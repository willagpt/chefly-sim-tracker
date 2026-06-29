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
  const plannedMeals=packRuns.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const packedMeals=done.reduce((s,r)=>s+(Number(r.qty_packed)||Number(r.planned_qty)||0),0)
  const cos=packRuns.filter(r=>r.changeover_mins!=null)
  const overCount=cos.filter(r=>r.changeover_mins>PACK_CO_TARGET).length
  const avgCo=cos.length?(cos.reduce((s,r)=>s+Number(r.changeover_mins),0)/cos.length):null
  let html=''
  html+=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Packing — ${packShift.shift_date}</h2><span class="pill ${packing?'live':'off'}">${packing?'● PACKING':'idle'}</span></div>
    <div class="stat-grid" style="margin-top:10px">
      <div class="stat"><div class="n">${done.length}/${packRuns.length}</div><div class="l">Dishes done</div></div>
      <div class="stat"><div class="n">${packedMeals}</div><div class="l">Meals packed</div></div>
      <div class="stat"><div class="n">${plannedMeals}</div><div class="l">Meals planned</div></div>
    </div>
    ${packing?`<div style="margin-top:6px;font-weight:700">Now packing: ${packing.dish_name} <span class="muted">(SKU ${packing.sku||'–'})</span> · <span id="packCurElapsed">00:00:00</span></div>`:''}
    <p class="muted" style="margin-top:8px">Changeovers: ${avgCo!=null?avgCo.toFixed(1)+'m avg':'–'} · <span class="${overCount?'vs-bad':'vs-good'}">${overCount} over the ${PACK_CO_TARGET}-min target</span></p>
  </div>`

  html+=`<div class="card"><h2>Team &amp; positions</h2>`
  if(!packMembers.length) html+=`<p class="muted">No packing roster yet. An admin adds people in Manage → Packing team.</p>`
  html+='<div>'
  packPositions.forEach(p=>{
    const a=packAssignments[p.id]
    html+=`<div class="row" style="align-items:center;margin-bottom:6px"><div style="flex:0 0 120px;font-weight:600;font-size:14px">${p.label}</div><select onchange="packAssign('${p.id}',this.value)">${packMemberOptions(a?a.member_id:'')}</select></div>`
  })
  html+='</div></div>'

  html+=`<div class="card"><h2>Breaks</h2>`
  if(packBreaks.length){html+='<div style="margin-bottom:8px">'+packBreaks.map(b=>`<div class="task-item"><div><b>${packMemberName(b.member_id)}</b><div class="meta">${b.break_time||'—'}${b.approved_by?' · approved by '+b.approved_by:''}</div></div><button class="ghost sm" onclick="packDelBreak('${b.id}')">✕</button></div>`).join('')+'</div>'}
  html+=`<div class="row"><select id="brkMember">${packMemberOptions('')}</select><input id="brkTime" placeholder="Break time (e.g. 11:00)" /></div>
    <div class="row" style="margin-top:8px"><input id="brkApproved" placeholder="Approved by" /><button class="green sm" style="flex:0 0 auto" onclick="packAddBreak()">Add</button></div></div>`

  html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">Dish list</h2>`
  if(packRuns.length) html+=`<button class="ghost sm" onclick="packSaveDefault()">Save order as default</button>`
  html+=`</div>`
  if(!packRuns.length){
    html+=`<p class="muted">No dishes loaded for today yet.</p><button class="green" onclick="packImportDishes()">Load today's dish list</button>`
  } else {
    html+=`<p class="muted" style="margin:6px 0">Drag the ⠿ handle to reorder upcoming dishes.</p><div id="packDishList">`
    packRuns.forEach(r=>{ html+=packRunRow(r) })
    html+='</div><button class="ghost sm" style="margin-top:10px" onclick="packImportDishes()">Re-load from sheet (clears timings)</button>'
  }
  html+='</div>'

  html+=packRulesCard()
  box.innerHTML=html
  packAttachDnD()
}
function packRunRow(r){
  const anyPacking=packRuns.some(x=>x.status==='packing')
  const started=r.status!=='pending'
  const coVal=r.changeover_mins!=null?r.changeover_mins.toFixed(1)+'m':'–'
  const coCls=(r.changeover_mins!=null&&r.changeover_mins>PACK_CO_TARGET)?'vs-bad':'vs-good'
  const co=started?` · CO <span class="${coCls}">${coVal}</span> <a class="link" style="font-size:13px" onclick="packEditChangeover('${r.id}')">✎</a>`:''
  const statusPill=r.status==='done'?'<span class="pill done">done</span>':(r.status==='packing'?'<span class="pill live">● packing</span>':'<span class="pill off">pending</span>')
  let action=''
  if(r.status==='pending'){ action=`<button class="green sm" onclick="packStartDish('${r.id}')" ${anyPacking?'disabled':''}>Start</button>` }
  else if(r.status==='packing'){ action=`<input id="qty_${r.id}" type="number" inputmode="numeric" placeholder="qty" value="${r.planned_qty??''}" style="width:64px;padding:8px;margin:0" /><button class="red sm" onclick="packStopDish('${r.id}')">Stop</button>` }
  else { action=`<span class="muted" style="font-size:13px">${r.total_minutes!=null?r.total_minutes+'m':''}${r.qty_packed!=null?' · '+r.qty_packed+' packed':''}</span>` }
  const handle=r.status==='pending'?`<span class="drag-h" style="cursor:grab;touch-action:none;user-select:none;padding:4px 6px;font-size:18px;color:var(--muted)">⠿</span>`:''
  return `<div class="task-item" data-runid="${r.id}" data-pending="${r.status==='pending'?'1':'0'}"><div style="min-width:0"><b>${r.dish_name}</b> ${statusPill}<div class="meta">SKU ${r.sku||'–'} · plan ${r.planned_qty??'–'}${co}</div></div><div style="display:flex;gap:6px;align-items:center;flex-shrink:0">${handle}${action}</div></div>`
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
