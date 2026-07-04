/* PLAN: weekly production plan — day-level capacity board (manager/admin).
   Enter target quantities per recipe; assign each job to a day + named vessel;
   each vessel/day shows a utilisation bar vs its available hours. Durations come
   from sim_standard_times() (median of history, override-aware), editable per job.
   Batch/cook steps auto-split into loads across the vessel-kind pool. */

let planWeekStart=null, planWeekId=null, planItems=[], planStd={}, planVessels=[], planPeople=[], planActual={}
const DAY_LBL=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function isoLocal(dt){const y=dt.getFullYear(),m=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');return y+'-'+m+'-'+d}
function mondayOf(d){const dt=new Date(d+'T00:00:00');const off=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-off);return isoLocal(dt)}
function addDaysIso(iso,n){const dt=new Date(iso+'T00:00:00');dt.setDate(dt.getDate()+n);return isoLocal(dt)}
function ddmm(iso){const dt=new Date(iso+'T00:00:00');return dt.getDate()+'/'+(dt.getMonth()+1)}
function stdFor(id){return planStd[id]||null}
function batchOf(catId){const t=catalog.find(c=>c.id===catId);return (t&&t.is_batch)?t:null}
function loadsFor(t,qty){if(!t||!t.capacity_per_load||!qty)return null;return Math.ceil(qty/Number(t.capacity_per_load))}
function kindCapMins(kind){return planVessels.filter(v=>v.kind===kind).reduce((s,v)=>s+(Number(v.daily_hours)||0)*60,0)}
function kindVesselCount(kind){return planVessels.filter(v=>v.kind===kind).length}
function kindLabel(k){return (typeof equipKindLabel==='function')?equipKindLabel(k):(k||'vessel')}
function itemKind(it){const t=catalog.find(c=>c.id===it.catalog_id);return t?t.equipment_kind:null}
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
  // standard times
  const {data:std}=await sb.rpc('sim_standard_times')
  planStd={}; (std||[]).forEach(r=>{planStd[r.catalog_id]=r})
  // vessels (active, with daily_hours)
  await loadEquipState(); planVessels=equipState.slice()
  const {data:_pf}=await sb.from('sim_profiles').select('id,full_name,email'); const {data:_st}=await sb.from('sim_staff').select('id,full_name')
  planPeople=[...(_pf||[]).map(x=>({v:'u:'+x.id,label:(x.full_name||x.email)})),...(_st||[]).map(x=>({v:'s:'+x.id,label:x.full_name+' (floor)'}))]
  // populate add-job controls
  const ts=$('pjTask'); ts.innerHTML=''; catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;ts.appendChild(o)})
  fillDaySelect('pjDay'); fillVesselSelect('pjEquip')
  pjRecalc()
  // week row + items
  const {data:wk}=await sb.from('sim_plan_weeks').select('id').eq('week_start',planWeekStart).maybeSingle()
  planWeekId = wk?wk.id:null
  if(planWeekId){const {data:items}=await sb.from('sim_plan_items').select('*').eq('week_id',planWeekId).order('sort_order'); planItems=items||[]}
  else planItems=[]
  const {data:acts}=await sb.from('sim_task_logs').select('catalog_id,units').gte('log_date',planWeekStart).lte('log_date',addDaysIso(planWeekStart,6)).eq('status','completed')
  planActual={}; (acts||[]).forEach(a=>{ if(a.catalog_id){ planActual[a.catalog_id]=(planActual[a.catalog_id]||0)+(Number(a.units)||0) } })
  renderPlanBoard()
}
function fillDaySelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${iso===c?' selected':''}>${lbl} ${ddmm(iso)}</option>`}).join('')}
function fillVesselSelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">No vessel</option>'+planVessels.map(v=>`<option value="${v.equipment_id}"${v.equipment_id===c?' selected':''}>${esc(v.name)}</option>`).join('')}

window.pjRecalc=function(){
  const t=catalog.find(c=>c.id===$('pjTask').value)
  const qty=$('pjQty').value?Number($('pjQty').value):null
  if(!t)return
  const em=estMinutes(t.id,qty); if(em!=null && !$('pjMins').dataset.touched) $('pjMins').value=em
  if(t.is_batch){
    if(t.capacity_per_load&&t.cook_minutes){
      const l=loadsFor(t,qty); const n=kindVesselCount(t.equipment_kind)
      $('pjHint').innerHTML = qty ? `${qty} ${esc(t.uom||'kg')} = <b>${l} load${l===1?'':'s'}</b> × ${esc(t.cook_minutes)} min in ${esc(kindLabel(t.equipment_kind))} (${n} vessel${n===1?'':'s'}). Pooled — pick the actual vessel on the day.` : `Batch step: ${esc(t.capacity_per_load)} ${esc(t.uom||'kg')}/load · ${esc(t.cook_minutes)} min · ${esc(kindLabel(t.equipment_kind))}.`
    } else { $('pjHint').innerHTML='<span style="color:var(--amber)">This batch step needs capacity + cook time set in Manage → Tasks.</span>' }
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
  if(!planWeekId){
    const {data:wk,error:we}=await sb.from('sim_plan_weeks').insert({week_start:planWeekStart,created_by:me.id}).select('id').single()
    if(we){msg($('planMsg'),we.message,false);return}
    planWeekId=wk.id
  }
  const order=(planItems.length?Math.max(...planItems.map(i=>i.sort_order||0)):0)+1
  const {error}=await sb.from('sim_plan_items').insert({week_id:planWeekId,catalog_id:t.id,task_name:t.name,product:$('pjProduct').value.trim()||null,target_qty:qty,uom:t.uom||'kg',plan_date:$('pjDay').value||null,equipment_id:(t.is_batch?null:($('pjEquip').value||null)),est_minutes:mins,staff_count:Number($('pjStaff').value)||1,sort_order:order})
  if(error){msg($('planMsg'),error.message,false);return}
  $('pjQty').value='';$('pjProduct').value='';$('pjMins').value='';$('pjMins').dataset.touched='';clearMsg($('planMsg'))
  await loadPlan()
}
window.updatePlanJob=async function(id,field,value){
  const patch={}; patch[field]=(value===''?null:(field==='est_minutes'||field==='target_qty'||field==='staff_count'||field==='loads_done')?Number(value):value)
  await sb.from('sim_plan_items').update(patch).eq('id',id)
  await loadPlan()
}
window.delPlanJob=async function(id){ if(!confirm('Remove this job from the plan?'))return; await sb.from('sim_plan_items').delete().eq('id',id); await loadPlan() }
window.planPrevWeek=function(){$('planWeek').value=addDaysIso(planWeekStart,-7);loadPlan()}
window.planNextWeek=function(){$('planWeek').value=addDaysIso(planWeekStart,7);loadPlan()}

function utilBar(mins,capMins){
  const pct=capMins>0?Math.round(mins/capMins*100):0
  const col=pct>100?'var(--red)':(pct>85?'var(--amber)':'var(--green)')
  return `<div style="background:var(--panel2);border-radius:6px;height:10px;overflow:hidden;margin:4px 0"><div style="width:${Math.min(100,pct)}%;height:100%;background:${col}"></div></div><div class="muted" style="font-size:12px">${(mins/60).toFixed(1)}h / ${(capMins/60).toFixed(0)}h · <b style="color:${col}">${pct}%</b>${pct>100?' — over capacity':''}</div>`
}
function assigneeSelectHtml(it){
  const cur=it.assigned_user?('u:'+it.assigned_user):(it.assigned_staff?('s:'+it.assigned_staff):'')
  return `<select onchange="updatePlanAssignee('${it.id}',this.value)"><option value="">Unassigned</option>`+planPeople.map(pp=>`<option value="${pp.v}"${pp.v===cur?' selected':''}>${esc(pp.label)}</option>`).join('')+'</select>'
}
window.updatePlanAssignee=async function(id,val){
  const patch={assigned_user:null,assigned_staff:null}
  if(val.indexOf('u:')===0)patch.assigned_user=val.slice(2)
  else if(val.indexOf('s:')===0)patch.assigned_staff=val.slice(2)
  await sb.from('sim_plan_items').update(patch).eq('id',id); await loadPlan()
}
function daySelectHtml(it){return `<select onchange="updatePlanJob('${it.id}','plan_date',this.value)">`+'<option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${it.plan_date===iso?' selected':''}>${lbl} ${ddmm(iso)}</option>`}).join('')+'</select>'}
function batchJobCard(it){
  const t=catalog.find(c=>c.id===it.catalog_id)
  const total=loadsFor(t,it.target_qty)||0
  const done=Math.min(it.loads_done||0,total)
  const pct=total?Math.round(done/total*100):0
  return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div><b>${esc(it.task_name||'')}</b>${it.product?' · '+esc(it.product):''}<div class="muted" style="font-size:12px">${it.target_qty??'–'} ${esc(it.uom||'')} · ${total} load${total===1?'':'s'} × ${esc((t&&t.cook_minutes)||'?')} min</div></div>
      <a class="link" style="font-size:13px;flex-shrink:0" onclick="delPlanJob('${it.id}')">Remove</a>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="ghost sm" onclick="tickLoad('${it.id}',-1)">−</button>
      <b style="white-space:nowrap">${done} / ${total} done</b>
      <button class="ghost sm" onclick="tickLoad('${it.id}',1)">＋</button>
      <div style="flex:1;background:var(--panel2);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--green)"></div></div>
    </div>
    <div class="row" style="gap:8px">${daySelectHtml(it)}${assigneeSelectHtml(it)}</div>
  </div>`
}
window.tickLoad=async function(id,delta){
  const it=planItems.find(x=>x.id===id); if(!it)return
  const t=catalog.find(c=>c.id===it.catalog_id); const total=loadsFor(t,it.target_qty)||0
  let nd=(it.loads_done||0)+delta; if(nd<0)nd=0; if(nd>total)nd=total
  await sb.from('sim_plan_items').update({loads_done:nd}).eq('id',id); await loadPlan()
}
function jobCard(it){
  const daySel=daySelectHtml(it)
  const vesSel=`<select onchange="updatePlanJob('${it.id}','equipment_id',this.value)">`+'<option value="">No vessel</option>'+planVessels.map(v=>`<option value="${v.equipment_id}"${it.equipment_id===v.equipment_id?' selected':''}>${esc(v.name)}</option>`).join('')+'</select>'
  return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div><b>${esc(it.task_name||'')}</b>${it.product?' · '+esc(it.product):''}<div class="muted" style="font-size:12px">${it.target_qty??'–'} ${esc(it.uom||'')} · ${it.est_minutes??'–'} min · ${it.staff_count||1} ppl</div></div>
      <a class="link" style="font-size:13px;flex-shrink:0" onclick="delPlanJob('${it.id}')">Remove</a>
    </div>
    <div class="row" style="gap:8px">${daySel}${vesSel}${assigneeSelectHtml(it)}</div>
  </div>`
}
function healthWarnings(){
  const w=[]
  catalog.forEach(t=>{
    if(t.is_batch){
      if(!t.capacity_per_load) w.push('“'+esc(t.name)+'” is a batch step but has no capacity/load.')
      if(!t.cook_minutes) w.push('“'+esc(t.name)+'” is a batch step but has no cook time.')
      if(!t.equipment_kind) w.push('“'+esc(t.name)+'” is a batch step but has no vessel type.')
      else if(!planVessels.some(v=>v.kind===t.equipment_kind)) w.push('“'+esc(t.name)+'” uses vessel type “'+esc(kindLabel(t.equipment_kind))+'” but no active vessel of that type exists.')
    }
  })
  planVessels.forEach(v=>{ if(!v.kind) w.push('Vessel “'+esc(v.name)+'” has no type set.') })
  return w
}
function healthCard(){
  const w=healthWarnings()
  if(!w.length) return '<div class="card"><span class="muted">✓ Setup checks pass — batch steps and vessels look configured.</span></div>'
  return `<div class="card" style="border-color:var(--amber)"><h2 style="margin:0 0 6px">⚠ Setup check</h2>${w.map(x=>'<div style="font-size:13px;margin-bottom:3px">• '+x+'</div>').join('')}</div>`
}
function planVsActualCard(){
  const byCat={}
  planItems.forEach(i=>{ if(!i.catalog_id)return; const b=byCat[i.catalog_id]||(byCat[i.catalog_id]={name:i.task_name,planned:0,uom:i.uom||'kg'}); b.planned+=Number(i.target_qty)||0 })
  const rows=Object.keys(byCat).map(cid=>{const b=byCat[cid];b.actual=planActual[cid]||0;return b}).filter(b=>b.planned>0)
  if(!rows.length) return ''
  rows.sort((a,b)=>b.planned-a.planned)
  const cell=(txt,i,bold)=>`<td style="text-align:${i===0?'left':'right'};padding:6px 8px;border-bottom:1px solid var(--line);${bold?'font-weight:700':''}">${txt}</td>`
  const trs=rows.map(b=>{
    const pct=b.planned>0?Math.round(b.actual/b.planned*100):0
    const col=pct>=95?'var(--green)':(pct>=70?'var(--amber)':'var(--red)')
    return `<tr>${cell(esc(b.name),0)}${cell(Math.round(b.planned)+' '+esc(b.uom),1)}${cell(Math.round(b.actual)+' '+esc(b.uom),2,true)}<td style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);font-weight:700;color:${col}">${pct}%</td></tr>`
  }).join('')
  const th=['Task','Planned','Actual','Hit'].map((h,i)=>`<th style="text-align:${i===0?'left':'right'};padding:6px 8px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)">${h}</th>`).join('')
  return `<div class="card"><h2 style="margin:0 0 6px">Plan vs actual · this week</h2><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><tr>${th}</tr>${trs}</table></div></div>`
}
function dragBoardHtml(){
  if(!planItems.length) return ''
  const cols=[]
  for(let d=0;d<7;d++){const iso=addDaysIso(planWeekStart,d);cols.push({day:iso,label:DAY_LBL[d]+' '+ddmm(iso),items:planItems.filter(i=>i.plan_date===iso)})}
  cols.push({day:'',label:'Unscheduled',items:planItems.filter(i=>!i.plan_date)})
  const chip=i=>{const warn=(i.assigned_user||i.assigned_staff)?'':' <span style="color:var(--amber)">⚠</span>';return `<div class="jobchip" data-id="${i.id}" style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px;cursor:grab;font-size:13px"><b>${esc(i.task_name||'')}</b>${i.target_qty!=null?' · '+i.target_qty+' '+esc(i.uom||''):''}${warn}</div>`}
  const col=c=>`<div class="dragcol" data-day="${c.day}" style="min-width:150px;flex:1;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px"><div style="font-weight:700;font-size:13px;margin-bottom:6px">${c.label}</div>${c.items.map(chip).join('')}</div>`
  return `<div class="card"><h2 style="margin:0 0 4px">Drag jobs onto a day</h2><p class="muted" style="margin:0 0 10px;font-size:13px">Drag a job between columns to reschedule it. ⚠ = nobody assigned yet.</p><div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px">${cols.map(col).join('')}</div></div>`
}
function onPlanDrop(evt){ const id=evt.item.dataset.id; const day=evt.to.dataset.day||''; if(id) updatePlanJob(id,'plan_date',day) }
function renderPlanBoard(){
  const box=$('planBoard'); if(!box)return
  const totJobs=planItems.length
  const unsched=planItems.filter(i=>!i.plan_date)
  let html=`<div class="card"><b>${totJobs}</b> job${totJobs===1?'':'s'} planned for week of ${ddmm(planWeekStart)}. Flow steps sit on a named vessel; batch/cook steps auto-split into loads across the vessel pool.</div>`
  html += healthCard() + planVsActualCard() + dragBoardHtml()
  for(let d=0; d<7; d++){
    const iso=addDaysIso(planWeekStart,d)
    const dayItems=planItems.filter(i=>i.plan_date===iso)
    if(!dayItems.length) continue
    const flowItems=dayItems.filter(i=>!batchOf(i.catalog_id))
    const batchItems=dayItems.filter(i=>batchOf(i.catalog_id))
    const labour=flowItems.reduce((s,i)=>s+((i.est_minutes||0)*(i.staff_count||1)),0)
    html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${DAY_LBL[d]} ${ddmm(iso)}</h2><span class="muted">${dayItems.length} jobs · ${(labour/60).toFixed(1)} labour-h</span></div>`
    // batch: grouped by vessel-kind pool
    const kinds=[...new Set(batchItems.map(itemKind).filter(Boolean))]
    kinds.forEach(kind=>{
      const its=batchItems.filter(i=>itemKind(i)===kind)
      const usedMins=its.reduce((s,i)=>{const t=batchOf(i.catalog_id);const l=loadsFor(t,i.target_qty)||0;return s+l*(Number(t.cook_minutes)||0)},0)
      const cap=kindCapMins(kind); const n=kindVesselCount(kind)
      html+=`<div style="margin-top:12px"><b>${esc(kindLabel(kind))} pool · ${n} vessel${n===1?'':'s'}</b>${utilBar(usedMins,cap)}`
      its.forEach(i=>html+=batchJobCard(i)); html+='</div>'
    })
    const batchNoKind=batchItems.filter(i=>!itemKind(i))
    if(batchNoKind.length){html+=`<div style="margin-top:12px"><b class="muted">Batch — no vessel type set</b>`;batchNoKind.forEach(i=>html+=batchJobCard(i));html+='</div>'}
    // flow: by named vessel
    const vids=[...new Set(flowItems.map(i=>i.equipment_id).filter(Boolean))]
    vids.forEach(vid=>{
      const v=planVessels.find(x=>x.equipment_id===vid)
      const its=flowItems.filter(i=>i.equipment_id===vid)
      const mins=its.reduce((s,i)=>s+(i.est_minutes||0),0)
      const cap=(v?Number(v.daily_hours):8)*60
      html+=`<div style="margin-top:12px"><b>${v?esc(v.name):'Vessel'}</b>${utilBar(mins,cap)}`
      its.forEach(i=>html+=jobCard(i)); html+='</div>'
    })
    const noVes=flowItems.filter(i=>!i.equipment_id)
    if(noVes.length){html+=`<div style="margin-top:12px"><b class="muted">No vessel assigned</b>`;noVes.forEach(i=>html+=jobCard(i));html+='</div>'}
    html+='</div>'
  }
  if(unsched.length){html+=`<div class="card"><h2 style="margin:0 0 8px">Unscheduled (${unsched.length})</h2>`;unsched.forEach(i=>html+=(batchOf(i.catalog_id)?batchJobCard(i):jobCard(i)));html+='</div>'}
  if(!totJobs) html+='<div class="card"><p class="muted">No jobs yet. Add one above to start planning the week.</p></div>'
  box.innerHTML=html
  if(typeof Sortable!=='undefined'){ document.querySelectorAll('#planBoard .dragcol').forEach(col=>{ new Sortable(col,{group:'plandrag',draggable:'.jobchip',animation:150,onEnd:onPlanDrop}) }) }
}
