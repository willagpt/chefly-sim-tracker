/* KIOSK: shared-device flow for floor staff (tap name + PIN, log time). Supports multiple concurrent tasks. */

window.enterKiosk=async function(){
  hide($('appView')); hide($('loginView')); show($('kioskView'))
  if(!catalog.length) await loadCatalog()
  if(!products.length) await loadProducts()
  kioskBackToGrid()
}
window.exitKiosk=function(){ kStaff=null; kActiveLogs=[]; if(kTimerInt)clearInterval(kTimerInt); hide($('kioskView')); show($('appView')) }
window.kioskBackToGrid=function(){
  kStaff=null; kActiveLogs=[]; if(kTimerInt)clearInterval(kTimerInt)
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
  await loadEquipState(); populateEquipSelect('kEquip')
  if(typeof loadMyDayKiosk==='function') loadMyDayKiosk()
  await kioskLoadActive()
}
async function kioskLoadActive(){
  const {data}=await sb.from('sim_task_logs').select('*').eq('staff_id',kStaff.id).in('status',['in_progress','paused']).order('start_time',{ascending:false})
  kActiveLogs=data||[]; kioskRenderRunning()
}
function kioskRenderRunning(){
  const box=$('kRunningList'); if(box){ box.innerHTML=kActiveLogs.map(l=>runCardHTML(l,'k')).join(''); kActiveLogs.forEach(l=>renderPhotoStrip('ph_k_'+l.id,l)) }
  startTaskTicker()
}
window.kioskStart=async function(){
  const t=catalog.find(c=>c.id===$('kSelTask').value); if(!t){msg($('kTaskMsg'),'Pick a task.',false);return}
  if(t.requires_product && !($('kProduct').value||'').trim()){msg($('kTaskMsg'),'Choose or + add a product before starting.',false);return}
  const eqId=($('kEquip')&&$('kEquip').value)||null
  const planMin=($('kPlanMin')&&$('kPlanMin').value)?Number($('kPlanMin').value):null
  const {data,error}=await sb.from('sim_task_logs').insert({staff_id:kStaff.id,catalog_id:t.id,task_name:t.name,station:t.station,uom:t.uom||'kg',product:$('kProduct').value.trim()||null,staff_count:Number($('kCount').value)||1,equipment_id:eqId,planned_minutes:planMin,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('kTaskMsg'),equipBusyErr(error),false);await loadEquipState();populateEquipSelect('kEquip');return}
  kActiveLogs.unshift(data); $('kProduct').value=''; if($('kPlanMin'))$('kPlanMin').value=''; clearMsg($('kTaskMsg')); await loadEquipState(); populateEquipSelect('kEquip'); kioskRenderRunning()
}
window.kioskStopFor=async function(id){
  const l=kActiveLogs.find(x=>x.id===id); if(!l)return
  const p='k_'+id
  const gv=pre=>{const e=$(pre+'_'+p); return (e&&e.value!=='')?Number(e.value):null}
  const units=gv('u'), waste=gv('w'); const kuom=uomFor(l)
  const he=numberHardError(units,waste,kuom); if(he){ alert(he); return }
  if(!numberSanityOK(units,waste)) return
  // Kiosk: amount + waste + photo are strictly required (no manager override).
  if(requiresUnits(l) && (units==null||isNaN(units))){ alert('Please enter the amount produced ('+kuom+') before finishing this task.'); return }
  if(requiresWaste(l) && (waste==null||isNaN(waste))){ alert('Please enter the waste ('+kuom+') for this task before finishing. If there was none, enter 0.'); return }
  if(!(l.photos&&l.photos.length)){ alert('A photo of the work is required before finishing.\n\nPlease add a photo above, then finish.'); return }
  let ps=l.paused_seconds||0; if(l.status==='paused'&&l.pause_started_at) ps+=(Date.now()-new Date(l.pause_started_at))/1000
  const stEl=$('st_'+p), chEl=$('ch_'+p), cmEl=$('cm_'+p)
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:stEl?Number(stEl.value)||1:(l.staff_count||1),changeover_mins:(chEl&&chEl.value)?Number(chEl.value):null,comments:cmEl?cmEl.value.trim()||null:null,status:'completed'}).eq('id',id)
  if(error){alert(finishErr(error));return}
  kActiveLogs=kActiveLogs.filter(x=>x.id!==id); await loadEquipState(); populateEquipSelect('kEquip'); kioskRenderRunning()
  if(typeof loadMyDayKiosk==='function') loadMyDayKiosk()
  alert('Logged — thanks '+kStaff.full_name+'!')
}
