/* TRAYS & PALLETS — transit-packaging ledger for the wholesale (Simmer) lane.
   PPS blue trays and UK blue pallets cycle out with deliveries (Oakland / Coolpack /
   Ireland) and must come back. This screen keeps the running balance per partner,
   logs this week's delivery straight from the wholesale shipments, sends the weekly
   email to Oakland (via the sim-tray-email edge function), and marks off returns —
   every return should carry WHO confirmed the count in writing.
   Maths (validated 23 Sep 2026 reconciliation): Standard 30 meals/tray, Lean 30,
   Large 24, rounded up per line; pallets = ceil(meals / 1,080).
   Follows MODULE_TEMPLATE: load() -> render() -> subscribe(). */

let trEvents = [], trSettings = null, trShipments = [], trChannel = null
let trEmailOpen = false, trEmailShipKey = null

const TR_CAPS = { standard: 30, lean: 30, large: 24 }
const TR_DEST_LABELS = { OIUK: 'Oakland International', CPUK: 'Coolpack Solutions (UK)', IE: 'Ireland (via Coolpack)' }

window.loadTrays = async function () {
  const [ev, st, sh] = await Promise.all([
    sb.from('sim_tray_events').select('*').order('event_date').order('created_at'),
    sb.from('sim_tray_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('sim_ws_shipments')
      .select('id,po_number,week_start,dispatch_date,product_name,status,destination_id,sim_ws_shipment_lines(config,meals,tray_capacity),sim_ws_destinations(code,name)')
      .order('week_start', { ascending: false }).limit(12)
  ])
  trEvents = ev.data || []
  trSettings = st.data || { fleet_trays: 3060, fleet_pallets: 50, meals_per_pallet: 1080, email_to: '', email_cc: '', email_from: '' }
  trShipments = sh.data || []
  trRender()
  trSubscribe()
}

function trSubscribe () {
  if (trChannel) return
  trChannel = db.onChanges('trays-live', ['sim_tray_events', 'sim_tray_settings'], () => loadTrays())
}

/* ---------- maths ---------- */
function trLineTrays (line) {
  const cap = TR_CAPS[String(line.config || '').toLowerCase()] || line.tray_capacity || 30
  return Math.ceil((line.meals || 0) / cap)
}
function trShipTotals (s) {
  const lines = s.sim_ws_shipment_lines || []
  const meals = lines.reduce((a, l) => a + (l.meals || 0), 0)
  const trays = lines.reduce((a, l) => a + trLineTrays(l), 0)
  const pallets = Math.ceil(meals / (trSettings.meals_per_pallet || 1080))
  return { meals, trays, pallets }
}
function trBalance (code) {
  let out = 0, back = 0, pOut = 0, pBack = 0
  trEvents.filter(e => e.destination_code === code).forEach(e => {
    if (e.kind === 'delivery') { out += e.trays; pOut += (e.pallets || 0) }
    else { back += e.trays; pBack += (e.pallets || 0) }
  })
  return { out, back, at: out - back, pOut, pBack, pAt: pOut - pBack }
}
function trNum (n) { return (n == null) ? '—' : Number(n).toLocaleString('en-GB') }
function trDateGB (d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—' }

/* ---------- render ---------- */
function trRender () {
  const box = $('traysBody'); if (!box) return
  const mgr = isManagerUp()
  const codes = ['OIUK', 'CPUK', 'IE']
  const totalOut = codes.reduce((a, c) => a + trBalance(c).at, 0)
  const inHouse = (trSettings.fleet_trays || 0) - totalOut

  const balCards = codes.map(c => {
    const b = trBalance(c)
    return `<div class="stat"><div class="n">${trNum(b.at)}</div><div class="l">${esc(TR_DEST_LABELS[c] || c)}<br><span class="muted">${trNum(b.out)} out · ${trNum(b.back)} back</span></div></div>`
  }).join('')

  const unconfirmed = trEvents.filter(e => !e.confirmed)
  const shipCards = trShipments.slice(0, 6).map(s => {
    const code = s.sim_ws_destinations && s.sim_ws_destinations.code
    const t = trShipTotals(s)
    const logged = trEvents.some(e => e.shipment_id === s.id)
    const key = esc(s.id)
    return `<div class="task-item">
      <div><b>${esc(s.po_number)}</b> · ${esc(TR_DEST_LABELS[code] || code || '?')} ${pill(esc(s.status), 'live')}</div>
      <div class="muted">w/c ${trDateGB(s.week_start)} · dispatch ${trDateGB(s.dispatch_date)} · ${esc(s.product_name)}</div>
      <div><b>${trNum(t.meals)}</b> meals → <b>${trNum(t.trays)}</b> trays on <b>${trNum(t.pallets)}</b> pallets</div>
      ${logged ? '<div class="muted">✓ already in the ledger</div>'
        : (mgr ? `<div class="row" style="margin-top:6px">
            <button class="ghost sm" onclick="trLogShipment('${key}', false)">Log delivery</button>
            ${code === 'OIUK' ? `<button class="green sm" onclick="trLogShipment('${key}', true)">Log &amp; email Oakland…</button>` : ''}
          </div>` : '')}
    </div>`
  }).join('') || '<p class="muted">No wholesale shipments found — add them on the Wholesale screen.</p>'

  const ledgerRows = trEvents.slice().reverse().map(e => `
    <div class="task-item">
      <div><b>${trDateGB(e.event_date)}</b> · ${e.kind === 'delivery' ? 'Delivery →' : '↩ Return from'} ${esc(TR_DEST_LABELS[e.destination_code] || e.destination_code)}
        ${e.confirmed ? pill('confirmed', 'active') : pill('⚠ unconfirmed', 'alert')}
        ${e.email_sent_at ? pill('emailed', 'live') : ''}</div>
      <div><b>${trNum(e.trays)}</b> trays${e.pallets != null ? ` · <b>${trNum(e.pallets)}</b> pallets` : ''}${e.meals != null ? ` · ${trNum(e.meals)} meals` : ''}</div>
      <div class="muted">${esc(e.source || '')}${e.confirmed_by ? ' · confirmed by ' + esc(e.confirmed_by) : ''}${e.note ? ' · ' + esc(e.note) : ''}</div>
      ${mgr && !e.confirmed ? `<button class="ghost sm" onclick="trConfirm('${esc(e.id)}')">Mark confirmed…</button>` : ''}
    </div>`).join('')

  box.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Trays &amp; pallets</h2><span class="pill live">● LIVE</span></div>
      <p class="muted" style="margin-top:2px">30/30/24 meals per tray (rounded up per line) · ${trNum(trSettings.meals_per_pallet)} meals per pallet · fleet ${trNum(trSettings.fleet_trays)} trays / ${trNum(trSettings.fleet_pallets)} blue pallets</p>
      <div class="stat-grid">${balCards}
        <div class="stat"><div class="n">${trNum(inHouse)}</div><div class="l">Trays in-house (calc)</div></div>
      </div>
      ${unconfirmed.length ? `<p class="muted">⚠ ${unconfirmed.length} ledger entr${unconfirmed.length === 1 ? 'y' : 'ies'} still need a written count.</p>` : ''}
    </div>

    <div class="card"><h2>This week's shipments</h2><p class="muted" style="margin-top:-8px">Pulled from the Wholesale lane. Logging a delivery writes it to the ledger; "Log &amp; email" also sends the weekly summary to Oakland after you review it.</p>${shipCards}</div>

    <div id="trEmailCard" class="card ${trEmailOpen ? '' : 'hidden'}">
      <h2>Email to Oakland — review before sending</h2>
      <div class="row">
        <div><label for="trTo">To</label><input id="trTo" type="text" value="${esc(trSettings.email_to || '')}" /></div>
        <div><label for="trCc">Cc</label><input id="trCc" type="text" value="${esc(trSettings.email_cc || '')}" /></div>
      </div>
      <label for="trSubject">Subject</label><input id="trSubject" type="text" />
      <label for="trBody">Message</label><textarea id="trBody" rows="12"></textarea>
      <div class="row" style="margin-top:6px">
        <button class="green" onclick="trSendEmail()">Send email &amp; log</button>
        <button class="ghost" onclick="trEmailOpen=false;trRender()">Cancel</button>
      </div>
      <div id="trEmailMsg" class="msg"></div>
    </div>

    ${mgr ? `<div class="card">
      <h2>Log a return</h2>
      <p class="muted" style="margin-top:-8px">Every load coming back. Always record who confirmed the count in writing — the unconfirmed loads are where this month's discrepancies came from.</p>
      <div class="row">
        <div><label for="trRetDate">Date</label><input id="trRetDate" type="date" /></div>
        <div><label for="trRetDest">From</label><select id="trRetDest"><option value="OIUK">Oakland</option><option value="CPUK">Coolpack UK</option><option value="IE">Ireland</option></select></div>
      </div>
      <div class="row">
        <div><label for="trRetTrays">Trays</label><input id="trRetTrays" type="number" inputmode="numeric" placeholder="e.g. 1770" /></div>
        <div><label for="trRetPallets">Pallets (blank if unknown)</label><input id="trRetPallets" type="number" inputmode="numeric" /></div>
      </div>
      <label for="trRetWho">Count confirmed in writing by (leave blank if not yet)</label>
      <input id="trRetWho" type="text" placeholder="e.g. Sushila / D2C Admin, email 25 Sep" />
      <label for="trRetNote">Note (optional)</label>
      <input id="trRetNote" type="text" placeholder="e.g. DMC 910 trailer" />
      <button class="green" onclick="trLogReturn()">Log return</button>
      <div id="trRetMsg" class="msg"></div>
    </div>` : ''}

    <div class="card"><h2>Ledger</h2>${ledgerRows || '<p class="muted">No events yet.</p>'}</div>

    ${mgr ? `<div class="card">
      <h2>Settings</h2>
      <div class="row">
        <div><label for="trSetFleet">Fleet: trays</label><input id="trSetFleet" type="number" value="${trSettings.fleet_trays || 0}" /></div>
        <div><label for="trSetPallets">Fleet: blue pallets</label><input id="trSetPallets" type="number" value="${trSettings.fleet_pallets || 0}" /></div>
        <div><label for="trSetMpp">Meals per pallet</label><input id="trSetMpp" type="number" value="${trSettings.meals_per_pallet || 1080}" /></div>
      </div>
      <label for="trSetTo">Email to</label><input id="trSetTo" type="text" value="${esc(trSettings.email_to || '')}" />
      <label for="trSetCc">Email cc</label><input id="trSetCc" type="text" value="${esc(trSettings.email_cc || '')}" />
      <label for="trSetFrom">Send from (must be a verified SES address)</label><input id="trSetFrom" type="text" value="${esc(trSettings.email_from || '')}" />
      <button class="ghost" onclick="trSaveSettings()">Save settings</button>
      <div id="trSetMsg" class="msg"></div>
    </div>` : ''}`

  const rd = $('trRetDate'); if (rd && !rd.value) rd.value = new Date().toISOString().slice(0, 10)
  if (trEmailOpen) trFillEmail()
}

/* ---------- email ---------- */
function trFillEmail () {
  const s = trShipments.find(x => x.id === trEmailShipKey); if (!s) return
  const t = trShipTotals(s)
  const b = trBalance('OIUK')
  const wc = trDateGB(s.week_start)
  const pending = trShipTotals(s).trays // this week's, not yet in b (logged on send)
  $('trSubject').value = 'Trays — weekly update, w/c ' + wc
  $('trBody').value =
`Hi,

This week's confirmed order (w/c ${wc}): ${trNum(t.trays)} PPS blue trays on ${trNum(t.pallets)} pallets (${trNum(t.meals)} meals), arriving with the usual delivery.

Running balance per our ledger: ${trNum(b.out)} trays delivered to date and ${trNum(b.back)} returned, so ${trNum(b.at + pending)} trays will be with you once this delivery lands.

Please could the outstanding empty trays and our blue pallets come back on Thursday's collection, with the tray and pallet counts confirmed in writing as agreed.

Thanks so much,
Chefly / Willa Ltd`
}

window.trLogShipment = async function (shipmentId, withEmail) {
  const s = trShipments.find(x => x.id === shipmentId)
  if (!s) return
  if (withEmail) { trEmailOpen = true; trEmailShipKey = shipmentId; trRender(); return }
  await trInsertDelivery(s, null)
}

async function trInsertDelivery (s, emailMeta) {
  const code = s.sim_ws_destinations && s.sim_ws_destinations.code
  const t = trShipTotals(s)
  const row = {
    event_date: s.dispatch_date, week_start: s.week_start, kind: 'delivery',
    destination_code: code || 'OIUK', trays: t.trays, pallets: t.pallets, meals: t.meals,
    shipment_id: s.id, confirmed: true, confirmed_by: 'PO ' + s.po_number,
    source: 'Logged from Wholesale shipment ' + s.po_number
  }
  if (emailMeta) { row.email_sent_at = new Date().toISOString(); row.email_to = emailMeta.to }
  const { error } = await sb.from('sim_tray_events').insert(row)
  if (error) throw error
}

window.trSendEmail = async function () {
  const el = $('trEmailMsg')
  const s = trShipments.find(x => x.id === trEmailShipKey)
  if (!s) { msg(el, 'Shipment not found — reload the tab.', false); return }
  const to = $('trTo').value.trim(), cc = $('trCc').value.trim()
  const subject = $('trSubject').value.trim(), body = $('trBody').value
  if (!to) { msg(el, 'Add at least one recipient.', false); return }
  if (!body.trim()) { msg(el, 'The message is empty.', false); return }
  msg(el, 'Sending…', true)
  const { data, error } = await sb.functions.invoke('sim-tray-email', { body: { to, cc, subject, text: body } })
  if (error || (data && data.error)) { msg(el, (data && data.error) || error.message, false); return }
  try { await trInsertDelivery(s, { to }) } catch (e) { msg(el, 'Email sent but ledger write failed: ' + e.message, false); return }
  trEmailOpen = false; trEmailShipKey = null
  msg(el, 'Sent and logged.', true)
  loadTrays()
}

/* ---------- returns / confirm / settings ---------- */
window.trLogReturn = async function () {
  const el = $('trRetMsg')
  const trays = parseInt($('trRetTrays').value, 10)
  if (!trays || trays < 1) { msg(el, 'Enter the number of trays.', false); return }
  const pallets = $('trRetPallets').value ? parseInt($('trRetPallets').value, 10) : null
  const who = $('trRetWho').value.trim()
  const { error } = await sb.from('sim_tray_events').insert({
    event_date: $('trRetDate').value, kind: 'return', destination_code: $('trRetDest').value,
    trays, pallets, confirmed: !!who, confirmed_by: who || null,
    note: $('trRetNote').value.trim() || null,
    source: 'Logged in tracker'
  })
  if (error) { msg(el, error.message, false); return }
  msg(el, 'Return logged' + (who ? '.' : ' — UNCONFIRMED: chase a written count.'), true)
  loadTrays()
}

window.trConfirm = async function (id) {
  const who = prompt('Who confirmed this count in writing? (name + where, e.g. "Sushila, email 25 Sep")')
  if (!who) return
  const { error } = await sb.from('sim_tray_events').update({ confirmed: true, confirmed_by: who }).eq('id', id)
  if (error) { alert(error.message); return }
  loadTrays()
}

window.trSaveSettings = async function () {
  const el = $('trSetMsg')
  const patch = {
    fleet_trays: parseInt($('trSetFleet').value, 10) || 0,
    fleet_pallets: parseInt($('trSetPallets').value, 10) || 0,
    meals_per_pallet: parseInt($('trSetMpp').value, 10) || 1080,
    email_to: $('trSetTo').value.trim(), email_cc: $('trSetCc').value.trim(),
    email_from: $('trSetFrom').value.trim(), updated_at: new Date().toISOString()
  }
  const { error } = await sb.from('sim_tray_settings').update(patch).eq('id', 1)
  if (error) { msg(el, error.message, false); return }
  msg(el, 'Saved.', true)
  loadTrays()
}
