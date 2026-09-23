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
let trDrive = null, trDriveBusy = false, trDriveChecked = {}, trDriveMap = {}

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

    ${mgr ? trDriveCard() : ''}

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

/* ---------- Drive fetch (final orders -> tracker) ---------- */
function trSecTotals (sec) {
  let trays = 0, meals = 0
  for (const l of (sec.lines || [])) {
    trays += Math.ceil((l.Standard || 0) / 30) + Math.ceil((l.Lean || 0) / 30) + Math.ceil((l.Large || 0) / 24)
    meals += (l.Standard || 0) + (l.Lean || 0) + (l.Large || 0)
  }
  return { trays, meals, pallets: Math.ceil(meals / (trSettings.meals_per_pallet || 1080)) }
}

function trDriveMatch (poName) {
  if (!trDrive || !trDrive.meals) return null
  const n = String(poName).trim().toLowerCase()
  for (const m of trDrive.meals) {
    if (String(m.name).trim().toLowerCase() === n) return m.id
    const aliases = String(m.po_aliases || '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (aliases.indexOf(n) !== -1) return m.id
  }
  return null
}

function trDriveCard () {
  let body = ''
  if (trDriveBusy) {
    body = '<p class="muted">Scanning the Final Orders folder and reading the PDFs — this can take a minute…</p>'
  } else if (!trDrive) {
    body = '<p class="muted">Reads the Simmer PO PDFs straight from the Final Orders folder in Google Drive, shows you what it found, and only writes after you approve. Nothing is imported without the preview.</p>'
  } else if (trDrive.error) {
    body = `<p class="msg err">${esc(trDrive.error)}</p>`
  } else {
    const files = trDrive.files || []
    const done = files.filter(f => f.status === 'applied')
    const parsed = files.filter(f => f.status === 'parsed')
    const bad = files.filter(f => f.status === 'unreadable' || f.status === 'error')
    const mealOpts = (trDrive.meals || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))

    const parsedCards = parsed.map(f => {
      const fk = esc(f.file_id)
      const checked = trDriveChecked[f.file_id] !== false
      const secRows = (f.sections || []).map(sec => {
        const t = trSecTotals(sec)
        const already = trEvents.some(e => e.kind === 'delivery' && e.destination_code === sec.dest && e.week_start === sec.week_start)
        return `<div class="muted" style="margin:2px 0 2px 24px">${esc(TR_DEST_LABELS[sec.dest] || sec.dest)} · PO ${esc(sec.po_number)} · w/c ${trDateGB(sec.week_start)} — <b>${trNum(t.meals)}</b> meals → <b>${trNum(t.trays)}</b> trays / <b>${trNum(t.pallets)}</b> pallets${already ? ' · ledger already has this week (won’t double-count)' : ''}</div>`
      }).join('')
      // one mapping row per distinct PO meal name that doesn't match a tracker meal
      const names = []
      ;(f.sections || []).forEach(sec => (sec.lines || []).forEach(l => { if (names.indexOf(l.meal) === -1) names.push(l.meal) }))
      const unmatched = names.filter(n => !trDriveMatch(n) && !(trDriveMap[f.file_id] && trDriveMap[f.file_id][n]))
      const mapRows = names.filter(n => !trDriveMatch(n)).map(n => {
        const cur = (trDriveMap[f.file_id] && trDriveMap[f.file_id][n]) || ''
        const opts = mealOpts.map(m => `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')
        return `<div class="row" style="margin:2px 0 2px 24px;align-items:center">
          <span class="muted" style="min-width:220px">"${esc(n)}" =</span>
          <select onchange="trDriveSetMap('${fk}', this.dataset.n, this.value)" data-n="${esc(n)}">
            <option value="">— skip plan update for this meal —</option>${opts}
          </select></div>`
      }).join('')
      return `<div class="task-item">
        <label style="display:flex;gap:8px;align-items:baseline"><input type="checkbox" ${checked ? 'checked' : ''} onchange="trDriveCheck('${fk}', this.checked)" /> <b>${esc(f.name)}</b></label>
        ${secRows}
        ${mapRows ? `<div class="muted" style="margin-left:24px;margin-top:4px">PO meal names the tracker doesn't know yet${unmatched.length ? '' : ' (all mapped)'} — pick the matching meal so the weekly plan fills in too (imports fine either way):</div>${mapRows}` : ''}
      </div>`
    }).join('')

    body = `
      ${done.length ? `<p class="muted">✓ ${done.length} file${done.length === 1 ? '' : 's'} already imported — skipped.</p>` : ''}
      ${parsed.length ? `<p style="margin:4px 0"><b>${parsed.length}</b> new or changed order${parsed.length === 1 ? '' : 's'} ready to import:</p>${parsedCards}
        <div class="row" style="margin-top:8px">
          <button class="green" onclick="trApplyDrive()">Import ticked orders</button>
          <button class="ghost" onclick="trDrive=null;trRender()">Discard preview</button>
        </div>` : '<p class="muted">Nothing new — every PDF in the folder is already in the tracker.</p>'}
      ${bad.map(f => `<p class="msg err">${esc(f.name)}: ${esc(f.error || 'could not read this PDF — enter that week by hand')}</p>`).join('')}`
  }
  return `<div class="card">
    <h2>Fetch final orders from Drive</h2>
    ${body}
    <div class="row" style="margin-top:6px">
      <button class="ghost" onclick="trFetchDrive()" ${trDriveBusy ? 'disabled' : ''}>${trDrive ? 'Re-scan folder' : 'Scan Final Orders folder'}</button>
    </div>
    <div id="trDriveMsg" class="msg"></div>
  </div>`
}

window.trDriveCheck = function (fileId, on) { trDriveChecked[fileId] = !!on }
window.trDriveSetMap = function (fileId, poName, mealId) {
  if (!trDriveMap[fileId]) trDriveMap[fileId] = {}
  trDriveMap[fileId][poName] = mealId || null
}

window.trFetchDrive = async function () {
  trDriveBusy = true; trDrive = null; trRender()
  const { data, error } = await sb.functions.invoke('sim-drive-orders', { body: { action: 'scan' } })
  trDriveBusy = false
  trDrive = error ? { error: (data && data.error) || error.message } : (data.error ? { error: data.error } : data)
  trRender()
}

window.trApplyDrive = async function () {
  const el = $('trDriveMsg')
  const parsed = ((trDrive && trDrive.files) || []).filter(f => f.status === 'parsed' && trDriveChecked[f.file_id] !== false)
  if (!parsed.length) { msg(el, 'Nothing ticked.', false); return }
  const weeks = parsed.map(f => {
    const meal_map = {}
    ;(f.sections || []).forEach(sec => (sec.lines || []).forEach(l => {
      const picked = (trDriveMap[f.file_id] && trDriveMap[f.file_id][l.meal]) || trDriveMatch(l.meal)
      if (picked) meal_map[l.meal] = picked
    }))
    return { file_id: f.file_id, name: f.name, modified_time: f.modified_time, sections: f.sections, meal_map }
  })
  msg(el, 'Importing ' + weeks.length + ' file' + (weeks.length === 1 ? '' : 's') + '…', true)
  const { data, error } = await sb.functions.invoke('sim-drive-orders', { body: { action: 'apply', weeks } })
  if (error || (data && data.error)) { msg(el, (data && data.error) || error.message, false); return }
  // remember the hand-picked name mappings so next time they match automatically
  for (const fid in trDriveMap) {
    for (const n in trDriveMap[fid]) {
      const id = trDriveMap[fid][n]
      if (id && !trDriveMatch(n)) await sb.functions.invoke('sim-drive-orders', { body: { action: 'alias', meal_id: id, alias: n } })
    }
  }
  trDrive = null; trDriveChecked = {}; trDriveMap = {}
  msg(el, 'Imported: ' + (data.applied || []).join(', '), true)
  loadTrays()
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
