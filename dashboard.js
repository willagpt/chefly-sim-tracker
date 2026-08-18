/* DASHBOARD: today's live board (manager/admin) + realtime subscriptions. */

async function refreshDashboard(){
  if(!isManagerUp()) return
  const today=new Date().toISOString().slice(0,10)
  const {data:logs}=await sb.from('sim_task_logs').select('*').eq('log_date',today).order('start_time',{ascending:false})
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  const nameFor=l=>{ if(l.user_id){const p=(profs||[]).find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=(staffs||[]).find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  // 'cancelled' is a closed state (an admin withdrew a mis-tap) -- it must not
  // read as somebody standing at a bench working.
  const all=logs||[], running=all.filter(l=>l.status==='in_progress'||l.status==='paused'), done=all.filter(l=>l.status==='completed')
  $('stIn').textContent=running.length;$('stDone').textContent=done.length;$('stUnits').textContent=done.reduce((s,l)=>s+(Number(l.units)||0),0)
  const rb=$('dashRunning')
  if(!running.length){rb.innerHTML='<p class="muted">Nobody is on a task right now.</p>'}
  else{rb.innerHTML='';running.forEach(l=>{const el=document.createElement('div');el.className='dash-row';const wk=Math.floor(workedSeconds(l)/60);const badge=l.status==='paused'?'<div class="pill off">❚❚ paused</div>':'<div class="pill live">● '+wk+' min</div>';el.innerHTML=`<div><div class="name">${esc(nameFor(l))}</div><div class="sub">${esc(l.task_name)}${l.product?' · '+esc(l.product):''} · ${l.staff_count||1} ppl</div></div><div style="text-align:right">${badge}</div>`;rb.appendChild(el)})}
  const fb=$('dashFeed')
  if(!done.length){fb.innerHTML='<p class="muted">No completed tasks yet today.</p>'}
  else{fb.innerHTML='';done.slice(0,20).forEach(l=>{const cat=catalog.find(c=>c.id===l.catalog_id);let vs='';if(cat&&cat.expected_units&&l.units){const pct=Math.round((l.units/cat.expected_units)*100);vs=pct>=100?`<span class="vs-good">${pct}% of target</span>`:`<span class="vs-bad">${pct}% of target</span>`}const el=document.createElement('div');el.className='feed-item';const thumbs=(l.photos&&l.photos.length)?(()=>{const lb=l.photos.map(photoViewUrl).join('|');return '<div class="feed-thumbs">'+l.photos.slice(0,5).map((p,i)=>'<img loading="lazy" src="'+photoThumbUrl(p,180)+'" data-lb="'+lb+'" data-i="'+i+'" onclick="openLightboxEl(this)" style="cursor:zoom-in">').join('')+'</div>'})():'';const _u=uomFor(l);el.innerHTML=`<b>${esc(nameFor(l))}</b> finished <b>${esc(l.task_name)}</b> · ${l.units??'–'} ${_u} in ${l.total_minutes??'–'} min ${l.units_per_hour?'('+l.units_per_hour+' '+_u+'/hr)':''}${l.waste_kg?' · '+l.waste_kg+' '+_u+' waste':''} ${vs} <span class="muted">· ${fmtTime(l.finish_time)}</span>${thumbs}`;fb.appendChild(el)});done.forEach(l=>lastFinishIds.add(l.id))}
  await loadEquipState(); const vb=$('dashVessels'); if(vb) vb.innerHTML=equipBoardHtml()
  refreshOpenTasks()
}

/* ---- LEFT OPEN (admin) ----
   A task is only reachable by the person who started it, and Manage → History
   only lists COMPLETED tasks -- so anything left running was invisible to
   everyone and impossible to clear. As of 18 Aug 2026 that was 32 tasks across
   11 people, the oldest from 24 June, 31 of them with no amount produced and
   no photo. They inflate "on task now" and sit in the data forever.

   Two causes, and this card addresses the second while startTask() addresses
   the first:
     1. Duplicate starts -- 8 of the 32 began within seconds of an identical
        task by the same person (four Brisket Trims inside four seconds). The
        START button gave no feedback, so on a slow connection people tapped
        again. tasks.js now disables the button while the request is in flight.
     2. Never stopped -- someone ends a shift or closes the browser without
        tapping STOP, and nothing could ever close it.

   Admin-only by deliberate choice: closing another person's work record is a
   supervisory act, and every action here writes who did it into the task's
   comments so the change is never anonymous. */
let openTasksRows=[]
async function refreshOpenTasks(){
  const host=$('dashTab'); if(!host) return
  let card=$('openTasksCard')
  if(!isAdmin()){ if(card) card.remove(); return }
  const {data,error}=await sb.from('sim_task_logs').select('*')
    .in('status',['in_progress','paused']).order('start_time',{ascending:true})
  if(error) return
  const rows=data||[]
  openTasksRows=rows
  if(!card){
    card=document.createElement('div'); card.className='card'; card.id='openTasksCard'
    host.insertBefore(card, host.firstChild)
  }
  if(!rows.length){
    card.innerHTML='<h2>Left open</h2><p class="muted">Nothing is left open. Every task has been finished.</p>'
    return
  }
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  const who=l=>{ if(l.user_id){const p=(profs||[]).find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'}
                 if(l.staff_id){const s=(staffs||[]).find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  const ageOf=t=>{const d=Math.floor((Date.now()-new Date(t))/86400000);
    if(d>=1) return d+' day'+(d>1?'s':'')+' ago'
    const h=Math.floor((Date.now()-new Date(t))/3600000); return h>=1?h+'h ago':'today'}
  const stale=rows.filter(l=>Date.now()-new Date(l.start_time)>864e5).length
  card.innerHTML='<h2>Left open <span class="pill '+(stale?'off':'live')+'">'+rows.length+'</span></h2>'
    +'<p class="muted" style="margin-top:-6px">Tasks still running or paused, across everyone. '
    +(stale?stale+' of them started more than a day ago. ':'')
    +'Finish one to record it properly, or discard it if it was a mis-tap.</p>'
    +rows.map(l=>{
      const noData=(l.units==null)&&!(l.photos&&l.photos.length)
      return '<div class="task-item" style="flex-direction:column;align-items:stretch;gap:6px">'
        +'<div><b>'+esc(l.task_name)+'</b> <span class="muted">· '+esc(who(l))+'</span>'
        +'<div class="meta">'+esc(ageOf(l.start_time))+' · started '+esc(l.log_date)+' '+fmtTime(l.start_time)
        +(l.product?' · '+esc(l.product):'')+(l.status==='paused'?' · paused':'')
        +(noData?' · <span style="color:#fcd34d">nothing recorded</span>':
           ' · '+(l.units!=null?l.units+' '+uomFor(l):'')+((l.photos&&l.photos.length)?' · 📷 '+l.photos.length:''))
        +'</div></div>'
        +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
        +'<button class="green sm" onclick="adminFinishTask(\''+l.id+'\')">Finish properly</button>'
        +'<button class="ghost sm" onclick="adminDiscardTask(\''+l.id+'\')">Discard as mis-tap</button>'
        +'</div></div>'
    }).join('')
}
function _adminName(){ return (profile&&(profile.full_name||profile.email))||'an admin' }
window.adminFinishTask=async function(id){
  const l=openTasksRows.find(x=>x.id===id); if(!l) return
  const u=uomFor(l)
  const needUnits=requiresUnits(l)
  let units=null
  const ask=prompt('Finish "'+l.task_name+'" for '+ (l.product||'this task') +'.\n\n'
    +'Amount produced ('+u+')'+(needUnits?' — required for this task':' — optional, leave blank if none')+':','')
  if(ask===null) return
  if(ask.trim()!==''){ units=Number(ask); if(isNaN(units)){alert('Enter a number, or leave it blank.');return} }
  if(needUnits && units==null){ alert('This task records an amount produced, so it cannot be finished without one.\n\nIf nothing was actually produced, discard it as a mis-tap instead.'); return }
  const he=numberHardError(units,null,u); if(he){alert(he);return}
  let waste=null
  if(requiresWaste(l)){
    const w=prompt('Waste ('+u+') — required for this task. Enter 0 if there was none:','0')
    if(w===null) return
    waste=Number(w); if(isNaN(waste)){alert('Enter a number.');return}
  }
  /* Duration matters. total_minutes is derived from finish_time - start_time,
     so closing a task that has been open for weeks with "now" would record it
     as having taken 79,631 minutes and drag that person's rate towards zero
     in every performance view. For anything left open more than a few hours,
     ask how long the job actually took and back-date the finish accordingly;
     a blank answer falls back to the task's expected time, and only a genuinely
     recent task is closed at the current time. */
  const openedMs=Date.now()-new Date(l.start_time)
  let finish=new Date()
  if(openedMs>6*3600*1000){
    const cat=catFor(l)
    const suggest=(cat&&cat.cook_minutes)||60
    const dur=prompt('This has been open for '+Math.floor(openedMs/86400000)+' day(s), so "now" would record a wildly wrong duration.\n\n'
      +'Roughly how many minutes did the job actually take?\n(blank = use '+suggest+' min)','')
    if(dur===null) return
    let m=dur.trim()===''?suggest:Number(dur)
    if(isNaN(m)||m<=0){alert('Enter a number of minutes, or leave blank.');return}
    finish=new Date(new Date(l.start_time).getTime()+m*60000)
  }
  const note=prompt('Why is this being closed? (kept on the record)','Left running — closed by '+_adminName())
  if(note===null) return
  const comments=[l.comments,note.trim()].filter(Boolean).join(' | ')
  const {error}=await sb.from('sim_task_logs')
    .update({finish_time:finish.toISOString(), units, waste_kg:waste, paused_seconds:0, comments, status:'completed'}).eq('id',id)
  if(error){ alert(finishErr(error)); return }
  await refreshDashboard()
}
window.adminDiscardTask=async function(id){
  const l=openTasksRows.find(x=>x.id===id); if(!l) return
  const hasData=(l.units!=null)||(l.photos&&l.photos.length)
  if(hasData && !confirm('This task has data recorded against it ('
      +[l.units!=null?l.units+' '+uomFor(l):null,(l.photos&&l.photos.length)?l.photos.length+' photo(s)':null].filter(Boolean).join(', ')
      +').\n\nDiscarding keeps the record but marks it as never completed, and it will not count towards anything.\n\nAre you sure it was a mis-tap?')) return
  const note=prompt('Why is this being discarded? (kept on the record)','Mis-tap — discarded by '+_adminName())
  if(note===null) return
  const comments=[l.comments,note.trim()].filter(Boolean).join(' | ')
  // status only -- setting finish_time would make sim_calc_totals() force it
  // to 'completed' and then the units/CCP gates would fire.
  const {error}=await sb.from('sim_task_logs').update({status:'cancelled', comments}).eq('id',id)
  if(error){ alert(netErr(error)); return }
  await refreshDashboard()
}

function subscribeRealtime(){
  sb.channel('sim-logs').on('postgres_changes',{event:'*',schema:'public',table:'sim_task_logs'},(payload)=>{
    if(payload.eventType==='UPDATE'&&payload.new.status==='completed'&&!lastFinishIds.has(payload.new.id)){lastFinishIds.add(payload.new.id);if(isManagerUp()&&payload.new.user_id!==me.id)notify('Task finished',`${payload.new.task_name} · ${payload.new.units??'–'} ${payload.new.uom||'kg'}`)}
    if(isManagerUp())refreshDashboard()
    if(payload.new&&payload.new.user_id===me.id){loadActive();refreshMyRecent()}
  }).subscribe()
  sb.channel('sim-cooks').on('postgres_changes',{event:'*',schema:'public',table:'sim_cook_sessions'},()=>{
    const et=$('equipTab'); if(et&&!et.classList.contains('hidden')) loadEquip()
    if(isManagerUp()&&!$('dashTab').classList.contains('hidden')) refreshDashboard()
  }).subscribe()
  setInterval(()=>{if(isManagerUp()&&!$('dashTab').classList.contains('hidden'))refreshDashboard()},30000)
}
