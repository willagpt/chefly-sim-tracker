/* CCP: Critical Control Point monitoring — the food-safety register.

   This is the screen an inspector asks for first: "show me your CCP records".
   Three parts:
     1. Floor board  — big touch cards, one per active CCP, with a RECORD CHECK
                       button. Anyone signed in can record.
     2. Register     — manager view: every check in a date range, printable as
                       an evidence pack, exportable as CSV.
     3. Definitions  — manager view: the CCPs themselves. These must be typed
                       in from the APPROVED HACCP plan. Nothing is pre-seeded,
                       deliberately: an invented critical limit is worse than
                       no critical limit.

   The database is the real gate, not this file. sim_ccp_evaluate() computes
   `passed` server-side from the critical limits, so a client cannot save a
   fake pass, and it refuses to save an out-of-limit reading that has no
   corrective action and no product disposition. The checks below are only so
   staff get told before they hit Save.

   Classic script: everything top-level here is global. Every identifier in
   this file is prefixed `ccp` to stay clear of the other modules. */

// ---- state ----
let ccpDefs = []          // sim_ccps
let ccpGaps = []          // sim_ccp_gaps (active CCPs + overdue flag)
let ccpRecent = []        // today's checks, newest first
let ccpStaffList = []     // sim_staff for "who took the reading"
let ccpEquipList = []     // sim_equipment
let ccpOpenCcp = null     // id of the CCP whose form is expanded
let ccpRegRows = []       // last loaded register range
let ccpEditingDef = null  // id of the CCP definition being edited

const CCP_DISPOSITIONS = ['Held pending decision', 'Re-cooked / re-processed', 'Reworked', 'Returned to supplier', 'Discarded', 'Released after review']

// Map the database sentinel errors onto something a chef can act on.
function ccpErr(error) {
  const m = (error && error.message) || String(error || '')
  if (/CCP_ACTION_REQUIRED/.test(m)) return 'This reading is outside the critical limit. Write down what you did about it before saving.'
  if (/CCP_DISPOSITION_REQUIRED/.test(m)) return 'Say what happened to the affected product (held, re-cooked, discarded…) before saving.'
  if (/CCP_VALUE_REQUIRED/.test(m)) return 'Enter the reading before saving.'
  if (/CCP_TIME_INVALID/.test(m)) return 'The check time cannot be in the future — check the clock on this device.'
  if (/CCP_INACTIVE/.test(m)) return 'That control point has been switched off. Refresh the page.'
  if (/CCP_NOT_FOUND/.test(m)) return 'That control point no longer exists. Refresh the page.'
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that. Ask a manager.'
  return m
}

// ---- small formatters ----
function ccpLimitText(c) {
  if (!c) return '—'
  if (c.measure_kind !== 'numeric') return 'Pass / fail'
  const u = c.uom ? ' ' + c.uom : ''
  const lo = c.critical_min, hi = c.critical_max
  if (lo != null && hi != null) return lo + ' to ' + hi + u
  if (hi != null) return '≤ ' + hi + u
  if (lo != null) return '≥ ' + lo + u
  return '—'
}
function ccpReadingText(c, row) {
  if (!c) return '—'
  if (c.measure_kind !== 'numeric') return row.observed_ok ? 'Pass' : 'Fail'
  if (row.value == null) return '—'
  return row.value + (c.uom ? ' ' + c.uom : '')
}
function ccpDefById(id) { return ccpDefs.find(d => d.id === id) || null }
function ccpTimeShort(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
function ccpDateShort(ts) { try { return new Date(ts).toLocaleDateString('en-GB') } catch (e) { return '' } }
function ccpTodayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// Does this value sit inside the critical limits? Mirrors sim_ccp_evaluate()
// so the operator finds out before they hit Save, not after.
function ccpValueOk(c, val) {
  if (!c || val == null || val === '' || isNaN(Number(val))) return null
  const v = Number(val)
  if (c.critical_min != null && v < Number(c.critical_min)) return false
  if (c.critical_max != null && v > Number(c.critical_max)) return false
  return true
}

// ---- loading ----
async function initCcp() {
  const box = $('ccpBody'); if (!box) return
  if (!box.dataset.built) { box.innerHTML = ccpShell(); box.dataset.built = '1' }
  await ccpLoadAll()
}

async function ccpLoadAll() {
  const [defs, gaps, recent] = await Promise.all([
    sb.from('sim_ccps').select('*').order('sort_order').order('code'),
    sb.from('sim_ccp_gaps').select('*'),
    sb.from('sim_ccp_checks').select('*').gte('check_date', ccpTodayIso()).order('checked_at', { ascending: false })
  ])
  if (defs.error) { ccpBoardError(ccpErr(defs.error)); return }
  ccpDefs = defs.data || []
  ccpGaps = gaps.data || []
  ccpRecent = recent.data || []
  if (!ccpStaffList.length) {
    const { data } = await sb.from('sim_staff').select('id,full_name').eq('active', true).order('full_name')
    ccpStaffList = data || []
  }
  if (!ccpEquipList.length) {
    const { data } = await sb.from('sim_equipment').select('id,name').eq('active', true).order('name')
    ccpEquipList = data || []
  }
  ccpRenderBoard()
  ccpRenderDefs()
}

function ccpBoardError(text) {
  const el = $('ccpBoard'); if (el) el.innerHTML = `<p class="muted">Could not load the control points: ${esc(text)}</p>`
}

// ---- shell markup (built once) ----
function ccpShell() {
  const mgr = isManagerUp()
  return `
  <div class="card">
    <h2 style="margin:0 0 4px">Food safety checks</h2>
    <p class="muted" style="margin:0">Your critical control points. Take the reading, tap the card, type the number. If it fails, the app will make you record what you did about it — that is the record an inspector asks for.</p>
  </div>
  <div id="ccpAlert"></div>
  <div id="ccpBoard"><p class="muted">Loading…</p></div>
  ${mgr ? `
  <div class="card">
    <h2>Monitoring register (evidence)</h2>
    <p class="muted" style="margin-top:-8px">Every check in the range, with its critical limit, result, corrective action and who took it. Print this for an inspection.</p>
    <div class="row">
      <div><label for="ccpRegFrom">From</label><input id="ccpRegFrom" type="date" /></div>
      <div><label for="ccpRegTo">To</label><input id="ccpRegTo" type="date" /></div>
    </div>
    <div class="row">
      <button class="green" onclick="ccpLoadRegister()">Load</button>
      <button class="ghost" onclick="ccpRegRange(7)">Last 7 days</button>
      <button class="ghost" onclick="ccpRegRange(30)">Last 30 days</button>
    </div>
    <div class="row">
      <button class="ghost" onclick="ccpPrintRegister()">🖨 Print evidence pack</button>
      <button class="ghost" onclick="ccpExportCsv()">Export CSV</button>
    </div>
    <div id="ccpRegBody" style="margin-top:12px"><p class="muted">Pick a range, or tap Last 7 days.</p></div>
  </div>
  <div class="card">
    <h2>Control points (from the approved HACCP plan)</h2>
    <p class="muted" style="margin-top:-8px">Type these in exactly as they appear on your approved plan — the same step, the same critical limit, the same corrective action. Nothing here is pre-filled on purpose: a made-up limit is worse than none. Use <b>Plan ref</b> to note which section of the plan each one came from.</p>
    <div id="ccpDefList"></div>
    <div id="ccpDefForm" style="margin-top:10px"></div>
    <div id="ccpDefMsg" class="msg"></div>
  </div>` : ''}
  `
}

// ---- floor board ----
function ccpRenderBoard() {
  const box = $('ccpBoard'); if (!box) return
  const active = ccpDefs.filter(d => d.active)
  if (!active.length) {
    box.innerHTML = `<div class="card"><h2 style="margin:0 0 6px">No control points set up yet</h2>
      <p class="muted" style="margin:0">${isManagerUp()
        ? 'Add your CCPs below, copied from the approved HACCP plan. Until then nothing can be monitored here.'
        : 'Ask your manager to add the control points from the HACCP plan.'}</p></div>`
    ccpRenderAlert()
    return
  }
  box.innerHTML = active.map(ccpCardHtml).join('')
  ccpRenderAlert()
  if (ccpOpenCcp) ccpMountForm(ccpOpenCcp)
}

function ccpRenderAlert() {
  const el = $('ccpAlert'); if (!el) return
  const overdue = ccpGaps.filter(g => g.overdue)
  const fails = ccpRecent.filter(r => r.passed === false)
  const bits = []
  if (overdue.length) bits.push(`<div class="ccp-alert bad"><b>${overdue.length} check${overdue.length > 1 ? 's' : ''} overdue</b><div>${overdue.map(g => esc(g.ccp_code + ' ' + g.ccp_name)).join(' · ')}</div></div>`)
  if (fails.length) bits.push(`<div class="ccp-alert warn"><b>${fails.length} failed reading${fails.length > 1 ? 's' : ''} today</b><div>Each one has a corrective action recorded against it — check the affected product has been dealt with.</div></div>`)
  el.innerHTML = bits.join('')
}

function ccpCardHtml(c) {
  const gap = ccpGaps.find(g => g.ccp_id === c.id) || {}
  const last = ccpRecent.find(r => r.ccp_id === c.id)
  let state = 'ok', stateText = 'Up to date'
  if (!gap.last_check_at) { state = 'bad'; stateText = 'Never monitored' }
  else if (gap.overdue) { state = 'bad'; stateText = 'Overdue' }
  else if (c.frequency_hours == null) { state = 'idle'; stateText = 'No interval set' }
  // `last` only exists if the most recent check was today; otherwise show the
  // timestamp on its own rather than a reading of "—", which reads as a gap.
  const when = gap.last_check_at ? esc(ccpDateShort(gap.last_check_at)) + ' ' + esc(ccpTimeShort(gap.last_check_at)) : ''
  const lastLine = !gap.last_check_at
    ? 'No reading has ever been recorded against this control point.'
    : last
      ? `Last: ${esc(ccpReadingText(c, last))} ${last.passed ? '<span class="ccp-tag pass">PASS</span>' : '<span class="ccp-tag fail">FAIL</span>'} · ${when}`
      : `Last checked ${when}`
  const todayN = gap.checks_today || 0
  return `
  <div class="ccp-card ${state}" id="ccpCard_${esc(c.id)}">
    <div class="ccp-head">
      <div>
        <div class="ccp-code">${esc(c.code)}</div>
        <div class="ccp-name">${esc(c.name)}</div>
      </div>
      <span class="ccp-state ${state}">${esc(stateText)}</span>
    </div>
    <div class="ccp-limit">Critical limit: <b>${esc(ccpLimitText(c))}</b>${c.frequency ? ' · ' + esc(c.frequency) : ''}</div>
    <div class="ccp-last">${lastLine}</div>
    <div class="ccp-last">${todayN} recorded today</div>
    <button class="green ccp-go" data-ccp="${esc(c.id)}" onclick="ccpToggleForm(this.dataset.ccp)">RECORD CHECK</button>
    <div class="ccp-form" id="ccpForm_${esc(c.id)}"></div>
  </div>`
}

window.ccpToggleForm = function (id) {
  if (ccpOpenCcp === id) { ccpOpenCcp = null; const f = $('ccpForm_' + id); if (f) f.innerHTML = ''; return }
  if (ccpOpenCcp) { const old = $('ccpForm_' + ccpOpenCcp); if (old) old.innerHTML = '' }
  ccpOpenCcp = id
  ccpMountForm(id)
}

function ccpMountForm(id) {
  const c = ccpDefById(id); const box = $('ccpForm_' + id)
  if (!c || !box) return
  const numeric = c.measure_kind === 'numeric'
  const prodOpts = ['<option value="">— none —</option>'].concat((products || []).map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)).join('')
  const staffOpts = ['<option value="">— me —</option>'].concat(ccpStaffList.map(s => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`)).join('')
  const equipOpts = ['<option value="">— none —</option>'].concat(ccpEquipList.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`)).join('')
  box.innerHTML = `
    <div class="ccp-formin">
      ${numeric ? `
        <label for="ccpVal_${esc(c.id)}">Reading${c.uom ? ' (' + esc(c.uom) + ')' : ''}</label>
        <input id="ccpVal_${esc(c.id)}" class="ccp-big" type="number" inputmode="decimal" step="any" placeholder="e.g. 82"
               data-ccp="${esc(c.id)}" oninput="ccpVerdict(this.dataset.ccp)" />
      ` : `
        <label>Result</label>
        <div class="row">
          <button class="green" data-ccp="${esc(c.id)}" onclick="ccpSetPf(this.dataset.ccp,'1')" id="ccpPfY_${esc(c.id)}">✓ PASS</button>
          <button class="ghost" data-ccp="${esc(c.id)}" onclick="ccpSetPf(this.dataset.ccp,'0')" id="ccpPfN_${esc(c.id)}">✗ FAIL</button>
        </div>
        <input type="hidden" id="ccpPf_${esc(c.id)}" value="" />
      `}
      <div id="ccpVerdict_${esc(c.id)}" class="ccp-verdict"></div>

      <div class="row">
        <div><label for="ccpProd_${esc(c.id)}">Product (optional)</label><select id="ccpProd_${esc(c.id)}">${prodOpts}</select></div>
        <div><label for="ccpBatch_${esc(c.id)}">Batch code (optional)</label><input id="ccpBatch_${esc(c.id)}" type="text" placeholder="e.g. BRIS-260723" /></div>
      </div>
      <div class="row">
        <div><label for="ccpEquip_${esc(c.id)}">Equipment (optional)</label><select id="ccpEquip_${esc(c.id)}">${equipOpts}</select></div>
        <div><label for="ccpWho_${esc(c.id)}">Who took the reading</label><select id="ccpWho_${esc(c.id)}">${staffOpts}</select></div>
      </div>

      <div id="ccpFail_${esc(c.id)}" class="ccp-fail hidden">
        <div class="ccp-fail-head">⚠ Outside the critical limit — this must be dealt with now</div>
        <label for="ccpAct_${esc(c.id)}">What did you do about it? (corrective action)</label>
        <textarea id="ccpAct_${esc(c.id)}" rows="2" placeholder="e.g. returned to the oven and re-cooked to 84 °C, re-probed at 12:40"></textarea>
        <label for="ccpDisp_${esc(c.id)}">What happened to the product?</label>
        <select id="ccpDisp_${esc(c.id)}"><option value="">— choose —</option>${CCP_DISPOSITIONS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
        ${c.corrective_action ? `<p class="muted" style="margin-top:8px">Plan says: ${esc(c.corrective_action)}</p>` : ''}
      </div>

      <label for="ccpNotes_${esc(c.id)}">Notes (optional)</label>
      <input id="ccpNotes_${esc(c.id)}" type="text" placeholder="anything worth recording" />

      <div class="row">
        <button class="green" data-ccp="${esc(c.id)}" onclick="ccpSaveCheck(this.dataset.ccp)">SAVE CHECK</button>
        <button class="ghost" data-ccp="${esc(c.id)}" onclick="ccpToggleForm(this.dataset.ccp)">Cancel</button>
      </div>
      <div id="ccpMsg_${esc(c.id)}" class="msg"></div>
    </div>`
  const first = $('ccpVal_' + c.id); if (first) first.focus()
}

window.ccpSetPf = function (id, val) {
  const h = $('ccpPf_' + id); if (h) h.value = val
  const y = $('ccpPfY_' + id), n = $('ccpPfN_' + id)
  if (y) y.className = val === '1' ? 'green' : 'ghost'
  if (n) n.className = val === '0' ? 'red' : 'ghost'
  ccpVerdict(id)
}

window.ccpVerdict = function (id) {
  const c = ccpDefById(id); if (!c) return
  const vbox = $('ccpVerdict_' + id), fbox = $('ccpFail_' + id)
  let ok = null
  if (c.measure_kind === 'numeric') {
    const el = $('ccpVal_' + id)
    ok = ccpValueOk(c, el ? el.value : null)
  } else {
    const h = $('ccpPf_' + id)
    ok = (h && h.value === '1') ? true : (h && h.value === '0') ? false : null
  }
  if (vbox) {
    vbox.className = 'ccp-verdict' + (ok === true ? ' pass' : ok === false ? ' fail' : '')
    vbox.textContent = ok === true ? '✓ Within the critical limit' : ok === false ? '✗ OUTSIDE the critical limit (' + ccpLimitText(c) + ')' : ''
  }
  if (fbox) fbox.classList.toggle('hidden', ok !== false)
}

window.ccpSaveCheck = async function (id) {
  const c = ccpDefById(id); if (!c) return
  const m = $('ccpMsg_' + id); if (m) clearMsg(m)
  const btnBox = $('ccpForm_' + id)
  const rec = { ccp_id: id }

  if (c.measure_kind === 'numeric') {
    const raw = ($('ccpVal_' + id) || {}).value
    if (raw === '' || raw == null || isNaN(Number(raw))) { if (m) msg(m, 'Enter the reading first.', false); return }
    rec.value = Number(raw)
  } else {
    const h = $('ccpPf_' + id)
    if (!h || h.value === '') { if (m) msg(m, 'Tap PASS or FAIL first.', false); return }
    rec.observed_ok = h.value === '1'
  }

  const failed = (c.measure_kind === 'numeric') ? (ccpValueOk(c, rec.value) === false) : (rec.observed_ok === false)
  if (failed) {
    const act = (($('ccpAct_' + id) || {}).value || '').trim()
    const disp = (($('ccpDisp_' + id) || {}).value || '').trim()
    if (!act) { if (m) msg(m, 'Write down what you did about the failed check before saving.', false); return }
    if (!disp) { if (m) msg(m, 'Choose what happened to the affected product before saving.', false); return }
    rec.corrective_action = act
    rec.disposition = disp
  }

  const prod = (($('ccpProd_' + id) || {}).value || '').trim(); if (prod) rec.product = prod
  const batch = (($('ccpBatch_' + id) || {}).value || '').trim(); if (batch) rec.batch_code = batch
  const eq = (($('ccpEquip_' + id) || {}).value || ''); if (eq) rec.equipment_id = eq
  const who = (($('ccpWho_' + id) || {}).value || ''); if (who) rec.staff_id = who
  const notes = (($('ccpNotes_' + id) || {}).value || '').trim(); if (notes) rec.notes = notes
  if (me && me.id) rec.user_id = me.id

  if (btnBox) btnBox.querySelectorAll('button').forEach(b => { b.disabled = true })
  const { error } = await sb.from('sim_ccp_checks').insert(rec)
  if (btnBox) btnBox.querySelectorAll('button').forEach(b => { b.disabled = false })
  if (error) { if (m) msg(m, ccpErr(error), false); return }

  ccpOpenCcp = null
  await ccpLoadAll()
  const card = $('ccpCard_' + id)
  if (card) {
    const flash = document.createElement('div')
    flash.className = 'msg ok show'
    flash.textContent = failed ? 'Saved — failed reading and corrective action are on the record.' : 'Saved.'
    card.appendChild(flash)
    setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash) }, 4000)
  }
}

// ---- register (manager) ----
window.ccpRegRange = function (days) {
  const to = new Date(), from = new Date()
  from.setDate(from.getDate() - (days - 1))
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const f = $('ccpRegFrom'), t = $('ccpRegTo')
  if (f) f.value = iso(from); if (t) t.value = iso(to)
  ccpLoadRegister()
}

window.ccpLoadRegister = async function () {
  const box = $('ccpRegBody'); if (!box) return
  const from = (($('ccpRegFrom') || {}).value) || ccpTodayIso()
  const to = (($('ccpRegTo') || {}).value) || ccpTodayIso()
  box.innerHTML = '<p class="muted">Loading…</p>'
  const { data, error } = await sb.from('sim_ccp_register').select('*')
    .gte('check_date', from).lte('check_date', to)
    .order('checked_at', { ascending: false })
  if (error) { box.innerHTML = `<p class="muted">Could not load: ${esc(ccpErr(error))}</p>`; return }
  ccpRegRows = data || []
  ccpRenderRegister(from, to)
}

function ccpRenderRegister(from, to) {
  const box = $('ccpRegBody'); if (!box) return
  if (!ccpRegRows.length) {
    box.innerHTML = `<p class="muted">No checks recorded between ${esc(from)} and ${esc(to)}. For an inspection that is the worst answer — it reads as "not monitored".</p>`
    return
  }
  const fails = ccpRegRows.filter(r => r.passed === false)
  const head = `<p class="muted" style="margin:0 0 10px">${ccpRegRows.length} check${ccpRegRows.length > 1 ? 's' : ''} · ${fails.length} outside the critical limit${fails.length ? ' (all with a corrective action recorded)' : ''}</p>`
  const rows = ccpRegRows.map(r => `
    <tr>
      <td>${esc(ccpDateShort(r.checked_at))}<br><span class="muted">${esc(ccpTimeShort(r.checked_at))}</span></td>
      <td><b>${esc(r.ccp_code)}</b><br><span class="muted">${esc(r.ccp_name)}</span></td>
      <td>${esc(r.critical_limit)}</td>
      <td><b>${esc(r.reading)}</b></td>
      <td>${r.passed ? '<span class="ccp-tag pass">PASS</span>' : '<span class="ccp-tag fail">FAIL</span>'}</td>
      <td>${esc(meta([r.product, r.batch_code, r.equipment]))}</td>
      <td>${esc(r.corrective_action || '')}${r.disposition ? '<br><span class="muted">' + esc(r.disposition) + '</span>' : ''}</td>
      <td>${esc(r.recorded_by || '')}</td>
    </tr>`).join('')
  box.innerHTML = head + `<div class="ccp-tablewrap"><table class="ccp-table">
    <thead><tr><th>When</th><th>CCP</th><th>Critical limit</th><th>Reading</th><th>Result</th><th>Product / batch</th><th>Corrective action</th><th>By</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

window.ccpExportCsv = function () {
  if (!ccpRegRows.length) { alert('Load a range first.'); return }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
  const head = ['Date', 'Time', 'CCP code', 'CCP name', 'Process step', 'Critical limit', 'Reading', 'Result', 'Product', 'Batch code', 'Equipment', 'Corrective action', 'Disposition', 'Notes', 'Recorded by']
  const lines = [head.map(q).join(',')]
  ccpRegRows.forEach(r => {
    lines.push([ccpDateShort(r.checked_at), ccpTimeShort(r.checked_at), r.ccp_code, r.ccp_name, r.process_step,
      r.critical_limit, r.reading, r.result, r.product, r.batch_code, r.equipment,
      r.corrective_action, r.disposition, r.notes, r.recorded_by].map(q).join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'ccp-register-' + ccpTodayIso() + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

window.ccpPrintRegister = function () {
  if (!ccpRegRows.length) { alert('Load a range first — the printout is whatever is on screen.'); return }
  const from = (($('ccpRegFrom') || {}).value) || '', to = (($('ccpRegTo') || {}).value) || ''
  const fails = ccpRegRows.filter(r => r.passed === false)
  const rows = ccpRegRows.slice().reverse().map(r => `
    <tr>
      <td>${esc(ccpDateShort(r.checked_at))} ${esc(ccpTimeShort(r.checked_at))}</td>
      <td>${esc(r.ccp_code)} ${esc(r.ccp_name)}</td>
      <td>${esc(r.critical_limit)}</td>
      <td><b>${esc(r.reading)}</b></td>
      <td>${r.passed ? 'PASS' : '<b>FAIL</b>'}</td>
      <td>${esc(meta([r.product, r.batch_code, r.equipment]))}</td>
      <td>${esc(r.corrective_action || '')}${r.disposition ? '<br>' + esc(r.disposition) : ''}</td>
      <td>${esc(r.recorded_by || '')}</td>
    </tr>`).join('')
  const defs = ccpDefs.filter(d => d.active).map(d => `
    <tr>
      <td>${esc(d.code)}</td><td>${esc(d.name)}</td><td>${esc(d.process_step || '')}</td>
      <td>${esc(d.hazard || '')}</td><td>${esc(ccpLimitText(d))}</td>
      <td>${esc(d.frequency || '')}</td><td>${esc(d.corrective_action || '')}</td>
      <td>${esc(d.verification || '')}</td><td>${esc(d.plan_ref || '')}</td>
    </tr>`).join('')
  $('printArea').innerHTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:8px">
    <h2 style="margin:0 0 2px">CCP Monitoring Register</h2>
    <div style="font-size:12px;margin-bottom:10px">Chefly · Willa Ltd &nbsp;|&nbsp; Period: ${esc(from)} to ${esc(to)}
      &nbsp;|&nbsp; Printed: ${esc(new Date().toLocaleString('en-GB'))}
      &nbsp;|&nbsp; ${ccpRegRows.length} records, ${fails.length} outside critical limits</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead><tr style="background:#eee">
        <th style="border:1px solid #999;padding:3px;text-align:left">When</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">CCP</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Critical limit</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Reading</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Result</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Product / batch</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Corrective action &amp; disposition</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Recorded by</th>
      </tr></thead>
      <tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #999;padding:3px;vertical-align:top">')}</tbody>
    </table>
    <h3 style="margin:16px 0 4px;font-size:13px">Appendix — control points monitored (from the approved HACCP plan)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead><tr style="background:#eee">
        <th style="border:1px solid #999;padding:3px;text-align:left">Code</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Control point</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Process step</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Hazard</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Critical limit</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Frequency</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Corrective action</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Verification</th>
        <th style="border:1px solid #999;padding:3px;text-align:left">Plan ref</th>
      </tr></thead>
      <tbody>${defs.replace(/<td>/g, '<td style="border:1px solid #999;padding:3px;vertical-align:top">')}</tbody>
    </table>
    <div style="margin-top:18px;font-size:11px">
      Verified by: ____________________________ &nbsp;&nbsp; Signature: ____________________ &nbsp;&nbsp; Date: ____________
    </div>
    <div style="margin-top:10px;font-size:9px;color:#444">Records are generated from the SIM Tracker CCP register. Pass/fail is evaluated by the system against the critical limits above; an out-of-limit reading cannot be saved without a corrective action and a product disposition. All amendments are retained in the change log.</div>
  </div>`
  window.print()
}

// ---- definitions (manager) ----
function ccpRenderDefs() {
  const box = $('ccpDefList'); if (!box) return
  if (!ccpDefs.length) {
    box.innerHTML = '<p class="muted">No control points yet.</p>'
  } else {
    box.innerHTML = ccpDefs.map(d => `
      <div class="task-item" style="align-items:flex-start">
        <div style="min-width:0">
          <b>${esc(d.code)} — ${esc(d.name)}</b>${d.active ? '' : ' <span class="pill">off</span>'}
          <div class="meta">${esc(meta([d.process_step, 'Limit: ' + ccpLimitText(d), d.frequency, d.plan_ref ? 'Plan ' + d.plan_ref : '']))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="ghost sm" data-id="${esc(d.id)}" onclick="ccpEditDef(this.dataset.id)">Edit</button>
          <button class="${d.active ? 'red' : 'green'} sm" data-id="${esc(d.id)}" onclick="ccpToggleDef(this.dataset.id)">${d.active ? 'Switch off' : 'Switch on'}</button>
        </div>
      </div>`).join('')
  }
  if (!$('ccpDefForm').dataset.open) ccpDefFormRender(null)
}

function ccpDefFormRender(d) {
  const box = $('ccpDefForm'); if (!box) return
  d = d || {}
  const v = k => esc(d[k] == null ? '' : d[k])
  box.innerHTML = `
    <div class="row">
      <div><label for="cdCode">Code</label><input id="cdCode" type="text" placeholder="e.g. CCP1" value="${v('code')}" /></div>
      <div><label for="cdName">Name</label><input id="cdName" type="text" placeholder="e.g. Cook — core temperature" value="${v('name')}" /></div>
    </div>
    <div class="row">
      <div><label for="cdStep">Process step</label><input id="cdStep" type="text" placeholder="e.g. Sous-vide cook" value="${v('process_step')}" /></div>
      <div><label for="cdHazard">Hazard</label><input id="cdHazard" type="text" placeholder="e.g. Survival of vegetative pathogens" value="${v('hazard')}" /></div>
    </div>
    <div class="row">
      <div><label for="cdKind">Measured how?</label><select id="cdKind" onchange="ccpDefKindChanged()">
        <option value="numeric"${d.measure_kind === 'pass_fail' ? '' : ' selected'}>A number (e.g. °C)</option>
        <option value="pass_fail"${d.measure_kind === 'pass_fail' ? ' selected' : ''}>Pass / fail observation</option>
      </select></div>
      <div><label for="cdUom">Unit</label><input id="cdUom" type="text" placeholder="e.g. °C" value="${v('uom')}" /></div>
    </div>
    <div class="row" id="cdLimitRow">
      <div><label for="cdMin">Critical minimum</label><input id="cdMin" type="number" inputmode="decimal" step="any" placeholder="e.g. 75" value="${v('critical_min')}" /></div>
      <div><label for="cdMax">Critical maximum</label><input id="cdMax" type="number" inputmode="decimal" step="any" placeholder="e.g. 8" value="${v('critical_max')}" /></div>
    </div>
    <p class="muted" id="cdLimitHint">Fill in whichever the plan gives. A cook step usually has a minimum only (≥ 75 °C); a chill or storage step usually has a maximum only (≤ 8 °C).</p>
    <div class="row">
      <div><label for="cdFreq">Frequency (as written on the plan)</label><input id="cdFreq" type="text" placeholder="e.g. Every batch" value="${v('frequency')}" /></div>
      <div><label for="cdFreqH">…in hours (for the overdue alert)</label><input id="cdFreqH" type="number" inputmode="decimal" step="any" placeholder="e.g. 4" value="${v('frequency_hours')}" /></div>
    </div>
    <label for="cdWhat">What is monitored</label>
    <input id="cdWhat" type="text" placeholder="e.g. Core temperature of the thickest piece" value="${v('monitoring_what')}" />
    <div class="row">
      <div><label for="cdHow">How</label><input id="cdHow" type="text" placeholder="e.g. Calibrated probe thermometer" value="${v('monitoring_how')}" /></div>
      <div><label for="cdWho">Who</label><input id="cdWho" type="text" placeholder="e.g. Chef on shift" value="${v('monitoring_who')}" /></div>
    </div>
    <label for="cdAction">Corrective action (from the plan)</label>
    <textarea id="cdAction" rows="2" placeholder="e.g. Continue cooking and re-probe; if still below limit, reject the batch">${v('corrective_action')}</textarea>
    <div class="row">
      <div><label for="cdVerif">Verification</label><input id="cdVerif" type="text" placeholder="e.g. Weekly manager review of records" value="${v('verification')}" /></div>
      <div><label for="cdRecords">Record kept</label><input id="cdRecords" type="text" placeholder="e.g. CCP monitoring register" value="${v('records')}" /></div>
    </div>
    <div class="row">
      <div><label for="cdPlanRef">Plan reference</label><input id="cdPlanRef" type="text" placeholder="e.g. HACCP plan §5.2" value="${v('plan_ref')}" /></div>
      <div><label for="cdSort">Sort order</label><input id="cdSort" type="number" inputmode="numeric" placeholder="0" value="${v('sort_order')}" /></div>
    </div>
    <div class="row">
      <button class="green" onclick="ccpSaveDef()">${ccpEditingDef ? 'Save changes' : 'Add control point'}</button>
      ${ccpEditingDef ? '<button class="ghost" onclick="ccpCancelDef()">Cancel</button>' : ''}
    </div>`
  ccpDefKindChanged()
}

window.ccpDefKindChanged = function () {
  const kind = (($('cdKind') || {}).value) || 'numeric'
  const row = $('cdLimitRow'), hint = $('cdLimitHint'), uom = $('cdUom')
  const numeric = kind === 'numeric'
  if (row) row.classList.toggle('hidden', !numeric)
  if (hint) hint.classList.toggle('hidden', !numeric)
  if (uom && uom.parentNode) uom.parentNode.classList.toggle('hidden', !numeric)
}

window.ccpEditDef = function (id) {
  const d = ccpDefById(id); if (!d) return
  ccpEditingDef = id
  const box = $('ccpDefForm'); if (box) box.dataset.open = '1'
  ccpDefFormRender(d)
  const el = $('cdCode'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

window.ccpCancelDef = function () {
  ccpEditingDef = null
  const box = $('ccpDefForm'); if (box) delete box.dataset.open
  ccpDefFormRender(null)
}

window.ccpSaveDef = async function () {
  const m = $('ccpDefMsg'); if (m) clearMsg(m)
  const num = id => { const raw = (($(id) || {}).value || '').trim(); return raw === '' ? null : Number(raw) }
  const txt = id => { const raw = (($(id) || {}).value || '').trim(); return raw === '' ? null : raw }
  const kind = (($('cdKind') || {}).value) || 'numeric'
  const rec = {
    code: txt('cdCode'), name: txt('cdName'), process_step: txt('cdStep'), hazard: txt('cdHazard'),
    monitoring_what: txt('cdWhat'), monitoring_how: txt('cdHow'), monitoring_who: txt('cdWho'),
    frequency: txt('cdFreq'), frequency_hours: num('cdFreqH'), measure_kind: kind,
    uom: kind === 'numeric' ? txt('cdUom') : null,
    critical_min: kind === 'numeric' ? num('cdMin') : null,
    critical_max: kind === 'numeric' ? num('cdMax') : null,
    corrective_action: txt('cdAction'), verification: txt('cdVerif'), records: txt('cdRecords'),
    plan_ref: txt('cdPlanRef'), sort_order: num('cdSort') || 0
  }
  if (!rec.code) { if (m) msg(m, 'Give it a code (CCP1, CCP2…).', false); return }
  if (!rec.name) { if (m) msg(m, 'Give it a name.', false); return }
  if (kind === 'numeric' && rec.critical_min == null && rec.critical_max == null) {
    if (m) msg(m, 'A measured control point needs at least one critical limit — otherwise nothing can ever fail it.', false); return
  }
  if (rec.critical_min != null && rec.critical_max != null && rec.critical_min > rec.critical_max) {
    if (m) msg(m, 'The minimum cannot be above the maximum.', false); return
  }
  const res = ccpEditingDef
    ? await sb.from('sim_ccps').update(rec).eq('id', ccpEditingDef)
    : await sb.from('sim_ccps').insert(rec)
  if (res.error) {
    if (m) msg(m, /duplicate key|unique/i.test(res.error.message) ? 'That code is already used by another control point.' : ccpErr(res.error), false)
    return
  }
  if (m) msg(m, ccpEditingDef ? 'Saved.' : 'Control point added.', true)
  ccpEditingDef = null
  const box = $('ccpDefForm'); if (box) delete box.dataset.open
  await ccpLoadAll()
  ccpDefFormRender(null)
}

window.ccpToggleDef = async function (id) {
  const d = ccpDefById(id); if (!d) return
  const on = !d.active
  if (!on && !confirm('Switch off ' + d.code + '?\n\nIt disappears from the floor board and no new checks can be recorded against it. Existing records are kept. Only do this if it has come off the approved HACCP plan.')) return
  const { error } = await sb.from('sim_ccps').update({ active: on }).eq('id', id)
  const m = $('ccpDefMsg')
  if (error) { if (m) msg(m, ccpErr(error), false); return }
  if (m) msg(m, on ? d.code + ' switched on.' : d.code + ' switched off.', true)
  await ccpLoadAll()
}
