/* PLAN: weekly production plan — day-level capacity board (manager/admin).
   Enter target quantities per recipe; assign each job to a day + named vessel;
   each vessel/day shows a utilisation bar vs its available hours. Durations come
   from sim_standard_times() (median of history, override-aware), editable per job. */

let planWeekStart=null, planWeekId=null, planItems=[], planStd={}, planVessels=[]
const DAY_LBL=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function mondayOf(d){const dt=new Date(d+'T00:00:00');const off=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-off);return dt.toISOString().slice(0,10)}
function addDaysIso(iso,n){const dt=new Date(iso+'T00:00:00');dt.setDate(dt.getDate()+n);return dt.toISOString().slice(0,10)}
function ddmm(iso){const dt=new Date(iso+'T00:00:00');return dt.getDate()+'/'+(dt.getMonth()+1)}
function stdFor(id){return planStd[id]||null}
function estMinutes(catId,qty){const s=stdFor(catId);if(!s||!qty)return s&&s.eff_minutes?Math.round(s.eff_minutes):null;if(s.eff_uph&&s.eff_uph>0)return Math.round(qty/s.eff_uph*60);if(s.eff_minutes)return Math.round(s.eff_minutes);return null}

window.loadPlan=async function(){
  if(!isManagerUp())return
  if(!catalog.length) await loadCatalog()
  if(!$('planWeek').value) $('planWeek').value=mondayOf(new Date().toISOString().slice(0,10))
  planWeekStart=mondayOf($('planWeek').value); $('planWeek').value=planWeekStart
  // standard times
  const {data:std}=await sb.rpc('sim_standard_times')
  planStd={}; (std||[]).forEach(r=>{planStd[r.catalog_id]=r})
  // vessels (active, with daily_hours)
  await loadEquipState(); planVessels=equipState.slice()
  // populate add-job controls
  const ts=$('pjTask'); ts.innerHTML=''; catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;ts.appendChild(o)})
  fillDaySelect('pjDay'); fillVesselSelect('pjEquip')
  pjRecalc()
  // week row + items
  const {data:wk}=await sb.from('sim_plan_weeks').select('id').eq('week_start',planWeekStart).maybeSingle()
  planWeekId = wk?wk.id:null
  if(planWeekId){const {data:items}=await sb.from('sim_plan_items').select('*').eq('week_id',planWeekId).order('sort_order'); planItems=items||[]}
  else planItems=[]
  renderPlanBoard()
}
function fillDaySelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${iso===c?' selected':''}>${lbl} ${ddmm(iso)}</option>`}).join('')}
function fillVesselSelect(id,cur){const sel=$(id);if(!sel)return;const c=cur||sel.value;sel.innerHTML='<option value="">No vessel</option>'+planVessels.map(v=>`<option value="${v.equipment_id}"${v.equipment_id===c?' selected':''}>${esc(v.name)}</option>`).join('')}

window.pjRecalc=function(){
  const t=catalog.find(c=>c.id===$('pjTask').value)
  const qty=$('pjQty').value?Number($('pjQty').value):null
  if(t){const em=estMinutes(t.id,qty); if(em!=null && !$('pjMins').dataset.touched) $('pjMins').value=em
    const s=stdFor(t.id)
    $('pjHint').innerHTML = s ? (s.runs?`Standard: ${s.eff_uph?esc(s.eff_uph)+' '+esc(t.uom||'kg')+'/hr':esc(s.eff_minutes)+' min'} · from ${s.runs} run${s.runs===1?'':'s'}${s.is_estimate?' <b style="color:var(--amber)">(estimate — few runs)</b>':''}` : '<span style="color:var(--amber)">No history yet — enter minutes manually or set an override.</span>') : ''
  }
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
  const {error}=await sb.from('sim_plan_items').insert({week_id:planWeekId,catalog_id:t.id,task_name:t.name,product:$('pjProduct').value.trim()||null,target_qty:qty,uom:t.uom||'kg',plan_date:$('pjDay').value||null,equipment_id:$('pjEquip').value||null,est_minutes:mins,staff_count:Number($('pjStaff').value)||1,sort_order:order})
  if(error){msg($('planMsg'),error.message,false);return}
  $('pjQty').value='';$('pjProduct').value='';$('pjMins').value='';$('pjMins').dataset.touched='';clearMsg($('planMsg'))
  await loadPlan()
}
window.updatePlanJob=async function(id,field,value){
  const patch={}; patch[field]=(value===''?null:(field==='est_minutes'||field==='target_qty'||field==='staff_count')?Number(value):value)
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
function jobCard(it){
  const daySel=`<select onchange="updatePlanJob('${it.id}','plan_date',this.value)">`+'<option value="">Unscheduled</option>'+DAY_LBL.map((lbl,i)=>{const iso=addDaysIso(planWeekStart,i);return `<option value="${iso}"${it.plan_date===iso?' selected':''}>${lbl} ${ddmm(iso)}</option>`}).join('')+'</select>'
  const vesSel=`<select onchange="updatePlanJob('${it.id}','equipment_id',this.value)">`+'<option value="">No vessel</option>'+planVessels.map(v=>`<option value="${v.equipment_id}"${it.equipment_id===v.equipment_id?' selected':''}>${esc(v.name)}</option>`).join('')+'</select>'
  return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div><b>${esc(it.task_name||'')}</b>${it.product?' · '+esc(it.product):''}<div class="muted" style="font-size:12px">${it.target_qty??'–'} ${esc(it.uom||'')} · ${it.est_minutes??'–'} min · ${it.staff_count||1} ppl</div></div>
      <a class="link" style="font-size:13px;flex-shrink:0" onclick="delPlanJob('${it.id}')">Remove</a>
    </div>
    <div class="row" style="gap:8px">${daySel}${vesSel}</div>
  </div>`
}
function renderPlanBoard(){
  const box=$('planBoard'); if(!box)return
  const totJobs=planItems.length
  const unsched=planItems.filter(i=>!i.plan_date)
  let html=`<div class="card"><b>${totJobs}</b> job${totJobs===1?'':'s'} planned for week of ${ddmm(planWeekStart)}. Assign a day + vessel to each; bars show each vessel's load per day.</div>`
  // per-day
  for(let d=0; d<7; d++){
    const iso=addDaysIso(planWeekStart,d)
    const dayItems=planItems.filter(i=>i.plan_date===iso)
    if(!dayItems.length) continue
    const labour=dayItems.reduce((s,i)=>s+((i.est_minutes||0)*(i.staff_count||1)),0)
    html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${DAY_LBL[d]} ${ddmm(iso)}</h2><span class="muted">${dayItems.length} jobs · ${(labour/60).toFixed(1)} labour-h</span></div>`
    // vessels used that day
    const vids=[...new Set(dayItems.map(i=>i.equipment_id).filter(Boolean))]
    vids.forEach(vid=>{
      const v=planVessels.find(x=>x.equipment_id===vid)
      const its=dayItems.filter(i=>i.equipment_id===vid)
      const mins=its.reduce((s,i)=>s+(i.est_minutes||0),0)
      const cap=(v?Number(v.daily_hours):8)*60
      html+=`<div style="margin-top:12px"><b>${v?esc(v.name):'Vessel'}</b>${utilBar(mins,cap)}`
      its.forEach(i=>html+=jobCard(i)); html+='</div>'
    })
    const noVes=dayItems.filter(i=>!i.equipment_id)
    if(noVes.length){html+=`<div style="margin-top:12px"><b class="muted">No vessel assigned</b>`;noVes.forEach(i=>html+=jobCard(i));html+='</div>'}
    html+='</div>'
  }
  if(unsched.length){html+=`<div class="card"><h2 style="margin:0 0 8px">Unscheduled (${unsched.length})</h2>`;unsched.forEach(i=>html+=jobCard(i));html+='</div>'}
  if(!totJobs) html+='<div class="card"><p class="muted">No jobs yet. Add one above to start planning the week.</p></div>'
  box.innerHTML=html
}
