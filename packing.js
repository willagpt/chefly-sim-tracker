/* PACKING: team-leader screen — start-of-day positions & breaks, and the day's
   dish run-sheet with sequential start/stop + automatic changeover timing. */

let packShift=null, packPositions=[], packMembers=[], packAssignments={}, packRuns=[], packBreaks=[], packTimer=null
const PACK_CO_TARGET=3   // minutes — SKU change target

window.loadPacking=async function(){
  const today=new Date().toISOString().slice(0,10)
  let {data:sh}=await sb.from('sim_pack_shifts').select('*').eq('shift_date',today).maybeSingle()
  if(!sh){const ins=await sb.from('sim_pack_shifts').insert({shift_date:today,created_by:(me&&me.id)||null}).select().single(); if(ins.error){$('packBody').innerHTML='<div class="card"><p class="muted">'+ins.error.message+'</p></div>';return} sh=ins.data}
  packShift=sh
  const [pos,mem,asg,runs,brk]=await Promise.all([
    sb.from('sim_pack_positions').select('*').eq('active',true).order('sort_order'),
    sb.from('sim_pack_members').select('*').eq('active',true).order('sort_order').order('full_name'),
    sb.from('sim_pack_assignments').select('*').eq('shift_id',sh.id),
    sb.from('sim_pack_runs').select('*').eq('shift_id',sh.id).order('sort_order'),
    sb.from('sim_pack_breaks').select('*').eq('shift_id',sh.id).order('created_at')
  ])
  packPositions=pos.data||[]; packMembers=mem.data||[]; packRuns=runs.data||[]; packBreaks=brk.data||[]
  packAssignments={}; (asg.data||[]).forEach(a=>{packAssignments[a.position_id]=a})
  renderPacking()
  if(packTimer)clearInterval(packTimer); packTimer=setInterval(packTick,1000)
}
function packMemberName(id){const m=packMembers.find(x=>x.id===id);return m?m.full_name:'—'}
function packMemberOptions(sel){return '<option value="">— unassigned —</option>'+packMembers.map(m=>`<option value="${m.id}" ${sel===m.id?'selected':''}>${m.full_name}</option>`).join('')}
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
  </div>`

  // ---- the run-sheet (big action panel + clean list) ----
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

  // ---- positions ----
  html+=`<div class="card"><h2>Team &amp; positions</h2>`
  if(!packMembers.length) html+=`<p class="muted">No packing roster yet. An admin adds people in Manage → Packing team.</p>`
  packPositions.forEach(p=>{
    const a=packAssignments[p.id]
    html+=`<div style="margin-bottom:8px"><div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:3px">${p.label}</div><select onchange="packAssign('${p.id}',this.value)">${packMemberOptions(a?a.member_id:'')}</select></div>`
  })
  html+='</div>'

  // ---- breaks ----
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
    return `<div class="card" style="background:var(--panel2);border-color:var(--accent);text-align:center;margin:6px 0 0">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.5px">NOW PACKING · SKU ${packing.sku||'–'}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${packing.dish_name}</div>
      <div class="timer" id="packCurElapsed">00:00:00</div>
      <div style="max-width:240px;margin:6px auto 0"><input id="qty_${packing.id}" type="number" inputmode="numeric" placeholder="qty packed" value="${packing.planned_qty??''}" style="text-align:center" /></div>
      <button class="red" onclick="packStopDish('${packing.id}')">■ STOP — finish dish</button>
    </div>`
  }
  if(next){
    return `<div class="card" style="background:var(--panel2);text-align:center;margin:6px 0 0">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.5px">NEXT UP · SKU ${next.sku||'–'}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${next.dish_name}</div>
      <div class="muted" style="margin-bottom:2px"><b style="font-size:22px;color:var(--txt)">${next.planned_qty??'–'}</b> to pack</div>
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
  else if(r.status==='done'){ act=`<span class="muted" style="font-size:12px">${r.total_minutes!=null?r.total_minutes+' min':''}${r.qty_packed!=null?' · '+r.qty_packed+' packed':''}</span>` }
  const noteLink=`<a class="link" style="font-size:12px" onclick="packNote('${r.id}')">📝 ${r.notes?'Edit note':'Note'}</a>`
  const handle=r.status==='pending'?`<span class="drag-h" style="cursor:grab;touch-action:none;user-select:none;padding:2px 4px;font-size:18px;color:var(--muted)">⠿</span>`:''
  const skuBlock=`<div style="flex:0 0 auto;text-align:center;min-width:38px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:20px;font-weight:900;color:var(--accent);line-height:1">${r.sku||'–'}</div></div>`
  const planBlock=`<div style="flex:0 0 auto;text-align:center;min-width:42px"><div style="font-size:20px;font-weight:900;line-height:1">${r.planned_qty??'–'}</div><div style="font-size:10px;color:var(--muted)">PLAN</div></div>`
  const notesLine=r.notes?`<div style="color:#fcd34d;font-size:12px;margin-top:2px">📝 ${r.notes}</div>`:''
  return `<div class="task-item" data-runid="${r.id}" data-pending="${r.status==='pending'?'1':'0'}" style="flex-direction:column;align-items:stretch;gap:6px">
    <div style="display:flex;align-items:center;gap:10px">${handle}${skuBlock}<b style="flex:1;min-width:0;font-size:15px">${r.dish_name}</b>${planBlock}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">${pill}${co}</span><span style="flex-shrink:0;display:flex;gap:12px;align-items:center">${noteLink}${act}</span></div>
    ${notesLine}
  </div>`
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
  if(r&&el&&r.start_time){ el.textContent=fmtClock((Date.now()-new Date(r.start_time))/1000) }
}
// drag-and-drop reordering (pointer events = works on touch + mouse)
function packAttachDnD(){
  const list=$('packDishList'); if(!list)return
  list.querySelectorAll('.drag-h').forEach(h=>{
    h.addEventListener('pointerdown',e=>{
      const dragEl=h.closest('[data-runid]'); if(!dragEl)return
      e.preventDefault(); dragEl.style.opacity='0.5'
      const move=(ev)=>{
        const targets=[...list.querySelectorAll('[data-runid][data-pending="1"]')].filter(r=>r!==dragEl)
        let placed=false
        for(const r of targets){ const rect=r.getBoundingClientRect(); if(ev.clientY < rect.top+rect.height/2){ list.insertBefore(dragEl,r); placed=true; break } }
        if(!placed && targets.length){ const last=targets[targets.length-1]; list.insertBefore(dragEl,last.nextSibling) }
      }
      const up=async()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up)
        dragEl.style.opacity=''
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
window.packNote=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const v=prompt('Note for "'+r.dish_name+'":', r.notes||'')
  if(v===null)return
  const {error}=await sb.from('sim_pack_runs').update({notes:v.trim()||null}).eq('id',id)
  if(error){alert(error.message);return}
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
  const ins=rows.map((d,i)=>({shift_id:packShift.id,dish_name:d.dish_name,sku:d.sku,planned_qty:d.planned_qty,sort_order:i,status:'pending'}))
  const {error}=await sb.from('sim_pack_runs').insert(ins)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packStartDish=async function(id){
  if(packRuns.some(r=>r.status==='packing')){alert('Finish the current dish first.');return}
  const done=packRuns.filter(r=>r.status==='done'&&r.finish_time).sort((a,b)=>new Date(b.finish_time)-new Date(a.finish_time))
  const co=done.length?Math.round(((Date.now()-new Date(done[0].finish_time))/60000)*10)/10:null
  const {error}=await sb.from('sim_pack_runs').update({start_time:new Date().toISOString(),status:'packing',changeover_mins:co}).eq('id',id)
  if(error){alert(error.message);return}
  await loadPacking()
}
window.packStopDish=async function(id){
  const r=packRuns.find(x=>x.id===id); if(!r)return
  const qtyEl=$('qty_'+id); const qty=(qtyEl&&qtyEl.value!=='')?Number(qtyEl.value):null
  const fin=new Date().toISOString()
  const mins=r.start_time?Math.round(((new Date(fin)-new Date(r.start_time))/60000)*100)/100:null
  const {error}=await sb.from('sim_pack_runs').update({finish_time:fin,total_minutes:mins,qty_packed:qty,status:'done'}).eq('id',id)
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
