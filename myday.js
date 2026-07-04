/* MY DAY: a person's assigned plan jobs for today, shown on My Task and the kiosk. */
let myDayItems=[], kMyDayItems=[]
function _todayIsoMD(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function renderMyDay(items,m){
  if(!items.length) return '<p class="muted">Nothing assigned to you today.</p>'
  return items.map(i=>{
    const t=catalog.find(c=>c.id===i.catalog_id)
    const sub=[i.product?esc(i.product):'',(i.target_qty!=null?i.target_qty+' '+esc(i.uom||'kg'):''),(t&&t.is_batch?'batch/cook':'')].filter(Boolean).join(' · ')
    const running=i.status==='in_progress'
    return `<div class="task-item">
      <div><b>${esc(i.task_name||'')}</b>${sub?'<div class="meta">'+sub+'</div>':''}</div>
      <button class="${running?'ghost':'green'} sm" style="flex-shrink:0" onclick="startFromPlan('${i.id}','${m}')">${running?'Start again':'Start'}</button>
    </div>`
  }).join('')
}
async function loadMyDay(){
  const box=$('myDayBody'); if(!box||!me) return
  const {data}=await sb.from('sim_plan_items').select('*').eq('plan_date',_todayIsoMD()).eq('assigned_user',me.id).order('sort_order')
  myDayItems=(data||[]).filter(i=>i.status!=='done')
  const card=$('myDayCard'); if(card)card.classList.toggle('hidden',!myDayItems.length)
  box.innerHTML=renderMyDay(myDayItems,'s')
}
async function loadMyDayKiosk(){
  const box=$('kMyDayBody'); if(!box||!kStaff) return
  const {data}=await sb.from('sim_plan_items').select('*').eq('plan_date',_todayIsoMD()).eq('assigned_staff',kStaff.id).order('sort_order')
  kMyDayItems=(data||[]).filter(i=>i.status!=='done')
  const card=$('kMyDayCard'); if(card)card.classList.toggle('hidden',!kMyDayItems.length)
  box.innerHTML=renderMyDay(kMyDayItems,'k')
}
window.startFromPlan=async function(id,m){
  const items=m==='k'?kMyDayItems:myDayItems
  const it=items.find(x=>x.id===id); if(!it)return
  const t=catalog.find(c=>c.id===it.catalog_id)
  const row={catalog_id:it.catalog_id,task_name:it.task_name||(t&&t.name)||'Task',station:t?t.station:null,uom:it.uom||(t&&t.uom)||'kg',product:it.product||null,staff_count:1,start_time:new Date().toISOString(),status:'in_progress'}
  if(m==='k'){row.staff_id=kStaff.id} else {row.user_id=me.id}
  const {data,error}=await sb.from('sim_task_logs').insert(row).select().single()
  if(error){alert(error.message);return}
  await sb.from('sim_plan_items').update({status:'in_progress'}).eq('id',id)
  if(m==='k'){ kActiveLogs.unshift(data); kioskRenderRunning(); loadMyDayKiosk() }
  else { activeLogs.unshift(data); renderRunning(); loadMyDay() }
}
