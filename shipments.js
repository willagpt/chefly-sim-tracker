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

// [label, tray capacity]. Large trays hold fewer because the meals are bigger.
const WS_CONFIGS=[['Standard',30],['Large',24],['Lean',30]]
const WS_TRAYS_PER_PALLET=45

function wsShipDestOf(id){return wsDests.find(d=>d.id===id)}
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
function wsShipPrefillProduct(){
  const ids=typeof wsWeekMealIds==='function'?wsWeekMealIds():new Set()
  for(const id of ids){ const m=wsMealOf(id); if(m) return m.name }
  const m=(wsMeals||[]).find(x=>x.active)
  return m?m.name:''
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
  const pre=wsShipPrefill(), prod=wsShipPrefillProduct()
  const dOpts='<option value="">Destination…</option>'+wsDests.filter(d=>d.active)
    .map(d=>`<option value="${d.id}">${esc(d.name)}${d.sub_label?' — '+esc(d.sub_label):''}</option>`).join('')
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
      <div><label style="font-size:12px;color:var(--muted)">Product</label>
        <input id="wsShipProduct" value="${esc(prod)}" style="width:100%" /></div>
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

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0">${esc(d?d.name:'—')}</h2>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${esc(s.po_number)} · ${esc(s.product_name)} · ${wsShipNoun(d).toLowerCase()} ${esc(wsShipDateLong(s.dispatch_date))}
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

function wsShipView(){
  if(!wsCanPlan()) return '<div class="card"><p class="muted">Managers only.</p></div>'
  let h='<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<div><h2 style="margin:0">Shipments</h2><p class="muted" style="font-size:13px;margin:2px 0 0">'+
    'Delivery note, packing list and pallet labels are generated from these numbers — nothing is typed twice.</p></div>'+
    (wsShipNewOpen?'':'<button onclick="wsShipToggleNew()">＋ New shipment</button>')+'</div>'
  if(wsShipNewOpen) h+=wsShipNewCard()
  if(!wsShips.length && !wsShipNewOpen)
    h+='<div class="card"><p class="muted">No shipments for this week yet.</p></div>'
  h+=wsShips.map(wsShipCard).join('')
  return h
}

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
  return `@page{size:A4;margin:14mm}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;margin:0;font-size:12px}
  .page{page-break-after:always;min-height:255mm;display:flex;flex-direction:column}
  .page:last-child{page-break-after:auto}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px}
  .brand{font-size:26px;font-weight:800;letter-spacing:3px;line-height:1}
  .brand small{display:block;font-size:9px;letter-spacing:4px;font-weight:600;margin-bottom:2px}
  .doctype{text-align:right}
  .doctype h1{font-size:19px;margin:0;letter-spacing:2px;text-transform:uppercase}
  .doctype div{font-size:10px;color:#555;margin-top:3px;letter-spacing:1px}
  .cols{display:flex;gap:28px;margin-top:20px}
  .cols>div{flex:1}
  .lbl{font-size:9px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:6px}
  .who{font-size:15px;font-weight:700}
  .sub{color:#444;margin-top:3px;line-height:1.5}
  .kv{margin:2px 0;color:#333}
  .kv b{color:#111}
  .stats{display:flex;gap:10px;margin:26px 0;text-align:center}
  .stat{flex:1;border:1px solid #ddd;border-radius:6px;padding:14px 6px}
  .stat .n{font-size:28px;font-weight:800;line-height:1}
  .stat .t{font-size:8px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-top:6px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{font-size:9px;letter-spacing:1.5px;color:#666;text-transform:uppercase;text-align:left;padding:6px 8px;border-bottom:1px solid #ccc}
  td{padding:7px 8px;border-bottom:1px solid #eee}
  .num{text-align:right}
  tr.sub td{color:#666;font-size:11px;border-bottom:1px solid #ddd}
  tr.tot td{font-weight:800;border-top:2px solid #111;border-bottom:none}
  .sign{margin-top:auto;padding-top:26px;display:flex;gap:20px}
  .sign div{flex:1;border-top:1px solid #111;padding-top:5px;font-size:8px;letter-spacing:1.5px;color:#666;text-transform:uppercase}
  .foot{margin-top:14px;padding-top:7px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:8px;color:#888}
  .label-body{flex:1;display:flex;flex-direction:column;justify-content:space-around;text-align:center;padding:14mm 0}
  .pnum{font-size:96px;font-weight:800;line-height:.95}
  .pof{font-size:26px;color:#555;font-weight:700}
  .plbl{font-size:10px;letter-spacing:4px;color:#666;text-transform:uppercase;margin-top:2px}
  .prod{font-size:34px;font-weight:700;margin:0;padding:18px 8px;border-top:2px solid #111;border-bottom:2px solid #111}
  .lgrid{display:flex;gap:10px;text-align:left}
  .lgrid>div{flex:1}
  .lgrid .v{font-size:22px;font-weight:700;margin-top:5px}
  .noprint{padding:10px 14px;background:#111;color:#fff;display:flex;justify-content:space-between;align-items:center;font-size:13px}
  .noprint button{font:inherit;padding:6px 16px;border-radius:6px;border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}
  @media print{.noprint{display:none}}`
}

function wsPackHtml(s){
  const d=wsShipDestOf(s.destination_id)||{}
  const t=wsShipTotals(s)
  const lines=wsShipLinesOf(s.id).filter(l=>Number(l.meals)>0)
  const pallets=wsPalletList(s)
  const collect=d.mode==='collection'
  const po=esc(s.po_number), prod=esc(s.product_name)
  const dateLong=esc(wsShipDateLong(s.dispatch_date))
  const brand='<div class="brand"><small>LTD</small>WILLA</div>'
  const foot=`<div class="foot"><span>Willa Ltd · Unit 17, 250 Milkwood Rd, London SE24 0HG</span><span>${collect?'Collection':'Delivery'} Note · ${po}</span><span>Goods ${collect?'collected':'received'} in good condition unless noted above</span></div>`

  // Page 1 -- delivery (or collection) note
  let h=`<div class="page">
    <div class="top">${brand}<div class="doctype"><h1>${collect?'Collection Note':'Delivery Note'}</h1><div>Ref / PO · ${po}</div></div></div>
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
      <div class="stat"><div class="n">${wsShipNum(t.configs)}</div><div class="t">Configuration${t.configs===1?'':'s'}</div></div>
    </div>
    <div class="lbl">Consignment breakdown</div>
    <table><tbody>
      ${lines.map(l=>`<tr><td style="width:22%">${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(l.meals)}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'}</td><td class="num">${wsShipNum(t.meals)}</td></tr>
    </tbody></table>
    <div class="sign">
      <div>${collect?'Collected by (print name)':'Received by (print name)'}</div><div>Signature</div><div>Date &amp; time</div>
    </div>
    ${foot}
  </div>`

  // Page 2 -- packing list, pallet by pallet
  let n=0
  const palletRows=lines.map(l=>{
    const c=wsShipCalc(l, s.trays_per_pallet)
    let r=''
    for(let i=0;i<c.fullPallets;i++){ n++; r+=`<tr><td>${String(n).padStart(2,'0')}</td><td>${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(c.mealsPerFullPallet)}</td></tr>` }
    if(c.lastPalletMeals>0){ n++; r+=`<tr><td>${String(n).padStart(2,'0')}</td><td>${esc(l.config)}</td><td>${prod}</td><td class="num">${wsShipNum(c.lastPalletMeals)}</td></tr>` }
    r+=`<tr class="sub"><td></td><td colspan="2">${esc(l.config)} subtotal</td><td class="num">${wsShipNum(c.meals)}</td></tr>`
    return r
  }).join('')

  h+=`<div class="page">
    <div class="top">${brand}<div class="doctype"><h1>Packing List</h1><div>Ref / PO · ${po}</div></div></div>
    <div class="cols" style="margin-top:16px">
      <div><div class="lbl">${collect?'Collected by':'Deliver to'}</div><div class="who" style="font-size:13px">${esc(d.name||'')}</div></div>
      <div><div class="lbl">Product</div><div class="who" style="font-size:13px">${prod}</div></div>
      <div><div class="lbl">${collect?'Collection date':'Dispatch date'}</div><div class="who" style="font-size:13px">${dateLong}</div></div>
    </div>
    <table>
      <thead><tr><th>Pallet</th><th>Configuration</th><th>Product</th><th class="num">Meals</th></tr></thead>
      <tbody>${palletRows}
        <tr class="tot"><td>Total</td><td colspan="2">${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'}</td><td class="num">${wsShipNum(t.meals)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:14px;font-size:10px;color:#666">All quantities verified at dispatch. Configuration subtotals: ${lines.map(l=>esc(l.config)+' '+wsShipNum(l.meals)).join(' · ')} · Grand total ${wsShipNum(t.meals)} meals across ${wsShipNum(t.pallets)} pallet${t.pallets===1?'':'s'}. Trays: ${wsShipNum(t.trays)}.</div>
    ${foot}
  </div>`

  // Pages 3+ -- one label per pallet
  if(d.pallet_labels){
    pallets.forEach((p,i)=>{
      h+=`<div class="page">
        <div class="top">${brand}<div class="doctype"><div style="font-size:9px;letter-spacing:2px;color:#666;text-transform:uppercase">PO Number</div><h1 style="letter-spacing:4px">${po}</h1></div></div>
        <div class="label-body">
          <div><div><span class="pnum">${i+1}</span> <span class="pof">/ ${pallets.length}</span></div><div class="plbl">Pallet</div></div>
          <div class="prod">${prod}</div>
          <div class="lgrid">
            <div><div class="lbl">Destination</div><div class="v">${esc(d.name||'')}</div></div>
            <div><div class="lbl">Configuration</div><div class="v">${esc(p.config)}</div></div>
            <div><div class="lbl">Meals</div><div class="v">${wsShipNum(p.meals)}</div></div>
          </div>
        </div>
        <div class="foot" style="justify-content:center"><span>Willa Ltd · ${po} · Pallet ${i+1} of ${pallets.length}</span></div>
      </div>`
    })
  }

  const pageCount=2+(d.pallet_labels?pallets.length:0)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${po} — ${collect?'collection':'shipping'} pack</title><style>${wsPackCss()}</style></head><body>
    <div class="noprint"><span>${po} · ${pageCount} page${pageCount===1?'':'s'} · ${wsShipNum(t.pallets)} pallets · ${wsShipNum(t.meals)} meals · ${wsShipNum(t.trays)} trays</span><button onclick="window.print()">Print / Save as PDF</button></div>
    ${h}</body></html>`
}

window.wsPrintPack=function(id){
  const s=wsShips.find(x=>x.id===id); if(!s) return
  const t=wsShipTotals(s)
  if(!t.meals){alert('This shipment has no meals on it yet.');return}
  const w=window.open('', '_blank')
  if(!w){alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');return}
  w.document.open(); w.document.write(wsPackHtml(s)); w.document.close()
}
