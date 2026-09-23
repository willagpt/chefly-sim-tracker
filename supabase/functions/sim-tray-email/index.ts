// sim-tray-email — sends the weekly tray/pallet email via Amazon SES.
// Caller must be a logged-in tracker user with role manager or admin (checked
// against sim_profiles). The client composes and previews the exact message;
// this function only validates the caller and relays it to SES, so what was
// reviewed is what is sent.
// Secrets required (Edge Function secrets): SES_REGION, SES_ACCESS_KEY_ID,
// SES_SECRET_ACCESS_KEY. Optional: TRAY_FROM_ADDRESS (defaults to the
// sim_tray_settings row's email_from).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
    }
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not logged in" }), { status: 401, headers });
    }
    const { data: prof } = await userClient
      .from("sim_profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!prof || !["admin", "manager"].includes(prof.role)) {
      return new Response(JSON.stringify({ error: "Managers and admins only" }), { status: 403, headers });
    }

    const { to, cc, subject, text } = await req.json();
    if (!to || typeof to !== "string" || !to.includes("@")) {
      return new Response(JSON.stringify({ error: "Missing recipient" }), { status: 400, headers });
    }
    if (!text || typeof text !== "string" || text.length > 50000) {
      return new Response(JSON.stringify({ error: "Missing or oversized message body" }), { status: 400, headers });
    }
    const split = (s: unknown) =>
      String(s ?? "").split(",").map((x) => x.trim()).filter((x) => x.includes("@"));

    const { data: settings } = await userClient
      .from("sim_tray_settings").select("email_from").eq("id", 1).maybeSingle();
    const from = Deno.env.get("TRAY_FROM_ADDRESS") || settings?.email_from;
    if (!from) {
      return new Response(JSON.stringify({ error: "No from-address configured" }), { status: 400, headers });
    }

    const region = Deno.env.get("SES_REGION");
    const keyId = Deno.env.get("SES_ACCESS_KEY_ID");
    const secret = Deno.env.get("SES_SECRET_ACCESS_KEY");
    if (!region || !keyId || !secret) {
      return new Response(
        JSON.stringify({ error: "SES secrets not configured — add SES_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY in Edge Function secrets" }),
        { status: 500, headers },
      );
    }

    const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, region, service: "ses" });
    const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: from,
        Destination: { ToAddresses: split(to), CcAddresses: split(cc) },
        Content: {
          Simple: {
            Subject: { Data: String(subject || "Trays — weekly update"), Charset: "UTF-8" },
            Body: { Text: { Data: text, Charset: "UTF-8" } },
          },
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `SES ${res.status}: ${body?.message || "send failed"}` }),
        { status: 502, headers },
      );
    }
    return new Response(JSON.stringify({ ok: true, messageId: body?.MessageId ?? null }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
