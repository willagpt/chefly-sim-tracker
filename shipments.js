/* SHIPMENTS: wholesale consignments to Oaklands International and Coolpack,
   plus the paperwork pack that goes with them.

   Everything on the paperwork is DERIVED from three numbers per configuration
   (meals) plus two constants (tray capacity, trays per pallet). Nothing is
   typed twice, so the pallet labels can never disagree with the packing list.

     trays   = ceil(meals / tray_capacity)          -- rounded up per line
     pallets = ceil(trays / trays_per_pallet)       -- a part pallet still ships
     a full pallet holds tray_capacity * trays_per_pallet meals

   Verified against three real packs: SIMCFOIUK050826 (16 pallets / 18,329
   meals / 644 trays), SIMCFCPUK120826 (1 / 79) and SIMCFIE120826 (3 / 42).

   Data: sim_ws_destinations / sim_ws_shipments / sim_ws_shipment_lines.
   Lives inside the Wholesale tab as the 'Shipments' view. */

let wsDests=[], wsShips=[], wsShipLines=[], wsShipNewOpen=false
let wsShipSel=new Set()   // shipments ticked to print as one combined pack

// [label, tray capacity]. Large trays hold fewer because the meals are bigger.
const WS_CONFIGS=[['Standard',30],['Large',24],['Lean',30]]
const WS_TRAYS_PER_PALLET=45

function wsShipDestOf(id){return wsDests.find(d=>d.id===id)}
// Both Coolpack rows are legally 'Coolpack Solutions'; short_label is what
// distinguishes them on screen. The full name still prints on the paperwork.
function wsShipDestName(d){return d?(d.short_label||d.name||''):''}
function wsShipLinesOf(id){return wsShipLines.filter(l=>l.shipment_id===id).sort((a,b)=>a.sort_order-b.sort_order)}
function wsShipCapOf(config){const r=WS_CONFIGS.find(c=>c[0]===config);return r?r[1]:30}

/* The one piece of arithmetic in this file. Mirrors v_ws_shipment_line_calc
   in the database exactly -- if you change one, change both. */
function wsShipCalc(line, traysPerPallet){
  const tpp=Number(traysPerPallet)||WS_TRAYS_PER_PALLET
  const meals=Number(line.meals)||0
  const cap=Number(line.tray_capacity)||wsShipCapOf(line.config)
  const trays=Math.ceil(meals/cap)
  const pallets=Math.ceil(trays/tpp)
  const fullPallets=Math.floor(trays/tpp)
  const mealsPerFullPallet=cap*tpp
  return {meals, cap, trays, pallets, fullPallets, mealsPerFullPallet,
          lastPalletMeals: meals - fullPallets*mealsPerFullPallet}
}
function wsShipTotals(ship){
  const lines=wsShipLinesOf(ship.id).filter(l=>Number(l.meals)>0)
  return lines.reduce((t,l)=>{
    const c=wsShipCalc(l, ship.trays_per_pallet)
    t.meals+=c.meals; t.trays+=c.trays; t.pallets+=c.pallets; t.configs++
    return t
  },{meals:0,trays:0,pallets:0,configs:0})
}

/* PO numbers follow the house convention: SIMCF + destination code + ddmmyy,
   where the date is the WEDNESDAY of the production week -- the day final
   confirmation lands -- not the dispatch date. Checked against the real packs:
   SIMCFOIUK050826 dispatched Fri 7 Aug, SIMCFCPUK120826 dispatched Thu 13 Aug,
   and 5 and 12 August 2026 are both Wednesdays. Always editable, in case a
   PO ever gets raised off-cycle. */
function wsShipPoDate(weekStart){
  if(!weekStart) return ''
  const dt=new Date(weekStart+'T00:00:00')
  if(isNaN(dt)) return ''
  dt.setDate(dt.getDate()+2)
  const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), d=String(dt.getDate()).padStart(2,'0')
  return d+m+String(y).slice(2)
}
function wsShipPo(destId, weekStart){
  const d=wsShipDestOf(destId); if(!d) return ''
  const dd=wsShipPoDate(weekStart); if(!dd) return ''
  return 'SIMCF'+d.code+dd
}
function wsShipDateLong(iso){
  if(!iso) return ''
  const dt=new Date(iso+'T00:00:00')
  return dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})
}
function wsShipNum(n){return Number(n||0).toLocaleString('en-GB')}
function wsShipNoun(d){return d&&d.mode==='collection'?'Collection':'Delivery'}

/* ================= data ================= */

async function wsShipLoad(){
  const [dz, sz]=await Promise.all([
    sb.from('sim_ws_destinations').select('*').order('sort_order'),
    sb.from('sim_ws_shipments').select('*').eq('week_start', wsWeekStart).order('dispatch_date'),
  ])
  wsDests=dz.data||[]; wsShips=sz.data||[]
  if(wsShips.length){
    const {data:ln}=await sb.from('sim_ws_shipment_lines').select('*').in('shipment_id', wsShips.map(s=>s.id))
    wsShipLines=ln||[]
  } else wsShipLines=[]
  // Changing week must not leave last week's ticks armed.
  const ids=new Set(wsShips.map(x=>x.id))
  wsShipSel.forEach(id=>{ if(!ids.has(id)) wsShipSel.delete(id) })
}

/* Prefill the new-shipment form from the week's agreed targets, so the common
   case is: pick a destination, check the numbers, save. */
function wsShipPrefill(){
  const out={}
  WS_CONFIGS.forEach(([name])=>{ out[name]='' })
  ;(wsLines||[]).forEach(l=>{
    const v=wsVariantOf(l.variant_id); if(!v) return
    if(Object.prototype.hasOwnProperty.call(out, v.name)) out[v.name]=Number(l.target_qty)||''
  })
  return out
}
/* The meal this week's plan is built around. */
function wsShipWeekMeal(){
  const ids=typeof wsWeekMealIds==='function'?wsWeekMealIds():new Set()
  for(const id of ids){ const m=wsMealOf(id); if(m) return m }
  return (wsMeals||[]).find(x=>x.active)||null
}
/* Paperwork carries the name the CUSTOMER uses -- Simmer's menu name, the one
   on their purchase order -- not the kitchen's. Checked against the real packs:
   SIMCFOIUK050826 printed "Grilled Chicken Power Bowl" while the kitchen was
   making "Japanese Chicken & Butternut Squash". */
function wsShipPrefillProduct(){
  const m=wsShipWeekMeal()
  return m?(m.external_name||m.name):''
}

window.wsShipToggleNew=function(){ wsShipNewOpen=!wsShipNewOpen; renderWs() }

window.wsShipSyncPo=function(){
  const el=$('wsShipPo'); if(!el||el.dataset.touched) return
  el.value=wsShipPo($('wsShipDest').value, wsWeekStart)
}

window.wsShipCreate=async function(){
  const destId=$('wsShipDest').value
  const product=($('wsShipProduct').value||'').trim()
  const dd=$('wsShipDate').value
  const po=($('wsShipPo').value||'').trim().toUpperCase()
  if(!destId){alert('Pick a destination.');return}
  if(!product){alert('Enter the product name.');return}
  if(!dd){alert('Pick a dispatch date.');return}
  if(!po){alert('PO number is empty.');return}
  const rows=[]
  WS_CONFIGS.forEach(([name,cap],i)=>{
    const meals=Math.max(0, Math.round(Number($('wsShipQty_'+name).value)||0))
    if(meals>0) rows.push({config:name, meals, tray_capacity:cap, sort_order:i+1})
  })
  if(!rows.length){alert('Enter meals for at least one configuration.');return}

  const btn=$('wsShipCreateBtn'); if(btn) btn.disabled=true
  try{
    const {data:sh, error}=await sb.from('sim_ws_shipments').insert({
      po_number:po, destination_id:destId, week_start:wsWeekStart,
      product_name:product, dispatch_date:dd, status:'draft',
      created_by:(window.me&&me.id)||null
    }).select().single()
    if(error){
      alert(/duplicate|unique/i.test(error.message)
        ? 'A shipment with PO '+po+' already exists.' : error.message)
      return
    }
    const {error:le}=await sb.from('sim_ws_shipment_lines')
      .insert(rows.map(r=>Object.assign({shipment_id:sh.id}, r)))
    if(le){
      // Don't leave a shipment with no lines behind.
      await sb.from('sim_ws_shipments').delete().eq('id', sh.id)
      alert(le.message); return
    }
    wsShipNewOpen=false
    await loadWholesale()
  } finally { if(btn) btn.disabled=false }
}

window.wsShipSetQty=async function(lineId, val){
  const meals=Math.max(0, Math.round(Number(val)||0))
  const {error}=await sb.from('sim_ws_shipment_lines').update({meals}).eq('id', lineId)
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsShipSetProduct=async function(id, val){
  const product_name=(val||'').trim()
  if(!product_name){alert('The product name cannot be empty — it prints on every label.');await loadWholesale();return}
  const {error}=await sb.from('sim_ws_shipments')
    .update({product_name, updated_at:new Date().toISOString()}).eq('id', id)
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsShipSetStatus=async function(id, status){
  const {error}=await sb.from('sim_ws_shipments')
    .update({status, updated_at:new Date().toISOString()}).eq('id', id)
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsShipDelete=async function(id, po){
  if(!confirm('Delete shipment '+po+'? This removes its lines too.')) return
  const {error}=await sb.from('sim_ws_shipments').delete().eq('id', id)
  if(error){alert(error.message);return}
  await loadWholesale()
}

/* ================= view ================= */

function wsShipNewCard(){
  const pre=wsShipPrefill(), prod=wsShipPrefillProduct(), meal=wsShipWeekMeal()
  const dOpts='<option value="">Destination…</option>'+wsDests.filter(d=>d.active)
    .map(d=>`<option value="${d.id}">${esc(wsShipDestName(d))} — ${esc(d.name)}${d.mode==='collection'?' (collection)':''}</option>`).join('')
  const qty=WS_CONFIGS.map(([name,cap])=>`
    <div><label style="font-size:12px;color:var(--muted)">${name} <span style="opacity:.7">(${cap}/tray)</span></label>
    <input id="wsShipQty_${name}" type="number" min="0" value="${pre[name]===''?'':esc(pre[name])}" style="width:100%" /></div>`).join('')
  return `<div class="card">
    <h2 style="margin:0 0 4px">New shipment</h2>
    <p class="muted" style="font-size:13px;margin:0 0 10px">Quantities are prefilled from this week's agreed targets — check them against the final confirmation before you print anything.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
      <div><label style="font-size:12px;color:var(--muted)">Destination</label>
        <select id="wsShipDest" onchange="wsShipSyncPo()" style="width:100%">${dOpts}</select></div>
      <div><label style="font-size:12px;color:var(--muted)">Dispatch / collection date</label>
        <input id="wsShipDate" type="date" onchange="wsShipSyncPo()" style="width:100%" /></div>
      <div><label style="font-size:12px;color:var(--muted)">Product — as the customer names it</label>
        <input id="wsShipProduct" value="${esc(prod)}" style="width:100%" />
        ${meal&&meal.external_name&&meal.external_name!==meal.name?`<div style="font-size:11px;color:var(--muted);margin-top:3px">Kitchen calls it ${esc(meal.name)}</div>`:''}</div>
      <div><label style="font-size:12px;color:var(--muted)">PO number</label>
        <input id="wsShipPo" oninput="this.dataset.touched=1" placeholder="auto" style="width:100%" /></div>
      ${qty}
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button id="wsShipCreateBtn" onclick="wsShipCreate()">Create shipment</button>
      <button class="ghost" onclick="wsShipToggleNew()">Cancel</button>
    </div>
  </div>`
}

function wsShipCard(s){
  const d=wsShipDestOf(s.destination_id)
  const t=wsShipTotals(s)
  const lines=wsShipLinesOf(s.id)
  const editable=s.status==='draft'||s.status==='confirmed'
  const statusPill=s.status==='dispatched'?pill('done','Dispatched')
    :s.status==='cancelled'?pill('off','Cancelled')
    :s.status==='confirmed'?pill('live','Confirmed'):pill('','Draft')

  const rows=lines.map(l=>{
    const c=wsShipCalc(l, s.trays_per_pallet)
    const qty=editable
      ? `<input type="number" min="0" value="${c.meals}" onchange="wsShipSetQty('${l.id}',this.value)" style="max-width:90px;font-size:13px;padding:3px 6px;text-align:right" />`
      : `<b>${wsShipNum(c.meals)}</b>`
    return `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center;padding:5px 0;border-top:1px solid var(--line);font-size:13px">
      <span>${esc(l.config)} <span style="color:var(--muted);font-size:11px">${c.cap}/tray</span></span>
      <span style="text-align:right">${qty}</span>
      <span style="color:var(--muted);min-width:74px;text-align:right">${wsShipNum(c.trays)} trays</span>
      <span style="color:var(--muted);min-width:76px;text-align:right">${wsShipNum(c.pallets)} pallet${c.pallets===1?'':'s'}</span>
    </div>`
  }).join('')

  const actions=[]
  if(s.status==='draft') actions.push(`<button class="ghost sm" onclick="wsShipSetStatus('${s.id}','confirmed')">Mark confirmed</button>`)
  if(s.status==='confirmed') actions.push(`<button class="ghost sm" onclick="wsShipSetStatus('${s.id}','dispatched')">Mark dispatched</button>`)
  if(s.status==='dispatched') actions.push(`<button class="ghost sm" onclick="wsShipSetStatus('${s.id}','confirmed')">Reopen</button>`)
  if(s.status!=='cancelled') actions.push(`<button class="ghost sm" onclick="wsShipSetStatus('${s.id}','cancelled')">Cancel</button>`)
  actions.push(`<button class="ghost sm" onclick="wsShipDelete('${s.id}','${esc(s.po_number)}')">Delete</button>`)

  const ticked=wsShipSel.has(s.id)
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <label title="Tick two or more to print them as one document" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;flex:0 0 auto;margin-top:2px">
          <input type="checkbox" ${ticked?'checked':''} onchange="wsShipToggleSel('${s.id}')" style="width:17px;height:17px;cursor:pointer;margin:0" />
          <span style="font-size:9px;letter-spacing:.5px;color:var(--muted);text-transform:uppercase">Combine</span>
        </label>
        <div>
          <h2 style="margin:0">${esc(wsShipDestName(d))}</h2>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">
            ${esc(s.po_number)} · ${editable
              ? `<input value="${esc(s.product_name)}" onchange="wsShipSetProduct('${s.id}',this.value)" title="Prints on the delivery note and every pallet label" style="font-size:12px;padding:2px 6px;max-width:230px" />`
              : esc(s.product_name)} · ${wsShipNoun(d).toLowerCase()} ${esc(wsShipDateLong(s.dispatch_date))}
          </div>
        </div>
      </div>
      ${statusPill}
    </div>
    ${rows}
    <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:10px;padding:6px 0;border-top:2px solid var(--line);margin-top:2px;font-size:13px;font-weight:700">
      <span>Total</span>
      <span style="text-align:right">${wsShipNum(t.meals)}</span>
      <span style="min-width:74px;text-align:right">${wsShipNum(t.trays)} trays</span>
      <span style="min-width:76px;text-align:right">${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'}</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button onclick="wsPrintPack('${s.id}')">Print paperwork pack</button>
      ${actions.join('')}
    </div>
  </div>`
}

/* Everything going out this week, and whether it adds up to what the week's
   plan says. The three destinations should sum EXACTLY to the agreed targets --
   if they do not, either a shipment is missing or someone has been typed over,
   and it is far better to find that here than after the pallets are wrapped. */
function wsShipWeekTotals(){
  return wsShips.filter(s=>s.status!=='cancelled').reduce((a,s)=>{
    const n=wsShipTotals(s)
    a.meals+=n.meals; a.trays+=n.trays; a.pallets+=n.pallets; a.count++
    return a
  },{meals:0,trays:0,pallets:0,count:0})
}
function wsShipVsPlan(){
  const target={}
  ;(wsLines||[]).forEach(l=>{
    const v=wsVariantOf(l.variant_id); if(!v) return
    target[v.name]=(target[v.name]||0)+(Number(l.target_qty)||0)
  })
  if(!Object.keys(target).length) return null
  const got={}
  wsShips.filter(s=>s.status!=='cancelled').forEach(s=>wsShipLinesOf(s.id).forEach(l=>{
    got[l.config]=(got[l.config]||0)+(Number(l.meals)||0)
  }))
  const names=[...new Set(Object.keys(target).concat(Object.keys(got)))]
  const rows=names.map(n=>({config:n, target:target[n]||0, got:got[n]||0, diff:(got[n]||0)-(target[n]||0)}))
  return {rows, ok:rows.every(r=>r.diff===0)}
}

function wsShipStat(n,label){
  return `<div style="flex:1;min-width:96px;text-align:center;border:1px solid var(--line);border-radius:8px;padding:10px 6px">
    <div style="font-size:22px;font-weight:800;line-height:1">${wsShipNum(n)}</div>
    <div style="font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-top:5px">${label}</div>
  </div>`
}
function wsShipWeekCard(){
  const t=wsShipWeekTotals()
  if(!t.count) return ''
  const p=wsShipVsPlan()
  let check=''
  if(p){
    const detail=p.rows.map(r=>esc(r.config)+' '+wsShipNum(r.got)+(r.diff?` <b>(${r.diff>0?'+':''}${wsShipNum(r.diff)})</b>`:'')).join(' · ')
    check=p.ok
      ? `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(34,197,94,.14);color:#86efac;font-size:12.5px">Matches this week's plan — ${detail}</div>`
      : `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.14);color:#fca5a5;font-size:12.5px"><b>Does not match this week's plan</b> — ${detail}. Either a shipment is missing or a quantity has been changed.</div>`
  }
  return `<div class="card">
    <div style="font-size:12px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Going out this week</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${wsShipStat(t.meals,'Meals')}${wsShipStat(t.trays,'Trays')}${wsShipStat(t.pallets,'Pallets')}${wsShipStat(t.count,t.count===1?'Shipment':'Shipments')}
    </div>
    ${check}
  </div>`
}

function wsShipView(){
  if(!wsCanPlan()) return '<div class="card"><p class="muted">Managers only.</p></div>'
  let h='<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<div><h2 style="margin:0">Shipments</h2><p class="muted" style="font-size:13px;margin:2px 0 0">'+
    'Delivery note, packing list and pallet labels are generated from these numbers — nothing is typed twice.'+
    (wsShips.length>1?'<br>Tick <b>Combine</b> on two or more to print them as one document.':'')+
    '</p></div>'+
    (wsShipNewOpen?'':'<button onclick="wsShipToggleNew()">＋ New shipment</button>')+'</div>'
  if(wsShipNewOpen) h+=wsShipNewCard()
  if(!wsShips.length && !wsShipNewOpen)
    h+='<div class="card"><p class="muted">No shipments for this week yet.</p></div>'
  h+=wsShipWeekCard()
  h+=wsShipSelBar()
  h+=wsShips.map(wsShipCard).join('')
  return h
}

/* Coolpack UK and Coolpack Ireland leave on the same day to the same place, so
   they are printed as one document -- each keeping its own PO, its own note and
   its own page count, exactly like the combined pack was being assembled by
   hand. Tick any two or more; it is not limited to Coolpack. */
function wsShipSelBar(){
  const picked=wsShips.filter(x=>wsShipSel.has(x.id))
  if(!picked.length) return ''
  const t=picked.reduce((a,x)=>{const n=wsShipTotals(x);a.meals+=n.meals;a.trays+=n.trays;a.pallets+=n.pallets;return a},{meals:0,trays:0,pallets:0})
  const names=picked.map(x=>esc(x.po_number)).join(' + ')
  const one=picked.length===1
  return `<div class="card" style="border:1px solid var(--accent);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div>
      <b style="font-size:14px">${one?'Combine — 1 shipment ticked':`Combine — ${picked.length} shipments ticked`}</b>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${names}${one?' — tick one more to print them as a single document':` · one document, ${wsShipNum(t.pallets)} pallets · ${wsShipNum(t.meals)} meals · ${wsShipNum(t.trays)} trays. Each keeps its own PO and its own note.`}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${one?'':`<button onclick="wsPrintCombined()">Print ${picked.length} as one pack</button>`}
      <button class="ghost sm" onclick="wsShipClearSel()">Clear</button>
    </div>
  </div>`
}

window.wsShipToggleSel=function(id){
  if(wsShipSel.has(id)) wsShipSel.delete(id); else wsShipSel.add(id)
  renderWs()
}
window.wsShipClearSel=function(){ wsShipSel.clear(); renderWs() }

/* ================= paperwork ================= */

/* Expand a shipment into the physical pallet list, in the order they're
   labelled: all of one configuration, then the next. A part pallet is still
   a pallet and gets its own label. */
function wsPalletList(s){
  const out=[]
  wsShipLinesOf(s.id).filter(l=>Number(l.meals)>0).forEach(l=>{
    const c=wsShipCalc(l, s.trays_per_pallet)
    for(let i=0;i<c.fullPallets;i++) out.push({config:l.config, meals:c.mealsPerFullPallet})
    if(c.lastPalletMeals>0) out.push({config:l.config, meals:c.lastPalletMeals})
  })
  return out
}

function wsPackCss(){
  return `@page{size:A4;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;font-size:11.5px;background:#eceef1;-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* One .page = one sheet of A4, on screen and on paper. Screen shows it as a
     white card on grey so the pack reads as documents rather than one long
     scroll; print drops the card and fixes the height so Chrome cannot spill a
     trailing blank page. */
  .page{width:210mm;min-height:297mm;padding:15mm;background:#fff;margin:18px auto;
        box-shadow:0 2px 16px rgba(15,23,42,.16);display:flex;flex-direction:column}
  @media print{
    body{background:#fff}
    .page{width:auto;min-height:0;height:296mm;margin:0;box-shadow:none;page-break-after:always;break-after:page}
    .page:last-child{page-break-after:auto;break-after:auto}
  }

  .bar{position:sticky;top:0;z-index:5;padding:11px 18px;background:#0f172a;color:#fff;
       display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:13px}
  .bar b{font-weight:700;letter-spacing:.5px}
  .bar span{color:#94a3b8}
  .bar button{font:inherit;font-weight:700;padding:8px 18px;border-radius:7px;border:0;background:#fff;color:#0f172a;cursor:pointer}
  .hint{max-width:210mm;margin:14px auto -4px;font-size:12px;color:#64748b;padding:0 4px}

  .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #111;padding-bottom:9px}
  .brand{font-size:25px;font-weight:800;letter-spacing:3px;line-height:1}
  .brand small{display:block;font-size:8px;letter-spacing:4px;font-weight:700;color:#666;margin-bottom:3px}
  .doctype{text-align:right}
  .doctype h1{font-size:18px;margin:0;letter-spacing:2px;text-transform:uppercase;line-height:1}
  .doctype div{font-size:9.5px;color:#666;margin-top:4px;letter-spacing:1px}
  .lbl{font-size:8px;letter-spacing:2px;color:#777;text-transform:uppercase;margin-bottom:6px}

  .cols{display:flex;gap:26px;margin-top:22px}
  .cols>div{flex:1}
  .who{font-size:14.5px;font-weight:700;line-height:1.3}
  .sub{color:#444;margin-top:3px;line-height:1.55}
  .kv{margin:3px 0;color:#444}
  .kv b{color:#111}

  .stats{display:flex;gap:11px;margin:24px 0 26px;text-align:center}
  .stat{flex:1;border:1px solid #dfe3e8;border-radius:7px;padding:15px 6px}
  .stat .n{font-size:29px;font-weight:800;line-height:1;letter-spacing:-.5px}
  .stat .t{font-size:7.5px;letter-spacing:2px;color:#777;text-transform:uppercase;margin-top:7px}

  table{width:100%;border-collapse:collapse}
  th{font-size:8px;letter-spacing:1.5px;color:#777;text-transform:uppercase;text-align:left;padding:7px 9px;border-bottom:1px solid #cbd2d9}
  td{padding:8px 9px;border-bottom:1px solid #eef1f4}
  .num{text-align:right;white-space:nowrap}
  tr.subt td{color:#777;font-size:10.5px;background:#fafbfc;border-bottom:1px solid #e3e8ed}
  tr.tot td{font-weight:800;border-top:2px solid #111;border-bottom:none;padding-top:10px}

  /* Fills what used to be dead space on the note with something the driver can
     actually use, rather than padding the page out. */
  .notes{flex:1;display:flex;flex-direction:column;margin-top:24px;min-height:34mm}
  .notesBox{flex:1;border:1px solid #dfe3e8;border-radius:7px;
    background-image:repeating-linear-gradient(#fff 0 27px,#eef1f4 27px 28px)}
  .sign{margin-top:26px;display:flex;gap:18px}
  .sign div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:7.5px;letter-spacing:1.5px;color:#666;text-transform:uppercase}
  .foot{margin-top:16px;padding-top:8px;border-top:1px solid #e3e8ed;display:flex;justify-content:space-between;gap:12px;font-size:7.5px;color:#94a3b8}

  /* ---- pallet label: read from across the warehouse ---- */
  .label{padding:13mm}
  .lpoV{font-size:19px;font-weight:800;letter-spacing:3.5px;line-height:1}
  .lnum{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
        border-bottom:1px solid #dfe3e8;padding:8px 0}
  .lnumBig{font-size:165px;font-weight:800;line-height:.82;letter-spacing:-6px}
  .lnumOf{font-size:29px;font-weight:700;color:#5b6774;margin-top:8px;letter-spacing:1px}
  .lnumCap{font-size:10px;letter-spacing:9px;color:#777;text-transform:uppercase;margin-bottom:14px;padding-left:9px}
  .lprod{padding:15px 0;border-bottom:1px solid #dfe3e8}
  .lprodV{font-size:27px;font-weight:700;line-height:1.15;margin-top:5px}
  .lrow{display:flex;border-bottom:1px solid #dfe3e8}
  .lcell{flex:1;padding:15px 0}
  .lcell+.lcell{border-left:1px solid #dfe3e8;padding-left:20px}
  .lcellV{font-size:42px;font-weight:800;line-height:1;margin-top:7px;letter-spacing:-1px}
  .ldest{padding:15px 0 0}
  .ldestV{font-size:19px;font-weight:700;margin-top:5px}
  .ldestA{color:#5b6774;margin-top:3px;line-height:1.5}

  /* Last, so it beats the display:flex on .bar above -- otherwise the toolbar
     prints as a page of its own and every pack comes out one page long. */
  @media print{.bar,.hint{display:none !important}}`
}

function wsPackPages(s){
  const d=wsShipDestOf(s.destination_id)||{}
  const t=wsShipTotals(s)
  const lines=wsShipLinesOf(s.id).filter(l=>Number(l.meals)>0)
  const pallets=wsPalletList(s)
  const collect=d.mode==='collection'
  const po=esc(s.po_number), prod=esc(s.product_name)
  const dateLong=esc(wsShipDateLong(s.dispatch_date))
  const brand='<div class="brand"><small>LTD</small>WILLA</div>'
  const foot=(title,right)=>`<div class="foot"><span>Willa Ltd · Unit 17, 250 Milkwood Rd, London SE24 0HG</span><span>${title} · ${po}</span><span>${right==null?`Goods ${collect?'collected':'received'} in good condition unless noted above`:right}</span></div>`
  const noteTitle=collect?'Collection Note':'Delivery Note'

  // Page 1 -- delivery (or collection) note
  let h=`<div class="page">
    <div class="top">${brand}<div class="doctype"><h1>${noteTitle}</h1><div>Ref / PO · ${po}</div></div></div>
    <div class="cols">
      <div>
        <div class="lbl">${collect?'Collected by':'Deliver to'}</div>
        <div class="who">${esc(d.name||'')}</div>
        ${d.address_line?`<div class="sub">${esc(d.address_line)}</div>`:''}
        ${d.sub_label?`<div class="sub">${esc(d.sub_label)}</div>`:''}
        ${d.attn?`<div class="sub">Attn: ${esc(d.attn)}</div>`:''}
      </div>
      <div>
        <div class="lbl">Consignment</div>
        <div class="kv">Product <b>${prod}</b></div>
        <div class="kv">PO Number <b>${po}</b></div>
        <div class="kv">${collect?'Collection':'Dispatch'} Date <b>${dateLong}</b></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${wsShipNum(t.pallets)}</div><div class="t">Pallet${t.pallets===1?'':'s'}</div></div>
      <div class="stat"><div class="n">${wsShipNum(t.meals)}</div><div class="t">Meals</div></div>
      <div class="stat"><div class="n">${wsShipNum(t.trays)}</div><div class="t">Trays</div></div>
      <div class="stat"><div class="n">${wsShipNum(t.configs)}</div><div class="t">Configuration${t.configs===1?'':'s'}</div></div>
    </div>
    <div class="lbl">Consignment breakdown</div>
    <table><thead><tr><th style="width:24%">Configuration</th><th>Product</th><th class="num">Trays</th><th class="num">Pallets</th><th class="num">Meals</th></tr></thead><tbody>
      ${lines.map(l=>{const c=wsShipCalc(l,s.trays_per_pallet)
        return `<tr><td>${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(c.trays)}</td><td class="num">${wsShipNum(c.pallets)}</td><td class="num">${wsShipNum(c.meals)}</td></tr>`}).join('')}
      <tr class="tot"><td>Total</td><td>${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'}</td><td class="num">${wsShipNum(t.trays)}</td><td class="num">${wsShipNum(t.pallets)}</td><td class="num">${wsShipNum(t.meals)}</td></tr>
    </tbody></table>
    <div class="notes">
      <div class="lbl">Notes, shortages or damage on ${collect?'collection':'delivery'}</div>
      <div class="notesBox"></div>
    </div>
    <div class="sign">
      <div>${collect?'Collected by (print name)':'Received by (print name)'}</div><div>Signature</div><div>Date &amp; time</div>
    </div>
    ${foot(noteTitle)}
  </div>`

  // Page 2 -- packing list, pallet by pallet
  let n=0
  const palletRows=lines.map(l=>{
    const c=wsShipCalc(l, s.trays_per_pallet)
    let r=''
    for(let i=0;i<c.fullPallets;i++){ n++; r+=`<tr><td>${String(n).padStart(2,'0')}</td><td>${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(c.mealsPerFullPallet)}</td></tr>` }
    if(c.lastPalletMeals>0){ n++; r+=`<tr><td>${String(n).padStart(2,'0')}</td><td>${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(c.lastPalletMeals)}</td></tr>` }
    r+=`<tr class="subt"><td></td><td colspan="2">${esc(l.config)} subtotal — ${wsShipNum(c.trays)} trays across ${wsShipNum(c.pallets)} pallet${c.pallets===1?'':'s'}</td><td class="num">${wsShipNum(c.meals)}</td></tr>`
    return r
  }).join('')

  h+=`<div class="page">
    <div class="top">${brand}<div class="doctype"><h1>Packing List</h1><div>Ref / PO · ${po}</div></div></div>
    <div class="cols">
      <div><div class="lbl">${collect?'Collected by':'Deliver to'}</div><div class="who">${esc(d.name||'')}</div></div>
      <div><div class="lbl">Product</div><div class="who">${prod}</div></div>
      <div style="flex:0 0 30%"><div class="lbl">${collect?'Collection date':'Dispatch date'}</div><div class="who">${dateLong}</div></div>
    </div>
    <div style="margin-top:22px">
      <table>
        <thead><tr><th style="width:12%">Pallet</th><th style="width:22%">Configuration</th><th>Product</th><th class="num">Meals</th></tr></thead>
        <tbody>${palletRows}
          <tr class="tot"><td>Total</td><td colspan="2">${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'} · ${wsShipNum(t.trays)} trays</td><td class="num">${wsShipNum(t.meals)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="notes">
      <div class="lbl">Notes</div>
      <div class="notesBox"></div>
    </div>
    ${foot('Packing List', 'All quantities verified at dispatch')}
  </div>`

  // Pages 3+ -- one label per pallet
  if(d.pallet_labels){
    pallets.forEach((p,i)=>{
      h+=`<div class="page label">
        <div class="top">${brand}<div class="doctype"><div class="lbl" style="margin-bottom:4px">PO Number</div><div class="lpoV">${po}</div></div></div>
        <div class="lnum">
          <div class="lnumCap">Pallet</div>
          <div class="lnumBig">${i+1}</div>
          <div class="lnumOf">of ${pallets.length}</div>
        </div>
        <div class="lprod"><div class="lbl">Product</div><div class="lprodV">${prod}</div></div>
        <div class="lrow">
          <div class="lcell"><div class="lbl">Configuration</div><div class="lcellV">${esc(p.config)}</div></div>
          <div class="lcell"><div class="lbl">Meals on this pallet</div><div class="lcellV">${wsShipNum(p.meals)}</div></div>
        </div>
        <div class="ldest">
          <div class="lbl">${collect?'Collected by':'Deliver to'}</div>
          <div class="ldestV">${esc(d.name||'')}</div>
          ${d.address_line?`<div class="ldestA">${esc(d.address_line)}</div>`:''}
          ${d.sub_label?`<div class="ldestA">${esc(d.sub_label)}</div>`:''}
        </div>
        ${foot('Pallet '+(i+1)+' of '+pallets.length, esc(s.product_name)+' · '+dateLong)}
      </div>`
    })
  }

  return h
}

function wsPackPageCount(s){
  const d=wsShipDestOf(s.destination_id)||{}
  return 2+(d.pallet_labels?wsPalletList(s).length:0)
}

/* One document, one or many shipments. Combining does NOT merge the
   consignments -- each keeps its own PO, its own note and its own labels; they
   are simply printed back to back, which is how the combined Coolpack pack was
   being put together by hand. */
function wsPackDoc(ships){
  const t=ships.reduce((a,x)=>{const n=wsShipTotals(x);a.meals+=n.meals;a.trays+=n.trays;a.pallets+=n.pallets;return a},{meals:0,trays:0,pallets:0})
  const pageCount=ships.reduce((n,x)=>n+wsPackPageCount(x),0)
  const pos=ships.map(x=>esc(x.po_number))
  const many=ships.length>1
  const title=many?'Combined pack — '+pos.join(' + '):pos[0]+' — pack'
  const head=many
    ? `<b>Combined pack</b> &nbsp;·&nbsp; ${pos.join(' &nbsp;+&nbsp; ')}`
    : `<b>${pos[0]}</b>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${wsPackCss()}</style></head><body>
    <div class="bar"><span>${head} &nbsp;·&nbsp; ${pageCount} page${pageCount===1?'':'s'} &nbsp;·&nbsp; ${wsShipNum(t.pallets)} pallets &nbsp;·&nbsp; ${wsShipNum(t.meals)} meals &nbsp;·&nbsp; ${wsShipNum(t.trays)} trays</span><button onclick="window.print()">Print / Save as PDF</button></div>
    <div class="hint">In the print dialog set Margins to <b>None</b> and untick <b>Headers and footers</b>, or Chrome adds its own date and page numbers over the top of the pack.</div>
    ${ships.map(wsPackPages).join('')}</body></html>`
}

function wsPackOpen(ships){
  if(!ships.length) return
  const empty=ships.filter(x=>!wsShipTotals(x).meals)
  if(empty.length){alert((empty.length===1?empty[0].po_number+' has':'These shipments have')+' no meals on them yet.');return}
  const w=window.open('', '_blank')
  if(!w){alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');return}
  w.document.open(); w.document.write(wsPackDoc(ships)); w.document.close()
}

window.wsPrintPack=function(id){
  const s=wsShips.find(x=>x.id===id)
  if(s) wsPackOpen([s])
}
window.wsPrintCombined=function(){
  // Keep the printed order the same as the order on screen, so the pack matches
  // the list the manager just ticked.
  const picked=wsShips.filter(x=>wsShipSel.has(x.id))
  if(picked.length<2){alert('Tick at least two shipments to print them together.');return}
  wsPackOpen(picked)
}
