/* TRACE: goods-in traceability. The lot code IS the goods-in (receiving) date —
   the same date written on the sticker when a delivery arrives. Staff pick the
   lot on the running task card when they use an ingredient. Reports trace a
   delivery forward to every batch that used it, or a batch back to the
   deliveries (and invoice / supplier) that went into it. */

let trIngredients=[], trGoods=[], trProfs=[], trStaffs=[], _trLotsAt=0, _biCache={}, _mmOrders=[]
let trSuppliers=[], _spEditId=null

function giCode(g){const d=String(g.received_date||'').split('-');return d.length===3?('GI '+d[2]+'/'+d[1]+'/'+d[0].slice(2)):'GI ?'}
function trIngName(id){const i=trIngredients.find(x=>x.id===id);return i?i.name:'(ingredient)'}
function lotLabel(g){return trIngName(g.ingredient_id)+' · '+giCode(g)+(g.supplier?' · '+g.supplier:'')}
function _trIsoToday(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

async function trEnsureIngredients(force){
  if(trIngredients.length&&!force) return
  const {data}=await sb.from('sim_ingredients').select('*').eq('active',true).order('sort_order').order('name')
  trIngredients=data||[]
}
async function trEnsureSuppliers(force){
  if(trSuppliers.length&&!force) return
  const {data}=await sb.from('sim_suppliers').select('*').order('sort_order').order('name')
  trSuppliers=data||[]
}
// pill state for a supplier's certificate: reused for the list and the dropdowns
function supplierStatus(sup){
  const t=String((sup&&sup.cert_type)||'').trim().toLowerCase()
  const noneNeeded=(!t||['none','n/a','na','not required','not needed'].includes(t))
  if(!sup||!sup.cert_expiry){
    if(noneNeeded) return {cls:'na',label:'N/A'}
    return {cls:'red',label:'no expiry set'}
  }
  const days=Math.round((new Date(sup.cert_expiry)-new Date(_trIsoToday()))/864e5)
  if(days<0) return {cls:'red',label:'expired'}
  if(days<=30) return {cls:'amber',label:days+'d left'}
  return {cls:'green',label:'valid'}
}
function _supPill(st){
  const c={green:'#16a34a',amber:'#d97706',red:'#dc2626',na:'#64748b'}[st.cls]||'#64748b'
  return `<span class="pill" style="background:${c};color:#fff">${esc(st.label)}</span>`
}
function populateSupplierSelect(selectId,includeBlank){
  const sel=$(selectId); if(!sel)return; const cur=sel.value
  let html=includeBlank?'<option value="">— pick supplier —</option>':''
  html+=trSuppliers.map(s=>{const st=supplierStatus(s);return `<option value="${s.id}">${esc(s.name)}${st.label?' · '+esc(st.label):''}</option>`}).join('')
  html+='<option value="__other__">— other / not listed —</option>'
  sel.innerHTML=html
  if(cur)sel.value=cur
}
window.giSupplierChanged=function(){
  const other=$('giSupplier')&&$('giSupplier').value==='__other__'
  const box=$('giSupplierOther'); if(box){other?show(box):hide(box)}
}
function renderSupplierList(){
  const box=$('supplierList'); if(!box)return; box.innerHTML=''
  trSuppliers.forEach(s=>{
    const st=supplierStatus(s)
    const prod=String(s.products||''); const prodShort=prod.length>60?(prod.slice(0,60)+'…'):prod
    const emailHtml=s.email?esc(s.email):'<span style="color:#dc2626">no email</span>'
    const d=document.createElement('div'); d.className='task-item'
    d.innerHTML=`<div style="min-width:0"><b>${esc(s.name)}</b> ${_supPill(st)}<div class="meta">${esc(s.category)||'food'}${prodShort?' · '+esc(prodShort):''}${s.cert_expiry?' · cert '+esc(s.cert_expiry):''} · ${emailHtml}</div></div>`
    const b=document.createElement('button'); b.className='ghost sm'; b.textContent='Edit'; b.onclick=()=>editSupplier(s.id)
    d.appendChild(b); box.appendChild(d)
  })
  if(!trSuppliers.length) box.innerHTML='<p class="muted">No suppliers yet. Add one above.</p>'
}
window.saveSupplier=async function(){
  if(!isManagerUp()){msg($('spMsg'),'Managers only.',false);return}
  const name=$('spName').value.trim(); if(!name){msg($('spMsg'),'Enter a supplier name.',false);return}
  const rec={name,
    category:$('spCategory').value||'food',
    products:$('spProducts').value.trim()||null,
    address:$('spAddress').value.trim()||null,
    contact:$('spContact').value.trim()||null,
    email:$('spEmail').value.trim()||null,
    cert_type:$('spCertType').value.trim()||null,
    cert_ref:$('spCertRef').value.trim()||null,
    cert_expiry:$('spCertExpiry').value||null,
    approval_status:$('spApproval').value||'approved'}
  let error
  if(_spEditId){ ({error}=await sb.from('sim_suppliers').update(rec).eq('id',_spEditId)) }
  else { const order=(trSuppliers.length?Math.max(...trSuppliers.map(s=>s.sort_order||0)):0)+1; ({error}=await sb.from('sim_suppliers').insert(Object.assign({},rec,{sort_order:order,active:true}))) }
  if(error){msg($('spMsg'),error.message,false);return}
  msg($('spMsg'),_spEditId?'Supplier updated.':'Supplier added.',true)
  supplierFormReset()
  await trEnsureSuppliers(true); renderSupplierList(); populateSupplierSelect('giSupplier',true); populateSupplierSelect('inSupplier',true)
}
window.editSupplier=function(id){
  const s=trSuppliers.find(x=>x.id===id); if(!s)return
  _spEditId=id
  $('spName').value=s.name||''
  $('spCategory').value=s.category||'food'
  $('spProducts').value=s.products||''
  $('spAddress').value=s.address||''
  $('spContact').value=s.contact||''
  $('spEmail').value=s.email||''
  $('spCertType').value=s.cert_type||''
  $('spCertRef').value=s.cert_ref||''
  $('spCertExpiry').value=s.cert_expiry||''
  $('spApproval').value=s.approval_status||'approved'
  const b=$('spSaveBtn'); if(b)b.textContent='Save changes'
  const c=$('spCancelBtn'); if(c)c.classList.remove('hidden')
  clearMsg($('spMsg')); if($('spName').scrollIntoView)$('spName').scrollIntoView({behavior:'smooth',block:'center'})
}
window.supplierFormReset=function(){
  _spEditId=null
  ;['spName','spProducts','spAddress','spContact','spEmail','spCertType','spCertRef','spCertExpiry'].forEach(id=>{const e=$(id);if(e)e.value=''})
  if($('spCategory'))$('spCategory').value='food'
  if($('spApproval'))$('spApproval').value='approved'
  const b=$('spSaveBtn'); if(b)b.textContent='Add supplier'
  const c=$('spCancelBtn'); if(c)c.classList.add('hidden')
}
// ---- certificate renewal reminder settings (admin only) ----
async function renderCertReminderCard(){
  const card=$('certRemindCard'); if(!card)return
  if(!isAdmin()){card.classList.add('hidden');return}
  card.classList.remove('hidden')
  const {data}=await sb.from('sim_cert_reminder_settings').select('*').limit(1).maybeSingle()
  const s=data||{}
  if($('crEnabled'))$('crEnabled').checked=!!s.enabled
  if($('crFromEmail'))$('crFromEmail').value=s.from_email||'kaja@eatchefly.com'
}
window.saveCertReminders=async function(){
  if(!isAdmin()){msg($('crMsg'),'Admins only.',false);return}
  const rec={enabled:$('crEnabled').checked, from_email:$('crFromEmail').value.trim()||'kaja@eatchefly.com'}
  const {error}=await sb.from('sim_cert_reminder_settings').update(rec).eq('id',true)
  if(error){msg($('crMsg'),error.message,false);return}
  msg($('crMsg'),'Saved.',true)
}
async function trEnsureLots(force){
  const now=Date.now()
  if(trGoods.length&&!force&&(now-_trLotsAt)<60000) return
  await trEnsureIngredients()
  const cut=new Date(now-60*864e5)
  const iso=cut.getFullYear()+'-'+String(cut.getMonth()+1).padStart(2,'0')+'-'+String(cut.getDate()).padStart(2,'0')
  const {data}=await sb.from('sim_goods_in').select('*').eq('active',true).gte('received_date',iso).order('received_date',{ascending:false}).order('created_at',{ascending:false})
  trGoods=data||[]; _trLotsAt=now
}
async function trEnsureNames(){
  if(!trProfs.length){const {data}=await sb.from('sim_profiles').select('id,full_name,email');trProfs=data||[]}
  if(!trStaffs.length){const {data}=await sb.from('sim_staff').select('id,full_name');trStaffs=data||[]}
}
function trWho(l){ if(l.user_id){const p=trProfs.find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=trStaffs.find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }

// ---- Trace tab (manager/admin) ----
window.initTrace=async function(){
  if(!isManagerUp())return
  if($('giDate')&&!$('giDate').value)$('giDate').value=_trIsoToday()
  if($('tbTo')&&!$('tbTo').value)$('tbTo').value=_trIsoToday()
  if($('tbFrom')&&!$('tbFrom').value){const d=new Date(Date.now()-6*864e5);$('tbFrom').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  await trEnsureSuppliers(true); await trEnsureIngredients(true); await trEnsureLots(true)
  renderSupplierList(); await renderCertReminderCard()
  populateSupplierSelect('giSupplier',true); populateSupplierSelect('inSupplier',true); giSupplierChanged()
  renderIngredientList(); populateGiIngSelect(); renderGoodsInList(); populateTraceLotSelect()
}

// ---- ingredients master ----
window.addIngredient=async function(){
  const name=$('inName').value.trim(); if(!name){msg($('inMsg'),'Enter an ingredient name.',false);return}
  const uom=($('inUom').value||'kg').trim()||'kg'
  const supSel=$('inSupplier')?$('inSupplier').value:''
  let supplier_id=null, supplier=null
  if(supSel&&supSel!=='__other__'){ supplier_id=supSel; const s=trSuppliers.find(x=>x.id===supSel); supplier=s?s.name:null }
  const order=(trIngredients.length?Math.max(...trIngredients.map(i=>i.sort_order||0)):0)+1
  const {error}=await sb.from('sim_ingredients').insert({name,uom,supplier,supplier_id,sort_order:order})
  if(error){msg($('inMsg'),error.message,false);return}
  $('inName').value='';if($('inSupplier'))$('inSupplier').value='';msg($('inMsg'),'Ingredient added.',true)
  await trEnsureIngredients(true); renderIngredientList(); populateGiIngSelect()
}
window.addIngredientInline=async function(){
  const nm=prompt('New ingredient name:'); if(nm===null)return
  const n=nm.trim(); if(!n)return
  const order=(trIngredients.length?Math.max(...trIngredients.map(i=>i.sort_order||0)):0)+1
  const {data,error}=await sb.from('sim_ingredients').insert({name:n,sort_order:order}).select().single()
  if(error){alert(error.message);return}
  await trEnsureIngredients(true); renderIngredientList(); populateGiIngSelect()
  const sel=$('giIng'); if(sel&&data)sel.value=data.id
}
function renderIngredientList(){
  const box=$('ingredientList'); if(!box)return; box.innerHTML=''
  trIngredients.forEach(i=>{
    const d=document.createElement('div'); d.className='task-item'
    const supName=i.supplier_id?(((trSuppliers.find(s=>s.id===i.supplier_id)||{}).name)||i.supplier):i.supplier
    d.innerHTML=`<div><b>${esc(i.name)}</b><div class="meta">${esc(i.uom)||'kg'}${supName?' · '+esc(supName):''}</div></div>`
    const b=document.createElement('button'); b.className='ghost sm'; b.textContent='Remove'
    b.onclick=async()=>{if(!confirm('Remove '+i.name+'? Past deliveries keep their records.'))return;await sb.from('sim_ingredients').update({active:false}).eq('id',i.id);await trEnsureIngredients(true);renderIngredientList();populateGiIngSelect()}
    d.appendChild(b); box.appendChild(d)
  })
  if(!trIngredients.length) box.innerHTML='<p class="muted">No ingredients yet. Add one above.</p>'
}
function populateGiIngSelect(){
  const sel=$('giIng'); if(!sel)return; const cur=sel.value
  sel.innerHTML='<option value="">— pick ingredient —</option>'+trIngredients.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')
  if(cur)sel.value=cur
}

// ---- goods-in receipts ----
window.addGoodsIn=async function(){
  const ing=$('giIng').value; if(!ing){msg($('giMsg'),'Pick an ingredient (or + new).',false);return}
  const date=$('giDate').value||_trIsoToday()
  const qty=$('giQty').value?Number($('giQty').value):null
  const uom=($('giUom').value||'kg').trim()||'kg'
  const supSel=$('giSupplier')?$('giSupplier').value:''
  let supplier_id=null, supplier=null, chosen=null
  if(supSel==='__other__'){ supplier=(($('giSupplierOther')&&$('giSupplierOther').value)||'').trim()||null }
  else if(supSel){ supplier_id=supSel; chosen=trSuppliers.find(x=>x.id===supSel)||null; supplier=chosen?chosen.name:null }
  const invoice=$('giInvoice').value.trim()||null
  const notes=$('giNotes').value.trim()||null
  const {data,error}=await sb.from('sim_goods_in').insert({ingredient_id:ing,received_date:date,qty,uom,supplier,supplier_id,invoice_ref:invoice,notes}).select().single()
  if(error){msg($('giMsg'),error.message,false);return}
  $('giQty').value='';$('giInvoice').value='';$('giNotes').value=''
  const expired=chosen&&chosen.cert_expiry&&(new Date(chosen.cert_expiry)<new Date(_trIsoToday()))
  if(expired) msg($('giMsg'),'⚠ '+chosen.name+"'s certificate is expired — logged, but chase renewal",false)
  else msg($('giMsg'),'Delivery logged — code '+(data?giCode(data):'')+'. This is the sticker date.',true)
  await trEnsureLots(true); renderGoodsInList(); populateTraceLotSelect()
}
function renderGoodsInList(){
  const box=$('giList'); if(!box)return; box.innerHTML=''
  trGoods.slice(0,40).forEach(g=>{
    const d=document.createElement('div'); d.className='task-item'
    d.innerHTML=`<div><b>${esc(trIngName(g.ingredient_id))}</b> <span class="pill done">${esc(giCode(g))}</span><div class="meta">${g.qty!=null?g.qty+' '+esc(g.uom||'kg')+' · ':''}${g.supplier?esc(g.supplier)+' · ':''}${g.invoice_ref?'inv '+esc(g.invoice_ref)+' · ':''}${esc(g.notes)||''}</div></div>`
    const b=document.createElement('button'); b.className='ghost sm'; b.textContent='Remove'
    b.onclick=async()=>{if(!confirm('Remove this delivery? Only do this for mistakes — batches that used it keep their trace records.'))return;await sb.from('sim_goods_in').update({active:false}).eq('id',g.id);await trEnsureLots(true);renderGoodsInList();populateTraceLotSelect()}
    d.appendChild(b); box.appendChild(d)
  })
  if(!trGoods.length) box.innerHTML='<p class="muted">No deliveries in the last 60 days. Log one above.</p>'
}
function populateTraceLotSelect(){
  const sel=$('tfLot'); if(!sel)return
  sel.innerHTML='<option value="">— pick a delivery —</option>'+trGoods.map(g=>`<option value="${g.id}">${esc(lotLabel(g))}${g.qty!=null?' · '+g.qty+' '+esc(g.uom||'kg'):''}</option>`).join('')
}

// ---- trace forward: delivery → batches ----
window.traceForward=async function(){
  const box=$('tfBody'); const gid=$('tfLot').value
  if(!gid){box.innerHTML='<p class="muted">Pick a delivery first.</p>';return}
  box.innerHTML='<p class="muted">Loading…</p>'
  const {data:bi,error}=await sb.from('sim_batch_inputs').select('*').eq('goods_in_id',gid)
  if(error){box.innerHTML='<p class="muted">'+esc(error.message)+'</p>';return}
  if(!bi||!bi.length){box.innerHTML='<p class="muted">This delivery has not been used in any logged task yet.</p>';return}
  const ids=[...new Set(bi.map(x=>x.log_id))]
  const {data:logs}=await sb.from('sim_task_logs').select('*').in('id',ids).order('start_time',{ascending:false})
  await trEnsureNames()
  const g=trGoods.find(x=>x.id===gid)
  const head=g?`<p class="muted"><b>${esc(lotLabel(g))}</b>${g.invoice_ref?' · invoice '+esc(g.invoice_ref):''} — used in ${ids.length} batch${ids.length===1?'':'es'}:</p>`:''
  box.innerHTML=head+(logs||[]).map(l=>{
    const q=bi.filter(x=>x.log_id===l.id).reduce((s,x)=>s+(Number(x.qty)||0),0)
    return `<div class="task-item"><div><b>${esc(l.task_name)}</b>${l.product?' · '+esc(l.product):''}<div class="meta">${l.log_date} · ${esc(trWho(l))} · ${l.units!=null?l.units+' '+esc(uomFor(l))+' out':(l.status==='completed'?'no amount':'still running')}${q?' · '+q+' used':''}</div></div></div>`
  }).join('')
}

// ---- trace back: production range → lots consumed ----
window.traceBack=async function(){
  const box=$('tbBody'); box.innerHTML='<p class="muted">Loading…</p>'
  const from=$('tbFrom').value, to=$('tbTo').value, f=($('tbProduct').value||'').trim().toLowerCase()
  let q=sb.from('sim_task_logs').select('*').order('start_time',{ascending:false})
  if(from)q=q.gte('log_date',from); if(to)q=q.lte('log_date',to)
  const {data:logs,error}=await q
  if(error){box.innerHTML='<p class="muted">'+esc(error.message)+'</p>';return}
  let list=(logs||[]).filter(l=>!f||String(l.product||'').toLowerCase().includes(f)||String(l.task_name||'').toLowerCase().includes(f))
  const ids=list.map(l=>l.id)
  if(!ids.length){box.innerHTML='<p class="muted">No tasks in this range.</p>';return}
  const {data:bi}=await sb.from('sim_batch_inputs').select('*').in('log_id',ids)
  const byLog={}; (bi||[]).forEach(x=>{(byLog[x.log_id]=byLog[x.log_id]||[]).push(x)})
  list=list.filter(l=>byLog[l.id])
  if(!list.length){box.innerHTML='<p class="muted">No ingredient lots recorded against tasks in this range yet. Staff add them on the task card while the job runs.</p>';return}
  const giIds=[...new Set((bi||[]).map(x=>x.goods_in_id))]
  const {data:gis}=await sb.from('sim_goods_in').select('*').in('id',giIds)
  const giById={}; (gis||[]).forEach(g=>giById[g.id]=g)
  await trEnsureIngredients(); await trEnsureNames()
  box.innerHTML=list.map(l=>{
    const lots=(byLog[l.id]||[]).map(x=>{const g=giById[x.goods_in_id];return g?('🏷 '+esc(trIngName(g.ingredient_id))+' '+esc(giCode(g))+(x.qty?' ('+x.qty+')':'')+(g.supplier?' · '+esc(g.supplier):'')+(g.invoice_ref?' · inv '+esc(g.invoice_ref):'')):''}).filter(Boolean).join('<br>')
    return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px"><div><b>${esc(l.task_name)}</b>${l.product?' · '+esc(l.product):''} <span class="muted">· ${l.log_date} · ${esc(trWho(l))}${l.units!=null?' · '+l.units+' '+esc(uomFor(l)):''}</span></div><div class="muted" style="font-size:13px">${lots}</div></div>`
  }).join('')
}

// ---- lot picker on running task cards (app + kiosk) ----
function populateLotSelect(id){
  const sel=$(id); if(!sel)return; const cur=sel.value
  sel.innerHTML='<option value="">— ingredient · goods-in code —</option>'+trGoods.map(g=>`<option value="${g.id}">${esc(lotLabel(g))}</option>`).join('')
  if(cur)sel.value=cur
}
window.refreshCardLots=async function(){
  const cards=[...(activeLogs||[]).map(l=>({l,p:'s_'+l.id})),...(kActiveLogs||[]).map(l=>({l,p:'k_'+l.id}))].filter(x=>$('lot_'+x.p))
  if(!cards.length)return
  await trEnsureLots()
  cards.forEach(x=>populateLotSelect('lot_'+x.p))
  const ids=cards.map(x=>x.l.id)
  const {data:bi}=await sb.from('sim_batch_inputs').select('*').in('log_id',ids)
  _biCache={}; (bi||[]).forEach(x=>{(_biCache[x.log_id]=_biCache[x.log_id]||[]).push(x)})
  const missing=[...new Set((bi||[]).map(x=>x.goods_in_id))].filter(id=>!trGoods.find(g=>g.id===id))
  if(missing.length){const {data:extra}=await sb.from('sim_goods_in').select('*').in('id',missing);(extra||[]).forEach(g=>trGoods.push(g))}
  await trEnsureIngredients()
  cards.forEach(x=>renderBatchInputs(x))
}
function renderBatchInputs(x){
  const box=$('bi_'+x.p); if(!box)return
  const rows=_biCache[x.l.id]||[]
  box.innerHTML=rows.map(r=>{const g=trGoods.find(gg=>gg.id===r.goods_in_id);return `<div class="muted" style="font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0">🏷 ${g?esc(lotLabel(g)):'lot'}${r.qty?' · '+r.qty:''}<a class="link" onclick="removeBatchInput('${r.id}')">✕</a></div>`}).join('')
}
window.addBatchInput=async function(logId,mode){
  const p=(mode==='kiosk'?'k_':'s_')+logId
  const sel=$('lot_'+p); if(!sel||!sel.value){alert('Pick the delivery / goods-in code first. If the delivery is not in the list, a manager logs it on the Trace tab.');return}
  const q=$('lotq_'+p); const qty=(q&&q.value!=='')?Number(q.value):null
  const {error}=await sb.from('sim_batch_inputs').insert({log_id:logId,goods_in_id:sel.value,qty})
  if(error){alert(error.message);return}
  if(q)q.value=''; sel.value=''
  await refreshCardLots()
}
window.removeBatchInput=async function(id){
  if(!confirm('Remove this lot from the task?'))return
  const {error}=await sb.from('sim_batch_inputs').delete().eq('id',id)
  if(error){alert(error.message);return}
  await refreshCardLots()
}

// ---- MarketMan expected deliveries ----
let _mmSel=null
window.loadExpected=async function(){
  const box=$('mmBody'); if(!box)return; box.innerHTML='<p class="muted">Loading from MarketMan…</p>'
  const {data,error}=await sb.functions.invoke('sim-marketman',{body:{action:'expected',days_back:14,days_forward:7}})
  if(error||!data||data.error||data.ok===false){box.innerHTML='<p class="muted">'+esc((data&&data.error)||(error&&error.message)||'Could not reach MarketMan.')+'</p>';return}
  _mmOrders=data.orders||[]; _mmSel=null
  const nums=_mmOrders.filter(o=>o.number).map(o=>'MM '+o.number)
  if(nums.length){
    const {data:recs}=await sb.from('sim_goods_in').select('invoice_ref,received_date').in('invoice_ref',nums).eq('active',true)
    const seen=new Map(); (recs||[]).forEach(r=>{if(!seen.has(r.invoice_ref))seen.set(r.invoice_ref,r.received_date)})
    _mmOrders.forEach(o=>{o.received_date=seen.get('MM '+o.number)||null})
  }
  mmRenderList()
}
function mmRenderList(){
  const box=$('mmBody'); if(!box)return
  if(!_mmOrders.length){box.innerHTML='<p class="muted">No open orders in the last 14 days / next 7 days.</p>';return}
  box.innerHTML=_mmOrders.map((o,i)=>{
    const exp=String(o.expected||'').split(' ')[0]
    const done=!!o.received_date
    const badge=done?` <span class="pill done">✓ in GoodsIn · ${esc(giCode({received_date:o.received_date}))}</span>`:''
    return `<div class="task-item"${done?' style="opacity:.75"':''}>
      <div style="min-width:0"><b style="font-size:16px">${esc(o.supplier||'?')}</b>${badge}<div class="meta">expected ${esc(exp)} · ${(o.lines||[]).length} lines · #${esc(o.number||'')} · ${esc(o.status||'')}</div></div>
      <div style="display:flex;gap:8px;flex-shrink:0"><button class="ghost sm" onclick="mmPrint(${i})">🖨 Print</button><button class="${done?'ghost':'green'} sm" onclick="mmOpen(${i})">${done?'Re-open':'Check off'}</button></div>
    </div>`
  }).join('')
}
window.mmOpen=function(i){ _mmSel=i; mmRenderDetail() }
function mmRenderDetail(){
  const o=_mmOrders[_mmSel]; const box=$('mmBody'); if(!o||!box)return
  const exp=String(o.expected||'').split(' ')[0]
  box.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
      <div><b style="font-size:17px">${esc(o.supplier||'?')}</b>${o.received_date?' <span class="pill done">✓ already in GoodsIn · '+esc(giCode({received_date:o.received_date}))+'</span>':''}<div class="muted" style="font-size:13px">#${esc(o.number||'')} · expected ${esc(exp)}</div></div>
      <div style="display:flex;gap:8px;flex-shrink:0"><button class="ghost sm" onclick="mmPrint(${_mmSel})">🖨 Print</button><button class="ghost sm" onclick="mmRenderList()">‹ Back</button></div>
    </div>
    <p class="muted" style="font-size:13px;margin:6px 0 2px">Tick each line as it comes off the van. Adjust the quantity if it's short. The 🏷 number is how many GI labels print for that line (one per pack/case). <a class="link" onclick="mmTickAll()">Tick all</a></p>
    ${(o.lines||[]).map((l,li)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid var(--line);cursor:pointer" onclick="if(event.target.tagName!=='INPUT'){const c=$('mmck_${li}');c.checked=!c.checked}">
      <input type="checkbox" id="mmck_${li}" style="width:28px;height:28px;flex-shrink:0" />
      <div style="flex:1;min-width:0;font-weight:600;font-size:15px">${esc(l.name)}</div>
      <input id="mmq_${li}" type="number" inputmode="decimal" value="${l.qty??''}" style="width:86px;padding:10px;flex-shrink:0" />
      <span class="muted" style="flex-shrink:0;min-width:26px">${esc(l.uom||'kg')}</span>
      <span class="muted" style="flex-shrink:0">🏷</span>
      <input id="lbl_${li}" type="number" inputmode="numeric" value="${Math.round(l.packs)||1}" style="width:64px;padding:10px;flex-shrink:0" />
    </div>`).join('')}
    <div class="row">
      <button class="ghost" onclick="mmPrintLabels()">🏷 Print GI labels</button>
      <button class="green" onclick="mmReceiveChecked()">✓ Receive ticked lines → GoodsIn</button>
    </div>`
}
// ---- Zebra GI label printing (via Zebra Browser Print app on the tablet) ----
async function bpAvailable(){
  const r=await fetch('http://127.0.0.1:9100/available')
  return r.json()
}
async function bpWrite(device,data){
  const r=await fetch('http://127.0.0.1:9100/write',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({device:device,data:data})})
  if(!r.ok) throw new Error('printer write failed ('+r.status+')')
}
async function mmGetPrinter(){
  let d=null
  try{ d=await bpAvailable() }
  catch(e){ alert('Could not reach Zebra Browser Print on this device.\n\n1. Install the "Zebra Browser Print" app (Android) and open it.\n2. Let it find the printer (same Wi-Fi, or pair by Bluetooth).\n3. Approve this website when the app asks.\n\nThen try again.'); return null }
  const list=(d&&(d.printer||d.printers))||[]
  if(!list.length){ alert('Browser Print is running but found no Zebra printers.\n\nCheck the printer is switched on and on the same Wi-Fi (or paired by Bluetooth), then pull down to refresh in the Browser Print app.'); return null }
  const saved=localStorage.getItem('mm_printer_uid')
  let p=list.find(x=>x.uid===saved)
  if(!p){
    if(list.length===1){ p=list[0] }
    else{
      const names=list.map((x,ix)=>(ix+1)+'. '+(x.name||x.uid)).join('\n')
      const pick=prompt('Which printer? Enter the number:\n'+names,'1')
      if(pick===null) return null
      const ix=Math.max(1,Math.min(list.length,Number(pick)||1))-1
      p=list[ix]
    }
    localStorage.setItem('mm_printer_uid',p.uid)
  }
  return p
}
function zplGiLabel(code,l,o,count){
  const clean=s=>String(s||'').replace(/[\^~\\]/g,' ')
  const pack=(l.pack_size&&l.pack_size!==1)?(l.pack_size+' '+(l.uom||'kg')+' per pack'):((l.uom||'kg'))
  return '^XA^CI28^PW400^LL240'
    +'^CF0,26^FO16,10^FDGOODS IN^FS'
    +'^CF0,60^FO16,42^FD'+clean(code)+'^FS'
    +'^CF0,24^FO16,112^FB370,2,2,L^FD'+clean(l.name)+'^FS'
    +'^CF0,20^FO16,178^FD'+clean(o.supplier||'')+(o.number?' - MM '+clean(o.number):'')+'^FS'
    +'^CF0,20^FO16,206^FD'+clean(pack)+'^FS'
    +'^PQ'+Math.max(1,count)+'^XZ'
}
window.mmPrintLabels=async function(){
  const o=_mmOrders[_mmSel]; if(!o)return
  const rows=(o.lines||[]).map((l,li)=>{
    const c=$('mmck_'+li), n=$('lbl_'+li)
    const v=(n&&n.value!=='')?Math.round(Number(n.value)):null
    return {l, ticked:!!(c&&c.checked), count:v==null?(Math.round(l.packs)||1):Math.max(0,v)}
  })
  let items=rows.filter(r=>r.ticked&&r.count>0)
  if(!items.length){
    if(!confirm('No lines ticked — print labels for every line on this order?'))return
    items=rows.filter(r=>r.count>0)
  }
  if(!items.length){alert('Nothing to print — set the 🏷 label counts first.');return}
  const total=items.reduce((s,r)=>s+r.count,0)
  const code=giCode({received_date:_trIsoToday()})
  if(!confirm('Print '+total+' GI labels ('+code+') for '+items.length+' line'+(items.length===1?'':'s')+'?'))return
  const p=await mmGetPrinter(); if(!p)return
  try{
    for(const r of items){ await bpWrite(p, zplGiLabel(code,r.l,o,r.count)) }
    alert('✓ Sent '+total+' labels to '+(p.name||'the printer')+'.')
  }catch(e){
    localStorage.removeItem('mm_printer_uid')
    alert('Printing failed: '+e.message+'\n\nCheck the printer is on and Browser Print can see it, then try again.')
  }
}
window.mmTickAll=function(){const o=_mmOrders[_mmSel];if(!o)return;(o.lines||[]).forEach((l,li)=>{const c=$('mmck_'+li);if(c)c.checked=true})}
window.mmReceiveChecked=async function(){
  const o=_mmOrders[_mmSel]; if(!o)return
  const picked=[]
  ;(o.lines||[]).forEach((l,li)=>{const c=$('mmck_'+li);if(c&&c.checked){const q=$('mmq_'+li);picked.push({name:l.name,qty:(q&&q.value!=='')?Number(q.value):l.qty,uom:l.uom})}})
  if(!picked.length){alert('Tick the lines that arrived first — tap a row to tick it.');return}
  const total=(o.lines||[]).length
  if(picked.length<total && !confirm('Only '+picked.length+' of '+total+' lines are ticked. Receive just those?'))return
  if(o.received_date && !confirm('This order is already in GoodsIn ('+giCode({received_date:o.received_date})+'). Receiving again will add duplicate lines. Continue?'))return
  const today=_trIsoToday(); const code=giCode({received_date:today})
  if(!confirm('Log '+picked.length+' line'+(picked.length===1?'':'s')+' from '+(o.supplier||'')+' into GoodsIn?\n\nTraceability code: '+code))return
  const {data,error}=await sb.functions.invoke('sim-marketman',{body:{action:'receive',date:today,order:{number:o.number,supplier:o.supplier},lines:picked}})
  if(error||!data||data.error){alert((data&&data.error)||(error&&error.message)||'Receive failed');return}
  o.received_date=today
  alert('✓ '+data.received+' lines logged into GoodsIn.\n\nTRACEABILITY CODE: '+code+'\nWrite this date on the sticker of every item in this delivery.\n\n'+(data.mm_confirmed?'Receipt confirmed in MarketMan.':'MarketMan not auto-confirmed — mark it received in MarketMan as usual.')+(data.errors&&data.errors.length?('\n\nIssues:\n'+data.errors.join('\n')):''))
  await trEnsureIngredients(true); await trEnsureLots(true); renderIngredientList(); populateGiIngSelect(); renderGoodsInList(); populateTraceLotSelect()
  mmRenderList()
}
window.mmPrint=function(i){
  const o=_mmOrders[i]; if(!o)return
  const exp=String(o.expected||'').split(' ')[0]
  const today=_trIsoToday().split('-').reverse().join('/')
  const cell='border:1px solid #000;padding:8px;font-size:13px'
  const rows=(o.lines||[]).map(l=>`<tr>
    <td style="${cell};width:34px;height:26px"></td>
    <td style="${cell}">${esc(l.name)}</td>
    <td style="${cell};text-align:right;white-space:nowrap">${l.qty??''} ${esc(l.uom||'kg')}</td>
    <td style="${cell};width:80px"></td>
    <td style="${cell};width:130px"></td>
  </tr>`).join('')
  $('printArea').innerHTML=`<div style="font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:8px">
    <h1 style="font-size:20px;margin:0 0 2px">Goods In — Delivery Check Sheet</h1>
    <p style="margin:2px 0 10px;font-size:13px">Supplier: <b>${esc(o.supplier||'')}</b> &nbsp;·&nbsp; Order #${esc(o.number||'')} &nbsp;·&nbsp; Expected: ${esc(exp)} &nbsp;·&nbsp; Printed: ${today}</p>
    <p style="margin:0 0 10px;font-size:13px"><b>Traceability code = today's goods-in date</b> — write it on the sticker for every item: <b>GI ____ / ____ / ____</b></p>
    <table style="width:100%;border-collapse:collapse">
      <tr><th style="${cell}">✓</th><th style="${cell};text-align:left">Item</th><th style="${cell}">Ordered</th><th style="${cell}">Received</th><th style="${cell}">Notes</th></tr>
      ${rows}
    </table>
    <p style="margin-top:18px;font-size:13px">Checked by: ______________________ &nbsp;&nbsp; Date / time: ________________ &nbsp;&nbsp; Vehicle clean: ☐ &nbsp;&nbsp; Chilled temps OK: ☐</p>
    <p style="font-size:12px;margin-top:6px;color:#333">Once checked, mark it received on the Trace tab (Check off → Receive) so the lots appear for traceability.</p>
  </div>`
  window.print()
}
