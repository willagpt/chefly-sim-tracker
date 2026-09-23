// sim-drive-orders — fetches Simmer final-order PO PDFs from the Google Drive
// "Final Orders" folder, parses them, and (after the user reviews a preview in
// the tracker) applies them: wholesale shipments + lines, weekly plan targets
// (when the PO meal name maps to a tracker meal), and tray-ledger deliveries.
//
// Actions (POST JSON, caller must be manager/admin):
//   {action:"scan"}                       -> list folder, parse new/changed PDFs, return preview (no writes)
//   {action:"apply", weeks:[...]}         -> write the approved parsed weeks
//   {action:"alias", meal_id, alias}      -> remember a PO meal name for a tracker meal
//
// Secrets: GDRIVE_SA_KEY (service-account JSON), GDRIVE_FOLDER_ID.
// The service account only needs the Final Orders folder shared with it, read-only.
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.11.0";
import { importPKCS8, SignJWT } from "npm:jose@5";

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const CAPS: Record<string, number> = { Standard: 30, Lean: 30, Large: 24 };
const MEALS_PER_PALLET = 1080;

function parseUkDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}
function num(s: string): number {
  if (/^[–—-]+$/.test(s.trim())) return 0;
  return parseInt(s.replace(/[,\s]/g, ""), 10) || 0;
}

interface Line { meal: string; Standard: number; Lean: number; Large: number }
interface Section { po_number: string; dest: string; week_start: string | null; order_date: string | null; lines: Line[] }

function parsePo(text: string): Section[] {
  const out: Section[] = [];
  const chunks = text.split(/(?=UK PURCHASE ORDER|IRELAND PURCHASE\s*ORDER|IRELAND\s+PURCHASE|COMBINED TOTALS)/);
  for (const chunk of chunks) {
    if (/^\s*COMBINED TOTALS/.test(chunk)) continue;
    const po = chunk.match(/P\.O\.\s*NUMBER:\s*([A-Z0-9]+)/);
    if (!po) continue;
    const head = chunk.slice(0, 250);
    const dest = /IRELAND/.test(head) ? "IE" : /COOLPACK/.test(head) ? "CPUK" : "OIUK";
    const wc = chunk.match(/WEEK COMMENCING:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    const od = chunk.match(/ORDER DATE:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    // Column order comes from the header row; both generators vary it.
    const hdr = chunk.match(/MEAL\s+(STANDARD)\s+(LARGE|LEAN)\s+(LEAN|LARGE)/);
    const order = hdr ? [cap(hdr[1]), cap(hdr[2]), cap(hdr[3])] : ["Standard", "Large", "Lean"];
    const startIdx = hdr ? chunk.indexOf(hdr[0]) + hdr[0].length : 0;
    const endMatch = chunk.slice(startIdx).match(/(Protein total|Total units|All totals)/);
    const body = endMatch ? chunk.slice(startIdx, startIdx + (endMatch.index ?? 0)) : chunk.slice(startIdx);
    const lines: Line[] = [];
    for (const raw of body.split("\n")) {
      const t = raw.trim();
      if (!t || /^PROTEIN$/i.test(t)) continue;
      const m = t.match(/^(.*?)\s+([\d,]+|[–—-])\s+([\d,]+|[–—-])\s+([\d,]+|[–—-])\s*$/);
      if (!m || !m[1] || /^https?:/.test(m[1])) continue;
      const vals = [num(m[2]), num(m[3]), num(m[4])];
      const line: Line = { meal: m[1].replace(/\s+/g, " ").trim(), Standard: 0, Lean: 0, Large: 0 };
      order.forEach((c, i) => { (line as unknown as Record<string, number>)[c] = vals[i]; });
      if (line.Standard + line.Lean + line.Large > 0 || lines.length === 0) lines.push(line);
    }
    if (!lines.length) continue;
    out.push({
      po_number: po[1], dest,
      week_start: wc ? parseUkDate(wc[1]) : null,
      order_date: od ? parseUkDate(od[1]) : null,
      lines,
    });
  }
  return out;
}
function cap(s: string) { return s[0] + s.slice(1).toLowerCase(); }

async function googleToken(): Promise<string> {
  const raw = Deno.env.get("GDRIVE_SA_KEY");
  if (!raw) throw new Error("Google credentials not configured — add GDRIVE_SA_KEY (the service-account JSON) and GDRIVE_FOLDER_ID in Edge Function secrets");
  const sa = JSON.parse(raw);
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/drive.readonly" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("Google auth failed: " + (j.error_description || j.error || res.status));
  return j.access_token;
}

async function listFolder(token: string) {
  const folder = Deno.env.get("GDRIVE_FOLDER_ID");
  if (!folder) throw new Error("GDRIVE_FOLDER_ID secret not set");
  const q = encodeURIComponent(`'${folder}' in parents and mimeType='application/pdf' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error("Drive list failed: " + (j.error?.message || res.status));
  return j.files as { id: string; name: string; modifiedTime: string }[];
}

async function downloadPdf(token: string, id: string): Promise<Uint8Array> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive download failed: " + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

async function requireManager(req: Request): Promise<SupabaseClient> {
  const auth = req.headers.get("Authorization") ?? "";
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) throw new Error("Not logged in");
  const { data: prof } = await client.from("sim_profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!prof || !["admin", "manager"].includes(prof.role)) throw new Error("Managers and admins only");
  return client;
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
    const sb = await requireManager(req);
    const body = await req.json();

    if (body.action === "alias") {
      const { meal_id, alias } = body;
      if (!meal_id || !alias) throw new Error("meal_id and alias required");
      const { data: meal } = await sb.from("sim_ws_meals").select("po_aliases").eq("id", meal_id).maybeSingle();
      const existing = (meal?.po_aliases || "").split("|").map((s: string) => s.trim()).filter(Boolean);
      if (!existing.some((a: string) => a.toLowerCase() === String(alias).toLowerCase())) existing.push(alias);
      const { error } = await sb.from("sim_ws_meals").update({ po_aliases: existing.join(" | ") }).eq("id", meal_id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (body.action === "scan") {
      const token = await googleToken();
      const files = await listFolder(token);
      const { data: seen } = await sb.from("sim_drive_files").select("file_id,modified_time,applied_at");
      const seenMap = new Map((seen || []).map((r: { file_id: string; modified_time: string; applied_at: string | null }) => [r.file_id, r]));
      const results: unknown[] = [];
      for (const f of files) {
        const prior = seenMap.get(f.id);
        const isNew = !prior || prior.modified_time !== f.modifiedTime || !prior.applied_at;
        if (!isNew) { results.push({ file_id: f.id, name: f.name, status: "applied" }); continue; }
        try {
          const bytes = await downloadPdf(token, f.id);
          const doc = await getDocumentProxy(bytes);
          const { text } = await extractText(doc, { mergePages: true });
          const sections = parsePo(String(text));
          results.push({ file_id: f.id, name: f.name, modified_time: f.modifiedTime, status: sections.length ? "parsed" : "unreadable", sections });
        } catch (e) {
          results.push({ file_id: f.id, name: f.name, status: "error", error: String((e as Error).message || e) });
        }
      }
      const { data: meals } = await sb.from("sim_ws_meals").select("id,name,po_aliases");
      const { data: variants } = await sb.from("sim_ws_variants").select("id,meal_id,name");
      const { data: dests } = await sb.from("sim_ws_destinations").select("id,code");
      return new Response(JSON.stringify({ ok: true, files: results, meals, variants, dests }), { headers });
    }

    if (body.action === "apply") {
      const weeks = body.weeks || []; // [{file_id, name, modified_time, sections:[{po_number,dest,week_start,order_date,lines}], meal_map:{poName: meal_id}}]
      const { data: dests } = await sb.from("sim_ws_destinations").select("id,code");
      const destId = new Map((dests || []).map((d: { id: string; code: string }) => [d.code, d.id]));
      const applied: string[] = [];
      for (const w of weeks) {
        for (const sec of (w.sections || [])) {
          if (!sec.week_start || !destId.get(sec.dest)) continue;
          // week row
          let { data: wk } = await sb.from("sim_ws_weeks").select("id").eq("week_start", sec.week_start).maybeSingle();
          if (!wk) {
            const ins = await sb.from("sim_ws_weeks").insert({ week_start: sec.week_start, status: "confirmed" }).select("id").single();
            if (ins.error) throw ins.error;
            wk = ins.data;
          }
          // shipment upsert by po_number
          const dispatch = new Date(sec.week_start + "T00:00:00Z"); dispatch.setUTCDate(dispatch.getUTCDate() + 3);
          const dispatchIso = dispatch.toISOString().slice(0, 10);
          const productName = (sec.lines[0] && sec.lines[0].meal) || "Wholesale order";
          let { data: ship } = await sb.from("sim_ws_shipments").select("id").eq("po_number", sec.po_number).maybeSingle();
          if (ship) {
            await sb.from("sim_ws_shipments").update({ week_start: sec.week_start, product_name: productName, destination_id: destId.get(sec.dest), status: "confirmed" }).eq("id", ship.id);
            await sb.from("sim_ws_shipment_lines").delete().eq("shipment_id", ship.id);
          } else {
            const ins = await sb.from("sim_ws_shipments").insert({
              po_number: sec.po_number, destination_id: destId.get(sec.dest), week_start: sec.week_start,
              product_name: productName, dispatch_date: dispatchIso, trays_per_pallet: 45, status: "confirmed",
            }).select("id").single();
            if (ins.error) throw ins.error;
            ship = ins.data;
          }
          const lineRows: unknown[] = [];
          let so = 0;
          for (const l of sec.lines) {
            for (const cfg of ["Standard", "Large", "Lean"]) {
              const meals = (l as unknown as Record<string, number>)[cfg] || 0;
              if (meals > 0) lineRows.push({ shipment_id: ship!.id, config: cfg, meals, tray_capacity: CAPS[cfg], sort_order: so++ });
            }
          }
          if (lineRows.length) {
            const insL = await sb.from("sim_ws_shipment_lines").insert(lineRows);
            if (insL.error) throw insL.error;
          }
          // tray ledger delivery (skip if one already exists for this dest+week)
          const { data: exists } = await sb.from("sim_tray_events").select("id").eq("kind", "delivery").eq("destination_code", sec.dest).eq("week_start", sec.week_start).limit(1);
          if (!exists || !exists.length) {
            let trays = 0, meals = 0;
            for (const l of sec.lines) {
              trays += Math.ceil((l.Standard || 0) / 30) + Math.ceil((l.Lean || 0) / 30) + Math.ceil((l.Large || 0) / 24);
              meals += (l.Standard || 0) + (l.Lean || 0) + (l.Large || 0);
            }
            await sb.from("sim_tray_events").insert({
              event_date: dispatchIso, week_start: sec.week_start, kind: "delivery", destination_code: sec.dest,
              trays, pallets: Math.ceil(meals / MEALS_PER_PALLET), meals, shipment_id: ship!.id,
              confirmed: true, confirmed_by: "PO " + sec.po_number, source: "Drive fetch: " + (w.name || sec.po_number),
            });
          }
          // plan targets when the PO meal maps to a tracker meal (name, alias, or user-picked map)
          if (w.meal_map) {
            for (const l of sec.lines) {
              const mealId = w.meal_map[l.meal];
              if (!mealId) continue;
              const { data: vars } = await sb.from("sim_ws_variants").select("id,name").eq("meal_id", mealId);
              for (const v of (vars || [])) {
                const qty = (l as unknown as Record<string, number>)[v.name] ?? null;
                if (qty == null) continue;
                const { data: wl } = await sb.from("sim_ws_week_lines").select("id,target_qty").eq("week_id", wk!.id).eq("variant_id", v.id).maybeSingle();
                if (wl) await sb.from("sim_ws_week_lines").update({ target_qty: (sec.dest === "OIUK" ? 0 : wl.target_qty) + qty }).eq("id", wl.id);
                else await sb.from("sim_ws_week_lines").insert({ week_id: wk!.id, variant_id: v.id, target_qty: qty });
              }
            }
          }
        }
        await sb.from("sim_drive_files").upsert({
          file_id: w.file_id, name: w.name || "", modified_time: w.modified_time || null,
          parsed_at: new Date().toISOString(), applied_at: new Date().toISOString(),
          week_start: (w.sections && w.sections[0] && w.sections[0].week_start) || null,
        });
        applied.push(w.name || w.file_id);
      }
      return new Response(JSON.stringify({ ok: true, applied }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const status = /Not logged in/.test(msg) ? 401 : /only/.test(msg) ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), { status, headers });
  }
});
