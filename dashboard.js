/* DASHBOARD: today's live board (manager/admin) + realtime subscriptions. */

async function refreshDashboard(){
  if(!isManagerUp()) return
  const today=new Date().toISOString().slice(0,10)
  const {data:logs}=await sb.from('sim_task_logs').select('*').eq('log_date',today).order('start_time',{ascending:false})
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  const nameFor=l=>{ if(l.user_id){const p=(profs||[]).find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=(staffs||[]).find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  const all=logs||[], running=all.filter(l=>l.status!=='completed'), done=all.filter(l=>l.status==='completed')
  $('stIn').textContent=running.length;$('stDone').textContent=done.length;$('stUnits').textContent=done.reduce((s,l)=>s+(Number(l.units)||0),0)
  const rb=$('dashRunning')
  if(!running.length){rb.innerHTML='<p class="muted">Nobody is on a task right now.</p>'}
  else{rb.innerHTML='';running.forEach(l=>{const el=document.createElement('div');el.className='dash-row';const wk=Math.floor(workedSeconds(l)/60);const badge=l.status==='paused'?'<div class="pill off">❚❚ paused</div>':'<div class="pill live">● '+wk+' min</div>';el.innerHTML=`<div><div class="name">${esc(nameFor(l))}</div><div class="sub">${esc(l.task_name)}${l.product?' · '+esc(l.product):''} · ${l.staff_count||1} ppl</div></div><div style="text-align:right">${badge}</div>`;rb.appendChild(el)})}
  const fb=$('dashFeed')
  if(!done.length){fb.innerHTML='<p class="muted">No completed tasks yet today.</p>'}
  else{fb.innerHTML='';done.slice(0,20).forEach(l=>{const cat=catalog.find(c=>c.id===l.catalog_id);let vs='';if(cat&&cat.expected_units&&l.units){const pct=Math.round((l.units/cat.expected_units)*100);vs=pct>=100?`<span class="vs-good">${pct}% of target</span>`:`<span class="vs-bad">${pct}% of target</span>`}const el=document.createElement('div');el.className='feed-item';const thumbs=(l.photos&&l.photos.length)?(()=>{const us=l.photos.map(photoUrl);const lb=us.join('|');return '<div class="feed-thumbs">'+us.slice(0,5).map((u,i)=>'<img loading="lazy" src="'+u+'" data-lb="'+lb+'" data-i="'+i+'" onclick="openLightboxEl(this)" style="cursor:zoom-in">').join('')+'</div>'})():'';const _u=uomFor(l);el.innerHTML=`<b>${esc(nameFor(l))}</b> finished <b>${esc(l.task_name)}</b> · ${l.units??'–'} ${_u} in ${l.total_minutes??'–'} min ${l.units_per_hour?'('+l.units_per_hour+' '+_u+'/hr)':''}${l.waste_kg?' · '+l.waste_kg+' '+_u+' waste':''} ${vs} <span class="muted">· ${fmtTime(l.finish_time)}</span>${thumbs}`;fb.appendChild(el)});done.forEach(l=>lastFinishIds.add(l.id))}
  await loadEquipState(); const vb=$('dashVessels'); if(vb) vb.innerHTML=equipBoardHtml()
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
