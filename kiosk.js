/* KIOSK: shared-device flow for floor staff (tap name + PIN, log time). */

window.enterKiosk=async function(){
  hide($('appView')); hide($('loginView')); show($('kioskView'))
  if(!catalog.length) await loadCatalog()
  if(!products.length) await loadProducts()
  kioskBackToGrid()
}
window.exitKiosk=function(){ kStaff=null; kActiveLog=null; if(kTimerInt)clearInterval(kTimerInt); hide($('kioskView')); show($('appView')) }
window.kioskBackToGrid=function(){
  kStaff=null; kActiveLog=null; if(kTimerInt)clearInterval(kTimerInt)
  $('kPin').value=''; clearMsg($('kPinMsg')); clearMsg($('kTaskMsg'))
  $('kPinStep').classList.add('hidden'); $('kTaskStep').classList.add('hidden'); $('kStaffStep').classList.remove('hidden')
  loadKioskStaff()
}
async function loadKioskStaff(){
  const grid=$('kGrid'); grid.innerHTML='<p class="muted">Loading…</p>'
  const {data,error}=await sb.from('sim_staff').select('id,full_name,station').eq('active',true).order('full_name')
  if(error){grid.innerHTML='<p class="muted">'+error.message+'</p>';return}
  grid.innerHTML=''
  ;(data||[]).forEach(s=>{const b=document.createElement('button');b.className='ghost';b.style.margin='0';b.style.padding='22px 10px';b.textContent=s.full_name;b.onclick=()=>kioskSelect(s);grid.appendChild(b)})
  if(!data||!data.length) grid.innerHTML='<p class="muted">No floor staff set up. Add them in Manage → Floor staff.</p>'
}
window.kioskSelect=function(s){
  kStaff=s; $('kPinName').textContent=s.full_name+' — enter your PIN'
  $('kStaffStep').classList.add('hidden'); $('kPinStep').classList.remove('hidden'); $('kPin').value=''; setTimeout(()=>$('kPin').focus(),50)
}
window.kioskVerify=async function(){
  if(!kStaff) return
  const pin=$('kPin').value.trim()
  if(!/^\d{4}$/.test(pin)){msg($('kPinMsg'),'Enter your 4-digit PIN.',false);return}
  const {data,error}=await sb.rpc('sim_verify_staff_pin',{p_staff_id:kStaff.id,p_pin:pin})
  if(error){msg($('kPinMsg'),error.message,false);return}
  if(!data){msg($('kPinMsg'),'Wrong PIN. Try again.',false);return}
  clearMsg($('kPinMsg'))
  $('kPinStep').classList.add('hidden'); $('kTaskStep').classList.remove('hidden')
  $('kWho').textContent='Start a task — '+kStaff.full_name
  const sel=$('kSelTask'); sel.innerHTML=''; catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;sel.appendChild(o)})
  populateProductSelects()
  await kioskLoadActive()
}
async function kioskLoadActive(){
  const {data}=await sb.from('sim_task_logs').select('*').eq('staff_id',kStaff.id).in('status',['in_progress','paused']).order('start_time',{ascending:false}).limit(1)
  kActiveLog=(data&&data[0])||null; kioskRenderActive()
}
function kioskRenderActive(){
  if(kActiveLog){
    $('kStartCard').classList.add('hidden'); $('kActiveCard').classList.remove('hidden')
    $('kActiveName').textContent=kActiveLog.task_name
    $('kActiveMeta').textContent=`${kActiveLog.product?kActiveLog.product+' · ':''}${kActiveLog.staff_count||1} ppl · started ${fmtTime(kActiveLog.start_time)}`
    $('kStaffCount').value=kActiveLog.staff_count||1
    const c=catFor(kActiveLog); const ru=!c||c.requires_units!==false; const sw=!!(c&&(c.track_waste||c.require_waste)); const rw=!!(c&&c.require_waste)
    $('kUnitsWrap').classList.toggle('hidden',!ru)
    $('kWaste').value=''; $('kWasteWrap').classList.toggle('hidden',!sw); $('kWasteToggleP').classList.toggle('hidden',sw)
    const kuom=uomFor(kActiveLog); const kul=$('kUnitsLabel'); if(kul)kul.textContent='Amount produced ('+kuom+')'; const kui=$('kUnits'); if(kui)kui.placeholder=kuom==='kg'?'e.g. 22.5':'e.g. 150'; const kwl=$('kWasteLabel'); if(kwl)kwl.textContent=rw?'Waste ('+kuom+') — required':'Waste ('+kuom+')'; const kwtp=document.querySelector('#kWasteToggleP a'); if(kwtp)kwtp.textContent='+ Record waste ('+kuom+')'
    renderPhotoStrip('kPhotoStrip',kActiveLog); updatePauseUI(kActiveLog,'kActivePill','kPauseBtn')
    if(kTimerInt)clearInterval(kTimerInt); const tick=()=>{$('kTimer').textContent=fmtClock(workedSeconds(kActiveLog))}; tick(); kTimerInt=setInterval(tick,1000)
  } else { $('kStartCard').classList.remove('hidden'); $('kActiveCard').classList.add('hidden'); if(kTimerInt)clearInterval(kTimerInt) }
}
window.kioskShowWaste=function(){$('kWasteWrap').classList.remove('hidden');$('kWasteToggleP').classList.add('hidden')}
window.kioskStart=async function(){
  const t=catalog.find(c=>c.id===$('kSelTask').value); if(!t){msg($('kTaskMsg'),'Pick a task.',false);return}
  const {data,error}=await sb.from('sim_task_logs').insert({staff_id:kStaff.id,catalog_id:t.id,task_name:t.name,station:t.station,uom:t.uom||'kg',product:$('kProduct').value.trim()||null,staff_count:Number($('kCount').value)||1,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('kTaskMsg'),error.message,false);return}
  kActiveLog=data; $('kProduct').value=''; clearMsg($('kTaskMsg')); kioskRenderActive()
}
window.kioskStop=async function(){
  if(!kActiveLog) return
  const units=$('kUnits').value?Number($('kUnits').value):null
  const waste=$('kWaste').value?Number($('kWaste').value):null
  const kuom=uomFor(kActiveLog)
  const he=numberHardError(units,waste,kuom); if(he){ alert(he); return }
  if(!numberSanityOK(units,waste)) return
  // Kiosk is used by floor staff directly, so amount + waste + photo are strictly required (no skip).
  if(requiresUnits(kActiveLog) && (units==null||isNaN(units))){ alert('Please enter the amount produced ('+kuom+') before finishing this task.'); return }
  if(requiresWaste(kActiveLog) && (waste==null||isNaN(waste))){ alert('Please enter the waste ('+kuom+') for this task before finishing. If there was none, enter 0.'); return }
  if(!(kActiveLog.photos&&kActiveLog.photos.length)){ alert('A photo of the work is required before finishing.\n\nPlease add a photo above, then finish.'); return }
  let ps=kActiveLog.paused_seconds||0; if(kActiveLog.status==='paused'&&kActiveLog.pause_started_at) ps+=(Date.now()-new Date(kActiveLog.pause_started_at))/1000
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:Number($('kStaffCount').value)||1,changeover_mins:$('kChange').value?Number($('kChange').value):null,comments:$('kComments').value.trim()||null,status:'completed'}).eq('id',kActiveLog.id)
  if(error){alert(finishErr(error));return}
  $('kUnits').value='';$('kWaste').value='';$('kChange').value='';$('kComments').value=''
  alert('Logged — thanks '+kStaff.full_name+'!')
  kioskBackToGrid()
}
