/* PLAN: weekly production plan (manager/admin).
   Redesigned around a filterable List (default), a vessel x day Timeline, and an
   optional drag Board — all over the same plan_items. No schema changes. */

let planWeekStart=null, planWeekId=null, planItems=[], planStd={}, planVessels=[], planPeople=[], planActual={}
let planView='list', planGroupBy='day', planSearch='', planFilter={unassigned:false, today:false}, planSel=new Set(), planDemand=[]
const DAY_LBL=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MINI='style="font-size:12px;padding:3px 6px;max-width:150px"'

function isoLocal(dt){const y=dt.getFullYear(),m=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');return y+'-'+m+'-'+d}
function todayIsoP(){return isoLocal(new Date())}
function mondayOf(d){const dt=new Date(d+'T00:00:00');const off=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-off);return isoLocal(dt)}
function addDaysIso(iso,n){const dt=new Date(iso+'T00:00:00');dt.setDate(dt.getDate()+n);return isoLocal(dt)}
function ddmm(iso){const dt=new Date(iso+'T00:00:00');return dt.getDate()+'/'+(dt.getMonth()+1)}
function dayLabelOf(iso){if(!iso)return 'Unscheduled';for(let i=0;i<7;i++){if(addDaysIso(planWeekStart,i)===iso)return DAY_LBL[i]+' '+ddmm(iso)}return ddmm(iso)}
function stdFor(id){return planStd[id]||null}
function catOfItem(it){return catalog.find(c=>c.id===it.catalog_id)||null}
function batchOf(catId){const t=catalog.find(c=>c.id===catId);return (t&&t.is_batch)?t:null}
function loadsFor(t,qty){if(!t||!t.capacity_per_load||!qty)return null;return Math.ceil(qty/Number(t.capacity_per_load))}
function kindCapMins(kind){return planVessels.filter(v=>v.kind===kind).reduce((s,v)=>s+(Number(v.daily_hours)||0)*60,0)}
function kindVesselCount(kind){return planVessels.filter(v=>v.kind===kind).length}
function kindLabel(k){return (typeof equipKindLabel==='function')?equipKindLabel(k):(k||'vessel')}
function itemKind(it){const t=catOfItem(it);return t?t.equipment_kind:null}
function personLabel(it){if(it.assigned_user){const p=planPeople.find(x=>x.v==='u:'+it.assigned_user);return p?p.label:'Someone'} if(it.assigned_staff){const p=planPeople.find(x=>x.v==='s:'+it.assigned_staff);return p?p.label:'Staff'} return null}
function itemMins(it){const t=catOfItem(it);if(t&&t.is_batch){const l=loadsFor(t,it.target_qty)||0;return l*(Number(t.cook_minutes)||0)}return Number(it.est_minutes)||0}
function estMinutes(catId,qty){
  const b=batchOf(catId)
  if(b){const l=loadsFor(b,qty); return (l&&b.cook_minutes)?Math.round(l*Number(b.cook_minutes)):null}
  const s=stdFor(catId);if(!s||!qty)return s&&s.eff_minutes?Math.round(s.eff_minutes):null;if(s.eff_uph&&s.eff_uph>0)return Math.round(qty/s.eff_uph*60);if(s.eff_minutes)return Math.round(s.eff_minutes);return null
}

window.loadPlan=async function(){
  if(!isManagerUp())return
  if(!catalog.length) await loadCatalog()
  if(!$('planWeek').value) $('planWeek').value=mondayOf(isoLocal(new Date()))
  planWeekStart=mondayOf($('planWeek').value); $('planWeek').value=planWeekStart
  const {data:std}=await sb.rpc('sim_standard_times')
  planStd={}; (std||[]).forEach(r=>{planStd[r.catalog_id]=r})
  await loadEquipState(); planVessels=equipState.slice()
  const {data:_pf}=await sb.from('sim_profiles').select('id,full_name,email'); const {data:_st}=await sb.from('sim_staff').select('id,full_name')
  planPeople=[...(_pf||[]).map(x=>({v:'u:'+x.id,label:(x.full_name||x.email)})),...(_st||[]).map(x=>({v:'s:'+x.id,label:x.full_name+' (floor)'}))]
  const ts=$('pjTask'); if(ts){ts.innerHTML=''; catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;ts.appendChild(o)})}
  fillDaySelect('pjDay'); fillVesselSelect('pjEquip'); pjRecalc()
  const {data:wk}=await sb.from('sim_plan_weeks').select('id').eq('week_start',planWeekStart).maybeSingle()
  planWeekId = wk?wk.id:null
  if(planWeekId){const {data:items}=await sb.from('sim_plan_items').select('*').eq('week_id',planWeekId).order('sort_order'); planItems=items||[]}
  else planItems=[]
  const {data:acts}=await sb.from('sim_task_logs').select('catalog_id,units').gte('log_date',planWeekStart).lte('log_date',addDaysIso(planWeekStart,6)).eq('status','completed')
  planActual={}; (acts||[]).forEach(a=>{ if(a.catalog_id){ planActual[a.catalog_id]=(planActual[a.catalog_id]||0)+(Number(a.units)||0) } })
  if(planWeekId){const {data:dem}=await sb.from('sim_plan_demand').select('*').eq('week_id',planWeekId).order('created_at'); planDemand=dem||[]} else planDemand=[]
  planSel=new Set(planItems.filter(i=>planSel.has(i.id)).map(i=>i.id))
  renderPlan()
}

/* ---- detailed add helpers (card may be absent) ---- */
function fillDaySelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${iso===c?' selected':''}>${lbl} ${ddmm(iso)}</option>`}).join('')}
function fillVesselSelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">No vessel</option>'+planVessels.map(v=>`<option value="${v.equipment_id}"${v.equipment_id===c?' selected':''}>${esc(v.name)}</option>`).join('')}
window.pjRecalc=function(){
  const t=catalog.find(c=>c.id===($('pjTask')?$('pjTask').value:'')); const qty=($('pjQty')&&$('pjQty').value)?Number($('pjQty').value):null
  if(!t)return
  const em=estMinutes(t.id,qty); if(em!=null && !$('pjMins').dataset.touched) $('pjMins').value=em
  if(t.is_batch){
    if(t.capacity_per_load&&t.cook_minutes){const l=loadsFor(t,qty);const n=kindVesselCount(t.equipment_kind);$('pjHint').innerHTML=qty?`${qty} ${esc(t.uom||'kg')} = <b>${l} load${l===1?'':'s'}</b> × ${esc(t.cook_minutes)} min in ${esc(kindLabel(t.equipment_kind))} (${n} vessel${n===1?'':'s'}). Pooled — pick the actual vessel on the day.`:`Batch step: ${esc(t.capacity_per_load)} ${esc(t.uom||'kg')}/load · ${esc(t.cook_minutes)} min · ${esc(kindLabel(t.equipment_kind))}.`}
    else { $('pjHint').innerHTML='<span style="color:var(--amber)">This batch step needs capacity + cook time set in Manage → Tasks.</span>' }
    return
  }
  const s=stdFor(t.id)
  $('pjHint').innerHTML = s ? (s.runs?`Standard: ${s.eff_uph?esc(s.eff_uph)+' '+esc(t.uom||'kg')+'/hr':esc(s.eff_minutes)+' min'} · from ${s.runs} run${s.runs===1?'':'s'}${s.is_estimate?' <b style="color:var(--amber)">(estimate — few runs)</b>':''}` : '<span style="color:var(--amber)">No history yet — enter minutes manually or set an override.</span>') : ''
}
window.pjMinsTouched=function(){$('pjMins').dataset.touched='1'}
window.addPlanJob=async function(){
  const t=catalog.find(c=>c.id===$('pjTask').value); if(!t){msg($('planMsg'),'Pick a recipe/task.',false);return}
  const qty=$('pjQty').value?Number($('pjQty').value):null
  const mins=$('pjMins').value?Number($('pjMins').value):estMinutes(t.id,qty)
  const id=await ensureWeek(); if(!id)return
  const {error}=await sb.from('sim_plan_items').insert({week_id:id,catalog_id:t.id,task_name:t.name,product:$('pjProduct').value.trim()||null,target_qty:qty,uom:t.uom||'kg',plan_date:$('pjDay').value||null,equipment_id:(t.is_batch?null:($('pjEquip').value||null)),est_minutes:mins,staff_count:Number($('pjStaff').value)||1,sort_order:nextOrder()})
  if(error){msg($('planMsg'),error.message,false);return}
  $('pjQty').value='';$('pjProduct').value='';$('pjMins').value='';$('pjMins').dataset.touched='';clearMsg($('planMsg'))
  await loadPlan()
}

/* ---- shared writes ---- */
async function ensureWeek(){ if(planWeekId)return planWeekId; const {data:wk,error}=await sb.from('sim_plan_weeks').insert({week_start:planWeekStart,created_by:me.id}).select('id').single(); if(error){alert(error.message);return null} planWeekId=wk.id; return planWeekId }
function nextOrder(){return (planItems.length?Math.max(...planItems.map(i=>i.sort_order||0)):0)+1}
window.updatePlanJob=async function(id,field,value){
  const patch={}; patch[field]=(value===''?null:(field==='est_minutes'||field==='target_qty'||field==='staff_count'||field==='loads_done')?Number(value):value)
  await sb.from('sim_plan_items').update(patch).eq('id',id); await loadPlan()
}
window.updatePlanAssignee=async function(id,val){
  const patch={assigned_user:null,assigned_staff:null}
  if(val.indexOf('u:')===0)patch.assigned_user=val.slice(2)
  else if(val.indexOf('s:')===0)patch.assigned_staff=val.slice(2)
  await sb.from('sim_plan_items').update(patch).eq('id',id); await loadPlan()
}
window.delPlanJob=async function(id){ if(!confirm('Remove this job from the plan?'))return; await sb.from('sim_plan_items').delete().eq('id',id); await loadPlan() }
window.tickLoad=async function(id,delta){
  const it=planItems.find(x=>x.id===id); if(!it)return
  const t=catOfItem(it); const total=loadsFor(t,it.target_qty)||0
  let nd=(it.loads_done||0)+delta; if(nd<0)nd=0; if(nd>total)nd=total
  await sb.from('sim_plan_items').update({loads_done:nd}).eq('id',id); await loadPlan()
}
window.planPrevWeek=function(){$('planWeek').value=addDaysIso(planWeekStart,-7);loadPlan()}
window.planNextWeek=function(){$('planWeek').value=addDaysIso(planWeekStart,7);loadPlan()}
window.quickAddPlan=async function(){
  const t=catalog.find(c=>c.id===$('qaTask').value); if(!t){msg($('planMsg'),'Pick a recipe.',false);return}
  const qty=$('qaQty').value?Number($('qaQty').value):null
  const id=await ensureWeek(); if(!id)return
  const {error}=await sb.from('sim_plan_items').insert({week_id:id,catalog_id:t.id,task_name:t.name,target_qty:qty,uom:t.uom||'kg',plan_date:$('qaDay').value||null,equipment_id:null,est_minutes:estMinutes(t.id,qty),staff_count:1,sort_order:nextOrder()})
  if(error){msg($('planMsg'),error.message,false);return}
  $('qaQty').value=''; clearMsg($('planMsg')); await loadPlan()
}
window.addPlanJobFromPalette=async function(catId,day){
  const t=catalog.find(c=>c.id===catId); if(!t)return
  const qtyStr=prompt('Quantity of '+t.name+' ('+(t.uom||'kg')+')'+(day?'':' — blank = unscheduled')+':')
  if(qtyStr===null)return
  const qty=(qtyStr.trim()===''?null:Number(qtyStr))
  const id=await ensureWeek(); if(!id)return
  const {error}=await sb.from('sim_plan_items').insert({week_id:id,catalog_id:t.id,task_name:t.name,target_qty:qty,uom:t.uom||'kg',plan_date:day||null,equipment_id:null,est_minutes:estMinutes(t.id,qty),staff_count:1,sort_order:nextOrder()})
  if(error){alert(error.message);return}
  await loadPlan()
}

/* ---- bulk actions ---- */
window.toggleSel=function(id){ if(planSel.has(id))planSel.delete(id); else planSel.add(id); renderViewBody() }
window.clearSel=function(){ planSel.clear(); renderViewBody() }
async function bulkApply(patchFn){ const ids=[...planSel]; for(const id of ids){ const p=patchFn(); await sb.from('sim_plan_items').update(p).eq('id',id) } planSel.clear(); await loadPlan() }
window.bulkSetDay=function(val){ if(val==='__')return; bulkApply(()=>({plan_date:val||null})) }
window.bulkSetPerson=function(val){ if(val==='__')return; const p={assigned_user:null,assigned_staff:null}; if(val.indexOf('u:')===0)p.assigned_user=val.slice(2); else if(val.indexOf('s:')===0)p.assigned_staff=val.slice(2); bulkApply(()=>p) }
window.bulkDelete=async function(){ if(!planSel.size)return; if(!confirm('Delete '+planSel.size+' selected job(s)?'))return; for(const id of [...planSel]){ await sb.from('sim_plan_items').delete().eq('id',id) } planSel.clear(); await loadPlan() }

/* ---- view state ---- */
window.setPlanView=function(v){ planView=v; renderPlan() }
window.setPlanGroup=function(v){ planGroupBy=v; renderPlan() }
window.togglePlanFilter=function(n){ planFilter[n]=!planFilter[n]; renderPlan() }
window.planSearchInput=function(v){ planSearch=v; renderViewBody() }

function filteredItems(){
  const q=(planSearch||'').trim().toLowerCase()
  const today=todayIsoP()
  return planItems.filter(i=>{
    if(planFilter.unassigned && (i.assigned_user||i.assigned_staff)) return false
    if(planFilter.today && i.plan_date!==today) return false
    if(q){ const hay=((i.task_name||'')+' '+(i.product||'')).toLowerCase(); if(hay.indexOf(q)<0) return false }
    return true
  })
}

/* ---- compact inline controls ---- */
function daySel(it){return `<select ${MINI} onchange="updatePlanJob('${it.id}','plan_date',this.value)"><option value="">Unscheduled</option>`+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${it.plan_date===iso?' selected':''}>${lbl}</option>`}).join('')+'</select>'}
function vesSel(it){return `<select ${MINI} onchange="updatePlanJob('${it.id}','equipment_id',this.value)"><option value="">No vessel</option>`+planVessels.map(v=>`<option value="${v.equipment_id}"${it.equipment_id===v.equipment_id?' selected':''}>${esc(v.name)}</option>`).join('')+'</select>'}
function asgSel(it){const cur=it.assigned_user?('u:'+it.assigned_user):(it.assigned_staff?('s:'+it.assigned_staff):'');return `<select ${MINI} onchange="updatePlanAssignee('${it.id}',this.value)"><option value="">Unassigned</option>`+planPeople.map(pp=>`<option value="${pp.v}"${pp.v===cur?' selected':''}>${esc(pp.label)}</option>`).join('')+'</select>'}
function statusDot(it){
  const t=catOfItem(it)
  if(t&&t.is_batch){const total=loadsFor(t,it.target_qty)||0;const done=Math.min(it.loads_done||0,total);const col=total&&done>=total?'var(--green)':(done>0?'var(--amber)':'var(--line)');return `<span style="width:9px;height:9px;border-radius:50%;background:${col};display:inline-block"></span>`}
  const col=(it.assigned_user||it.assigned_staff)?'var(--green)':'var(--amber)'
  return `<span style="width:9px;height:9px;border-radius:50%;background:${col};display:inline-block"></span>`
}

/* ---- LIST view ---- */
function groupsFor(items){
  const g=new Map()
  const push=(k,label,it)=>{ if(!g.has(k))g.set(k,{label,items:[]}); g.get(k).items.push(it) }
  items.forEach(it=>{
    if(planGroupBy==='day'){ const k=it.plan_date||'zzz'; push(k, dayLabelOf(it.plan_date), it) }
    else if(planGroupBy==='vessel'){ const t=catOfItem(it); if(t&&t.is_batch){const kd=t.equipment_kind; push('pool:'+(kd||'?'), kindLabel(kd)+' pool', it)} else if(it.equipment_id){const v=planVessels.find(x=>x.equipment_id===it.equipment_id); push('v:'+it.equipment_id, v?v.name:'Vessel', it)} else push('none','No vessel', it) }
    else if(planGroupBy==='person'){ const lbl=personLabel(it); push(lbl?('p:'+(it.assigned_user||it.assigned_staff)):'unassigned', lbl||'Unassigned', it) }
    else { const t=catOfItem(it); const done=t&&t.is_batch?((it.loads_done||0)>=(loadsFor(t,it.target_qty)||0) && (loadsFor(t,it.target_qty)||0)>0):false; const k=done?'done':((it.assigned_user||it.assigned_staff)?'assigned':'unassigned'); push(k, done?'Done':(k==='assigned'?'Assigned':'Unassigned'), it) }
  })
  let arr=[...g.entries()].map(([k,v])=>({key:k,label:v.label,items:v.items}))
  if(planGroupBy==='day') arr.sort((a,b)=>(a.key==='zzz'?'~':a.key).localeCompare(b.key==='zzz'?'~':b.key))
  else arr.sort((a,b)=>b.items.length-a.items.length)
  return arr
}
function listRowHtml(it){
  const t=catOfItem(it)
  const sel=planSel.has(it.id)
  const qty=it.target_qty!=null?(Number(it.target_qty)+' '+esc(it.uom||'')):''
  let right=''
  if(t&&t.is_batch){const total=loadsFor(t,it.target_qty)||0;const done=Math.min(it.loads_done||0,total);right=`<span style="font-size:12px;color:var(--muted);white-space:nowrap">${done}/${total} loads <button class="ghost sm" style="padding:1px 6px" onclick="tickLoad('${it.id}',1)">＋</button></span>`}
  else {const m=itemMins(it);right=`<span style="font-size:12px;color:var(--muted);white-space:nowrap">${m?('~'+m+'m'):'—'}</span>`}
  const vessel = (t&&t.is_batch)? `<span style="font-size:11px;color:var(--muted)">${esc(kindLabel(t.equipment_kind))} pool</span>` : vesSel(it)
  return `<div style="display:grid;grid-template-columns:20px 16px 1fr auto auto auto auto 24px;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--line)">
    <input type="checkbox" ${sel?'checked':''} onchange="toggleSel('${it.id}')" style="width:auto;margin:0" />
    ${statusDot(it)}
    <div style="min-width:0"><b style="font-size:13px">${esc(it.task_name||'')}</b>${it.auto?' <span style="font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px">auto</span>':''}${it.product?'<span style="color:var(--muted);font-size:12px"> · '+esc(it.product)+'</span>':''}${qty?'<div style="font-size:11px;color:var(--muted)">'+qty+'</div>':''}</div>
    ${daySel(it)}
    ${vessel}
    ${asgSel(it)}
    ${right}
    <a class="link" style="font-size:13px;text-align:center" onclick="delPlanJob('${it.id}')" title="Remove">✕</a>
  </div>`
}
function bulkBarHtml(){
  if(!planSel.size) return ''
  const dayOpts='<option value="__">Set day…</option><option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>`<option value="${addDaysIso(planWeekStart,i)}">${lbl} ${ddmm(addDaysIso(planWeekStart,i))}</option>`).join('')
  const perOpts='<option value="__">Set person…</option><option value="">Unassigned</option>'+planPeople.map(pp=>`<option value="${pp.v}">${esc(pp.label)}</option>`).join('')
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--panel2);border:1px solid var(--accent);border-radius:10px;padding:8px 10px;margin-bottom:10px">
    <b style="font-size:13px">${planSel.size} selected</b>
    <select ${MINI} onchange="bulkSetDay(this.value);this.value='__'">${dayOpts}</select>
    <select ${MINI} onchange="bulkSetPerson(this.value);this.value='__'">${perOpts}</select>
    <button class="ghost sm" onclick="bulkDelete()">Delete</button>
    <a class="link" style="font-size:13px" onclick="clearSel()">Clear</a>
  </div>`
}
function listHtml(){
  const items=filteredItems()
  if(!planItems.length) return '<div class="card"><p class="muted">No jobs yet. Use Quick add above, drag recipes in Board view, or list what you need in the Needs view and Auto-plan it.</p></div>'
  if(!items.length) return bulkBarHtml()+'<div class="card"><p class="muted">No jobs match your search / filters.</p></div>'
  let h=bulkBarHtml()
  groupsFor(items).forEach(grp=>{
    const flow=grp.items.filter(i=>{const t=catOfItem(i);return !(t&&t.is_batch)})
    const labour=flow.reduce((s,i)=>s+((Number(i.est_minutes)||0)*(i.staff_count||1)),0)
    h+=`<div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel2)">
        <b style="font-size:14px">${esc(grp.label)}</b>
        <span style="font-size:12px;color:var(--muted)">${grp.items.length} job${grp.items.length===1?'':'s'}${labour?' · '+(labour/60).toFixed(1)+'h':''}</span>
      </div>
      <div style="padding:0 8px">${grp.items.map(listRowHtml).join('')}</div>
    </div>`
  })
  return h
}

/* ---- TIMELINE (vessel x day capacity) ---- */
function vesselDayMins(vid,iso){return planItems.filter(i=>i.equipment_id===vid&&i.plan_date===iso&&!(catOfItem(i)||{}).is_batch).reduce((s,i)=>s+(Number(i.est_minutes)||0),0)}
function poolDayMins(kind,iso){return planItems.filter(i=>i.plan_date===iso&&itemKind(i)===kind&&(catOfItem(i)||{}).is_batch).reduce((s,i)=>{const t=catOfItem(i);const l=loadsFor(t,i.target_qty)||0;return s+l*(Number(t.cook_minutes)||0)},0)}
function capCell(mins,cap){
  const pct=cap>0?Math.round(mins/cap*100):0
  let bg='var(--panel)',fg='var(--muted)',txt='—'
  if(mins>0){ txt=pct+'%'; if(pct>100){bg='rgba(239,68,68,.25)';fg='#fca5a5'} else if(pct>=85){bg='rgba(245,158,11,.22)';fg='#fcd34d'} else {bg='rgba(34,197,94,.20)';fg='#86efac'} }
  return `<span style="background:${bg};color:${fg};border-radius:6px;text-align:center;padding:8px 0;font-size:12px;font-weight:700">${txt}</span>`
}
function timelineHtml(){
  const pools=[...new Set(planItems.filter(i=>(catOfItem(i)||{}).is_batch).map(itemKind).filter(Boolean))]
  const vids=[...new Set(planItems.filter(i=>i.equipment_id&&!(catOfItem(i)||{}).is_batch).map(i=>i.equipment_id))]
  if(!pools.length&&!vids.length) return '<div class="card"><p class="muted">Assign vessels (or set batch vessel types) on your jobs to see the capacity picture here.</p></div>'
  const head='<div style="display:grid;grid-template-columns:120px repeat(7,1fr);gap:4px;font-size:11px;color:var(--muted);margin-bottom:4px"><span></span>'+DAY_LBL.map((l,i)=>`<span style="text-align:center">${l} ${ddmm(addDaysIso(planWeekStart,i))}</span>`).join('')+'</div>'
  let rows=''
  pools.forEach(kind=>{
    const cap=kindCapMins(kind)
    const cells=DAY_LBL.map((l,i)=>capCell(poolDayMins(kind,addDaysIso(planWeekStart,i)),cap)).join('')
    rows+=`<div style="display:grid;grid-template-columns:120px repeat(7,1fr);gap:4px;align-items:center;margin-bottom:4px;font-size:11px"><span>${esc(kindLabel(kind))} pool</span>${cells}</div>`
  })
  vids.forEach(vid=>{
    const v=planVessels.find(x=>x.equipment_id===vid); const cap=(v?Number(v.daily_hours):8)*60
    const cells=DAY_LBL.map((l,i)=>capCell(vesselDayMins(vid,addDaysIso(planWeekStart,i)),cap)).join('')
    rows+=`<div style="display:grid;grid-template-columns:120px repeat(7,1fr);gap:4px;align-items:center;margin-bottom:4px;font-size:11px"><span>${v?esc(v.name):'Vessel'}</span>${cells}</div>`
  })
  const legend='<div style="display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--muted)"><span>■ under 85%</span><span style="color:#fcd34d">■ near full</span><span style="color:#fca5a5">■ over capacity</span></div>'
  return `<div class="card"><h2 style="margin:0 0 10px">Ovens &amp; vessels · this week</h2>${head}${rows}${legend}</div>`
}

/* ---- BOARD (drag palette) ---- */
function boardHtml(){
  const cols=[]
  for(let d=0;d<7;d++){const iso=addDaysIso(planWeekStart,d);cols.push({day:iso,label:DAY_LBL[d]+' '+ddmm(iso),items:planItems.filter(i=>i.plan_date===iso)})}
  cols.push({day:'',label:'Unscheduled',items:planItems.filter(i=>!i.plan_date)})
  const chip=i=>{const warn=(i.assigned_user||i.assigned_staff)?'':' <span style="color:var(--amber)">⚠</span>';return `<div class="jobchip" data-id="${i.id}" style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px;cursor:grab;font-size:13px"><b>${esc(i.task_name||'')}</b>${i.target_qty!=null?' · '+Number(i.target_qty)+' '+esc(i.uom||''):''}${warn}</div>`}
  const col=c=>`<div class="dragcol" data-day="${c.day}" style="min-width:150px;flex:1;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px;min-height:60px"><div style="font-weight:700;font-size:13px;margin-bottom:6px">${c.label}</div>${c.items.map(chip).join('')}</div>`
  const palette=catalog.map(t=>`<div class="recipechip" data-catalog-id="${t.id}" style="background:var(--accent);color:#0b1220;border-radius:8px;padding:6px 10px;font-size:13px;font-weight:700;cursor:grab;white-space:nowrap">${esc(t.name)}${t.is_batch?' 🔥':''}</div>`).join('')
  return `<div class="card"><p class="muted" style="margin:0 0 10px;font-size:13px">Drag a recipe onto a day to add it. Drag a job between days to reschedule.</p><div class="recipepalette" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:10px">${palette||'<span class="muted">No recipes yet.</span>'}</div><div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px">${cols.map(col).join('')}</div></div>`
}
function onDayAdd(evt){
  const el=evt.item; const day=evt.to.dataset.day||''
  const cat=el.dataset.catalogId
  if(cat){ if(el.parentNode) el.parentNode.removeChild(el); addPlanJobFromPalette(cat,day) }
  else if(el.dataset.id){ updatePlanJob(el.dataset.id,'plan_date',day) }
}
function wireBoardSortable(){
  if(typeof Sortable==='undefined') return
  const pal=document.querySelector('#planViewBody .recipepalette')
  if(pal) new Sortable(pal,{group:{name:'plan',pull:'clone',put:false},draggable:'.recipechip',sort:false,animation:150})
  document.querySelectorAll('#planViewBody .dragcol').forEach(col=>{ new Sortable(col,{group:{name:'plan',pull:true,put:true},draggable:'.jobchip',animation:150,onAdd:onDayAdd}) })
}

/* ---- NEEDS + auto-plan (Phase 1) ---- */
function needsHtml(){
  const taskOpts='<option value="">Recipe…</option>'+catalog.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')
  const dueOpts='<option value="">Any day this week</option>'+DAY_LBL.map((l,i)=>`<option value="${addDaysIso(planWeekStart,i)}">by ${l} ${ddmm(addDaysIso(planWeekStart,i))}</option>`).join('')
  const rows = planDemand.length? planDemand.map(d=>`<div style="display:grid;grid-template-columns:1fr auto auto 24px;gap:8px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--line)">
      <b style="font-size:13px">${esc(d.task_name||'')}</b>
      <span style="font-size:12px;color:var(--muted)">${d.target_qty!=null?Number(d.target_qty)+' '+esc(d.uom||''):''}</span>
      <span style="font-size:12px;color:var(--muted)">${d.due_date?('by '+dayLabelOf(d.due_date)):'this week'}</span>
      <a class="link" style="font-size:13px;text-align:center" onclick="delDemand('${d.id}')" title="Remove">✕</a>
    </div>`).join('') : '<p class="muted" style="padding:8px 4px">No needs yet. Add what you need above, then Auto-plan.</p>'
  return `<div class="card">
    <h2 style="margin:0 0 4px">Weekly needs → auto-plan</h2>
    <p class="muted" style="margin:0 0 10px;font-size:13px">List what you need and by when. Auto-plan schedules each job on the latest safe day before its deadline, spread so ovens don't go over capacity. It proposes — tweak the result in List or Board.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <select id="ndTask" style="max-width:170px">${taskOpts}</select>
      <input id="ndQty" type="number" inputmode="decimal" placeholder="qty" style="max-width:80px" />
      <select id="ndDue" style="max-width:170px">${dueOpts}</select>
      <button class="ghost sm" onclick="addDemand()">Add need</button>
    </div>
    <div style="border-top:1px solid var(--line)">${rows}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="green" onclick="autoPlan()">⚡ Auto-plan the week</button>
      <button class="ghost" onclick="clearAuto()">Clear auto jobs</button>
    </div>
  </div>`
}
window.addDemand=async function(){
  const t=catalog.find(c=>c.id===$('ndTask').value); if(!t){msg($('planMsg'),'Pick a recipe.',false);return}
  const qty=$('ndQty').value?Number($('ndQty').value):null
  const due=$('ndDue').value||null
  const id=await ensureWeek(); if(!id)return
  const {error}=await sb.from('sim_plan_demand').insert({week_id:id,catalog_id:t.id,task_name:t.name,target_qty:qty,uom:t.uom||'kg',due_date:due})
  if(error){msg($('planMsg'),error.message,false);return}
  $('ndQty').value=''; clearMsg($('planMsg')); await loadPlan()
}
window.delDemand=async function(id){ await sb.from('sim_plan_demand').delete().eq('id',id); await loadPlan() }
window.clearAuto=async function(){ if(!planWeekId)return; if(!confirm('Remove all auto-generated jobs for this week? Your manually-added jobs stay.'))return; await sb.from('sim_plan_items').delete().eq('week_id',planWeekId).eq('auto',true); await loadPlan() }
window.autoPlan=async function(){
  if(!planDemand.length){msg($('planMsg'),'Add some needs first.',false);return}
  const id=await ensureWeek(); if(!id)return
  await sb.from('sim_plan_items').delete().eq('week_id',id).eq('auto',true)
  const days=[]; for(let i=0;i<7;i++)days.push(addDaysIso(planWeekStart,i))
  const weekEnd=days[6]
  const poolUsed={}
  planItems.filter(i=>!i.auto).forEach(i=>{const t=catOfItem(i);if(t&&t.is_batch&&i.plan_date&&t.equipment_kind){const l=loadsFor(t,i.target_qty)||0;const need=l*(Number(t.cook_minutes)||0);poolUsed[t.equipment_kind]=poolUsed[t.equipment_kind]||{};poolUsed[t.equipment_kind][i.plan_date]=(poolUsed[t.equipment_kind][i.plan_date]||0)+need}})
  const dem=planDemand.slice().sort((a,b)=>(a.due_date||weekEnd).localeCompare(b.due_date||weekEnd))
  const rows=[]; let over=0; let ord=nextOrder()
  dem.forEach(d=>{
    const t=catalog.find(c=>c.id===d.catalog_id); if(!t)return
    const qty=d.target_qty
    const windowEnd=(d.due_date&&d.due_date<=weekEnd)?d.due_date:weekEnd
    const cand=days.filter(dd=>dd<=windowEnd); if(!cand.length)cand.push(days[0])
    let placeDay=cand[cand.length-1]
    if(t.is_batch&&t.equipment_kind){
      const kind=t.equipment_kind, cap=kindCapMins(kind), l=loadsFor(t,qty)||0, need=l*(Number(t.cook_minutes)||0)
      poolUsed[kind]=poolUsed[kind]||{}
      let chosen=null
      for(let k=cand.length-1;k>=0;k--){const dd=cand[k];const u=poolUsed[kind][dd]||0;if(cap>0&&u+need<=cap){chosen=dd;break}}
      if(!chosen){ let best=cand[cand.length-1],bestU=Infinity; cand.forEach(dd=>{const u=poolUsed[kind][dd]||0;if(u<bestU){bestU=u;best=dd}}); chosen=best; over++ }
      placeDay=chosen; poolUsed[kind][placeDay]=(poolUsed[kind][placeDay]||0)+need
    }
    rows.push({week_id:id,catalog_id:t.id,task_name:t.name,target_qty:qty,uom:t.uom||'kg',plan_date:placeDay,equipment_id:null,est_minutes:estMinutes(t.id,qty),staff_count:1,auto:true,sort_order:ord++})
  })
  if(rows.length){const {error}=await sb.from('sim_plan_items').insert(rows); if(error){msg($('planMsg'),error.message,false);return}}
  planView='list'; await loadPlan()
  alert('Auto-planned '+rows.length+' job'+(rows.length===1?'':'s')+(over?('. '+over+" couldn't fit oven capacity in time — check the red cells in Timeline."):'. All fit within oven capacity.'))
}

/* ---- insights (health + plan vs actual) ---- */
function healthCard(){
  const w=[]
  catalog.forEach(t=>{ if(t.is_batch){ if(!t.capacity_per_load)w.push('“'+esc(t.name)+'” batch step has no capacity/load.'); if(!t.cook_minutes)w.push('“'+esc(t.name)+'” batch step has no cook time.'); if(!t.equipment_kind)w.push('“'+esc(t.name)+'” batch step has no vessel type.'); else if(!planVessels.some(v=>v.kind===t.equipment_kind))w.push('“'+esc(t.name)+'” uses vessel type “'+esc(kindLabel(t.equipment_kind))+'” but no active vessel of that type exists.') } })
  planVessels.forEach(v=>{ if(!v.kind) w.push('Vessel “'+esc(v.name)+'” has no type set.') })
  if(!w.length) return ''
  return `<div class="card" style="border-color:var(--amber)"><b style="color:#fcd34d">⚠ Setup check</b>${w.map(x=>'<div style="font-size:13px;margin-top:3px">• '+x+'</div>').join('')}</div>`
}
function planVsActualCard(){
  const byCat={}
  planItems.forEach(i=>{ if(!i.catalog_id)return; const b=byCat[i.catalog_id]||(byCat[i.catalog_id]={name:i.task_name,planned:0,uom:i.uom||'kg'}); b.planned+=Number(i.target_qty)||0 })
  const rows=Object.keys(byCat).map(cid=>{const b=byCat[cid];b.actual=planActual[cid]||0;return b}).filter(b=>b.planned>0)
  if(!rows.length) return ''
  rows.sort((a,b)=>b.planned-a.planned)
  const cell=(txt,i,bold)=>`<td style="text-align:${i===0?'left':'right'};padding:5px 8px;border-bottom:1px solid var(--line);${bold?'font-weight:700':''}">${txt}</td>`
  const trs=rows.slice(0,8).map(b=>{const pct=b.planned>0?Math.round(b.actual/b.planned*100):0;const col=pct>=95?'var(--green)':(pct>=70?'var(--amber)':'var(--red)');return `<tr>${cell(esc(b.name),0)}${cell(Math.round(b.planned)+' '+esc(b.uom),1)}${cell(Math.round(b.actual)+' '+esc(b.uom),2,true)}<td style="text-align:right;padding:5px 8px;border-bottom:1px solid var(--line);font-weight:700;color:${col}">${pct}%</td></tr>`}).join('')
  const th=['Task','Planned','Actual','Hit'].map((h,i)=>`<th style="text-align:${i===0?'left':'right'};padding:5px 8px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)">${h}</th>`).join('')
  return `<div class="card"><h2 style="margin:0 0 6px">Plan vs actual · this week</h2><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><tr>${th}</tr>${trs}</table></div></div>`
}

/* ---- top-level render ---- */
function viewBtn(v,icon,label){const on=planView===v;return `<span onclick="setPlanView('${v}')" style="padding:6px 12px;font-size:13px;cursor:pointer;${on?'background:var(--accent);color:#0b1220;font-weight:700':'color:var(--muted)'}${v!=='list'?';border-left:1px solid var(--line)':''}">${label}</span>`}
function toolbarHtml(){
  const chip=(n,label)=>`<span onclick="togglePlanFilter('${n}')" style="padding:4px 10px;border-radius:999px;font-size:12px;cursor:pointer;${planFilter[n]?'background:var(--accent);color:#0b1220;font-weight:700':'border:1px solid var(--line);color:var(--muted)'}">${label}</span>`
  const groupOpts=[['day','Day'],['vessel','Vessel'],['person','Person'],['status','Status']].map(([v,l])=>`<option value="${v}"${planGroupBy===v?' selected':''}>Group: ${l}</option>`).join('')
  const qaTasks='<option value="">Recipe…</option>'+catalog.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')
  const qaDays='<option value="">Unscheduled</option>'+DAY_LBL.map((l,i)=>`<option value="${addDaysIso(planWeekStart,i)}">${l} ${ddmm(addDaysIso(planWeekStart,i))}</option>`).join('')
  return `<div class="card">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden">${viewBtn('list','','List')}${viewBtn('timeline','','Timeline')}${viewBtn('board','','Board')}${viewBtn('needs','','Needs')}</div>
      <input placeholder="Search jobs" value="${esc(planSearch)}" oninput="planSearchInput(this.value)" style="flex:1;min-width:130px" />
      <select onchange="setPlanGroup(this.value)" style="max-width:130px">${groupOpts}</select>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${chip('unassigned','Unassigned')}${chip('today','Today')}
      <span style="flex:1"></span>
      <select id="qaTask" style="max-width:150px">${qaTasks}</select>
      <input id="qaQty" type="number" inputmode="decimal" placeholder="qty" style="max-width:80px" />
      <select id="qaDay" style="max-width:120px">${qaDays}</select>
      <button class="green sm" onclick="quickAddPlan()">Add</button>
    </div>
    <div id="planMsg" class="msg"></div>
  </div>`
}
function renderViewBody(){
  const el=$('planViewBody'); if(!el)return
  if(planView==='timeline') el.innerHTML=timelineHtml()
  else if(planView==='board'){ el.innerHTML=boardHtml(); wireBoardSortable() }
  else if(planView==='needs') el.innerHTML=needsHtml()
  else el.innerHTML=listHtml()
}
function renderPlan(){
  const box=$('planBoard'); if(!box)return
  box.innerHTML = toolbarHtml() + healthCard() + planVsActualCard() + '<div id="planViewBody"></div>'
  renderViewBody()
}
