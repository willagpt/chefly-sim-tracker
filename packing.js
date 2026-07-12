/* PACKING: team-leader screen — start-of-day positions & breaks, and the day's
   dish run-sheet with sequential start/stop + automatic changeover timing.
   Live: subscribes to realtime + live pace vs an adjustable meals/hour target.
   User-entered / imported free text is escaped with esc() (from ui.js) before innerHTML. */

let packShift=null, packPositions=[], packMembers=[], packAssignments={}, packRuns=[], packBreaks=[], packTimer=null
let packChannel=null, packLiveT=null, packDragging=false, packTarget=500, packComponents={}
let packBom={}, packCompStat={}, packCompName={}   // dish BOM + kitchen component status (cook queue)
let packViewDate=null   // set to a past yyyy-mm-dd to view history read-only
let packShowPlan=false  // dish list toggle: live/packed view vs planned order
const PACK_CO_TARGET=3   // minutes — SKU change target

window.loadPacking=async function(){
  const today=new Date().toISOString().slice(0,10)
  if(packViewDate===today)packViewDate=null
  const qd=packViewDate||today
  let {data:sh}=await sb.from('sim_pack_shifts').select('*').eq('shift_date',qd).maybeSingle()
  if(!sh){
    if(packViewDate){const box=$('packBody');if(box)box.innerHTML='<div class="card"><h2 style="margin-top:0">Packing history</h2>'+packHistoryPicker()+'<p class="muted" style="margin-top:10px">No packing shift recorded on '+esc(packViewDate)+'.</p></div>';return}
    const ins=await sb.from('sim_pack_shifts').insert({shift_date:today,created_by:(me&&me.id)||null}).select().single(); if(ins.error){$('packBody').innerHTML='<div class="card"><p class="muted">'+ins.error.message+'</p></div>';return} sh=ins.data
  }
  packShift=sh
  const [pos,mem,asg,runs,brk,cfg,comp,bomQ,csQ,cnQ]=await Promise.all([
    sb.from('sim_pack_positions').select('*').eq('active',true).order('sort_order'),
    sb.from('sim_pack_members').select('*').eq('active',true).order('sort_order').order('full_name'),
    sb.from('sim_pack_assignments').select('*').eq('shift_id',sh.id),
    sb.from('sim_pack_runs').select('*').eq('shift_id',sh.id).order('sort_order'),
    sb.from('sim_pack_breaks').select('*').eq('shift_id',sh.id).order('created_at'),
    sb.from('sim_pack_settings').select('target_per_hour').eq('id',1).maybeSingle(),
    sb.from('sim_pack_dish_components').select('*'),
    sb.from('sim_dish_bom').select('sku,component_id'),
    sb.from('sim_component_status').select('*').eq('shift_date',qd),
    sb.from('sim_components').select('id,name').eq('active',true)
  ])
  packPositions=pos.data||[]; packMembers=mem.data||[]; packRuns=runs.data||[]; packBreaks=brk.data||[]
  packTarget=(cfg&&cfg.data&&Number(cfg.data.target_per_hour))||500
  packComponents={}; ((comp&&comp.data)||[]).forEach(c=>{packComponents[c.sku]=c.components})
  packAssignments={}; (asg.data||[]).forEach(a=>{packAssignments[a.position_id]=a})
  packBom={}; ((bomQ&&bomQ.data)||[]).forEach(b=>{(packBom[b.sku]=packBom[b.sku]||[]).push(b.component_id)})
  packCompStat={}; ((csQ&&csQ.data)||[]).forEach(s=>{packCompStat[s.component_id]=s.status})
  packCompName={}; ((cnQ&&cnQ.data)||[]).forEach(c=>{packCompName[c.id]=c.name})
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
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_dish_components'},packLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_component_status'},packLiveRefresh)
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
function packMemberOptions(sel){return '<option value="">— unassigned —</option>'+packMembers.map(m=>`<option value="${m.id}" ${sel===m.id?'selected':''}>${esc(m.full_name)}</option>`).join('')}
function packCompCount(sku){return (sku!=null&&packComponents[sku]!=null)?packComponents[sku]:null}
function packRate(r){ // meals per hour for a finished dish
  const q=(r.qty_packed!=null?r.qty_packed:r.planned_qty)
  if(!r.total_minutes||r.total_minutes<=0||q==null) return null
  return q/(r.total_minutes/60)
}
function _daySpan(a,b){if(!a||!b)return '';let m=Math.round((new Date(b)-new Date(a))/60000);if(m<0)m=0;const h=Math.floor(m/60);m=m%60;return (h?h+'h ':'')+m+'m'}
function renderPacking(){
  const box=$('packBody'); if(!box)return
  const viewing=!!packViewDate
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
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Packing — ${packShift.shift_date}</h2>${viewing?'<span class="pill off">📅 history</span>':`<span class="pill ${packing?'live':'off'}">${packing?'● PACKING':'idle'}</span>`}</div>
    <div class="stat-grid" style="margin-top:10px">
      <div class="stat"><div class="n">${done.length}/${packRuns.length}</div><div class="l">Dishes</div></div>
      <div class="stat"><div class="n">${packedMeals}</div><div class="l">Packed</div></div>
      <div class="stat"><div class="n">${plannedMeals}</div><div class="l">Planned</div></div>
    </div>
    <p class="muted" style="margin-top:8px">Changeovers: ${avgCo!=null?avgCo.toFixed(1)+'m avg':'–'} · <span class="${overCount?'vs-bad':'vs-good'}">${overCount} over ${PACK_CO_TARGET}-min</span>${skipped?' · '+skipped+' skipped':''}</p>
    <p class="muted" style="margin-top:2px">Target: <b style="color:var(--txt)">${packTarget}/hr</b> <a class="link" onclick="packSetTarget()">adjust</a></p>
    <button class="ghost sm" style="margin-top:8px" onclick="packEodReport()">\u{1F4C4} End-of-day report (PDF)</button>
    ${packHistoryPicker()}
  </div>`

  html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Dish list</h2><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">`
  html+=`<button class="ghost sm" onclick="packGuides()">🖨 Packing guides (PDF)</button>`
  if(packRuns.length) html+=`<button class="ghost sm" onclick="packTogglePlan()">${packShowPlan?'Live view':'Plan order'}</button><button class="ghost sm" onclick="packPlanReport()">Print plan (PDF)</button>`
  if(packRuns.length&&!viewing&&!packShowPlan) html+=`<button class="ghost sm" onclick="packSaveDefault()">Save order</button>`
  html+=`</span></div>`
  if(!packRuns.length){
    html+=viewing?`<p class="muted">No dishes were loaded on this day.</p>`:`<p class="muted">No dishes loaded for today yet.</p><button class="green" onclick="packImportDishes()">Load today's dish list</button>`
  } else if(packShowPlan){
    html+=packPlanList()
  } else {
    if(!viewing)html+=packActionPanel(packing,next)
    const _plannedSorted=[...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
    const _plannedRank={}; _plannedSorted.forEach((r,i)=>{_plannedRank[r.id]=i+1})
    const started=packRuns.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq)
    const pending=packRuns.filter(r=>r.status==='pending').sort((a,b)=>a.sort_order-b.sort_order)
    const skippedRuns=packRuns.filter(r=>r.status==='skipped').sort((a,b)=>a.sort_order-b.sort_order)
    if(started.length){
      const _startTimes=started.map(r=>r.start_time).filter(Boolean).sort()
      const _finTimes=started.map(r=>r.finish_time).filter(Boolean).sort()
      const _dayStart=_startTimes[0]||null, _dayEnd=_finTimes.length?_finTimes[_finTimes.length-1]:null
      html+=`<p class="muted" style="margin:14px 0 4px">Packed today — in the order it was done. <span style="color:#fcd34d">moved from #</span> = different from the plan.</p>`
      if(_dayStart) html+=`<div class="muted" style="font-size:13px;margin:-2px 0 8px">🕒 Day: <b style="color:var(--txt)">${fmtTime(_dayStart)}</b> → <b style="color:var(--txt)">${_dayEnd?fmtTime(_dayEnd):'in progress'}</b>${(_dayStart&&_dayEnd)?' · '+_daySpan(_dayStart,_dayEnd)+' elapsed':''}</div>`
      started.forEach((r,i)=>{ html+=packedRunRow(r,i+1,_plannedRank[r.id]) })
    }
    if(viewing){
      if(pending.length){ html+=`<p class="muted" style="margin:16px 0 4px">Never started</p>`; pending.forEach(r=>{ html+=packHistRow(r) }) }
    } else {
      html+=`<p class="muted" style="margin:16px 0 4px">Still to pack — drag ⠿ to reorder.</p><div id="packDishList">`
      if(pending.length){ pending.forEach(r=>{ html+=packRunRow(r) }) }
      else { html+=`<p class="muted">Nothing left in the queue — every dish has been started. 🎉</p>` }
      html+='</div>'
    }
    if(skippedRuns.length){
      html+=`<p class="muted" style="margin:16px 0 4px">Skipped</p>`
      skippedRuns.forEach(r=>{ html+=viewing?packHistRow(r):packRunRow(r) })
    }
    if(!viewing)html+='<button class="ghost sm" style="margin-top:10px" onclick="packImportDishes()">Re-load from sheet (clears timings)</button>'
  }
  html+='</div>'

  html+=`<div class="card"><h2>Team &amp; positions</h2>`
  if(viewing){
    const asgn=packPositions.map(p=>{const a=packAssignments[p.id];return a?`<div style="font-size:13px;margin-bottom:4px"><span class="muted">${esc(p.label)}:</span> <b>${esc(packMemberName(a.member_id))}</b></div>`:''}).join('')
    html+=asgn||'<p class="muted">No roster recorded for this day.</p>'
  } else {
    if(!packMembers.length) html+=`<p class="muted">No packing roster yet. An admin adds people in Manage → Packing team.</p>`
    packPositions.forEach(p=>{
      const a=packAssignments[p.id]
      html+=`<div style="margin-bottom:8px"><div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:3px">${esc(p.label)}</div><select onchange="packAssign('${p.id}',this.value)">${packMemberOptions(a?a.member_id:'')}</select></div>`
    })
  }
  html+='</div>'

  if(viewing){
    html+=`<div class="card"><h2>Breaks</h2>`
    html+=packBreaks.length?packBreaks.map(b=>`<div class="task-item"><div><b>${esc(packMemberName(b.member_id))}</b><div class="meta">${brkDuration(b)}${b.approved_by?' · '+esc(b.approved_by):''}</div></div></div>`).join(''):'<p class="muted">No breaks recorded.</p>'
    html+='</div>'
    box.innerHTML=html
    return
  }
  const onBreak=packBreaks.filter(b=>b.started_at&&!b.ended_at)
  const loggedBreaks=packBreaks.filter(b=>!(b.started_at&&!b.ended_at))
  html+=`<div class="card"><h2>Breaks <span class="pill ${onBreak.length?'live':'off'}">${onBreak.length} on break now</span></h2>`
  if(onBreak.length){
    html+='<div style="margin-bottom:10px">'+onBreak.map(b=>`<div class="task-item" style="background:rgba(245,158,11,.12);border-color:var(--amber)"><div><b>${esc(packMemberName(b.member_id))}</b><div class="meta">⏸ on break · <span class="brk-elapsed" data-start="${b.started_at}">0:00</span>${b.approved_by?' · '+esc(b.approved_by):''}</div></div><button class="green sm" onclick="packEndBreak('${b.id}')">◀ Back</button></div>`).join('')+'</div>'
  } else html+='<p class="muted">Everyone is on the line — nobody on break.</p>'
  html+=`<select id="brkMember">${packMemberOptions('')}</select>
    <div class="row" style="margin-top:8px"><input id="brkApproved" placeholder="Approved by (optional)" /></div>
    <button class="green" onclick="packStartBreak()">⏸ Send on break</button>`
  if(loggedBreaks.length){
    html+='<p class="muted" style="margin:12px 0 4px">Earlier today</p>'+loggedBreaks.slice(-8).reverse().map(b=>`<div class="task-item"><div><b>${esc(packMemberName(b.member_id))}</b><div class="meta">${brkDuration(b)}${b.approved_by?' · '+esc(b.approved_by):''}</div></div><button class="ghost sm" onclick="packDelBreak('${b.id}')">✕</button></div>`).join('')
  }
  html+='</div>'

  html+=packRulesCard()
  box.innerHTML=html
  packAttachDnD()
}
function packDishReadiness(sku){
  const ids=packBom[sku]
  if(!ids||!ids.length)return {state:'unknown',missing:[]}
  const missing=ids.filter(id=>packCompStat[id]!=='ready').map(id=>packCompName[id]||'component')
  return missing.length?{state:'blocked',missing:missing}:{state:'ready',missing:[]}
}
function packReadyBadge(sku){
  if(packViewDate)return ''
  const rd=packDishReadiness(sku)
  if(rd.state==='ready')return ' <span class="pill" style="background:rgba(34,197,94,.18);color:#86efac">kitchen ready</span>'
  if(rd.state==='blocked')return ' <span class="pill" style="background:rgba(239,68,68,.18);color:#fca5a5">waiting on kitchen</span>'
  return ''
}
function packMissingLine(sku){
  if(packViewDate)return ''
  const rd=packDishReadiness(sku)
  if(rd.state!=='blocked')return ''
  const list=rd.missing.slice(0,4).map(esc).join(', ')+(rd.missing.length>4?' +'+(rd.missing.length-4)+' more':'')
  return '<div style="color:#fca5a5;font-size:12px;margin-top:4px">Kitchen still cooking: '+list+'</div>'
}
function packActionPanel(packing,next){
  if(packing){
    const tmin=(packTarget&&packing.planned_qty)?(packing.planned_qty/packTarget*60):null
    return `<div class="card" style="background:var(--panel2);border-color:var(--accent);text-align:center;margin:6px 0 0">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.5px">NOW PACKING · SKU ${packing.sku||'–'}${packCompCount(packing.sku)!=null?' · 🧩 '+packCompCount(packing.sku)+' components':''}${packing.line_count?' · '+packing.line_count+' on line':''}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${esc(packing.dish_name)}</div>
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
      <div style="font-size:19px;font-weight:800;margin:2px 0">${esc(next.dish_name)}</div>
      <div class="muted" style="margin-bottom:2px"><b style="font-size:22px;color:var(--txt)">${next.planned_qty??'–'}</b> to pack · 🧩 <b style="color:var(--txt)">${packCompCount(next.sku)!=null?packCompCount(next.sku):'–'}</b> components <a class="link" style="font-size:13px" onclick="packSetComponents('${next.sku}')">edit</a></div>
      ${packReadyBadge(next.sku)?'<div style="margin:2px 0">'+packReadyBadge(next.sku)+'</div>':''}${packMissingLine(next.sku)}
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
  const photoStrip=photoThumbs(photos,48)
  const handle=r.status==='pending'?`<span class="drag-h" style="cursor:grab;touch-action:none;user-select:none;padding:2px 4px;font-size:18px;color:var(--muted)">⠿</span>`:''
  const skuBlock=`<div style="flex:0 0 auto;text-align:center;min-width:38px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:20px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div>`
  const planBlock=`<div style="flex:0 0 auto;text-align:center;min-width:42px"><div style="font-size:20px;font-weight:900;line-height:1">${r.planned_qty??'–'}</div><div style="font-size:10px;color:var(--muted)">PLAN</div></div>`
  const notesLine=r.notes?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">📝 ${esc(r.notes)}</div>`:''
  const _comp=packCompCount(r.sku)
  const compChip=` · <a class="link" style="font-size:13px" onclick="packSetComponents('${r.sku}')">🧩 ${_comp!=null?_comp+' comp':'set comp'}</a>`
  return `<div class="task-item" data-runid="${r.id}" data-pending="${r.status==='pending'?'1':'0'}" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;align-items:center;gap:10px">${handle}${skuBlock}<b style="flex:1;min-width:0;font-size:15px">${esc(r.dish_name)}</b>${planBlock}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">${pill}${r.status==='pending'?packReadyBadge(r.sku):''}${co}${compChip}</span><span style="flex-shrink:0;display:flex;gap:12px;align-items:center">${photoLink}${noteLink}${act}</span></div>
    ${notesLine}
    ${photoStrip}
  </div>`
}
function packedRunRow(r,actualPos,plannedPos){
  const moved=plannedPos!=null&&plannedPos!==actualPos
  const movedBadge=moved?` <span class="pill" style="background:rgba(245,158,11,.18);color:#fcd34d">moved from #${plannedPos}</span>`:''
  const status=r.status==='packing'?'<span class="pill live">● packing</span>':'<span class="pill done">done</span>'
  const rt=packRate(r); const rtTxt=rt!=null?` · <span class="${rt>=packTarget?'vs-good':'vs-bad'}">${Math.round(rt)}/hr</span>`:''
  const coTxt=r.changeover_mins!=null?` · CO ${r.changeover_mins.toFixed(1)}m`:(actualPos===1?' · start of day':' · CO —')
  const detail=[r.total_minutes!=null?r.total_minutes+' min':'', r.line_count?r.line_count+'p':'', r.qty_packed!=null?r.qty_packed+' packed':''].filter(Boolean).join(' · ')
  const _sc=r.start_time?fmtTime(r.start_time):null
  const _fc=r.finish_time?fmtTime(r.finish_time):null
  const clockLine=(_sc||_fc)?`<div class="muted" style="font-size:12px;margin-top:2px">🕒 ${_sc||'—'} → ${_fc||'running…'}${detail?' · '+detail:''}</div>`:(detail?`<div class="muted" style="font-size:12px;margin-top:2px">${detail}</div>`:'')
  const reason=r.out_of_sequence_reason?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">↳ ${esc(r.out_of_sequence_reason)}</div>`:''
  const notesLine=r.notes?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">📝 ${esc(r.notes)}</div>`:''
  const photos=r.notes_photos||[]
  const photoStrip=photoThumbs(photos,48)
  const qtyShown=r.qty_packed!=null?r.qty_packed:(r.planned_qty??'–')
  return `<div class="task-item" data-runid="${r.id}" style="flex-direction:column;align-items:stretch;gap:4px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:0 0 auto;text-align:center;min-width:26px"><div style="font-size:10px;color:var(--muted)">#</div><div style="font-size:20px;font-weight:900;line-height:1">${actualPos}</div></div>
      <div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div>
      <b style="flex:1;min-width:0;font-size:15px">${esc(r.dish_name)}</b>
      <div style="flex:0 0 auto;text-align:center;min-width:44px"><div style="font-size:18px;font-weight:900;line-height:1">${qtyShown}</div><div style="font-size:10px;color:var(--muted)">PACKED</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">${status}${movedBadge}${coTxt}${rtTxt}</span><span style="flex-shrink:0;display:flex;gap:12px;align-items:center"><a class="link" style="font-size:12px" onclick="packAddPhoto('${r.id}')">📷 ${photos.length?'('+photos.length+')':'Photo'}</a><a class="link" style="font-size:12px" onclick="packNote('${r.id}')">📝 ${r.notes?'Edit':'Note'}</a></span></div>
    ${clockLine}
    ${reason}
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
    const reason=r.out_of_sequence_reason?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">↳ ${esc(r.out_of_sequence_reason)}</div>`:''
    const status=r.status==='packing'?'<span class="pill live">● packing</span>':'<span class="pill done">done</span>'
    return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px;min-width:26px">#${actual}</b><span style="background:rgba(249,115,22,.18);color:var(--accent);font-weight:900;border-radius:6px;padding:1px 8px">${r.sku||'–'}</span><b style="flex:1;min-width:0">${esc(r.dish_name)}</b>${status}${movedBadge}</div><div class="muted" style="font-size:12px">${r.total_minutes!=null?r.total_minutes+' min pack':''}${coTxt}</div>${reason}</div>`
  }).join('')
  return `<div class="card"><h2>Actual packed order</h2><p class="muted" style="margin-top:-8px">The real sequence packed today, with pack time and changeover (CO) into each dish${movedAny?'. Dishes that moved from the plan are flagged with the reason given':''}.</p>${rows}</div>`
}
function brkDuration(b){
  if(b.started_at&&b.ended_at){ return Math.max(1,Math.round((new Date(b.ended_at)-new Date(b.started_at))/60000))+' min' }
  if(b.break_time){ return 'at '+esc(b.break_time) }
  return '—'
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
  document.querySelectorAll('.brk-elapsed').forEach(el=>{const st=el.dataset.start; if(st){el.textContent=fmtClock((Date.now()-new Date(st))/1000)}})
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
window.packSetComponents=async function(sku){
  if(sku==null||sku===''){alert('This dish has no SKU.');return}
  const cur=packComponents[sku]
  const v=prompt('How many components for SKU '+sku+'? (number of items to assemble — used to judge how many people to put on the line)', cur!=null?cur:'')
  if(v===null)return
  const t=String(v).trim()
  if(t===''){ await sb.from('sim_pack_dish_components').delete().eq('sku',sku); await loadPacking(); return }
  const n=Math.round(Number(t))
  if(isNaN(n)||n<0){alert('Enter a whole number (0 or more).');return}
  const {error}=await sb.from('sim_pack_dish_components').upsert({sku,components:n,updated_at:new Date().toISOString()},{onConflict:'sku'})
  if(error){alert(error.message);return}
  await loadPacking()
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
window.packStartBreak=async function(){
  const m=$('brkMember').value; if(!m){alert('Pick a person.');return}
  const {error}=await sb.from('sim_pack_breaks').insert({shift_id:packShift.id,member_id:m,started_at:new Date().toISOString(),approved_by:($('brkApproved').value||'').trim()||null})
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packEndBreak=async function(id){
  const {error}=await sb.from('sim_pack_breaks').update({ended_at:new Date().toISOString()}).eq('id',id)
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
  const rdy=packViewDate?{state:'unknown',missing:[]}:packDishReadiness(r.sku)
  if(rdy.state==='blocked'){
    const list=rdy.missing.slice(0,6).join(', ')+(rdy.missing.length>6?' +'+(rdy.missing.length-6)+' more':'')
    if(!confirm('KITCHEN NOT READY\n\n"'+r.dish_name+'" is still waiting on: '+list+'.\n\nStart it anyway?'))return
  }
  let reason=null
  if(expected && expected.id!==id){
    const prefill=rdy.state==='blocked'?('Components not ready: '+rdy.missing.slice(0,3).join(', ')):''
    reason=prompt('OUT OF SEQUENCE\n\n"'+expected.dish_name+'" (SKU '+(expected.sku||'–')+') is next on the plan but is not done.\n\nWhy are you packing "'+r.dish_name+'" first?',prefill)
    if(reason===null)return
    if(!reason.trim()){alert('A reason is required to pack out of sequence.');return}
  } else if(rdy.state==='blocked'){
    reason='Started before kitchen ready: '+rdy.missing.slice(0,3).join(', ')
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

/* ---------- END-OF-DAY REPORT (PDF download) ----------
   Page 1: management summary (KPIs, speed, changeover, sequence, skips,
   issue themes + recommendation). Page 2: full run-sheet appendix.
   Built client-side with jsPDF + autoTable (lazy-loaded from cdnjs). */
function _eodClock(t){if(!t)return '–';const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function _eodTheme(txt){
  const t=String(txt||'').toLowerCase()
  if(!t.trim())return null
  if(t.indexOf('kaja')>=0)return 'Verbal instruction (Kaja)'
  if(t.indexOf('frozen')>=0)return 'Product frozen'
  if(t.indexOf('not ready')>=0||t.indexOf('not started')>=0)return 'Not ready'
  if(t.indexOf('tomorrow')>=0)return 'Deferred to tomorrow'
  if(t.indexOf('short')>=0)return 'Ran short mid-pack'
  if(t.indexOf('rice')>=0||t.indexOf('tray')>=0||t.indexOf('meatball')>=0||t.indexOf('no ')===0)return 'Component missing'
  if(/\b(done|already|ready)\b/.test(t))return 'Already done / in stock'
  return 'Other'
}
const _EOD_RECS={
  'Product frozen':'Add a pre-shift readiness check: confirm each dish is thawed and ready before the run order is locked.',
  'Not ready':'Add a pre-shift readiness check: confirm each dish is ready before the run order is locked.',
  'Component missing':'Add a pre-shift component check (rice, trays, proteins) before the run order is locked.',
  'Verbal instruction (Kaja)':'Route every sequence change through this screen so verbal instructions are captured against the plan.',
  'Already done / in stock':'Net stock on hand off the plan before importing the dish list.',
  'Ran short mid-pack':'Pause and flag shortages instead of closing dishes under-supplied.',
  'Deferred to tomorrow':'Carry deferred dishes into the next import so they are not lost.',
  'Other':'Review the notes with the team leader at the morning huddle.'
}
function _eodScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('Could not load '+src+' — check the internet connection.'));document.head.appendChild(s)})}
async function _eodLibs(){
  if(!(window.jspdf&&window.jspdf.jsPDF)) await _eodScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  if(!(window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)) await _eodScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
}
function _eodCompute(){
  const done=packRuns.filter(r=>r.status==='done')
  const skipped=packRuns.filter(r=>r.status==='skipped')
  const open=packRuns.filter(r=>r.status==='pending'||r.status==='packing')
  const plannedMeals=packRuns.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const packedMeals=done.reduce((s,r)=>s+(r.qty_packed!=null?Number(r.qty_packed):(Number(r.planned_qty)||0)),0)
  const skippedMeals=skipped.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const plannedSorted=[...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
  const plannedRank={}; plannedSorted.forEach((r,i)=>{plannedRank[r.id]=i+1})
  const packedOrder=done.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq)
  const rows=packedOrder.length?packedOrder:done
  const starts=done.map(r=>r.start_time).filter(Boolean).sort()
  const fins=done.map(r=>r.finish_time).filter(Boolean).sort()
  const dayStart=starts[0]||null, dayEnd=fins.length?fins[fins.length-1]:null
  const elapsedMin=(dayStart&&dayEnd)?Math.max(1,(new Date(dayEnd)-new Date(dayStart))/60000):null
  const throughput=elapsedMin?(packedMeals/(elapsedMin/60)):null
  rows.forEach((r,i)=>{
    const q=(r.qty_packed!=null?Number(r.qty_packed):Number(r.planned_qty))
    r._rate=(r.total_minutes&&r.total_minutes>0&&q!=null)?(q/(r.total_minutes/60)):null
    r._excl=null
    if(r.total_minutes!=null&&r.total_minutes<1)r._excl='mistimed'
    else if(r._rate!=null&&r._rate>packTarget*1.8)r._excl='mistimed'
    else if(i===0&&r.total_minutes!=null&&r.total_minutes>60)r._excl='incl. start-up'
  })
  const clean=rows.filter(r=>!r._excl&&r._rate!=null)
  const cleanQty=clean.reduce((s,r)=>s+(r.qty_packed!=null?Number(r.qty_packed):Number(r.planned_qty)||0),0)
  const cleanMin=clean.reduce((s,r)=>s+Number(r.total_minutes),0)
  const avgRate=cleanMin>0?(cleanQty/(cleanMin/60)):null
  const hit=clean.filter(r=>r._rate>=packTarget).length
  const srt=[...clean].sort((a,b)=>b._rate-a._rate)
  const cos=rows.filter(r=>r.changeover_mins!=null)
  const coTotal=cos.reduce((s,r)=>s+Number(r.changeover_mins),0)
  const coAvg=cos.length?coTotal/cos.length:null
  const coOver=cos.filter(r=>Number(r.changeover_mins)>PACK_CO_TARGET).sort((a,b)=>b.changeover_mins-a.changeover_mins)
  const moved=packedOrder.filter((r,i)=>plannedRank[r.id]!=null&&plannedRank[r.id]!==(i+1))
  const themes={}; let kajaMentions=0
  const addTheme=(txt,r,isSkip)=>{
    const th=_eodTheme(txt); if(!th)return
    if(String(txt).toLowerCase().indexOf('kaja')>=0)kajaMentions++
    if(!themes[th])themes[th]={n:0,meals:0,skips:0}
    themes[th].n++; if(isSkip){themes[th].skips++;themes[th].meals+=(Number(r.planned_qty)||0)}
  }
  done.forEach(r=>{addTheme(r.out_of_sequence_reason,r,false); if(r.notes&&_eodTheme(r.notes)!==_eodTheme(r.out_of_sequence_reason))addTheme(r.notes,r,false)})
  skipped.forEach(r=>{addTheme(r.notes,r,true)})
  const themeList=Object.keys(themes).map(k=>({k,...themes[k]})).sort((a,b)=>b.n-a.n)
  const dominant=themeList.length?themeList[0].k:null
  const skipGroups={}
  skipped.forEach(r=>{const th=_eodTheme(r.notes)||'No reason logged'; if(!skipGroups[th])skipGroups[th]={n:0,meals:0}; skipGroups[th].n++; skipGroups[th].meals+=(Number(r.planned_qty)||0)})
  const crew=new Set(Object.values(packAssignments).map(a=>a.member_id).filter(Boolean)).size
  const supAsg=packPositions.filter(p=>/supervisor/i.test(p.label)).map(p=>packAssignments[p.id]).find(Boolean)
  const supervisor=supAsg?packMemberName(supAsg.member_id):null
  const doneBreaks=packBreaks.filter(b=>b.started_at&&b.ended_at)
  const brkSpan=doneBreaks.length?(_eodClock(doneBreaks.map(b=>b.started_at).sort()[0])+'–'+_eodClock(doneBreaks.map(b=>b.ended_at).sort().slice(-1)[0])):null
  return {done,skipped,open,plannedMeals,packedMeals,skippedMeals,plannedRank,rows,dayStart,dayEnd,elapsedMin,throughput,
    clean,avgRate,hit,srt,cos,coTotal,coAvg,coOver,moved,themeList,dominant,kajaMentions,
    mistimed:rows.filter(r=>r._excl==='mistimed'),startup:rows.filter(r=>r._excl==='incl. start-up'),
    skipGroups,crew,supervisor,doneBreaks,brkSpan}
}
window.packEodReport=async function(){
  if(!packShift||!packRuns.length){alert('No dishes for today yet — nothing to report.');return}
  if(!packRuns.some(r=>r.status==='done')){alert('No finished dishes yet — the report needs at least one packed dish.');return}
  try{await _eodLibs()}catch(e){alert(e.message);return}
  const S=_eodCompute()
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28, H=841.89, M=34
  const INK=[28,26,25], ORANGE=[232,84,29], GREY=[138,133,128], LINE=[220,215,209], SOFT=[236,232,227]
  const t=(x,y,s,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y)}
  const tr=(x,y,s,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y,{align:'right'})}
  const sec=(x,y,w,title)=>{t(x,y,title,9,'bold',ORANGE);doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(x,y+3.5,x+w,y+3.5);return y+15}
  const para=(x,y,w,s,size,style,col,lh)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);const L=doc.splitTextToSize(String(s),w);doc.text(L,x,y);return y+L.length*(lh||size*1.35)}
  const mini=(x,y,w,head,body,widths)=>{doc.autoTable({startY:y,margin:{left:x},tableWidth:w,theme:'plain',
    styles:{font:'helvetica',fontSize:7.6,cellPadding:{top:1.8,bottom:1.8,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.6,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:widths,head:[head],body});return doc.lastAutoTable.finalY+8}
  const header=(sub)=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,54,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,54,'F')
    t(M,24,'PACKING — END OF DAY',15,'bold',[251,250,248])
    doc.setCharSpace&&doc.setCharSpace(0)
    const dateStr=new Date(packShift.shift_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    t(M,40,dateStr+(S.supervisor?'  ·  Supervisor: '+S.supervisor:'')+(S.crew?'  ·  Crew of '+S.crew:''),9,'normal',[201,194,187])
    tr(W-M,24,'SHIFT '+_eodClock(S.dayStart)+' – '+_eodClock(S.dayEnd),10,'bold',[251,250,248])
    if(S.elapsedMin)tr(W-M,40,Math.floor(S.elapsedMin/60)+'h '+String(Math.round(S.elapsedMin%60)).padStart(2,'0')+'m elapsed',9,'normal',[201,194,187])
    if(sub)t(M,54+14,sub,8,'bolditalic',GREY)
  }
  const footer=(p,n)=>{
    doc.setDrawColor.apply(doc,LINE);doc.line(M,H-30,W-M,H-30)
    t(M,H-20,'Target '+packTarget+' meals/hr · Changeover target '+PACK_CO_TARGET+' min'+(S.brkSpan?' · Breaks staggered '+S.brkSpan+' ('+S.doneBreaks.length+' taken)':'')+' · Generated '+new Date().toLocaleString('en-GB'),7,'normal',GREY)
    tr(W-M,H-20,'Chefly SIM Tracker · page '+p+' of '+n,7,'normal',GREY)
  }

  /* ---- PAGE 1 : SUMMARY ---- */
  header(S.open.length?(packViewDate?('NOTE — '+S.open.length+' dish(es) were never finished on this day.'):('INTERIM — '+S.open.length+' dish(es) still open; re-run at end of day.')):null)
  let y=S.open.length?86:78
  // KPI band
  const pct=S.plannedMeals?Math.round(S.packedMeals/S.plannedMeals*100):0
  doc.setFillColor(255,255,255);doc.setDrawColor.apply(doc,LINE);doc.rect(M,y,W-2*M,58,'FD')
  t(M+14,y+34,S.packedMeals.toLocaleString(),28,'bold',INK)
  const bw=doc.getTextWidth(S.packedMeals.toLocaleString())
  t(M+14+bw+6,y+34,'/ '+S.plannedMeals.toLocaleString()+'  ('+pct+'%)',12,'normal',GREY)
  t(M+14,y+48,'MEALS PACKED VS PLANNED',6.8,'bold',GREY)
  const ks=[[S.done.length+' / '+packRuns.length,'DISHES',S.skipped.length+' skipped · '+S.skippedMeals+' meals'],
    [(S.avgRate!=null?Math.round(S.avgRate):'–')+' / '+packTarget,'PACK RATE MEALS/HR',S.hit+' of '+S.clean.length+' dishes hit target'],
    [(S.throughput!=null?Math.round(S.throughput):'–')+'/hr','DAY THROUGHPUT','incl. changeovers + gaps'],
    [(S.coAvg!=null?S.coAvg.toFixed(1)+'m':'–'),'AVG CHANGEOVER',S.coOver.length+' over '+PACK_CO_TARGET+'m · '+Math.round(S.coTotal)+'m total']]
  const kx0=M+218, kw=(W-M-kx0)/4
  ks.forEach((k,i)=>{const kx=kx0+i*kw
    doc.setDrawColor.apply(doc,SOFT);doc.line(kx,y+8,kx,y+50)
    t(kx+8,y+24,k[0],12,'bold',INK);t(kx+8,y+35,k[1],6.4,'bold',GREY)
    doc.setFontSize(6.8);doc.setTextColor.apply(doc,GREY);doc.setFont('helvetica','normal')
    doc.text(doc.splitTextToSize(k[2],kw-12),kx+8,y+44)})
  y+=74
  const colw=(W-2*M-22)/2, L=M, R=M+colw+22
  // LEFT: speed
  let yL=sec(L,y,colw,'SPEED')
  yL=para(L,yL,colw,'Average '+(S.avgRate!=null?Math.round(S.avgRate):'–')+' meals/hr — '+(S.avgRate!=null?Math.round((packTarget-S.avgRate)/packTarget*100)+'% below the '+packTarget+' target.':''),8.4,'bold')+2
  const fastest=S.srt.slice(0,3).map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Math.round(r._rate)+'/hr'])
  const slowest=S.srt.slice(-3).reverse().map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Math.round(r._rate)+'/hr'])
  yL=mini(L,yL,colw,['','FASTEST',''],fastest,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right',fontStyle:'bold'}})
  yL=mini(L,yL,colw,['','SLOWEST',''],slowest,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right'}})
  // LEFT: changeover
  yL=sec(L,yL+2,colw,'CHANGEOVER')
  yL=para(L,yL,colw,(S.coAvg!=null?S.coAvg.toFixed(1):'–')+' min average vs '+PACK_CO_TARGET+'-min target · '+Math.round(S.coTotal)+' min lost in total.',8.4,'bold')+2
  const coRows=S.coOver.slice(0,4).map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Number(r.changeover_mins).toFixed(1)+'m'])
  if(coRows.length)yL=mini(L,yL,colw,['','LONGEST CHANGEOVERS',''],coRows,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right',fontStyle:'bold'}})
  if(S.coOver.length>4)yL=para(L,yL,colw,'+ '+(S.coOver.length-4)+' more over target.',7.4,'normal',GREY)+2
  // RIGHT: sequence
  let yR=sec(R,y,colw,'SEQUENCE VS PLAN')
  yR=para(R,yR,colw,S.moved.length+' of '+S.done.length+' dishes packed out of plan order.',8.4,'bold')+2
  const seqMix=S.themeList.filter(x=>x.k!=='Other').slice(0,4).map(x=>x.n+'× '+x.k).join(' · ')
  if(seqMix)yR=para(R,yR,colw,seqMix,7.8,'normal',GREY)+4
  // RIGHT: skipped
  yR=sec(R,yR,colw,'SKIPPED — '+S.skipped.length+' DISHES · '+S.skippedMeals+' MEALS')
  const sg=Object.keys(S.skipGroups).map(k=>[k,S.skipGroups[k].n+' dishes',S.skipGroups[k].meals+' meals']).sort((a,b)=>parseInt(b[2])-parseInt(a[2]))
  if(sg.length)yR=mini(R,yR,colw,['REASON','',''],sg,{1:{cellWidth:44,halign:'right'},2:{cellWidth:44,halign:'right',fontStyle:'bold'}})
  // RIGHT: data quality
  if(S.mistimed.length||S.startup.length){
    yR=sec(R,yR+2,colw,'DATA QUALITY')
    if(S.mistimed.length)yR=para(R,yR,colw,S.mistimed.map(r=>'#'+r.sku).join(', ')+' mistimed (impossible rate) — excluded from speed stats. Check start/stop discipline.',7.6,'normal',GREY)+2
    if(S.startup.length)yR=para(R,yR,colw,S.startup.map(r=>'#'+r.sku).join(', ')+' includes line start-up — excluded from the rate average.',7.6,'normal',GREY)+2
  }
  // BOTTOM: issues
  let yB=Math.max(yL,yR)+8
  yB=sec(M,yB,W-2*M,'ISSUES — WHAT DROVE THE DAY OFF PLAN')
  const th=S.themeList.map(x=>[x.k,String(x.n),x.skips?(x.skips+' skipped · '+x.meals+' meals'):''])
  if(th.length){yB=mini(M,yB,(W-2*M)/2-10,['THEME','N','IMPACT'],th,{1:{cellWidth:22,halign:'right',fontStyle:'bold'},2:{cellWidth:80}})}
  else yB=para(M,yB,W-2*M,'No disruptions logged — clean day.',8.4,'normal')+4
  const ax=M+(W-2*M)/2+10, aw=(W-2*M)/2-10
  // analysis text sits to the right of the theme table
  let yAn=(th.length?doc.lastAutoTable.settings.startY+8:yB)
  if(S.kajaMentions)yAn=para(ax,yAn+2,aw,S.kajaMentions+' notes reference an instruction from Kaja — the sequence was changed verbally, off-plan.',7.8,'bold')+3
  const readiness=(S.themeList.find(x=>x.k==='Product frozen')||{n:0}).n+(S.themeList.find(x=>x.k==='Not ready')||{n:0}).n+(S.themeList.find(x=>x.k==='Component missing')||{n:0}).n
  if(readiness)yAn=para(ax,yAn,aw,readiness+' disruptions were product not ready to pack (frozen, missing components, not made) — upstream readiness, not line speed.',7.8,'normal')+3
  const already=(S.themeList.find(x=>x.k==='Already done / in stock')||{n:0}).n
  if(already)yAn=para(ax,yAn,aw,already+' dishes were found already packed — stock on hand never made it into the plan.',7.8,'normal',GREY)+3
  // recommendation — readiness themes act as one group when together they outweigh the top single theme
  const readinessN=['Product frozen','Not ready','Component missing'].reduce((s,k)=>{const x=S.themeList.find(t=>t.k===k);return s+(x?x.n:0)},0)
  let rec=S.dominant?_EOD_RECS[S.dominant]:'Clean day — no disruptions logged.'
  if(S.dominant&&readinessN>=(S.themeList[0]?S.themeList[0].n:0))rec='Add a pre-shift readiness check — thaw, components and stock confirmed per dish before the run order is locked ('+readinessN+' disruptions were product not ready to pack).'
  const recY=Math.max(yB,yAn)+6
  doc.setFont('helvetica','bold');doc.setFontSize(9.2)
  const recLines=doc.splitTextToSize(rec,W-2*M-20)
  const recH=22+recLines.length*12
  doc.setFillColor.apply(doc,ORANGE);doc.rect(M,recY,W-2*M,recH,'F')
  t(M+10,recY+13,'RECOMMENDATION',6.6,'bold',[248,205,184])
  doc.setFont('helvetica','bold');doc.setFontSize(9.2);doc.setTextColor(255,255,255)
  doc.text(recLines,M+10,recY+26)

  /* ---- PAGE 2+ : RUN SHEET APPENDIX ---- */
  doc.addPage()
  header('APPENDIX — full run sheet, actual pack order')
  const contHeader=d=>{if(d.pageNumber>1)header('APPENDIX — continued')}
  const body=S.rows.map((r,i)=>{
    const mvd=S.plannedRank[r.id]!=null&&S.plannedRank[r.id]!==(i+1)?('  (plan #'+S.plannedRank[r.id]+')'):''
    const note=[r.out_of_sequence_reason?('moved: '+r.out_of_sequence_reason):null,r.notes].filter(Boolean).join(' — ')
    return [i+1,_eodClock(r.start_time),r.sku||'–',r.dish_name+mvd,
      r.qty_packed!=null?r.qty_packed:(r.planned_qty!=null?r.planned_qty:'–'),
      r.total_minutes!=null?Number(r.total_minutes).toFixed(1):'–',
      r.changeover_mins!=null?Number(r.changeover_mins).toFixed(1):(i===0?'—':'–'),
      r._excl?('excl. '+r._excl):(r._rate!=null?Math.round(r._rate):'–'),'',note]
  })
  doc.autoTable({startY:86,margin:{left:M,right:M,top:86,bottom:40},didDrawPage:contHeader,theme:'plain',
    styles:{font:'helvetica',fontSize:7.2,cellPadding:{top:1.6,bottom:1.6,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.4,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:{0:{cellWidth:16,halign:'right'},1:{cellWidth:26,halign:'right'},2:{cellWidth:22,fontStyle:'bold'},3:{cellWidth:150},4:{cellWidth:28,halign:'right'},5:{cellWidth:24,halign:'right'},6:{cellWidth:22,halign:'right'},7:{cellWidth:30,halign:'right'},8:{cellWidth:56},9:{textColor:GREY,fontSize:6.6}},
    head:[['#','START','SKU','DISH','QTY','MIN','CO','RATE','VS '+packTarget,'NOTES']],
    body,
    didParseCell:d=>{
      if(d.section!=='body')return
      const r=S.rows[d.row.index]
      if(d.column.index===6&&r.changeover_mins!=null&&Number(r.changeover_mins)>PACK_CO_TARGET){d.cell.styles.fontStyle='bold';d.cell.styles.fillColor=[247,232,224]}
      if(d.column.index===7&&r._excl){d.cell.styles.textColor=GREY;d.cell.styles.fontStyle='italic';d.cell.styles.fontSize=6.4}
      if(d.column.index===7&&!r._excl&&r._rate!=null&&r._rate>=packTarget){d.cell.styles.fontStyle='bold'}
    },
    didDrawCell:d=>{
      if(d.section!=='body'||d.column.index!==8)return
      const r=S.rows[d.row.index]
      if(r._excl||r._rate==null)return
      const maxw=d.cell.width-8, frac=Math.min(1,r._rate/(packTarget*1.5))
      doc.setFillColor.apply(doc,(r._rate>=packTarget?ORANGE:[201,194,187]))
      doc.rect(d.cell.x+4,d.cell.y+d.cell.height/2-2.5,Math.max(1.5,frac*maxw),5,'F')
      const tx=d.cell.x+4+(1/1.5)*maxw
      doc.setDrawColor.apply(doc,INK);doc.setLineWidth(.8);doc.line(tx,d.cell.y+d.cell.height/2-4,tx,d.cell.y+d.cell.height/2+4)
    }})
  let y2=doc.lastAutoTable.finalY+10
  if(S.skipped.length){
    const needed=(S.skipped.length+2)*11+24
    if(y2+needed>H-40){doc.addPage();header('APPENDIX — continued');y2=86}
    y2=sec(M,y2,W-2*M,'SKIPPED')
    doc.autoTable({startY:y2,margin:{left:M,right:M,top:86,bottom:40},didDrawPage:contHeader,theme:'plain',
      styles:{font:'helvetica',fontSize:7.2,cellPadding:{top:1.6,bottom:1.6,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
      headStyles:{fontSize:6.4,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
      columnStyles:{0:{cellWidth:22,fontStyle:'bold'},1:{cellWidth:200},2:{cellWidth:28,halign:'right'},3:{textColor:GREY}},
      head:[['SKU','DISH','QTY','REASON']],
      body:S.skipped.map(r=>[r.sku||'–',r.dish_name,r.planned_qty!=null?r.planned_qty:'–',r.notes||'–'])})
  }
  const nPages=doc.getNumberOfPages()
  for(let p=1;p<=nPages;p++){doc.setPage(p);footer(p,nPages)}
  doc.save('Chefly-Packing-EOD-'+packShift.shift_date+'.pdf')
}

/* ---------- PACKING HISTORY (view a previous day, read-only) ---------- */
function packHistoryPicker(){
  if(!(typeof isManagerUp==='function'&&isManagerUp())) return ''
  const today=new Date().toISOString().slice(0,10)
  const v=packViewDate||today
  return `<div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:13px">📅 View day:</span><input type="date" value="${v}" max="${today}" onchange="packViewHistory(this.value)" style="max-width:180px" />${packViewDate?`<a class="link" style="font-size:13px" onclick="packViewHistory('')">← Back to today</a>`:''}</div>`
}
window.packViewHistory=async function(d){
  const today=new Date().toISOString().slice(0,10)
  packViewDate=(d&&d<today)?d:null
  await loadPacking()
}
function packHistRow(r){
  return `<div class="task-item" style="align-items:center;gap:10px"><div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div><b style="flex:1;min-width:0;font-size:14px">${esc(r.dish_name)}</b><span class="muted" style="font-size:12px">${r.planned_qty??'–'} planned</span>${r.notes?`<span style="color:#fcd34d;font-size:12px">📝 ${esc(r.notes)}</span>`:''}</div>`
}

/* ---------- PLAN ORDER (view + printable PDF) ----------
   The planned sequence lives on each run row (planned_seq, set at import).
   Works for today and for any history day loaded via the date picker. */
function _packPlanSorted(){return [...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))}
function _packPackedPos(){const m={};packRuns.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq).forEach((r,i)=>{m[r.id]=i+1});return m}
window.packTogglePlan=function(){packShowPlan=!packShowPlan;renderPacking()}
function packPlanList(){
  const plan=_packPlanSorted(), packedPos=_packPackedPos()
  const meals=plan.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  let h=`<p class="muted" style="margin:14px 0 4px">Plan order — the sequence as imported/planned for this day · <b style="color:var(--txt)">${plan.length}</b> dishes · <b style="color:var(--txt)">${meals}</b> meals.</p>`
  plan.forEach((r,i)=>{
    let st='<span class="pill off">pending</span>'
    if(r.status==='done')st=`<span class="pill done">done${packedPos[r.id]?' · packed #'+packedPos[r.id]:''}</span>`
    else if(r.status==='skipped')st='<span class="pill" style="background:rgba(245,158,11,.18);color:#fcd34d">skipped</span>'
    else if(r.status==='packing')st='<span class="pill live">● packing</span>'
    h+=`<div class="task-item" style="align-items:center;gap:10px"><b style="min-width:26px">#${i+1}</b><div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div><b style="flex:1;min-width:0;font-size:14px">${esc(r.dish_name)}</b><span class="muted" style="font-size:12px">${r.planned_qty??'–'}</span>${st}</div>`
  })
  return h
}
window.packPlanReport=async function(){
  if(!packShift||!packRuns.length){alert('No dishes loaded for this day — nothing to print.');return}
  try{await _eodLibs()}catch(e){alert(e.message);return}
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28, H=841.89, M=34
  const INK=[28,26,25], ORANGE=[232,84,29], GREY=[138,133,128], LINE=[220,215,209], SOFT=[236,232,227]
  const plan=_packPlanSorted(), packedPos=_packPackedPos()
  const meals=plan.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const started=plan.some(r=>r.status!=='pending')
  const header=()=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,54,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,54,'F')
    doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(251,250,248);doc.text('PACKING — PLAN ORDER',M,24)
    const dateStr=new Date(packShift.shift_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(201,194,187);doc.text(dateStr,M,40)
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(251,250,248);doc.text(plan.length+' dishes · '+meals.toLocaleString()+' meals',W-M,24,{align:'right'})
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(201,194,187);doc.text('Target '+packTarget+'/hr',W-M,40,{align:'right'})
  }
  header()
  const body=plan.map((r,i)=>{
    let st=''
    if(r.status==='done')st='done'+(packedPos[r.id]?' (packed #'+packedPos[r.id]+')':'')
    else if(r.status==='skipped')st='skipped'
    else if(r.status==='packing')st='packing now'
    return [i+1,r.sku||'–',r.dish_name,r.planned_qty!=null?r.planned_qty:'–',started?st:'','']
  })
  doc.autoTable({startY:76,margin:{left:M,right:M,top:76,bottom:36},theme:'plain',
    didDrawPage:d=>{if(d.pageNumber>1)header()},
    styles:{font:'helvetica',fontSize:8.6,cellPadding:{top:3.2,bottom:3.2,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.8,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:{0:{cellWidth:24,halign:'right',fontStyle:'bold'},1:{cellWidth:30,fontStyle:'bold'},3:{cellWidth:34,halign:'right',fontStyle:'bold'},4:{cellWidth:86,textColor:GREY},5:{cellWidth:34}},
    head:[['#','SKU','DISH','QTY',started?'STATUS':'','DONE']],
    body,
    didDrawCell:d=>{ if(d.section==='body'&&d.column.index===5){doc.setDrawColor.apply(doc,GREY);doc.setLineWidth(.8);doc.rect(d.cell.x+d.cell.width/2-4.5,d.cell.y+d.cell.height/2-4.5,9,9)} }
  })
  const n=doc.getNumberOfPages()
  for(let p=1;p<=n;p++){doc.setPage(p)
    doc.setDrawColor.apply(doc,LINE);doc.line(M,H-28,W-M,H-28)
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor.apply(doc,GREY)
    doc.text('Planned run order · generated '+new Date().toLocaleString('en-GB'),M,H-18)
    doc.text('Chefly SIM Tracker · page '+p+' of '+n,W-M,H-18,{align:'right'})}
  doc.save('Chefly-Packing-Plan-'+packShift.shift_date+'.pdf')
}

/* ---------- PACKING GUIDE CARDS (print + laminate) ----------
   One A4 page per dish: numbered components, portion weight, storage location.
   Big type for the line and for training new packers. Modes: the day's planned
   pack order, or the full A-Z set. Locations live on sim_components
   (manager-editable in the modal). jsPDF WinAnsi: keep PDF text ASCII-ish. */
let _pgComps=[], _pgBom=[], _pgNames={}, _pgLocs=[]
async function _pgLoad(){
  const [c,b,ni,lo]=await Promise.all([
    sb.from('sim_components').select('id,name,storage_location,active'),
    sb.from('sim_dish_bom').select('id,sku,component_id,grams'),
    sb.from('sim_pack_dish_import').select('sku,dish_name,imported_at').order('imported_at',{ascending:false}),
    sb.from('sim_storage_locations').select('id,name').order('sort_order').order('name')
  ])
  if(c.error)throw new Error(c.error.message)
  if(b.error)throw new Error(b.error.message)
  _pgComps=c.data||[]; _pgBom=b.data||[]
  _pgNames={}; ((ni&&ni.data)||[]).forEach(r=>{ if(!(r.sku in _pgNames)) _pgNames[r.sku]=r.dish_name })
  _pgLocs=(lo&&lo.data)||[]
}
function _pgUsedComps(){
  const used=new Set(_pgBom.map(x=>x.component_id))
  return _pgComps.filter(c=>used.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name))
}
function _pgLocNames(){
  const s=new Set()
  _pgLocs.forEach(l=>{const v=(l.name||'').trim(); if(v)s.add(v)})
  _pgComps.forEach(c=>{const v=(c.storage_location||'').trim(); if(v)s.add(v)})
  return [...s].sort((a,b)=>a.localeCompare(b))
}
function _pgLocChipsHTML(){
  if(!_pgLocs.length)return '<span class="muted" style="font-size:13px">No locations defined yet - add your fridges/freezers/stores once and every dropdown below will offer them.</span>'
  return _pgLocs.map(l=>'<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(249,115,22,.15);color:var(--accent);border-radius:14px;padding:3px 10px;font-size:13px;font-weight:600">'+esc(l.name)
    +'<a class="link" style="font-size:12px;cursor:pointer" onclick="packGuidesDelLoc(\''+l.id+'\')" title="Remove from list">✕</a></span>').join(' ')
}
function _pgLocSelect(c){
  const cur=(c.storage_location||'').trim()
  let o='<option value="">- none -</option>'
  _pgLocNames().forEach(l=>{o+='<option value="'+esc(l)+'"'+(l===cur?' selected':'')+'>'+esc(l)+'</option>'})
  o+='<option value="__new">+ New location…</option>'
  return '<select style="width:180px;flex:0 0 auto" onchange="packGuidesSetLoc(\''+c.id+'\',this)">'+o+'</select>'
}
function _pgLocListHTML(){
  let h=''
  _pgUsedComps().forEach(c=>{
    const unset=((c.storage_location||'').trim())?'0':'1'
    h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.15)">'
      +'<input type="checkbox" class="pgSel" data-cid="'+c.id+'" data-unset="'+unset+'" onchange="_pgBulkCount()" style="width:18px;height:18px;flex:0 0 auto;margin:0">'
      +'<div style="flex:1;min-width:0;font-size:13px">'+esc(c.name)+'</div>'+_pgLocSelect(c)+'</div>'
  })
  return h
}
function _pgBulkOptions(){
  let o='<option value="">- pick location -</option>'
  _pgLocNames().forEach(l=>{o+='<option value="'+esc(l)+'">'+esc(l)+'</option>'})
  o+='<option value="__new">+ New location…</option>'
  return o
}
function _pgBulkBarHTML(){
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">'
    +'<select id="pgBulkLoc" style="width:170px;flex:0 0 auto">'+_pgBulkOptions()+'</select>'
    +'<button class="ghost sm" id="pgBulkBtn" onclick="packGuidesBulkApply()">Apply to ticked (0)</button>'
    +'<span style="font-size:12px" class="muted">tick: <a class="link" onclick="packGuidesSel(\'all\')">all</a> · <a class="link" onclick="packGuidesSel(\'unset\')">unset only</a> · <a class="link" onclick="packGuidesSel(\'none\')">none</a></span>'
    +'</div>'
}
window._pgBulkCount=function(){
  const n=document.querySelectorAll('#pgLocList .pgSel:checked').length
  const b=document.getElementById('pgBulkBtn'); if(b)b.textContent='Apply to ticked ('+n+')'
}
window.packGuidesSel=function(mode){
  document.querySelectorAll('#pgLocList .pgSel').forEach(cb=>{
    if(mode==='all')cb.checked=true
    else if(mode==='none')cb.checked=false
    else cb.checked=(cb.dataset.unset==='1')
  })
  _pgBulkCount()
}
window.packGuidesBulkApply=async function(){
  const ids=[...document.querySelectorAll('#pgLocList .pgSel:checked')].map(cb=>cb.dataset.cid)
  if(!ids.length){alert('Tick at least one component first (or use the links to tick all / unset only).');return}
  const selEl=document.getElementById('pgBulkLoc')
  let v=selEl?selEl.value:''
  if(v==='__new'){
    v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
    if(!v)return
    const ins=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
    if(!ins.error&&ins.data&&!_pgLocs.some(l=>l.id===ins.data.id))_pgLocs.push(ins.data)
  }
  if(!v){alert('Pick a location to apply.');return}
  const {error}=await sb.from('sim_components').update({storage_location:v}).in('id',ids)
  if(error){alert(error.message);return}
  _pgComps.forEach(c=>{ if(ids.indexOf(c.id)>=0)c.storage_location=v })
  _pgRefreshLocs()
}
function _pgMissingWeights(){
  const compById={}; _pgComps.forEach(c=>{compById[c.id]=c})
  return _pgBom.filter(b=>b.grams==null||Number(b.grams)===0)
    .map(b=>({id:b.id,sku:b.sku,comp:(compById[b.component_id]||{}).name||'(unknown)',dish:_pgNames[b.sku]||('SKU '+b.sku)}))
    .sort((a,b)=>a.dish.localeCompare(b.dish))
}
function _pgWeightListHTML(){
  let h=''
  _pgMissingWeights().forEach(w=>{
    h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.15)">'
      +'<div style="flex:1;min-width:0;font-size:13px"><b>'+esc(w.comp)+'</b><div class="muted" style="font-size:11px">'+esc(w.dish)+' (SKU '+esc(w.sku)+')</div></div>'
      +'<input type="number" inputmode="numeric" placeholder="g" style="width:80px;flex:0 0 auto;text-align:right" onchange="packGuidesSetGrams(\''+w.id+'\',this)"> <span class="muted" style="font-size:12px">g</span></div>'
  })
  return h
}
function _pgRefreshLocs(){
  const ch=document.getElementById('pgLocChips'); if(ch)ch.innerHTML=_pgLocChipsHTML()
  const bl=document.getElementById('pgBulkLoc'); if(bl){const cur=bl.value;bl.innerHTML=_pgBulkOptions();bl.value=cur}
  const el=document.getElementById('pgLocList'); if(el){el.innerHTML=_pgLocListHTML();_pgBulkCount()}
  const n=document.getElementById('pgLocMsg')
  if(n){const comps=_pgUsedComps(),missing=comps.filter(c=>!(c.storage_location||'').trim()).length
    n.textContent=missing? missing+' of '+comps.length+' components have no location yet - they print as "-" until set.' : 'All '+comps.length+' components have a location.'}
  const wl=document.getElementById('pgWeightList'), wm=document.getElementById('pgWeightMsg'), ws=document.getElementById('pgWeightSec')
  if(wl){const mw=_pgMissingWeights()
    if(ws)ws.style.display=mw.length?'':'none'
    wl.innerHTML=_pgWeightListHTML()
    if(wm)wm.textContent=mw.length?(mw.length+' dish line'+(mw.length>1?'s have':' has')+' no portion weight - they print as CHECK until set. Type the grams and it saves.'):''}
}
window.packGuidesClose=function(){const m=document.getElementById('packGuidesModal');if(m)m.remove()}
window.packGuides=async function(){
  try{await _pgLoad()}catch(e){alert(e.message);return}
  const d=(packShift&&packShift.shift_date)||new Date().toISOString().slice(0,10)
  let body='<p class="muted" style="margin-top:-4px">One A4 card per dish - what goes in, the weight, and where to find it. Print, laminate, clip to the line. Reprint after any menu change.</p>'
  body+='<label style="display:block;margin:10px 0 6px"><input type="radio" name="pgMode" value="day" checked> Day pack order &nbsp;<input id="pgDate" type="date" value="'+d+'" style="width:auto;display:inline-block"></label>'
  body+='<label style="display:block;margin:0 0 12px"><input type="radio" name="pgMode" value="all"> Full set A-Z (every dish on file)</label>'
  body+='<button class="green" onclick="packGuidesPDF()">🖨 Generate PDF</button>'
  if(isManagerUp()){
    body+='<h3 style="margin:18px 0 2px">Storage locations</h3>'
    body+='<div id="pgLocChips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 8px"></div>'
    body+='<button class="ghost sm" onclick="packGuidesAddLoc()" style="margin:0 0 10px">+ Add location</button>'
    body+='<p class="muted" id="pgLocMsg" style="margin:0 0 8px"></p>'
    body+=_pgBulkBarHTML()
    body+='<div id="pgLocList" style="max-height:300px;overflow-y:auto;border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:2px 10px"></div>'
    body+='<div id="pgWeightSec"><h3 style="margin:18px 0 2px">Missing weights</h3>'
      +'<p class="muted" id="pgWeightMsg" style="margin:0 0 8px"></p>'
      +'<div id="pgWeightList" style="border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:2px 10px"></div></div>'
  }
  const m=document.createElement('div'); m.id='packGuidesModal'
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;overflow-y:auto;padding:20px 12px'
  m.innerHTML='<div class="card" style="max-width:640px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="margin:0">Packing guides</h2><button class="ghost sm" onclick="packGuidesClose()">✕ Close</button></div>'
    +body+'</div>'
  m.onclick=function(e){ if(e.target===m)packGuidesClose() }
  document.body.appendChild(m)
  _pgRefreshLocs()
}
window.packGuidesAddLoc=async function(){
  const v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
  if(!v)return
  const {data,error}=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
  if(error){alert(error.message);return}
  if(data&&!_pgLocs.some(l=>l.id===data.id))_pgLocs.push(data)
  _pgRefreshLocs()
}
window.packGuidesDelLoc=async function(id){
  const l=_pgLocs.find(x=>x.id===id); if(!l)return
  if(!confirm('Remove "'+l.name+'" from the location list? Components already set to it keep their value.'))return
  const {error}=await sb.from('sim_storage_locations').delete().eq('id',id)
  if(error){alert(error.message);return}
  _pgLocs=_pgLocs.filter(x=>x.id!==id)
  _pgRefreshLocs()
}
window.packGuidesSetLoc=async function(id,sel){
  let v=sel.value
  if(v==='__new'){
    v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
    if(!v){const c=_pgComps.find(x=>x.id===id);sel.value=(c&&c.storage_location)||'';return}
    const ins=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
    if(!ins.error&&ins.data&&!_pgLocs.some(l=>l.id===ins.data.id))_pgLocs.push(ins.data)
  }
  const {error}=await sb.from('sim_components').update({storage_location:v||null}).eq('id',id)
  if(error){alert(error.message);_pgRefreshLocs();return}
  const c=_pgComps.find(x=>x.id===id); if(c)c.storage_location=v||null
  _pgRefreshLocs()
}
window.packGuidesSetGrams=async function(bomId,inp){
  const t=String(inp.value).trim()
  if(t===''){return}
  const n=Number(t)
  if(isNaN(n)||n<=0){alert('Enter the portion weight in grams (a number above 0).');inp.value='';return}
  const {error}=await sb.from('sim_dish_bom').update({grams:n}).eq('id',bomId)
  if(error){alert(error.message);return}
  const b=_pgBom.find(x=>x.id===bomId); if(b)b.grams=n
  _pgRefreshLocs()
}
window.packGuidesPDF=async function(){
  const mode=(document.querySelector('input[name="pgMode"]:checked')||{}).value||'day'
  const d=($('pgDate')&&$('pgDate').value)||new Date().toISOString().slice(0,10)
  try{await _eodLibs()}catch(e){alert(e.message);return}
  try{await _pgLoad()}catch(e){alert(e.message);return}
  const compById={}; _pgComps.forEach(c=>{compById[c.id]=c})
  const bySku={}; _pgBom.forEach(b=>{(bySku[b.sku]=bySku[b.sku]||[]).push(b)})
  const pageFor=(sku,dish,q,seq)=>{
    const comps=(bySku[sku]||[]).map(b=>{const c=compById[b.component_id]||{}
      return {name:c.name||'(unknown component)',grams:b.grams!=null?Number(b.grams):null,loc:(c.storage_location||'').trim()||null}})
    comps.sort((a,b)=>(b.grams||0)-(a.grams||0))
    return {sku:sku,dish:dish||('SKU '+sku),qty:q,seq:seq,comps:comps}
  }
  let pages=[], label=''
  if(mode==='day'){
    const sh=await sb.from('sim_pack_shifts').select('id,shift_date').eq('shift_date',d).maybeSingle()
    if(sh.error){alert(sh.error.message);return}
    let runs=[]
    if(sh.data){
      const rr=await sb.from('sim_pack_runs').select('sku,dish_name,planned_qty,sort_order,planned_seq,status').eq('shift_id',sh.data.id)
      if(rr.error){alert(rr.error.message);return}
      runs=(rr.data||[]).filter(r=>r.status!=='skipped')
        .sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
    }
    if(!runs.length){alert('No dish list loaded for '+d+' - import the day first, or print the full set.');return}
    pages=runs.map((r,i)=>pageFor(r.sku,r.dish_name,r.planned_qty!=null?Number(r.planned_qty):null,i+1))
    label=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  } else {
    pages=Object.keys(bySku).map(sku=>pageFor(sku,_pgNames[sku]||null,null,null)).sort((a,b)=>a.dish.localeCompare(b.dish))
    if(!pages.length){alert('No dish components on file yet.');return}
    label='FULL SET - ALL DISHES'
  }
  const doc=_packGuidesRender(pages,label)
  doc.save(mode==='day'?('Chefly-Packing-Guides-'+d+'.pdf'):'Chefly-Packing-Guides-Full-Set.pdf')
  packGuidesClose()
}
window._packGuidesRender=function(pages,dateLabel){
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28,H=841.89,M=40
  const INK=[28,26,25],ORANGE=[232,84,29],GREY=[138,133,128],LINE=[220,215,209]
  const t=(x,y,s,size,style,col,opt)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y,opt)}
  const fmtG=g=> g>=1000 ? (Math.round(g/10)/100)+' kg' : Math.round(g)+' g'
  pages.forEach((p,pi)=>{
    if(pi>0)doc.addPage()
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,96,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,96,'F')
    t(M,24,'PACKING GUIDE',9,'bold',[248,205,184])
    t(W-M,24,dateLabel,9,'normal',[201,194,187],{align:'right'})
    t(W-M,48,'SKU',8,'bold',[201,194,187],{align:'right'})
    t(W-M,82,p.sku||'-',30,'bold',[251,250,248],{align:'right'})
    const maxw=W-2*M-90
    let size=30,lines=[]
    for(const s2 of [30,26,22,18,15]){size=s2;doc.setFont('helvetica','bold');doc.setFontSize(s2);lines=doc.splitTextToSize(p.dish,maxw);if(lines.length<=2)break}
    if(lines.length>2)lines=lines.slice(0,2)
    let ny=lines.length===2?56:68
    lines.forEach(l=>{t(M,ny,l,size,'bold',[251,250,248]);ny+=size*1.08})
    let y=96
    if(p.qty!=null){
      doc.setFillColor(250,238,230);doc.rect(0,96,W,26,'F')
      t(M,113,'#'+p.seq+" IN TODAY'S ORDER",10,'bold',ORANGE)
      t(W-M,113,p.qty+' MEALS',12,'bold',INK,{align:'right'})
      y=122
    }
    const footTop=H-100
    if(!p.comps.length){
      t(M,y+60,'No components on file for this dish yet.',16,'bold',ORANGE)
      t(M,y+84,'Add its components in the app and reprint this card.',11,'normal',GREY)
    } else {
      const n=p.comps.length
      const rowH=Math.min(100,(footTop-y-14)/n)
      const s=Math.min(1,rowH/92)
      let ry=y+10
      p.comps.forEach((c,ci)=>{
        const cy=ry+rowH/2
        doc.setFillColor.apply(doc,ORANGE);doc.circle(M+14,cy,13*s,'F')
        t(M+14,cy+4.5*s,String(ci+1),13*s+2,'bold',[255,255,255],{align:'center'})
        const nx=M+40, nmaxw=W-2*M-190
        let ns=23*s,nlines=[]
        for(const q of [23,19,16,13]){ns=q*s;doc.setFont('helvetica','bold');doc.setFontSize(ns);nlines=doc.splitTextToSize(c.name,nmaxw);if(nlines.length<=2)break}
        if(nlines.length>2)nlines=nlines.slice(0,2)
        let nyy=nlines.length===2?cy-16*s:cy-3*s
        nlines.forEach(l=>{t(nx,nyy,l,ns,'bold',INK);nyy+=ns*1.05})
        const locY=nlines.length===2?cy+27*s:cy+20*s
        const loc=c.loc?c.loc.toUpperCase():null
        t(nx,locY,'WHERE:',10*s,'bold',GREY)
        t(nx+48*s,locY,loc||'-  (no location set yet)',loc?(14*s):(10*s),'bold',loc?ORANGE:GREY)
        if(c.grams!=null&&c.grams>0) t(W-M,cy+11*s,fmtG(c.grams),34*s,'bold',INK,{align:'right'})
        else t(W-M,cy+7*s,'CHECK',20*s,'bold',ORANGE,{align:'right'})
        doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(M,ry+rowH,W-M,ry+rowH)
        ry+=rowH
      })
      const known=p.comps.filter(c=>c.grams!=null&&c.grams>0)
      const tot=known.reduce((a,c)=>a+Number(c.grams),0)
      const miss=known.length<p.comps.length
      t(M,footTop+34,'TOTAL PLATE WEIGHT',12,'bold',GREY)
      t(W-M,footTop+38,fmtG(tot)+(miss?' + ?':''),26,'bold',INK,{align:'right'})
      if(miss)t(M,footTop+52,'? = a component has no weight on file - confirm before packing.',9,'normal',GREY)
    }
    doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(M,H-30,W-M,H-30)
    t(M,H-18,'Reprint after any menu change - generated '+new Date().toLocaleString('en-GB'),7.5,'normal',GREY)
    t(W-M,H-18,'Chefly SIM Tracker - card '+(pi+1)+' of '+pages.length,7.5,'normal',GREY,{align:'right'})
  })
  return doc
}
