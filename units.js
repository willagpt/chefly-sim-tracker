/* UNITS: batch & unit traceability — physical-unit identity (tumbler load / tray / bag),
   genealogy (splits/merges), and run membership (shared processing, e.g. an oven or
   chiller cycle already logged as a sim_task_logs row with is_batch = true).

   Design reference: sim-tracker-batch-traceability-design.md (31 Jul 2026).

   V1 scope: a standalone tab, available to everyone (like Kitchen), not yet wired into
   the task start/finish screens in tasks.js/kiosk.js. That deeper integration — e.g.
   "scan the trays you're loading" right there on the Start Task card — is the natural
   next step once this is validated on the chicken line; kept out of V1 to keep this
   reviewable on its own. */

let unSplitParents = [], unAttachCodes = [], unRecent = [], unBatchLogs = []

// ---- shared camera scanner (jsQR) ----
let unScanStream = null, unScanRAF = null, unScanTarget = null

window.unOpenScanner = function (targetInputId) {
  unScanTarget = targetInputId
  const box = $('unScanBox'); if (!box) return
  box.classList.remove('hidden')
  const video = $('unScanVideo')
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
    unScanStream = stream; video.srcObject = stream; video.setAttribute('playsinline', true); video.play()
    unScanTick()
  }).catch(err => { msg($('unScanMsg'), 'Camera unavailable: ' + err.message + ' — type the code instead.', false); box.classList.add('hidden') })
}
window.unCloseScanner = function () {
  if (unScanRAF) cancelAnimationFrame(unScanRAF); unScanRAF = null
  if (unScanStream) { unScanStream.getTracks().forEach(t => t.stop()); unScanStream = null }
  const box = $('unScanBox'); if (box) box.classList.add('hidden')
}
function unScanTick () {
  const video = $('unScanVideo'), canvas = $('unScanCanvas')
  if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && typeof jsQR === 'function') {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(img.data, img.width, img.height)
    if (code && code.data) { unScanResult(code.data); return }
  }
  unScanRAF = requestAnimationFrame(unScanTick)
}
function unScanResult (text) {
  unCloseScanner()
  if (unScanTarget === 'unSplitParents') { unAddChip('unSplitParents', text) }
  else if (unScanTarget === 'unAttachCodes') { unAddChip('unAttachCodes', text) }
  else if (unScanTarget) { const el = $(unScanTarget); if (el) el.value = text }
}

// ---- init ----
window.loadUnits = async function () {
  await unRefreshBatchLogs()
  await unRefreshRecent()
  if (!products.length) await loadProducts()
  unPopulateProductSelect()
}

async function unRefreshBatchLogs () {
  const { data, error } = await db.activeBatchLogs()
  if (error) { console.error(error); return }
  unBatchLogs = data || []
  const sel = $('unRunSelect'); if (!sel) return
  sel.innerHTML = '<option value="">— pick the run —</option>' + unBatchLogs.map(l => {
    const eq = l.equipment_id ? ' · equip' : ''
    return `<option value="${l.id}">${esc(l.task_name)}${l.station ? ' — ' + esc(l.station) : ''} · started ${fmtTime(l.start_time)}${eq}</option>`
  }).join('')
}

async function unRefreshRecent () {
  const { data, error } = await db.recentUnits(30)
  if (error) { console.error(error); return }
  unRecent = data || []
  renderUnRecent()
}
function renderUnRecent () {
  const box = $('unRecentList'); if (!box) return
  box.innerHTML = unRecent.map(u => `
    <div class="task-item">
      <div><b>${esc(u.code)}</b> ${pill(u.status === 'active' ? 'live' : 'off', u.status)}
        <div class="meta">${esc(u.kind)}${u.qty != null ? ' · ' + u.qty + (u.uom ? ' ' + esc(u.uom) : '') : ''}${meta([unProductName(u.product_id)])}</div></div>
      <div style="display:flex;gap:6px">
        <button class="ghost sm" onclick="unPrintLabel('${u.id}')">Print label</button>
        <button class="ghost sm" onclick="unTraceCode('${esc(u.code)}')">Trace</button>
      </div>
    </div>`).join('') || '<p class="muted">No units yet.</p>'
}
function unProductName (id) { const p = products.find(x => x.id === id); return p ? p.name : '' }
function unPopulateProductSelect () {
  ['unCreateProduct', 'unSplitProduct'].forEach(id => {
    const sel = $(id); if (!sel) return
    sel.innerHTML = '<option value="">— none —</option>' + products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
  })
}

// ---- create a fresh unit (no parent — e.g. the tumbler load) ----
window.unCreateUnit = async function () {
  const kind = ($('unCreateKind').value || '').trim(); if (!kind) { msg($('unCreateMsg'), 'Enter what this is (e.g. tumbler_load).', false); return }
  const product_id = $('unCreateProduct').value || null
  const qty = $('unCreateQty').value ? Number($('unCreateQty').value) : null
  const uom = ($('unCreateUom').value || '').trim() || null
  const station = ($('unCreateStation').value || '').trim() || null
  const { data, error } = await db.createUnit({ kind, product_id, qty, uom, station })
  if (error) { msg($('unCreateMsg'), error.message, false); return }
  msg($('unCreateMsg'), 'Created ' + data.code + '.', true)
  $('unCreateQty').value = ''
  await unRefreshRecent()
  unShowLabels([data])
}

// ---- split / merge (genealogy) ----
function unAddChip (listName, text) {
  const val = (text || '').trim(); if (!val) return
  if (listName === 'unSplitParents') { if (!unSplitParents.includes(val)) unSplitParents.push(val); renderUnChips('unSplitParents', unSplitParents) }
  else if (listName === 'unAttachCodes') { if (!unAttachCodes.includes(val)) unAttachCodes.push(val); renderUnChips('unAttachCodes', unAttachCodes) }
}
window.unAddParentManual = function () { const el = $('unParentInput'); unAddChip('unSplitParents', el.value); el.value = '' }
window.unAddAttachManual = function () { const el = $('unAttachInput'); unAddChip('unAttachCodes', el.value); el.value = '' }
function renderUnChips (id, arr) {
  const box = $(id + 'Chips'); if (!box) return
  box.innerHTML = arr.map((c, i) => `<span class="pill live" style="margin:2px 4px 2px 0;cursor:pointer" onclick="unRemoveChip('${id}',${i})">${esc(c)} ✕</span>`).join('') || '<span class="muted" style="font-size:13px">none yet</span>'
}
window.unRemoveChip = function (id, i) {
  if (id === 'unSplitParents') { unSplitParents.splice(i, 1); renderUnChips('unSplitParents', unSplitParents) }
  else if (id === 'unAttachCodes') { unAttachCodes.splice(i, 1); renderUnChips('unAttachCodes', unAttachCodes) }
}

window.unDoSplit = async function () {
  const msgEl = $('unSplitMsg')
  if (!unSplitParents.length) { msg(msgEl, 'Scan or enter at least one parent unit.', false); return }
  const count = Number($('unSplitCount').value || 0)
  if (!count || count < 1) { msg(msgEl, 'Enter how many new units this makes.', false); return }
  const childKind = ($('unSplitKind').value || '').trim(); if (!childKind) { msg(msgEl, 'Enter what the new units are (e.g. tray).', false); return }
  const product_id = $('unSplitProduct').value || null
  const qty = $('unSplitQty').value ? Number($('unSplitQty').value) : null
  const uom = ($('unSplitUom').value || '').trim() || null

  const { data: parents, error: perr } = await db.unitsByCodes(unSplitParents)
  if (perr) { msg(msgEl, perr.message, false); return }
  const missing = unSplitParents.filter(c => !parents.some(p => p.code === c))
  if (missing.length) { msg(msgEl, "Couldn't find: " + missing.join(', ') + '. Check the codes.', false); return }

  const childRows = Array.from({ length: count }, () => ({ kind: childKind, product_id, qty, uom }))
  const { data: children, error: cerr } = await db.createUnits(childRows)
  if (cerr) { msg(msgEl, cerr.message, false); return }

  const links = []
  parents.forEach(p => children.forEach(c => links.push({ parent_unit_id: p.id, child_unit_id: c.id })))
  const { error: gerr } = await db.addGenealogy(links)
  if (gerr) { msg(msgEl, 'Units created but linking failed: ' + gerr.message, false); return }

  // mark parents consumed if this fully split them (best-effort — a manager can revert in Manage if wrong)
  await Promise.all(parents.map(p => db.updateUnit(p.id, { status: 'consumed' })))

  msg(msgEl, `Created ${children.length} unit(s) from ${parents.length} parent(s): ${children.map(c => c.code).join(', ')}.`, true)
  unSplitParents = []; renderUnChips('unSplitParents', unSplitParents)
  $('unSplitCount').value = ''
  await unRefreshRecent()
  unShowLabels(children)
}

// ---- attach units to an existing run (process-run membership) ----
window.unDoAttach = async function () {
  const msgEl = $('unAttachMsg')
  const logId = $('unRunSelect').value; if (!logId) { msg(msgEl, 'Pick the run to attach these units to.', false); return }
  if (!unAttachCodes.length) { msg(msgEl, 'Scan or enter at least one unit code.', false); return }
  const { data: units, error: uerr } = await db.unitsByCodes(unAttachCodes)
  if (uerr) { msg(msgEl, uerr.message, false); return }
  const missing = unAttachCodes.filter(c => !units.some(u => u.code === c))
  if (missing.length) { msg(msgEl, "Couldn't find: " + missing.join(', ') + '. Check the codes.', false); return }

  const rows = units.map(u => ({ unit_id: u.id, log_id: logId }))
  const { error } = await db.addRunMembers(rows)
  if (error) { msg(msgEl, error.message, false); return }

  // soft capacity check — informational only, see design doc open item on hard vs soft limits
  const log = unBatchLogs.find(l => l.id === logId)
  const cat = log && catalog.find(c => c.id === log.catalog_id)
  if (cat && cat.capacity_per_load) {
    const { data: members } = await db.runMembersOfLog(logId)
    const n = (members || []).length
    if (n > cat.capacity_per_load) msg(msgEl, `Added ${units.length} unit(s) — heads up: this run now has ${n}, over the usual capacity of ${cat.capacity_per_load}.`, true)
    else msg(msgEl, `Added ${units.length} unit(s) to the run (${n}/${cat.capacity_per_load}).`, true)
  } else {
    msg(msgEl, `Added ${units.length} unit(s) to the run.`, true)
  }
  unAttachCodes = []; renderUnChips('unAttachCodes', unAttachCodes)
}

// ---- trace ----
window.unTraceCode = async function (codeArg) {
  const code = (codeArg || $('unTraceInput').value || '').trim()
  const box = $('unTraceBody'); if (!box) return
  if (!code) { box.innerHTML = '<p class="muted">Enter or scan a unit code.</p>'; return }
  box.innerHTML = '<p class="muted">Tracing…</p>'
  const { data: unit, error } = await db.unitByCode(code)
  if (error || !unit) { box.innerHTML = `<p class="muted">No unit found for "${esc(code)}".</p>`; return }

  const ancestors = await unWalk(unit.id, 'up')
  const descendants = await unWalk(unit.id, 'down')
  const { data: members } = await db.runMembersOfUnit(unit.id)
  const logIds = (members || []).map(m => m.log_id)
  const { data: ccps } = logIds.length ? await db.ccpChecksForLogs(logIds) : { data: [] }

  box.innerHTML = `
    <div class="task-item" style="background:var(--panel)">
      <div><b>${esc(unit.code)}</b> ${pill(unit.status === 'active' ? 'live' : 'off', unit.status)}
        <div class="meta">${esc(unit.kind)}${unit.station ? ' · ' + esc(unit.station) : ''}${meta([unProductName(unit.product_id)])} · created ${fmtTime(unit.created_at)}</div></div>
    </div>
    <h3 style="margin:14px 0 6px">Made from (ancestors)</h3>
    ${ancestors.length ? ancestors.map(a => `<div class="task-item"><div><b>${esc(a.code)}</b><div class="meta">${esc(a.kind)}</div></div></div>`).join('') : '<p class="muted">Nothing further back — this is a first-stage unit.</p>'}
    <h3 style="margin:14px 0 6px">Became (descendants)</h3>
    ${descendants.length ? descendants.map(d => `<div class="task-item"><div><b>${esc(d.code)}</b><div class="meta">${esc(d.kind)}</div></div></div>`).join('') : '<p class="muted">Nothing downstream yet.</p>'}
    <h3 style="margin:14px 0 6px">Runs it was part of</h3>
    ${(members || []).length ? members.map(m => {
      const l = m.sim_task_logs || {}
      const checks = (ccps || []).filter(c => c.log_id === m.log_id)
      return `<div class="task-item"><div><b>${esc(l.task_name || '—')}</b>${l.station ? ' — ' + esc(l.station) : ''}
        <div class="meta">started ${l.start_time ? fmtTime(l.start_time) : '—'}${l.finish_time ? ' · finished ' + fmtTime(l.finish_time) : ''}${l.start_temp != null ? ' · ' + l.start_temp + '°→' + (l.finish_temp != null ? l.finish_temp + '°' : '?') : ''}
        ${checks.length ? ' · CCP: ' + checks.map(c => (c.passed ? '✅' : '⚠️') + ' ' + (c.value != null ? c.value : c.observed_ok)).join(', ') : ''}</div></div></div>`
    }).join('') : '<p class="muted">Not attached to any run yet.</p>'}
    <button class="ghost sm" style="margin-top:10px" onclick="unPrintTrace()">Print this trace</button>
  `
  _unLastTrace = { unit, ancestors, descendants, members: members || [], ccps: ccps || [] }
}
let _unLastTrace = null
window.unPrintTrace = function () {
  const t = _unLastTrace; if (!t) return
  const cell = 'border:1px solid #000;padding:6px;font-size:12px'
  const rows = (t.members || []).map(m => {
    const l = m.sim_task_logs || {}
    const checks = (t.ccps || []).filter(c => c.log_id === m.log_id)
    return `<tr><td style="${cell}">${esc(l.task_name || '')}</td><td style="${cell}">${esc(l.station || '')}</td>
      <td style="${cell}">${l.start_time ? fmtTime(l.start_time) : ''}</td>
      <td style="${cell}">${checks.map(c => (c.passed ? 'PASS' : 'FAIL') + ' ' + (c.value ?? '')).join(', ')}</td></tr>`
  }).join('')
  $('printArea').innerHTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:8px">
    <h1 style="font-size:20px;margin:0 0 2px">Unit trace — ${esc(t.unit.code)}</h1>
    <p style="margin:2px 0 10px;font-size:13px">${esc(t.unit.kind)}${t.unit.station ? ' · ' + esc(t.unit.station) : ''} · created ${fmtTime(t.unit.created_at)} · Printed ${new Date().toLocaleString()}</p>
    <p style="font-size:13px"><b>Made from:</b> ${t.ancestors.length ? t.ancestors.map(a => esc(a.code)).join(', ') : 'nothing further back (first-stage unit)'}</p>
    <p style="font-size:13px"><b>Became:</b> ${t.descendants.length ? t.descendants.map(d => esc(d.code)).join(', ') : 'nothing downstream yet'}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <tr><th style="${cell}">Run</th><th style="${cell}">Station</th><th style="${cell}">Started</th><th style="${cell}">CCP readings</th></tr>
      ${rows || `<tr><td style="${cell}" colspan="4">Not attached to any run yet.</td></tr>`}
    </table>
  </div>`
  window.print()
}
// walk genealogy one direction, breadth-first, small depth expected (design doc: splits happen twice in the chain)
async function unWalk (unitId, dir) {
  const out = []; let frontier = [unitId]; let depth = 0
  while (frontier.length && depth < 8) {
    const next = []
    for (const id of frontier) {
      const { data } = dir === 'up' ? await db.genealogyParentsOf(id) : await db.genealogyChildrenOf(id)
      for (const row of (data || [])) next.push(dir === 'up' ? row.parent_unit_id : row.child_unit_id)
    }
    if (!next.length) break
    const { data: units } = await db.unitsByIds(next)
    out.push(...(units || [])); frontier = next; depth++
  }
  return out
}

// ---- printable labels (QR) — on-screen preview, then routed through the
// existing #printArea convention (see trace.js/performance.js) for the actual print. ----
function unShowLabels (units) {
  const box = $('unLabelBox'); if (!box) return
  box.classList.remove('hidden')
  box.innerHTML = units.map(u => `
    <div style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;border:1px solid var(--line);border-radius:8px;padding:10px;margin:4px">
      <div id="qr_${u.id}"></div>
      <b>${esc(u.code)}</b><span class="muted" style="font-size:12px">${esc(u.kind)}</span>
    </div>`).join('') + '<div><button class="ghost sm" style="margin-top:8px" onclick="unPrintLabels()">Print these labels</button></div>'
  units.forEach(u => { if (typeof QRCode !== 'undefined') new QRCode($('qr_' + u.id), { text: u.code, width: 90, height: 90 }) })
  _unLastLabels = units
}
let _unLastLabels = []
window.unPrintLabel = function (unitId) {
  const u = unRecent.find(x => x.id === unitId); if (!u) return
  unShowLabels([u])
}
window.unPrintLabels = function () {
  if (!_unLastLabels.length) return
  $('printArea').innerHTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:8px;display:flex;flex-wrap:wrap;gap:10px">
    ${_unLastLabels.map(u => `<div style="border:1px solid #000;padding:8px;width:140px;text-align:center">
      <div id="pqr_${u.id}"></div><div style="font-weight:700;margin-top:4px">${esc(u.code)}</div><div style="font-size:12px">${esc(u.kind)}</div>
    </div>`).join('')}
  </div>`
  _unLastLabels.forEach(u => { if (typeof QRCode !== 'undefined') new QRCode($('pqr_' + u.id), { text: u.code, width: 100, height: 100 }) })
  setTimeout(() => window.print(), 60) // let QR canvases render before the print snapshot
}
