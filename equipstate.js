/* EQUIP STATE: shared live vessel state (from sim_equipment_state RPC).
   Used by the task-start pickers, the manager dashboard board, and the equipment tab. */
let equipState=[]
async function loadEquipState(){
  const {data,error}=await sb.rpc('sim_equipment_state')
  if(!error) equipState=data||[]
  return equipState
}
function freeEquip(){ return equipState.filter(e=>!e.busy) }
function equipById(id){ return equipState.find(e=>e.equipment_id===id) }
function equipBusyErr(error){ return (error&&error.code==='23505')?'That vessel was just taken by someone else — pick another.':(error?error.message:'Error') }
// Fill a <select> with vessels; busy ones shown disabled (except the one already chosen)
function populateEquipSelect(selId, currentId){
  const sel=$(selId); if(!sel) return
  const cur=currentId||sel.value||''
  const opts=['<option value="">— none —</option>']
  equipState.forEach(e=>{
    const off = e.busy && e.equipment_id!==cur
    opts.push(`<option value="${e.equipment_id}"${e.equipment_id===cur?' selected':''}${off?' disabled':''}>${esc(e.name)}${off?' (in use)':''}</option>`)
  })
  sel.innerHTML=opts.join('')
}
// In-use / idle board markup (dashboard)
function equipBoardHtml(){
  if(!equipState.length) return '<p class="muted">No equipment set up.</p>'
  const busy=equipState.filter(e=>e.busy), free=equipState.filter(e=>!e.busy)
  let h=`<div class="muted" style="margin-bottom:8px"><b>${busy.length}</b> in use · <b>${free.length}</b> free</div>`
  h+=busy.map(e=>{
    const since=e.start_time?fmtClock((Date.now()-new Date(e.start_time))/1000):''
    const plan=e.planned_minutes?' / '+e.planned_minutes+'m planned':''
    return `<div class="dash-row"><div><div class="name">${esc(e.name)}</div><div class="sub">${esc(e.activity||'In use')}${e.product?' · '+esc(e.product):''} · ${esc(e.occupant||'')}</div></div><div style="text-align:right"><div class="pill live">● ${since}${plan}</div></div></div>`
  }).join('')
  if(free.length) h+=`<div class="muted" style="margin-top:10px">Free: ${free.map(e=>esc(e.name)).join(' · ')}</div>`
  return h
}
