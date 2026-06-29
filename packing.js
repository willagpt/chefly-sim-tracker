/* PACKING: team-leader screen — start-of-day positions & breaks, and the day's
   dish run-sheet with sequential start/stop + automatic changeover timing.
   Live: subscribes to realtime + live pace vs an adjustable meals/hour target. */

let packShift=null, packPositions=[], packMembers=[], packAssignments={}, packRuns=[], packBreaks=[], packTimer=null
let packChannel=null, packLiveT=null, packDragging=false, packTarget=500
const PACK_CO_TARGET=3   // minutes — SKU change target

window.loadPacking=async function(){
  const today=new Date().toISOString().slice(0,10)
  let {data:sh}=await sb.from('sim_pack_shifts').select('*').eq('shift_date',today).maybeSingle()
  if(!sh){const ins=await sb.from('sim_pack_shifts').insert({shift_date:today,created_by:(me&&me.id)||null}).select().single(); if(ins.error){$('packBody').innerHTML='<div class="card"><p class="muted">'+ins.error.message+'</p></div>';return} sh=ins.data}
  packShift=sh
  const [pos,mem,asg,runs,brk,cfg]=await Promise.all([
    sb.from('sim_pack_positions').select('*').eq('active',true).order('sort_order'),
    sb.from('sim_pack_members').select('*').eq('active',true).order('sort_order').order('full_name'),
    sb.from('sim_pack_assignments').select('*').eq('shift_id',sh.id),
    sb.from('sim_pack_runs').select('*').eq('shift_id',sh.id).order('sort_order'),
    sb.from('sim_pack_breaks').select('*').eq('shift_id',sh.id).order('created_at'),
    sb.from('sim_pack_settings').select('target_per_hour').eq('id',1).maybeSingle()
  ])
  packPositions=pos.data||[]; packMembers=mem.data||[]; packRuns=runs.data||[]; packBreaks=brk.data||[]
  packTarget=(cfg&&cfg.data&&Number(cfg.data.target_per_hour))||500
  packAssignments={}; (asg.data||[]).forEach(a=>{packAssignments[a.position_id]=a})
  renderPacking()
  packSubscribe()
  if(packTimer)clearInterval(packTimer); packTimer=setInterval(packTick,1000)
}
function packSubscribe(){
  if(packChannel) return
  packChannel=sb.channel('sim-packing')
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_runs'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_assignments'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_breaks'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_shifts'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_dish_import'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_settings'},packLiveRefresh)
    .subscribe()
}
function packLiveRefresh(){
  const et=$('packTab'); if(!et||et.classList.contains('hidden')) return
  if(packDragging){ clearTimeout(packLiveT); packLiveT=setTimeout(packLiveRefresh,800); return }
  const ae=document.activeElement
  if(ae && (ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA') && $('packBody') && $('packBody').contains(ae)){
    clearTimeout(packLiveT); packLiveT=setTimeout(packLiveRefresh,1500); return
  }
  clearTimeout(packLiveT); packLiveT=setTimeout(()=>{ loadPacking() },300)
}
function packMemberName(id){const m=packMembers.find(x=>x.id===id);return m?m.full_name:'—'}
function packMemberOptions(sel){return '<option value="">— unassigned —</option>'+packMembers.map(m=>`<option value="${m.id}" ${sel===m.id?'selected':''}>${m.full_name}</option>`).join('')}
function packRate(r){ // meals per hour for a finished dish
  const q=(r.qty_packed!=null?r.qty_packed:r.planned_qty)
  if(!r.total_minutes||r.total_minutes<=0||q==null) return null
  return q/(r.total_minutes/60)
}
function renderPacking(){
  const box=$('packBody'); if(!box)return
  const done=packRuns.filter(r=>r.status==='done'), packing=packRuns.find(r=>r.status==='packing')
  const next=packRuns.find(r=>r.status==='pending')
  const skipped=packRuns.filter(r=>r.status==='skipped').length
  const plannedMeals=packRuns.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const packedMeals=done.reduce((s,r)=>s+(Number(r.qty_packed)||Number(r.planned_qty)||0),0)
  const cos=packRuns.filter(r=>r.changeover_mins!=null)
  const overCount=cos.filter(r=>r.changeover_mins>PACK_CO_TARGET).length
  const avgCo=cos.length?(cos.reduce((s,r)=>s+Number(r.changeover_mins),0)/cos.length):null
  let html=''
  html+=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Packing — ${packShift.shift_date}</h2><span class="pill ${packing?'live':'off'}">${packing?'● PACKING':'idle'}</span></div>
    <div class="stat-grid" style="margin-top:10px">
      <div class="stat"><div class="n">${done.length}/${packRuns.length}</div><div class="l">Dishes</div></div>
      <div class="stat"><div class="n">${packedMeals}</div><div class="l">Packed</div></div>
      <div class="stat"><div class="n">${plannedMeals}</div><div class="l">Planned</div></div>
    </div>
    <p class="muted" style="margin-top:8px">Changeovers: ${avgCo!=null?avgCo.toFixed(1)+'m avg':'–'} · <span class="${overCount?'vs-bad':'vs-good'}">${overCount} over ${PACK_CO_TARGET}-min</span>${skipped?' · '+skipped+' skipped':''}</p>
    <p class="muted" style="margin-top:2px">Target: <b style="color:var(--txt)">${packTarget}/hr</b> <a class="link" onclick="packSetTarget()">adjust</a></p>
  </div>`

  html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">Dish list</h2>`
  if(packRuns.length) html+=`<button class="ghost sm" onclick="packSaveDefault()">Save order</button>`
  html+=`</div>`
  if(!packRuns.length){
    html+=`<p class="muted">No dishes loaded for today yet.</p><button class="green" onclick="packImportDishes()">Load today's dish list</button>`
  } else {
    html+=packActionPanel(packing,next)
    html+=`<p class="muted" style="margin:14px 0 4px">All dishes — drag ⠿ to reorder.</p><div id="packDishList">`
    packRuns.forEach(r=>{ html+=packRunRow(r) })
    html+='</div><button class="ghost sm" style="margin-top:10px" onclick="packImportDishes()">Re-load from sheet (clears timings)</button>'
  }
  html+='</div>'

  html+=packActualOrderCard()
  html+=`<div class="card"><h2>Team &amp; positions</h2>`
  if(!packMembers.length) html+=`<p class="muted">No packing roster yet. An admin adds people in Manage → Packing team.</p>`
  packPositions.forEach(p=>{
    const a=packAssignments[p.id]
    html+=`<div style="margin-bottom:8px"><div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:3px">${p.label}</div><select onchange="packAssign('${p.id}',this.value)">${packMemberOptions(a?a.member_id:'')}</select></div>`
  })
  html+='</div>'

  html+=`<div class="card"><h2>Breaks</h2>`
  if(packBreaks.length){html+='<div style="margin-bottom:8px">'+packBreaks.map(b=>`<div class="task-item"><div><b>${packMemberName(b.member_id)}</b><div class="meta">${b.break_time||'—'}${b.approved_by?' · approved by '+b.approved_by:''}</div></div><button class="ghost sm" onclick="packDelBreak('${b.id}')">✕</button></div>`).join('')+'</div>'}
  html+=`<select id="brkMember">${packMemberOptions('')}</select>
    <div class="row" style="margin-top:8px"><input id="brkTime" placeholder="Break time (e.g. 11:00)" /><input id="brkApproved" placeholder="Approved by" /></div>
    <button class="green" onclick="packAddBreak()">Add break</button></div>`

  html+=packRulesCard()
  box.innerHTML=html
  packAttachDnD()
}
function packActionPanel(packing,next){
  if(packing){
    const tmin=(packTarget&&packing.planned_qty)?(packing.planned_qty/packTarget*60):null
    return `<div class="card" style="background:var(--panel2);border-color:var(--accent);text-align:center;margin:6px 0 0">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.5px">NOW PACKING · SKU ${packing.sku||'–'}${packing.line_count?' · '+packing.line_count+' on line':''}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${packing.dish_name}</div>
      <div class="timer" id="packCurElapsed">00:00:00</div>
      <div class="muted" style="font-size:12px">Target ${packTarget}/hr${tmin?' · '+tmin.toFixed(1)+' min for '+packing.planned_qty:''}</div>
      <div id="packPaceInfo" style="font-weight:800;font-size:15px;margin:6px 0 2px">&nbsp;</div>
      <div style="max-width:240px;margin:4px auto 0"><input id="qty_${packing.id}" type="number" inputmode="numeric" placeholder="qty packed" value="${packing.planned_qty??''}" style="text-align:center" /></div>
      <button class="red" onclick="packStopDish('${packing.id}')">■ STOP — finish dish</button>
      <a class="link" style="display:block;margin-top:10px;font-size:13px" onclick="packDiscard('${packing.id}')">✕ Cancel start (mis-tap — return to list)</a>
    </div>`
  }
  if(next){
    const dones=packRuns.filter(x=>x.status==='done'&&x.finish_time)
    const lastFin=dones.length?dones.reduce((a,b)=>new Date(a.finish_time)>new Date(b.finish_time)?a:b):null
    const coBlock=lastFin?`<div class="muted" style="font-size:12px;margin-top:8px">⏱ Changeover running — time since last dish finished (target ${PACK_CO_TARGET}m)</div><div class="timer vs-good" id="packCoElapsed" style="font-size:34px;margin:2px 0">00:00</div>`:''
    return `<div class="card" style="background:var(--panel2);text-align:center;margin:6px 0 0">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.5px">NEXT UP · SKU ${next.sku||'–'}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${next.dish_name}</div>
      <div class="muted" style="margin-bottom:2px"><b style="font-size:22px;color:var(--txt)">${next.planned_qty??'–'}</b> to pack</div>
      ${coBlock}
      <button class="green" onclick="packStartDish('${next.id}')">▶ START</button>
      <a class="link" style="display:block;margin-top:10px;font-size:13px" onclick="packSkip('${next.id}')">Not ready — skip this dish</a>
    </div>`
  }
  return `<div class="card" style="background:var(--panel2);text-align:center;margin:6px 0 0"><b>All dishes done 🎉</b></div>`
}
function packRunRow(r){
  const anyPacking=packRuns.some(x=>x.status==='packing')
  const ran=(r.status==='packing'||r.status==='done')
  const coVal=r.changeover_mins!=null?r.changeover_mins.toFixed(1)+'m':'–'
  const coCls=(r.changeover_mins!=null&&r.changeover_mins>PACK_CO_TARGET)?'vs-bad':'vs-good'
  const co=ran&&r.changeover_mins!=null?` · CO <span class="${coCls}">${coVal}</span> <a class="link" style="font-size:13px" onclick="packEditChangeover('${r.id}')">✎</a>`:''
  let pill
  if(r.status==='done')pill='<span class="pill done">done</span>'
  else if(r.status==='packing')pill='<span class="pill live">● packing</span>'
  else if(r.status==='skipped')pill='<span class="pill" style="background:rgba(245,158,11,.18);color:#fcd34d">skipped</span>'
  else pill='<span class="pill off">pending</span>'
  let act=''
  if(r.status==='pending'){ act=`<button class="green sm" onclick="packStartDish('${r.id}')" ${anyPacking?'disabled':''}>Start</button> <a class="link" style="font-size:12px" onclick="packSkip('${r.id}')">Skip</a>` }
  else if(r.status==='skipped'){ act=`<button class="ghost sm" onclick="packUnskip('${r.id}')">Un-skip</button>` }
  else if(r.status==='done'){ const rt=packRate(r); const rtTxt=rt!=null?` · <span class="${rt>=packTarget?'vs-good':'vs-bad'}">${Math.round(rt)}/hr</span>`:''; act=`<span class="muted" style="font-size:12px">${r.total_minutes!=null?r.total_minutes+' min':''}${r.line_count?' · '+r.line_count+'p':''}${r.qty_packed!=null?' · '+r.qty_packed+' packed':''}${rtTxt}</span>` }
  const noteLink=`<a class="link" style="font-size:12px" onclick="packNote('${r.id}')">📝 ${r.notes?'Edit note':'Note'}</a>`
  const photos=r.notes_photos||[]
  const photoLink=`<a class="link" style="font-size:12px" onclick="packAddPhoto('${r.id}')">📷 ${photos.length?'Photo ('+photos.length+')':'Photo'}</a>`
  const lbStr=photos.map(photoUrl).join('|')
  const photoStrip=photos.length?`<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">`+photos.map((p,i)=>`<span class="pwrap" style="position:relative"><img src="${photoUrl(p)}" loading="lazy" data-lb="${lbStr}" data-i="${i}" onclick="openLightboxEl(this)" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--line)"/><button onclick="packDelPhoto('${r.id}','${p}')" title="Remove" style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;line-height:1;cursor:pointer">✕</button></span>`).join('')+`</div>`:''
  const handle=r.status==='pending'?`<span class="drag-h" style="cursor:grab;touch-action:none;user-select:none;padding:2px 4px;font-size:18px;color:var(--muted)">⠿</span>`:''
  const skuBlock=`<div style="flex:0 0 auto;text-align:center;min-width:38px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:20px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div>`
  const planBlock=`<div style="flex:0 0 auto;text-align:center;min-width:42px"><div style="font-size:20px;font-weight:900;line-height:1">${r.planned_qty??'–'}</div><div style="font-size:10px;color:var(--muted)">PLAN</div></div>`
  const notesLine=r.notes?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">📝 ${r.notes}</div>`:''
  return `<div class="task-item" data-runid="${r.id}" data-pending="${r.status==='pending'?'1':'0'}" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;align-items:center;gap:10px">${handle}${skuBlock}<b style="flex:1;min-width:0;font-size:15px">${r.dish_name}</b>${planBlock}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">${pill}${co}</span><span style="flex-shrink:0;display:flex;gap:12px;align-items:center">${photoLink}${noteLink}${act}</span></div>
    ${notesLine}
    ${photoStrip}
  </div>`
}
function packActualOrderCard(){
  const started=packRuns.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq)
  if(!started.length) return ''
  const plannedSorted=[...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
  const plannedRank={}; plannedSorted.forEach((r,i)=>{plannedRank[r.id]=i+1})
  const movedAny=started.some((r,i)=>plannedRank[r.id]!=null && plannedRank[r.id]!==(i+1))
  const rows=started.map((r,i)=>{
    const actual=i+1, planned=plannedRank[r.id]
    const moved=planned!=null&&planned!==actual
    const movedBadge=moved?`<span class="pill" style="background:rgba(245,158,11,.18);color:#fcd34d">moved from #${planned}</span>`:''
    const coTxt=r.changeover_mins!=null?` · CO ${r.changeover_mins.toFixed(1)}m`:''
    const reason=r.out_of_sequence_reason?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">↳ ${r.out_of_sequence_reason}</div>`:''
    const status=r.status==='packing'?'<span class="pill live">● packing</span>':'<span class="pill done">done</span>'
    return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px;min-width:26px">#${actual}</b><span style="background:rgba(249,115,22,.18);color:var(--accent);font-weight:900;border-radius:6px;padding:1px 8px">${r.sku||'–'}</span><b style="flex:1;min-width:0">${r.dish_name}</b>${status}${movedBadge}</div><div class="muted" style="font-size:12px">${r.total_minutes!=null?r.total_minutes+' min pack':''}${coTxt}</div>${reason}</div>`
  }).join('')
  return `<div class="card"><h2>Actual packed order</h2><p class="muted" style="margin-top:-8px">The real sequence packed today, with pack time and changeover (CO) into each dish${movedAny?'. Dishes that moved from the plan are flagged with the reason given':''}.</p>${rows}</div>`
}
function packRulesCard(){
  return `<div class="card"><h2>Packing Team Rules</h2><ul style="margin:0;padding-left:18px;line-height:1.7;font-size:13px;color:var(--muted)">
    <li>Team leader sets team structure every Monday — confirm to team.</li>
    <li>Once a position is selected, do not leave station unless on a break.</li>
    <li>SKU change under 3 mins — aim for 1–2 mins.</li>
    <li>ALL components set up in position before packing (mixes, proteins, sauces, trays, sleeves).</li>
    <li>Person on stickers covers when a team member is on break.</li>
    <li>No one leaves station without Manager / Team Leader approval.</li>
    <li>No phones on shift. Team Leader on site for closing checks. Playlist agreed.</li>
    <li>Smoking breaks &amp; time-keeping — see policy.</li>
    <li>Docs: Timing SIM sheet, meal/tray count, label register, production sheets — all checked &amp; returned.</li>
  </ul></div>`
}
function packTick(){
  const r=packRuns.find(x=>x.status==='packing'); const el=$('packCurElapsed')
  if(r&&el&&r.start_time){
    const sec=(Date.now()-new Date(r.start_time))/1000
    el.textContent=fmtClock(sec)
    const info=$('packPaceInfo')
    if(info && packTarget>0 && r.planned_qty){
      const elapsedMin=sec/60, targetMin=r.planned_qty/packTarget*60
      if(elapsedMin<=targetMin){ const left=Math.max(0,targetMin-elapsedMin); info.innerHTML='<span class="vs-good">On pace ✓ — '+left.toFixed(1)+' min left to hit '+packTarget+'/hr</span>' }
      else { const over=elapsedMin-targetMin; info.innerHTML='<span class="vs-bad">Behind by '+over.toFixed(1)+' min vs '+packTarget+'/hr</span>' }
    }
    return
  }
  const coEl=$('packCoElapsed')
  if(coEl){
    const dones=packRuns.filter(x=>x.status==='done'&&x.finish_time)
    if(dones.length){
      const last=dones.reduce((a,b)=>new Date(a.finish_time)>new Date(b.finish_time)?a:b)
      const sec=(Date.now()-new Date(last.finish_time))/1000
      coEl.textContent=fmtClock(sec)
      coEl.className = (sec/60>PACK_CO_TARGET)?'timer vs-bad':'timer vs-good'
    }
  }
}
function packAttachDnD(){
  const list=$('packDishList'); if(!list)return
  list.querySelectorAll('.drag-h').forEach(h=>{
    h.addEventListener('pointerdown',e=>{
      const dragEl=h.closest('[data-runid]'); if(!dragEl)return
      e.preventDefault(); packDragging=true; dragEl.style.opacity='0.5'
      const move=(ev)=>{
        const targets=[...list.querySelectorAll('[data-runid][data-pending="1"]')].filter(r=>r!==dragEl)
        let placed=false
        for(const r of targets){ const rect=r.getBoundingClientRect(); if(ev.clientY < rect.top+rect.height/2){ list.insertBefore(dragEl,r); placed=true; break } }
        if(!placed && targets.length){ const last=targets[targets.length-1]; list.insertBefore(dragEl,last.nextSibling) }
      }
      const up=async()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up)
        dragEl.style.opacity=''; packDragging=false
        const orderIds=[...list.querySelectorAll('[data-runid]')].map(r=>r.dataset.runid)
        await packPersistOrder(orderIds)
      }
      document.addEventListener('pointermove',move)
      document.addEventListener('pointerup',up)
    })
  })
}
async function packPersistOrder(orderIds){
  const ups=[]
  orderIds.forEach((id,i)=>{ const r=packRuns.find(x=>x.id===id); if(r && r.sort_order!==i){ ups.push(sb.from('sim_pack_runs').update({sort_order:i}).eq('id',id)) } })
  if(ups.length) await Promise.all(ups)
  await loadPacking()
}
window.packSetTarget=async function(){
  const v=prompt('Packing target — meals per hour:', packTarget)
  if(v===null)return
  const n=Number(v); if(!n||isNaN(n)||n<=0){alert('Enter a number greater than 0.');return}
  const {error}=await sb.from('sim_pack_settings').update({target_per_hour:n}).eq('id',1)
  if(error){alert(error.message);return}
  packTarget=n; await loadPacking()
}
window.packNote=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const v=prompt('Note for "'+r.dish_name+'":', r.notes||'')
  if(v===null)return
  const {error}=await sb.from('sim_pack_runs').update({notes:v.trim()||null}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packAddPhoto=function(id){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.setAttribute('capture','environment')
  inp.onchange=async(ev)=>{
    const f=(ev.target.files||[])[0]; if(!f)return
    const ext=(f.name.split('.').pop()||'jpg').toLowerCase()
    const path=`pack/${id}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`
    const up=await sb.storage.from('sim-photos').upload(path,f,{contentType:f.type||'image/jpeg'})
    if(up.error){alert('Photo upload failed: '+up.error.message);return}
    const r=packRuns.find(x=>x.id===id)
    const photos=[...((r&&r.notes_photos)||[]),path]
    const {error}=await sb.from('sim_pack_runs').update({notes_photos:photos}).eq('id',id)
    if(error){alert('Saved photo but could not attach it: '+error.message);return}
    await loadPacking()
  }
  inp.click()
}
window.packDelPhoto=async function(id,path){
  if(!confirm('Remove this photo?'))return
  const r=packRuns.find(x=>x.id===id)
  const photos=((r&&r.notes_photos)||[]).filter(x=>x!==path)
  const {error}=await sb.from('sim_pack_runs').update({notes_photos:photos}).eq('id',id)
  if(error){alert(error.message);return}
  await sb.storage.from('sim-photos').remove([path])
  await loadPacking()
}
window.packSkip=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const reason=prompt('Skip "'+r.dish_name+'"? Add a reason (e.g. not ready):', r.notes||'')
  if(reason===null)return
  const {error}=await sb.from('sim_pack_runs').update({status:'skipped',notes:reason.trim()||null}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packUnskip=async function(id){
  const {error}=await sb.from('sim_pack_runs').update({status:'pending'}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packEditChangeover=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const v=prompt('Changeover for "'+r.dish_name+'" in minutes (blank for none):', r.changeover_mins!=null?r.changeover_mins:'')
  if(v===null)return
  const t=String(v).trim()
  const n=t===''?null:Number(t)
  if(n!=null&&(isNaN(n)||n<0)){alert('Enter a number of minutes (or leave blank).');return}
  const {error}=await sb.from('sim_pack_runs').update({changeover_mins:n}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packAssign=async function(posId,memberId){
  const existing=packAssignments[posId]
  if(existing){ if(memberId){await sb.from('sim_pack_assignments').update({member_id:memberId}).eq('id',existing.id)} else {await sb.from('sim_pack_assignments').delete().eq('id',existing.id)} }
  else if(memberId){ await sb.from('sim_pack_assignments').insert({shift_id:packShift.id,position_id:posId,member_id:memberId}) }
  await loadPacking()
}
window.packAddBreak=async function(){
  const m=$('brkMember').value; if(!m){alert('Pick a person.');return}
  const {error}=await sb.from('sim_pack_breaks').insert({shift_id:packShift.id,member_id:m,break_time:$('brkTime').value.trim()||null,approved_by:$('brkApproved').value.trim()||null})
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packDelBreak=async function(id){ await sb.from('sim_pack_breaks').delete().eq('id',id); await loadPacking() }
window.packImportDishes=async function(){
  const today=new Date().toISOString().slice(0,10)
  const {data:imp}=await sb.from('sim_pack_dish_import').select('*').eq('import_date',today).order('sort_order')
  if(!imp||!imp.length){alert('No dish list found for today yet. The morning import may not have run — you can run it from the Scheduled panel, or it will appear once it does.');return}
  if(packRuns.length && !confirm('Re-load the dish list? This clears the current timings for today.'))return
  const {data:ord}=await sb.from('sim_pack_dish_order').select('*')
  const orderBy={}; (ord||[]).forEach(o=>{orderBy[o.sku]=o.sort_order})
  const rows=imp.map(d=>({sku:d.sku,dish_name:d.dish_name,planned_qty:d.qty,_o:(orderBy[d.sku]!=null?orderBy[d.sku]:1000+d.sort_order)})).sort((a,b)=>a._o-b._o)
  await sb.from('sim_pack_runs').delete().eq('shift_id',packShift.id)
  const ins=rows.map((d,i)=>({shift_id:packShift.id,dish_name:d.dish_name,sku:d.sku,planned_qty:d.planned_qty,sort_order:i,planned_seq:i,status:'pending'}))
  const {error}=await sb.from('sim_pack_runs').insert(ins)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packStartDish=async function(id){
  if(packRuns.some(r=>r.status==='packing')){alert('Finish the current dish first.');return}
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const pendings=packRuns.filter(x=>x.status==='pending').sort((a,b)=>a.sort_order-b.sort_order)
  const expected=pendings[0]
  let reason=null
  if(expected && expected.id!==id){
    reason=prompt('OUT OF SEQUENCE\n\n"'+expected.dish_name+'" (SKU '+(expected.sku||'–')+') is next on the plan but is not done.\n\nWhy are you packing "'+r.dish_name+'" first?')
    if(reason===null)return
    if(!reason.trim()){alert('A reason is required to pack out of sequence.');return}
  }
  const lastLine=(packRuns.find(x=>x.line_count)||{}).line_count
  const def=lastLine||Object.keys(packAssignments).length||''
  const v=prompt('How many people on the line for this dish?', def)
  if(v===null)return
  const n=Math.round(Number(v))
  if(!n||isNaN(n)||n<1){alert('Enter the number of people on the line (1 or more) to start.');return}
  const done=packRuns.filter(x=>x.status==='done'&&x.finish_time).sort((a,b)=>new Date(b.finish_time)-new Date(a.finish_time))
  const co=done.length?Math.round(((Date.now()-new Date(done[0].finish_time))/60000)*10)/10:null
  const maxSeq=packRuns.reduce((m,x)=>Math.max(m,x.pack_seq||0),0)
  const upd={start_time:new Date().toISOString(),status:'packing',changeover_mins:co,line_count:n,pack_seq:maxSeq+1}
  if(reason!==null) upd.out_of_sequence_reason=reason.trim()
  const {error}=await sb.from('sim_pack_runs').update(upd).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packStopDish=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const qtyEl=$('qty_'+id); const qty=(qtyEl&&qtyEl.value!=='')?Number(qtyEl.value):null
  const fin=new Date().toISOString()
  const mins=r.start_time?Math.round(((new Date(fin)-new Date(r.start_time))/60000)*100)/100:null
  const usedQty=(qty!=null?qty:r.planned_qty)
  const rate=(mins&&mins>0&&usedQty!=null)?(usedQty/(mins/60)):null
  // Data-entry guards: an accidental Stop right after Start, or an impossible rate, must not be silently recorded.
  if(mins!=null && mins<0.5){
    const sec=Math.round(mins*60)
    if(confirm('This dish has only been running '+sec+'s — too short to be a real pack.\n\nOK = mis-tap, keep packing (ignore this Stop).\nCancel = finish it anyway.')) return
  } else if(rate!=null && rate>5000){
    if(!confirm('That works out at '+Math.round(rate)+' meals/hr — that is not possible.\n\nCheck qty packed ('+usedQty+') and minutes ('+mins+').\n\nFinish anyway?')) return
  }
  const {error}=await sb.from('sim_pack_runs').update({finish_time:fin,total_minutes:mins,qty_packed:qty,status:'done'}).eq('id',id)
  if(error){alert(error.message);return}
  if(rate!=null){
    alert(r.dish_name+'\n\n'+Math.round(rate)+' meals/hr  (target '+packTarget+'/hr)\n\n'+(rate>=packTarget?'Great — above target! 🎉':'Below target — room to improve.'))
  }
  await loadPacking()
}
window.packDiscard=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  if(!confirm('Cancel the start of "'+r.dish_name+'"? It returns to the dish list with no timing recorded.'))return
  const {error}=await sb.from('sim_pack_runs').update({status:'pending',start_time:null,finish_time:null,total_minutes:null,qty_packed:null,changeover_mins:null,pack_seq:null,line_count:null,out_of_sequence_reason:null}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packSaveDefault=async function(){
  if(!packRuns.length)return
  const rows=packRuns.map((r,i)=>({sku:r.sku,dish_name:r.dish_name,sort_order:i}))
  const {error}=await sb.from('sim_pack_dish_order').upsert(rows,{onConflict:'sku'})
  if(error){alert(error.message);return}
  alert('Saved this order as the default — future days will sort to match.')
}
