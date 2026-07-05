/* TRACE: goods-in traceability. The lot code IS the goods-in (receiving) date —
   the same date written on the sticker when a delivery arrives. Staff pick the
   lot on the running task card when they use an ingredient. Reports trace a
   delivery forward to every batch that used it, or a batch back to the
   deliveries (and invoice / supplier) that went into it. */

let trIngredients=[], trGoods=[], trProfs=[], trStaffs=[], _trLotsAt=0, _biCache={}

function giCode(g){const d=String(g.received_date||'').split('-');return d.length===3?('GI '+d[2]+'/'+d[1]+'/'+d[0].slice(2)):'GI ?'}
function trIngName(id){const i=trIngredients.find(x=>x.id===id);return i?i.name:'(ingredient)'}
function lotLabel(g){return trIngName(g.ingredient_id)+' · '+giCode(g)+(g.supplier?' · '+g.supplier:'')}
function _trIsoToday(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

async function trEnsureIngredients(force){
  if(trIngredients.length&&!force) return
  const {data}=await sb.from('sim_ingredients').select('*').eq('active',true).order('sort_order').order('name')
  trIngredients=data||[]
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
  await trEnsureIngredients(true); await trEnsureLots(true)
  renderIngredientList(); populateGiIngSelect(); renderGoodsInList(); populateTraceLotSelect()
}

// ---- ingredients master ----
window.addIngredient=async function(){
  const name=$('inName').value.trim(); if(!name){msg($('inMsg'),'Enter an ingredient name.',false);return}
  const uom=($('inUom').value||'kg').trim()||'kg', supplier=$('inSupplier').value.trim()||null
  const order=(trIngredients.length?Math.max(...trIngredients.map(i=>i.sort_order||0)):0)+1
  const {error}=await sb.from('sim_ingredients').insert({name,uom,supplier,sort_order:order})
  if(error){msg($('inMsg'),error.message,false);return}
  $('inName').value='';$('inSupplier').value='';msg($('inMsg'),'Ingredient added.',true)
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
    d.innerHTML=`<div><b>${esc(i.name)}</b><div class="meta">${esc(i.uom)||'kg'}${i.supplier?' · '+esc(i.supplier):''}</div></div>`
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
  const supplier=$('giSupplier').value.trim()||null
  const invoice=$('giInvoice').value.trim()||null
  const notes=$('giNotes').value.trim()||null
  const {data,error}=await sb.from('sim_goods_in').insert({ingredient_id:ing,received_date:date,qty,uom,supplier,invoice_ref:invoice,notes}).select().single()
  if(error){msg($('giMsg'),error.message,false);return}
  $('giQty').value='';$('giInvoice').value='';$('giNotes').value=''
  msg($('giMsg'),'Delivery logged — code '+(data?giCode(data):'')+'. This is the sticker date.',true)
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
