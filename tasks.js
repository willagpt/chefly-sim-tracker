/* TASKS: task catalog, products/recipes, and the My Task logging flow. */

async function loadCatalog(){
  const {data}=await sb.from('sim_task_catalog').select('*').eq('active',true).order('sort_order')
  catalog=data||[]; const sel=$('selTask'); sel.innerHTML=''
  catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;sel.appendChild(o)})
  renderTaskList()
}
window.renderTaskList=function(){
  const box=$('taskList'); if(!box) return; box.innerHTML=''
  catalog.forEach(t=>{
    const d=document.createElement('div'); d.className='task-item'; d.id='task_'+t.id
    const wasteMeta=t.require_waste?' · waste required':(t.track_waste?' · waste optional':'')
    const _u=t.uom||'kg'
    d.innerHTML=`<div><b>${t.name}</b><div class="meta">${t.station||'—'} · expected ${t.expected_units??'–'} ${_u} · ${t.expected_staff??'–'} ppl${t.requires_units===false?' · no '+_u:' · '+_u+' required'}${wasteMeta}</div></div>`
    const ctl=document.createElement('div'); ctl.style.display='flex'; ctl.style.gap='8px'; ctl.style.flexShrink='0'
    const e=document.createElement('button'); e.className='ghost sm'; e.textContent='Edit'; e.onclick=()=>editTask(t.id)
    const b=document.createElement('button'); b.className='ghost sm'; b.textContent='Remove'; b.onclick=async()=>{if(!confirm('Remove '+t.name+'?'))return;await sb.from('sim_task_catalog').update({active:false}).eq('id',t.id);await loadCatalog()}
    ctl.appendChild(e); ctl.appendChild(b); d.appendChild(ctl); box.appendChild(d)
  })
}
function renderTaskList(){ window.renderTaskList() }
window.editTask=function(id){
  const t=catalog.find(c=>c.id===id); if(!t) return
  const d=$('task_'+id); if(!d) return
  d.style.flexDirection='column'; d.style.alignItems='stretch'
  const esc=s=>(s||'').replace(/"/g,'&quot;')
  d.innerHTML=`
    <input id="et_name_${id}" value="${esc(t.name)}" placeholder="Task name" />
    <div class="row" style="margin-top:8px">
      <input id="et_station_${id}" value="${esc(t.station)}" placeholder="Station" />
      <input id="et_units_${id}" type="number" value="${t.expected_units??''}" placeholder="Expected" />
      <input id="et_uom_${id}" list="uomList" value="${t.uom||'kg'}" placeholder="Unit" style="max-width:90px" />
      <input id="et_staff_${id}" type="number" value="${t.expected_staff??''}" placeholder="Ppl" />
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_requnits_${id}" style="width:auto" ${t.requires_units!==false?'checked':''}/> Records amount produced (required to finish)</label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_waste_${id}" style="width:auto" ${t.track_waste?'checked':''}/> Track waste (show the box, optional)</label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_reqwaste_${id}" style="width:auto" ${t.require_waste?'checked':''}/> Require a waste figure to finish</label>
    <div class="row" style="margin-top:8px">
      <button class="green sm" style="flex:1" onclick="saveTask('${id}')">Save</button>
      <button class="ghost sm" style="flex:1" onclick="renderTaskList()">Cancel</button>
    </div>`
}
window.saveTask=async function(id){
  const name=$('et_name_'+id).value.trim(); if(!name){alert('Task name is required');return}
  const station=$('et_station_'+id).value.trim()||null
  const units=$('et_units_'+id).value?Number($('et_units_'+id).value):null
  const staff=$('et_staff_'+id).value?Number($('et_staff_'+id).value):null
  const trackWaste=$('et_waste_'+id).checked
  const reqWaste=$('et_reqwaste_'+id).checked
  const reqUnits=$('et_requnits_'+id).checked
  const uom=($('et_uom_'+id).value||'kg').trim()||'kg'
  const {error}=await sb.from('sim_task_catalog').update({name,station,expected_units:units,expected_staff:staff,track_waste:trackWaste,require_waste:reqWaste,requires_units:reqUnits,uom}).eq('id',id)
  if(error){msg($('addMsg'),error.message,false);return}
  await loadCatalog(); msg($('addMsg'),'Task updated.',true)
}
window.addTask=async function(){
  const name=$('ntName').value.trim(); if(!name){msg($('addMsg'),'Enter a task name.',false);return}
  const station=$('ntStation').value.trim()||null, units=$('ntUnits').value?Number($('ntUnits').value):null
  const order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order)):0)+1
  const uom=($('ntUom').value||'kg').trim()||'kg'
  const {error}=await sb.from('sim_task_catalog').insert({name,station,expected_units:units,expected_staff:1,uom,track_waste:$('ntWaste').checked,require_waste:$('ntReqWaste').checked,requires_units:$('ntReqUnits').checked,sort_order:order})
  if(error){msg($('addMsg'),error.message,false);return}
  $('ntName').value='';$('ntStation').value='';$('ntUnits').value='';$('ntWaste').checked=false;$('ntReqWaste').checked=false;$('ntReqUnits').checked=true;msg($('addMsg'),'Task added.',true);await loadCatalog()
}

// ---- products / recipes ----
async function loadProducts(){
  const {data}=await sb.from('sim_products').select('*').eq('active',true).order('sort_order').order('name')
  products=data||[]
  populateProductSelects(); renderProductList()
}
function populateProductSelects(){
  ['sProduct','kProduct'].forEach(id=>{const sel=$(id); if(!sel)return; const cur=sel.value; sel.innerHTML='<option value="">— select product —</option>'+products.map(p=>`<option>${p.name}</option>`).join(''); if(cur)sel.value=cur})
}
function renderProductList(){
  const box=$('productList'); if(!box) return; box.innerHTML=''
  products.forEach(p=>{const d=document.createElement('div');d.className='task-item';d.innerHTML='<div><b>'+p.name+'</b></div>';const b=document.createElement('button');b.className='ghost sm';b.textContent='Remove';b.onclick=async()=>{if(!confirm('Remove '+p.name+'?'))return;await sb.from('sim_products').update({active:false}).eq('id',p.id);await loadProducts()};d.appendChild(b);box.appendChild(d)})
  if(!products.length) box.innerHTML='<p class="muted">No products yet. Add one above.</p>'
}
window.addProduct=async function(){
  const name=$('npName').value.trim(); if(!name){msg($('prMsg'),'Enter a product/recipe name.',false);return}
  const order=(products.length?Math.max(...products.map(p=>p.sort_order)):0)+1
  const {error}=await sb.from('sim_products').insert({name,sort_order:order})
  if(error){msg($('prMsg'),error.message,false);return}
  $('npName').value='';msg($('prMsg'),'Added.',true);await loadProducts()
}

// ---- My Task logging ----
async function loadActive(){
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).in('status',['in_progress','paused']).order('start_time',{ascending:false}).limit(1)
  activeLog=(data&&data[0])||null; renderActive()
}
function renderActive(){
  if(activeLog){hide($('startCard'));show($('activeCard'));$('activeName').textContent=activeLog.task_name;$('activeMeta').textContent=`${activeLog.product?activeLog.product+' · ':''}${activeLog.staff_count||1} ppl · started ${fmtTime(activeLog.start_time)}`;$('fStaff').value=activeLog.staff_count||1;const _cat=catFor(activeLog);const _ru=!_cat||_cat.requires_units!==false;const _sw=!!(_cat&&(_cat.track_waste||_cat.require_waste));const _rw=!!(_cat&&_cat.require_waste);$('unitsWrap').classList.toggle('hidden',!_ru);$('fWaste').value='';$('wasteWrap').classList.toggle('hidden',!_sw);$('wasteToggleP').classList.toggle('hidden',_sw);const _uom=uomFor(activeLog);const _ul=$('fUnitsLabel');if(_ul)_ul.textContent='Amount produced ('+_uom+')';const _uin=$('fUnits');if(_uin)_uin.placeholder=_uom==='kg'?'e.g. 22.5':'e.g. 150';const _wl=$('fWasteLabel');if(_wl)_wl.textContent=_rw?'Waste ('+_uom+') — required':'Waste ('+_uom+')';const _wtp=document.querySelector('#wasteToggleP a');if(_wtp)_wtp.textContent='+ Record waste ('+_uom+')';renderPhotoStrip('photoStrip',activeLog);updatePauseUI(activeLog,'activePill','pauseBtn');if(timerInt)clearInterval(timerInt);const tick=()=>{$('activeTimer').textContent=fmtClock(workedSeconds(activeLog))};tick();timerInt=setInterval(tick,1000)}
  else{show($('startCard'));hide($('activeCard'));if(timerInt)clearInterval(timerInt)}
}
window.showWaste=function(){$('wasteWrap').classList.remove('hidden');$('wasteToggleP').classList.add('hidden')}
window.togglePause=async function(mode){
  const log=mode==='kiosk'?kActiveLog:activeLog; if(!log) return
  if(log.status==='paused'){
    const add=(Date.now()-new Date(log.pause_started_at))/1000
    log.paused_seconds=(log.paused_seconds||0)+add; log.pause_started_at=null; log.status='in_progress'
    await sb.from('sim_task_logs').update({status:'in_progress',paused_seconds:log.paused_seconds,pause_started_at:null}).eq('id',log.id)
  } else {
    log.status='paused'; log.pause_started_at=new Date().toISOString()
    await sb.from('sim_task_logs').update({status:'paused',pause_started_at:log.pause_started_at}).eq('id',log.id)
  }
  mode==='kiosk'?kioskRenderActive():renderActive()
}
window.startTask=async function(){
  const t=catalog.find(c=>c.id===$('selTask').value); if(!t){msg($('logMsg'),'Pick a task.',false);return}
  const {data,error}=await sb.from('sim_task_logs').insert({user_id:me.id,catalog_id:t.id,task_name:t.name,station:t.station,uom:t.uom||'kg',product:$('sProduct').value.trim()||null,staff_count:Number($('sStaff').value)||1,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('logMsg'),error.message,false);return}
  activeLog=data;$('sProduct').value='';clearMsg($('logMsg'));renderActive()
}
window.stopTask=async function(){
  if(!activeLog) return
  const units=$('fUnits').value?Number($('fUnits').value):null
  const waste=$('fWaste').value?Number($('fWaste').value):null
  const he=numberHardError(units,waste,uomFor(activeLog)); if(he){ alert(he); return }
  if(!numberSanityOK(units,waste)) return
  if(requiresUnits(activeLog) && (units==null||isNaN(units))){ unitsGateOK(); return }
  if(requiresWaste(activeLog) && (waste==null||isNaN(waste))){ wasteGateOK(); return }
  if(!photoGateOK(activeLog)) return
  let ps=activeLog.paused_seconds||0; if(activeLog.status==='paused'&&activeLog.pause_started_at) ps+=(Date.now()-new Date(activeLog.pause_started_at))/1000
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:Number($('fStaff').value)||1,changeover_mins:$('fChange').value?Number($('fChange').value):null,comments:$('fComments').value.trim()||null,status:'completed'}).eq('id',activeLog.id)
  if(error){alert(finishErr(error));return}
  activeLog=null;$('fUnits').value='';$('fWaste').value='';$('fChange').value='';$('fComments').value='';renderActive();await refreshMyRecent();if(isManagerUp())await refreshDashboard()
}
async function refreshMyRecent(){
  const today=new Date().toISOString().slice(0,10)
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).eq('log_date',today).order('start_time',{ascending:false})
  const box=$('myRecent'); if(!data||!data.length){box.innerHTML='<p class="muted">No tasks logged yet today.</p>';return}
  box.innerHTML=''
  data.forEach(l=>{const d=document.createElement('div');d.className='task-item';const status=l.status==='completed'?'<span class="pill done">done</span>':(l.status==='paused'?'<span class="pill off">❚❚ paused</span>':'<span class="pill live">● running</span>');const _u=uomFor(l);const uph=l.units_per_hour?`${l.units_per_hour} ${_u}/hr`:'';d.innerHTML=`<div><b>${l.task_name}</b> ${status}<div class="meta">${l.product?l.product+' · ':''}${l.units??'–'} ${_u} · ${l.total_minutes??'–'} min · ${uph}${l.waste_kg?' · '+l.waste_kg+' '+_u+' waste':''}${l.photos&&l.photos.length?' · 📷 '+l.photos.length:''}</div></div>`;box.appendChild(d)})
}
