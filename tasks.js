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
    const tempMeta=(t.records_temp||t.temp_target!=null)?` · 🌡 ${t.temp_dir==='max'?'≤':'≥'}${t.temp_target==null?'?':t.temp_target}°`:''
    const batchMeta=t.is_batch?` · 🔥 batch ${t.capacity_per_load??'?'}${_u}/load · ${t.cook_minutes??'?'}min · ${t.equipment_kind||'?'}`:''
    d.innerHTML=`<div><b>${esc(t.name)}</b><div class="meta">${esc(t.station)||'—'} · expected ${t.expected_units??'–'} ${_u} · ${t.expected_staff??'–'} ppl${t.requires_units===false?' · no '+_u:' · '+_u+' required'}${wasteMeta}${prodMeta}${batchMeta}${tempMeta}</div></div>`
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
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_batch_${id}" style="width:auto" ${t.is_batch?'checked':''}/> Batch/cook step (fills a vessel to capacity for a fixed cook time)</label>
    <div class="row" style="margin-top:8px">
      <input id="et_cap_${id}" type="number" value="${t.capacity_per_load??''}" placeholder="Capacity/load" />
      <input id="et_cook_${id}" type="number" value="${t.cook_minutes??''}" placeholder="Cook mins" />
      <select id="et_kind_${id}">${['','oven','sous_vide','combi','blast_chiller','freezer','other'].map(k=>`<option value="${k}" ${t.equipment_kind===k?'selected':''}>${k||'— vessel type —'}</option>`).join('')}</select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_temp_${id}" style="width:auto" ${(t.records_temp||t.temp_target!=null)?'checked':''}/> Records temperature (HACCP cook/chill) — the person logs a start and finish °C + time on the task card</label>
    <div class="row" style="margin-top:8px">
      <div><label>Target °C</label><input id="et_ttarget_${id}" type="number" value="${t.temp_target==null?'':t.temp_target}" placeholder="e.g. 75" /></div>
      <div><label>Direction</label><select id="et_tdir_${id}"><option value="min"${t.temp_dir!=='max'?' selected':''}>cook ≥</option><option value="max"${t.temp_dir==='max'?' selected':''}>chill ≤</option></select></div>
      <div><label>Chill window (mins)</label><input id="et_tmax_${id}" type="number" value="${t.temp_max_minutes==null?'':t.temp_max_minutes}" placeholder="e.g. 90" /></div>
    </div>
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
  const isBatch=$('et_batch_'+id).checked
  const cap=$('et_cap_'+id).value?Number($('et_cap_'+id).value):null
  const cook=$('et_cook_'+id).value?Number($('et_cook_'+id).value):null
  const kind=$('et_kind_'+id).value||null
  const tTarget=$('et_ttarget_'+id).value?Number($('et_ttarget_'+id).value):null
  const recTemp=$('et_temp_'+id).checked||tTarget!=null
  const tDir=$('et_tdir_'+id).value||'min'
  const tMax=$('et_tmax_'+id).value?Number($('et_tmax_'+id).value):null
  const {error}=await sb.from('sim_task_catalog').update({name,station,expected_units:units,expected_staff:staff,track_waste:trackWaste,require_waste:reqWaste,requires_units:reqUnits,requires_product:reqProduct,uom,is_batch:isBatch,capacity_per_load:cap,cook_minutes:cook,equipment_kind:kind,records_temp:recTemp,temp_target:tTarget,temp_dir:tDir,temp_max_minutes:tMax}).eq('id',id)
  if(error){msg($('addMsg'),error.message,false);return}
  await loadCatalog(); msg($('addMsg'),'Task updated.',true)
}
window.addTask=async function(){
  const name=$('ntName').value.trim(); if(!name){msg($('addMsg'),'Enter a task name.',false);return}
  const station=$('ntStation').value.trim()||null, units=$('ntUnits').value?Number($('ntUnits').value):null
  const order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order)):0)+1
  const uom=($('ntUom').value||'kg').trim()||'kg'
  const isBatch=$('ntBatch')?$('ntBatch').checked:false
  const cap=($('ntCap')&&$('ntCap').value)?Number($('ntCap').value):null
  const cook=($('ntCook')&&$('ntCook').value)?Number($('ntCook').value):null
  const kind=($('ntKind')&&$('ntKind').value)||null
  const tTarget=($('ntTempTarget')&&$('ntTempTarget').value)?Number($('ntTempTarget').value):null
  const recTemp=(($('ntTemp')&&$('ntTemp').checked)||tTarget!=null)
  const tDir=($('ntTempDir')&&$('ntTempDir').value)||'min'
  const tMax=($('ntTempMax')&&$('ntTempMax').value)?Number($('ntTempMax').value):null
  const {error}=await sb.from('sim_task_catalog').insert({name,station,expected_units:units,expected_staff:1,uom,track_waste:$('ntWaste').checked,require_waste:$('ntReqWaste').checked,requires_units:$('ntReqUnits').checked,requires_product:$('ntReqProduct').checked,is_batch:isBatch,capacity_per_load:cap,cook_minutes:cook,equipment_kind:kind,records_temp:recTemp,temp_target:tTarget,temp_dir:tDir,temp_max_minutes:tMax,sort_order:order})
  if(error){msg($('addMsg'),error.message,false);return}
  $('ntName').value='';$('ntStation').value='';$('ntUnits').value='';$('ntWaste').checked=false;$('ntReqWaste').checked=false;$('ntReqUnits').checked=true;$('ntReqProduct').checked=false;if($('ntBatch'))$('ntBatch').checked=false;if($('ntCap'))$('ntCap').value='';if($('ntCook'))$('ntCook').value='';if($('ntKind'))$('ntKind').value='';if($('ntTemp'))$('ntTemp').checked=false;if($('ntTempTarget'))$('ntTempTarget').value='';if($('ntTempMax'))$('ntTempMax').value='';msg($('addMsg'),'Task added.',true);await loadCatalog()
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
  await loadEquipState(); populateEquipSelect('sEquip')
  if(typeof loadMyDay==='function') loadMyDay()
}
function requiresTemp(l){const c=catFor(l);return !!(c&&(c.records_temp||c.temp_target!=null))}
function tempHint(c){if(!c||c.temp_target==null)return '';return c.temp_dir==='max'?(' — chill ≤'+c.temp_target+'°'+(c.temp_max_minutes?(' in '+c.temp_max_minutes+'m'):'')):(' — cook ≥'+c.temp_target+'°')}
function _hhmmLocal(t){if(!t)return '';const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function tempStamp(dateStr,hhmm,fallbackIso){if(!hhmm)return fallbackIso;const d=new Date((dateStr||new Date().toISOString().slice(0,10))+'T'+hhmm+':00');return isNaN(d.getTime())?fallbackIso:d.toISOString()}
function runCardHTML(l,m){
  const p=m+'_'+l.id
  const cat=catFor(l); const ru=!cat||cat.requires_units!==false; const sw=!!(cat&&(cat.track_waste||cat.require_waste)); const rw=!!(cat&&cat.require_waste); const u=uomFor(l); const rt=!!(cat&&(cat.records_temp||cat.temp_target!=null)); const th=tempHint(cat)
  const paused=l.status==='paused'
  const stopFn=m==='k'?'kioskStopFor':'stopTaskFor'
  const md=m==='k'?'kiosk':'main'
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${esc(l.task_name)}</h2><span class="pill ${paused?'off':'live'}">${paused?'❚❚ PAUSED':'● RUNNING'}</span></div>
    <div class="muted">${l.product?esc(l.product)+' · ':''}${l.staff_count||1} ppl · started ${fmtTime(l.start_time)}</div>
    ${l.equipment_id?'<div class="muted">🔧 '+esc(((typeof equipById==='function'&&equipById(l.equipment_id))||{}).name||'vessel')+(l.planned_minutes?' · '+l.planned_minutes+'m planned':'')+'</div>':''}
    <div class="timer" id="timer_${p}">00:00:00</div>
    ${ru?`<label>Amount produced (${u})</label><input id="u_${p}" type="number" inputmode="decimal" placeholder="${u==='kg'?'e.g. 22.5':'e.g. 150'}" />`:''}
    ${sw?`<label>Waste (${u})${rw?' — required':''}</label><input id="w_${p}" type="number" inputmode="decimal" placeholder="e.g. 3" />`:''}
    ${rt?`<label>Cook/chill check${th}</label><div class="row"><div><label>Start °C</label><input id="ts_${p}" type="number" inputmode="decimal" placeholder="start °" /></div><div><label>Start time</label><input id="tst_${p}" type="time" value="${_hhmmLocal(l.start_time)}" /></div></div><div class="row"><div><label>Finish °C</label><input id="tf_${p}" type="number" inputmode="decimal" placeholder="finish °" /></div><div><label>Finish time</label><input id="tft_${p}" type="time" /></div></div>`:''}
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
  const eqId=($('sEquip')&&$('sEquip').value)||null
  const planMin=($('sPlanMin')&&$('sPlanMin').value)?Number($('sPlanMin').value):null
  const {data,error}=await sb.from('sim_task_logs').insert({user_id:me.id,catalog_id:t.id,task_name:t.name,station:t.station,uom:t.uom||'kg',product:$('sProduct').value.trim()||null,staff_count:Number($('sStaff').value)||1,equipment_id:eqId,planned_minutes:planMin,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('logMsg'),equipBusyErr(error),false);await loadEquipState();populateEquipSelect('sEquip');return}
  activeLogs.unshift(data);$('sProduct').value='';if($('sPlanMin'))$('sPlanMin').value='';clearMsg($('logMsg'));await loadEquipState();populateEquipSelect('sEquip');renderRunning()
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
  const startTemp=gv('ts'), finishTemp=gv('tf')
  if(requiresTemp(l) && (startTemp==null||isNaN(startTemp)||finishTemp==null||isNaN(finishTemp))){ alert('Enter the start and finish temperature (°C) to finish this cook/chill step.'); return }
  const _sTAt=requiresTemp(l)?tempStamp(l.log_date,($('tst_'+p)&&$('tst_'+p).value),l.start_time):null
  const _fTAt=requiresTemp(l)?tempStamp(l.log_date,($('tft_'+p)&&$('tft_'+p).value),new Date().toISOString()):null
  let ps=l.paused_seconds||0; if(l.status==='paused'&&l.pause_started_at) ps+=(Date.now()-new Date(l.pause_started_at))/1000
  const stEl=$('st_'+p), chEl=$('ch_'+p), cmEl=$('cm_'+p)
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:stEl?Number(stEl.value)||1:(l.staff_count||1),changeover_mins:(chEl&&chEl.value)?Number(chEl.value):null,comments:cmEl?cmEl.value.trim()||null:null,start_temp:startTemp,finish_temp:finishTemp,start_temp_at:_sTAt,finish_temp_at:_fTAt,status:'completed'}).eq('id',id)
  if(error){alert(finishErr(error));return}
  activeLogs=activeLogs.filter(x=>x.id!==id); renderRunning(); await loadEquipState(); populateEquipSelect('sEquip'); await refreshMyRecent(); if(typeof loadMyDay==='function') loadMyDay(); if(isManagerUp())await refreshDashboard()
}
async function refreshMyRecent(){
  const today=new Date().toISOString().slice(0,10)
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).eq('log_date',today).order('start_time',{ascending:false})
  const box=$('myRecent'); if(!data||!data.length){box.innerHTML='<p class="muted">No tasks logged yet today.</p>';return}
  box.innerHTML=''
  data.forEach(l=>{const d=document.createElement('div');d.className='task-item';const status=l.status==='completed'?'<span class="pill done">done</span>':(l.status==='paused'?'<span class="pill off">❚❚ paused</span>':'<span class="pill live">● running</span>');const _u=uomFor(l);const uph=l.units_per_hour?`${l.units_per_hour} ${_u}/hr`:'';d.innerHTML=`<div><b>${esc(l.task_name)}</b> ${status}<div class="meta">${l.product?esc(l.product)+' · ':''}${l.units??'–'} ${_u} · ${l.total_minutes??'–'} min · ${uph}${l.waste_kg?' · '+l.waste_kg+' '+_u+' waste':''}${l.photos&&l.photos.length?' · 📷 '+l.photos.length:''}</div></div>`;box.appendChild(d)})
}

// ---- bulk CSV import / export (task catalog) ----
function parseCsv(text){
  const rows=[]; let i=0, field='', row=[], inQ=false
  const pushF=()=>{row.push(field);field=''}
  const pushR=()=>{rows.push(row);row=[]}
  while(i<text.length){
    const c=text[i]
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue} inQ=false;i++;continue }
      field+=c;i++;continue
    }
    if(c==='"'){inQ=true;i++;continue}
    if(c===','){pushF();i++;continue}
    if(c==='\r'){i++;continue}
    if(c==='\n'){pushF();pushR();i++;continue}
    field+=c;i++
  }
  if(field.length||row.length){pushF();pushR()}
  return rows.filter(r=>!(r.length===1&&r[0].trim()===''))
}
const _csvBool=v=>['1','true','yes','y'].includes(String(v||'').trim().toLowerCase())
window.taskCsvFile=function(ev){const f=ev.target.files&&ev.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('taskCsvText').value=r.result;msg($('impMsg'),'File loaded — review below, then Import.',true)};r.readAsText(f)}
window.importTasksCsv=async function(){
  const text=($('taskCsvText').value||'').trim(); if(!text){msg($('impMsg'),'Choose a file or paste CSV first.',false);return}
  const rows=parseCsv(text); if(rows.length<2){msg($('impMsg'),'Need a header row plus at least one task.',false);return}
  const hdr=rows[0].map(h=>h.trim().toLowerCase())
  const idx=(...names)=>{for(const n of names){const k=hdr.indexOf(n);if(k>=0)return k}return -1}
  const iName=idx('name','task','task name'); if(iName<0){msg($('impMsg'),'CSV must have a "name" column.',false);return}
  const C={station:idx('station'),expected:idx('expected_units','expected'),uom:idx('uom','unit'),requnits:idx('requires_units','records_amount'),reqproduct:idx('requires_product','product'),trackwaste:idx('track_waste'),reqwaste:idx('require_waste'),batch:idx('is_batch','batch'),cap:idx('capacity_per_load','capacity'),cook:idx('cook_minutes','cook'),kind:idx('equipment_kind','vessel_type'),rectemp:idx('records_temp','records_temperature'),ttarget:idx('temp_target'),tdir:idx('temp_dir'),tmax:idx('temp_max_minutes','temp_max')}
  const get=(r,i)=>(i>=0&&i<r.length)?String(r[i]).trim():''
  const numOr=v=>v===''?null:(isNaN(Number(v))?null:Number(v))
  const existing=new Map(catalog.map(c=>[(c.name||'').toLowerCase(),c]))
  let added=0,updated=0,skipped=0,order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order||0)):0)
  for(let ri=1;ri<rows.length;ri++){
    const r=rows[ri]; const name=get(r,iName); if(!name){skipped++;continue}
    const rec={name,
      station:C.station>=0?(get(r,C.station)||null):null,
      expected_units:C.expected>=0?numOr(get(r,C.expected)):null,
      uom:(C.uom>=0?get(r,C.uom):'')||'kg',
      requires_units:C.requnits>=0?_csvBool(get(r,C.requnits)):true,
      requires_product:C.reqproduct>=0?_csvBool(get(r,C.reqproduct)):false,
      track_waste:C.trackwaste>=0?_csvBool(get(r,C.trackwaste)):false,
      require_waste:C.reqwaste>=0?_csvBool(get(r,C.reqwaste)):false,
      is_batch:C.batch>=0?_csvBool(get(r,C.batch)):false,
      capacity_per_load:C.cap>=0?numOr(get(r,C.cap)):null,
      cook_minutes:C.cook>=0?numOr(get(r,C.cook)):null,
      equipment_kind:C.kind>=0?(get(r,C.kind)||null):null,
      records_temp:C.rectemp>=0?_csvBool(get(r,C.rectemp)):false,
      temp_target:C.ttarget>=0?numOr(get(r,C.ttarget)):null,
      temp_dir:C.tdir>=0?((get(r,C.tdir)||'min')):'min',
      temp_max_minutes:C.tmax>=0?numOr(get(r,C.tmax)):null}
    if(rec.temp_target!=null) rec.records_temp=true
    const ex=existing.get(name.toLowerCase())
    if(ex){const {error}=await sb.from('sim_task_catalog').update(rec).eq('id',ex.id);if(error){skipped++}else{updated++}}
    else{order++;const {error}=await sb.from('sim_task_catalog').insert(Object.assign({},rec,{expected_staff:1,active:true,sort_order:order}));if(error){skipped++}else{added++}}
  }
  msg($('impMsg'),`Imported — ${added} added, ${updated} updated${skipped?', '+skipped+' skipped':''}.`,true)
  $('taskCsvText').value=''; await loadCatalog()
}
window.exportTasksCsv=function(){
  const cols=['name','station','expected_units','uom','requires_units','requires_product','track_waste','require_waste','is_batch','capacity_per_load','cook_minutes','equipment_kind','records_temp','temp_target','temp_dir','temp_max_minutes']
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'
  const lines=[cols.join(',')].concat(catalog.map(t=>cols.map(c=>q(t[c])).join(',')))
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chefly-tasks.csv';a.click()
}
window.downloadTaskTemplate=function(){
  const tmpl='name,station,expected_units,uom,requires_units,requires_product,track_waste,require_waste,is_batch,capacity_per_load,cook_minutes,equipment_kind\nGrilled Chicken Sous Vide,Kitchen,,kg,yes,no,no,no,yes,100,120,sous_vide\nVacuum Tumble,Prep,,kg,yes,yes,no,no,no,,,\n'
  const blob=new Blob([tmpl],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chefly-tasks-template.csv';a.click()
}
