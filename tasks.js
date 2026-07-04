/* TASKS: task catalog, products/recipes, and the My Task logging flow (multiple concurrent). */

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
    const prodMeta=t.requires_product?' · product required':''
    d.innerHTML=`<div><b>${esc(t.name)}</b><div class="meta">${esc(t.station)||'—'} · expected ${t.expected_units??'–'} ${_u} · ${t.expected_staff??'–'} ppl${t.requires_units===false?' · no '+_u:' · '+_u+' required'}${wasteMeta}${prodMeta}</div></div>`
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
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_reqproduct_${id}" style="width:auto" ${t.requires_product?'checked':''}/> Requires a product (e.g. what's being packed)</label>
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
  const reqProduct=$('et_reqproduct_'+id).checked
  const {error}=await sb.from('sim_task_catalog').update({name,station,expected_units:units,expected_staff:staff,track_waste:trackWaste,require_waste:reqWaste,requires_units:reqUnits,requires_product:reqProduct,uom}).eq('id',id)
  if(error){msg($('addMsg'),error.message,false);return}
  await loadCatalog(); msg($('addMsg'),'Task updated.',true)
}
window.addTask=async function(){
  const name=$('ntName').value.trim(); if(!name){msg($('addMsg'),'Enter a task name.',false);return}
  const station=$('ntStation').value.trim()||null, units=$('ntUnits').value?Number($('ntUnits').value):null
  const order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order)):0)+1
  const uom=($('ntUom').value||'kg').trim()||'kg'
  const {error}=await sb.from('sim_task_catalog').insert({name,station,expected_units:units,expected_staff:1,uom,track_waste:$('ntWaste').checked,require_waste:$('ntReqWaste').checked,requires_units:$('ntReqUnits').checked,requires_product:$('ntReqProduct').checked,sort_order:order})
  if(error){msg($('addMsg'),error.message,false);return}
  $('ntName').value='';$('ntStation').value='';$('ntUnits').value='';$('ntWaste').checked=false;$('ntReqWaste').checked=false;$('ntReqUnits').checked=true;$('ntReqProduct').checked=false;msg($('addMsg'),'Task added.',true);await loadCatalog()
}

// ---- products / recipes ----
async function loadProducts(){
  const {data}=await sb.from('sim_products').select('*').eq('active',true).order('sort_order').order('name')
  products=data||[]
  populateProductSelects(); renderProductList()
}
function populateProductSelects(){
  ['sProduct','kProduct'].forEach(id=>{const sel=$(id); if(!sel)return; const cur=sel.value; sel.innerHTML='<option value="">— select product —</option>'+products.map(p=>`<option>${esc(p.name)}</option>`).join(''); if(cur)sel.value=cur})
}
function renderProductList(){
  const box=$('productList'); if(!box) return; box.innerHTML=''
  products.forEach(p=>{const d=document.createElement('div');d.className='task-item';d.innerHTML='<div><b>'+esc(p.name)+'</b></div>';const b=document.createElement('button');b.className='ghost sm';b.textContent='Remove';b.onclick=async()=>{if(!confirm('Remove '+p.name+'?'))return;await sb.from('sim_products').update({active:false}).eq('id',p.id);await loadProducts()};d.appendChild(b);box.appendChild(d)})
  if(!products.length) box.innerHTML='<p class="muted">No products yet. Add one above.</p>'
}
window.addProductInline=async function(which){
  const nm=prompt('New product / recipe — use the exact name for production sheets:')
  if(nm===null)return
  const n=nm.trim(); if(!n)return
  let prod=products.find(p=>(p.name||'').toLowerCase()===n.toLowerCase())
  if(!prod){
    const order=(products.length?Math.max(...products.map(p=>p.sort_order)):0)+1
    const {data,error}=await sb.from('sim_products').insert({name:n,sort_order:order}).select().single()
    if(error){alert(error.message);return}
    prod=data; products.push(prod); populateProductSelects()
  }
  const sel=$(which==='k'?'kProduct':'sProduct'); if(sel) sel.value=prod.name
}
window.addProduct=async function(){
  const name=$('npName').value.trim(); if(!name){msg($('prMsg'),'Enter a product/recipe name.',false);return}
  const order=(products.length?Math.max(...products.map(p=>p.sort_order)):0)+1
  const {error}=await sb.from('sim_products').insert({name,sort_order:order})
  if(error){msg($('prMsg'),error.message,false);return}
  $('npName').value='';msg($('prMsg'),'Added.',true);await loadProducts()
}

// ---- My Task logging (multiple concurrent tasks per person) ----
async function loadActive(){
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).in('status',['in_progress','paused']).order('start_time',{ascending:false})
  activeLogs=data||[]; renderRunning()
}
function runCardHTML(l,m){
  const p=m+'_'+l.id
  const cat=catFor(l); const ru=!cat||cat.requires_units!==false; const sw=!!(cat&&(cat.track_waste||cat.require_waste)); const rw=!!(cat&&cat.require_waste); const u=uomFor(l)
  const paused=l.status==='paused'
  const stopFn=m==='k'?'kioskStopFor':'stopTaskFor'
  const md=m==='k'?'kiosk':'main'
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${esc(l.task_name)}</h2><span class="pill ${paused?'off':'live'}">${paused?'❚❚ PAUSED':'● RUNNING'}</span></div>
    <div class="muted">${l.product?esc(l.product)+' · ':''}${l.staff_count||1} ppl · started ${fmtTime(l.start_time)}</div>
    <div class="timer" id="timer_${p}">00:00:00</div>
    ${ru?`<label>Amount produced (${u})</label><input id="u_${p}" type="number" inputmode="decimal" placeholder="${u==='kg'?'e.g. 22.5':'e.g. 150'}" />`:''}
    ${sw?`<label>Waste (${u})${rw?' — required':''}</label><input id="w_${p}" type="number" inputmode="decimal" placeholder="e.g. 3" />`:''}
    <div class="row"><div><label>People on task</label><input id="st_${p}" type="number" inputmode="numeric" min="1" value="${l.staff_count||1}" /></div><div><label>Change over (mins)</label><input id="ch_${p}" type="number" inputmode="numeric" placeholder="0" /></div></div>
    <label>Comments</label><textarea id="cm_${p}" rows="2" placeholder="Anything notable?"></textarea>
    <label>Photos of the work (required to finish)</label>
    <div id="ph_${p}" class="photo-strip"></div>
    <input type="file" accept="image/*" capture="environment" multiple onchange="uploadPhotosFor(event,'${l.id}','${md}')" style="padding:10px" />
    <button class="ghost" onclick="togglePauseFor('${l.id}','${md}')">${paused?'▶ Resume':'⏸ Pause'}</button>
    <button class="red" onclick="${stopFn}('${l.id}')">■ STOP &amp; FINISH</button>
  </div>`
}
function renderRunning(){
  const box=$('runningList'); if(box){ box.innerHTML=activeLogs.map(l=>runCardHTML(l,'s')).join(''); activeLogs.forEach(l=>renderPhotoStrip('ph_s_'+l.id,l)) }
  startTaskTicker()
}
function startTaskTicker(){
  if(timerInt)clearInterval(timerInt)
  timerInt=setInterval(()=>{
    activeLogs.forEach(l=>{const el=$('timer_s_'+l.id); if(el)el.textContent=fmtClock(workedSeconds(l))})
    kActiveLogs.forEach(l=>{const el=$('timer_k_'+l.id); if(el)el.textContent=fmtClock(workedSeconds(l))})
  },1000)
}
window.togglePauseFor=async function(id,mode){
  const arr=mode==='kiosk'?kActiveLogs:activeLogs; const log=arr.find(x=>x.id===id); if(!log)return
  if(log.status==='paused'){const add=(Date.now()-new Date(log.pause_started_at))/1000; log.paused_seconds=(log.paused_seconds||0)+add; log.pause_started_at=null; log.status='in_progress'; await sb.from('sim_task_logs').update({status:'in_progress',paused_seconds:log.paused_seconds,pause_started_at:null}).eq('id',id)}
  else {log.status='paused'; log.pause_started_at=new Date().toISOString(); await sb.from('sim_task_logs').update({status:'paused',pause_started_at:log.pause_started_at}).eq('id',id)}
  mode==='kiosk'?kioskRenderRunning():renderRunning()
}
window.startTask=async function(){
  const t=catalog.find(c=>c.id===$('selTask').value); if(!t){msg($('logMsg'),'Pick a task.',false);return}
  if(t.requires_product && !($('sProduct').value||'').trim()){msg($('logMsg'),'Choose or + add a product before starting.',false);return}
  const {data,error}=await sb.from('sim_task_logs').insert({user_id:me.id,catalog_id:t.id,task_name:t.name,station:t.station,uom:t.uom||'kg',product:$('sProduct').value.trim()||null,staff_count:Number($('sStaff').value)||1,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('logMsg'),error.message,false);return}
  activeLogs.unshift(data);$('sProduct').value='';clearMsg($('logMsg'));renderRunning()
}
window.stopTaskFor=async function(id){
  const l=activeLogs.find(x=>x.id===id); if(!l)return
  const p='s_'+id
  const gv=pre=>{const e=$(pre+'_'+p); return (e&&e.value!=='')?Number(e.value):null}
  const units=gv('u'), waste=gv('w')
  const he=numberHardError(units,waste,uomFor(l)); if(he){ alert(he); return }
  if(!numberSanityOK(units,waste)) return
  if(requiresUnits(l) && (units==null||isNaN(units))){ unitsGateOK(); return }
  if(requiresWaste(l) && (waste==null||isNaN(waste))){ wasteGateOK(); return }
  if(!photoGateOK(l)) return
  let ps=l.paused_seconds||0; if(l.status==='paused'&&l.pause_started_at) ps+=(Date.now()-new Date(l.pause_started_at))/1000
  const stEl=$('st_'+p), chEl=$('ch_'+p), cmEl=$('cm_'+p)
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:stEl?Number(stEl.value)||1:(l.staff_count||1),changeover_mins:(chEl&&chEl.value)?Number(chEl.value):null,comments:cmEl?cmEl.value.trim()||null:null,status:'completed'}).eq('id',id)
  if(error){alert(finishErr(error));return}
  activeLogs=activeLogs.filter(x=>x.id!==id); renderRunning(); await refreshMyRecent(); if(isManagerUp())await refreshDashboard()
}
async function refreshMyRecent(){
  const today=new Date().toISOString().slice(0,10)
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).eq('log_date',today).order('start_time',{ascending:false})
  const box=$('myRecent'); if(!data||!data.length){box.innerHTML='<p class="muted">No tasks logged yet today.</p>';return}
  box.innerHTML=''
  data.forEach(l=>{const d=document.createElement('div');d.className='task-item';const status=l.status==='completed'?'<span class="pill done">done</span>':(l.status==='paused'?'<span class="pill off">❚❚ paused</span>':'<span class="pill live">● running</span>');const _u=uomFor(l);const uph=l.units_per_hour?`${l.units_per_hour} ${_u}/hr`:'';d.innerHTML=`<div><b>${esc(l.task_name)}</b> ${status}<div class="meta">${l.product?esc(l.product)+' · ':''}${l.units??'–'} ${_u} · ${l.total_minutes??'–'} min · ${uph}${l.waste_kg?' · '+l.waste_kg+' '+_u+' waste':''}${l.photos&&l.photos.length?' · 📷 '+l.photos.length:''}</div></div>`;box.appendChild(d)})
}
