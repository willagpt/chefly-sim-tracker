import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://fhztszxpgqhunogwcoxw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3g-avL7NqQQsIMESfiGk4Q_8dBIarve'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

let me=null, profile=null, catalog=[], products=[], activeLog=null, timerInt=null
let lastFinishIds=new Set(), notifyReady=false, booting=false, kStaff=null, kActiveLog=null, kTimerInt=null

const $ = id => document.getElementById(id)
const show=el=>el.classList.remove('hidden'), hide=el=>el.classList.add('hidden')
function msg(el,t,ok){el.textContent=t; el.className='msg show '+(ok?'ok':'err')}
function clearMsg(el){el.className='msg'}
function fmtClock(s){s=Math.max(0,Math.floor(s));const h=String(Math.floor(s/3600)).padStart(2,'0'),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),x=String(s%60).padStart(2,'0');return `${h}:${m}:${x}`}
const mins=(a,b)=>((new Date(b)-new Date(a))/60000)
const fmtTime=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
function workedSeconds(l){let s=(Date.now()-new Date(l.start_time))/1000-(l.paused_seconds||0);if(l.status==='paused'&&l.pause_started_at)s-=(Date.now()-new Date(l.pause_started_at))/1000;return Math.max(0,s)}
function updatePauseUI(l,pillId,btnId){const paused=l.status==='paused';const pill=$(pillId);if(pill){pill.textContent=paused?'❚❚ PAUSED':'● RUNNING';pill.className='pill '+(paused?'off':'live')}const btn=$(btnId);if(btn){btn.textContent=paused?'▶ Resume':'⏸ Pause';btn.className=paused?'green':'ghost'}}
function catFor(log){return catalog.find(c=>c.id===log.catalog_id)}
function requiresUnits(log){const c=catFor(log);return !c || c.requires_units!==false}
function finishErr(error){return /KG_REQUIRED/.test(error.message)?'Please enter the kilograms produced before finishing this task.':error.message}
function numberSanityOK(units,waste){
  const issues=[]
  if(units!=null && units>1000) issues.push('Produced = '+units+' kg (over 1000)')
  if(waste!=null && waste>1000) issues.push('Waste = '+waste+' kg (over 1000)')
  if(units!=null && waste!=null && waste>units && waste>20) issues.push('Waste ('+waste+' kg) is more than produced ('+units+' kg)')
  if(!issues.length) return true
  return confirm('⚠ Please double-check these numbers:\n\n• '+issues.join('\n• ')+'\n\nTap OK to save anyway, or Cancel to go back and fix.')
}
function unitsGateOK(){
  // kg is a required KPI — no override for anyone. The database enforces this too.
  alert('Please enter the kilograms produced before finishing this task.\n\nIf this job genuinely has no weight, an admin can untick "Records kg" for it in Manage → Tasks.')
  return false
}
function photoGateOK(log){
  if(log.photos && log.photos.length) return true
  if(isManagerUp()) return confirm('No photo added. Finish without a photo?\n\n(Manager override — staff cannot skip this.)')
  alert('A photo is required to finish this task.\n\nPlease add a photo of the work above. If it will not upload, ask a manager to finish it for you.')
  return false
}
const photoUrl=p=>sb.storage.from('sim-photos').getPublicUrl(p).data.publicUrl
function renderPhotoStrip(id,log){
  const box=$(id); if(!box) return; box.innerHTML=''
  const paths=(log&&log.photos)||[]
  const urls=paths.map(photoUrl); const lb=urls.join('|')
  paths.forEach((p,idx)=>{
    const wrap=document.createElement('div'); wrap.className='pwrap'
    const img=document.createElement('img'); img.src=urls[idx]; img.loading='lazy'; img.style.cursor='zoom-in'
    img.dataset.lb=lb; img.dataset.i=idx; img.onclick=()=>openLightboxEl(img)
    wrap.appendChild(img)
    const x=document.createElement('button'); x.className='del'; x.textContent='✕'; x.title='Remove photo'
    x.onclick=(e)=>{e.preventDefault(); e.stopPropagation(); delPhoto(log,p,id)}
    wrap.appendChild(x); box.appendChild(wrap)
  })
}
window.delPhoto=async function(log,path,stripId){
  if(!log) return
  if(!confirm('Remove this photo?')) return
  log.photos=(log.photos||[]).filter(x=>x!==path)
  const u=await sb.from('sim_task_logs').update({photos:log.photos}).eq('id',log.id)
  if(u.error){alert('Could not remove: '+u.error.message);return}
  await sb.storage.from('sim-photos').remove([path])
  renderPhotoStrip(stripId,log)
}
window.uploadPhotos=async function(ev,mode){
  const log=mode==='kiosk'?kActiveLog:activeLog
  if(!log){alert('Start the task first.');return}
  const files=[...(ev.target.files||[])]; ev.target.value=''
  for(const f of files){
    const ext=(f.name.split('.').pop()||'jpg').toLowerCase()
    const path=`${log.id}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`
    const up=await sb.storage.from('sim-photos').upload(path,f,{contentType:f.type||'image/jpeg'})
    if(up.error){alert('Photo upload failed: '+up.error.message+'\n\nIf it keeps failing, ask a manager to finish the task.');continue}
    log.photos=[...(log.photos||[]),path]
    const u=await sb.from('sim_task_logs').update({photos:log.photos}).eq('id',log.id)
    if(u.error){alert('Saved photo but could not attach it: '+u.error.message);continue}
  }
  renderPhotoStrip(mode==='kiosk'?'kPhotoStrip':'photoStrip', log)
}

// ---------- PHOTO LIGHTBOX ----------
let lbUrls=[], lbIdx=0
window.openLightbox=function(urls,i){
  lbUrls=(urls||[]).filter(Boolean); if(!lbUrls.length)return
  lbIdx=Math.max(0,Math.min(i||0,lbUrls.length-1)); lbRender()
  const lb=$('lightbox'); if(lb)lb.classList.remove('hidden')
}
window.openLightboxEl=function(el){ openLightbox((el.dataset.lb||'').split('|'), Number(el.dataset.i||0)) }
function lbRender(){
  const img=$('lbImg'); if(img)img.src=lbUrls[lbIdx]||''
  const multi=lbUrls.length>1
  const c=$('lbCount'); if(c){c.textContent=multi?(lbIdx+1)+' / '+lbUrls.length:'';c.style.display=multi?'block':'none'}
  const pv=document.querySelector('.lb-prev'), nx=document.querySelector('.lb-next')
  if(pv)pv.style.display=multi?'flex':'none'; if(nx)nx.style.display=multi?'flex':'none'
}
window.lbClose=function(){ const lb=$('lightbox'); if(lb)lb.classList.add('hidden'); lbUrls=[] }
window.lbPrev=function(e){ if(e)e.stopPropagation(); if(!lbUrls.length)return; lbIdx=(lbIdx-1+lbUrls.length)%lbUrls.length; lbRender() }
window.lbNext=function(e){ if(e)e.stopPropagation(); if(!lbUrls.length)return; lbIdx=(lbIdx+1)%lbUrls.length; lbRender() }
window.lbBackdrop=function(e){ if(e.target&&e.target.id==='lightbox') lbClose() }
window.addEventListener('keydown',e=>{ const lb=$('lightbox'); if(!lb||lb.classList.contains('hidden'))return; if(e.key==='Escape')lbClose(); else if(e.key==='ArrowLeft')lbPrev(); else if(e.key==='ArrowRight')lbNext() })

const isManagerUp=()=> profile && (profile.role==='manager'||profile.role==='admin')
const isAdmin=()=> profile && profile.role==='admin'

function setAuthView(mode){ // bootstrap | login | signup | pw
  $('bootstrapStep').classList.toggle('hidden', mode!=='bootstrap')
  $('authToggle').classList.toggle('hidden', !(mode==='login'||mode==='signup'))
  $('loginStep').classList.toggle('hidden', mode!=='login')
  $('signupStep').classList.toggle('hidden', mode!=='signup')
  $('pwStep').classList.toggle('hidden', mode!=='pw')
  if(mode==='login'||mode==='signup'){
    $('authTabLogin').classList.toggle('active', mode==='login')
    $('authTabSignup').classList.toggle('active', mode==='signup')
  }
}
window.showAuth=function(m){ clearMsg($('loginMsg')); setAuthView(m) }

// ---------- AUTH ACTIONS ----------
window.logIn=async function(){
  const email=$('email').value.trim().toLowerCase(), password=$('password').value
  if(!email||!password){msg($('loginMsg'),'Enter your email and password.',false);return}
  const btn=$('loginBtn'); btn.disabled=true; btn.textContent='Logging in…'
  const {data,error}=await sb.auth.signInWithPassword({email,password})
  btn.disabled=false; btn.textContent='Log in'
  if(error){msg($('loginMsg'), /invalid/i.test(error.message)? 'Wrong email or password.' : error.message, false);return}
  me=data.user; clearMsg($('loginMsg')); await afterAuth()
}
window.createFirstAdmin=async function(){
  const email=$('bEmail').value.trim().toLowerCase(), name=$('bName').value.trim(), password=$('bPass').value
  if(!email||password.length<6){msg($('loginMsg'),'Enter an email and a password of 6+ characters.',false);return}
  const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'create_user',email,name,password}})
  if(error||data?.error){msg($('loginMsg'),(data&&data.error)||error.message,false);return}
  const {data:s,error:le}=await sb.auth.signInWithPassword({email,password})
  if(le){msg($('loginMsg'),'Account created — please log in.',true);setAuthView('login');$('email').value=email;return}
  me=s.user; clearMsg($('loginMsg')); await afterAuth()
}
window.createAccount=async function(){
  const name=$('suName').value.trim(), email=$('suEmail').value.trim().toLowerCase(), password=$('suPass').value, code=$('suCode').value.trim()
  if(!email||!email.includes('@')){msg($('loginMsg'),'Enter a valid email.',false);return}
  if(password.length<6){msg($('loginMsg'),'Password must be 6+ characters.',false);return}
  if(!code){msg($('loginMsg'),'Enter the join code from your manager.',false);return}
  const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'self_signup',name,email,password,code}})
  if(error||data?.error){msg($('loginMsg'),(data&&data.error)||error.message,false);return}
  const {data:s,error:le}=await sb.auth.signInWithPassword({email,password})
  if(le){msg($('loginMsg'),'Account created — please log in.',true);setAuthView('login');$('email').value=email;return}
  me=s.user; clearMsg($('loginMsg')); await afterAuth()
}
window.forgotPassword=async function(){
  const email=$('email').value.trim().toLowerCase()
  if(!email){msg($('loginMsg'),'Type your email above first, then tap Forgot password.',false);return}
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname})
  if(error){msg($('loginMsg'),error.message,false);return}
  msg($('loginMsg'),'If email is set up you\'ll get a reset link. Otherwise ask your admin to reset it.',true)
}
window.setMyPassword=async function(){
  const a=$('np1').value, b=$('np2').value
  if(a.length<6){msg($('loginMsg'),'Password must be 6+ characters.',false);return}
  if(a!==b){msg($('loginMsg'),'Passwords do not match.',false);return}
  const {error}=await sb.auth.updateUser({password:a})
  if(error){msg($('loginMsg'),error.message,false);return}
  await sb.from('sim_profiles').update({must_change_password:false}).eq('id',me.id)
  profile.must_change_password=false; clearMsg($('loginMsg')); await showApp()
}
window.signOut=async function(){await sb.auth.signOut();location.reload()}

// ---------- BOOT (no DB awaits inside onAuthStateChange — avoids auth deadlock) ----------
;(async()=>{
  try{ const {data:needs}=await sb.rpc('sim_needs_bootstrap'); if(needs){ setAuthView('bootstrap') } else { setAuthView('login') } }
  catch(e){ setAuthView('login') }
  const {data}=await sb.auth.getSession()
  if(data.session){ me=data.session.user; await afterAuth() }
})()
sb.auth.onAuthStateChange((event)=>{ if(event==='SIGNED_OUT'){ me=null } })

async function afterAuth(){
  if(!me||booting) return
  booting=true
  try{
    await loadProfile()
    if(profile.must_change_password){ hide($('appView')); show($('loginView')); setAuthView('pw'); return }
    await showApp()
  }catch(e){
    await sb.auth.signOut(); me=null
    show($('loginView')); hide($('appView')); setAuthView('login')
    msg($('loginMsg'),(e&&e.message)||'Account not set up. Ask your admin.',false)
  }finally{ booting=false }
}
async function loadProfile(){
  const {data,error}=await sb.from('sim_profiles').select('*').eq('id',me.id).maybeSingle()
  if(error) throw error
  if(!data) throw new Error('Your account is not fully set up yet. Please ask your admin.')
  profile=data
}
async function showApp(){
  hide($('loginView')); show($('appView'))
  $('whoName').textContent=profile.full_name||me.email
  const r=profile.role||'staff'; const badge=$('whoRole'); badge.textContent=r; badge.className='badge '+r
  $('kioskLink').classList.toggle('hidden',!isManagerUp())
  buildTabs()
  await loadCatalog(); await loadProducts(); await loadActive(); await refreshMyRecent()
  if(isManagerUp()) await refreshDashboard()
  subscribeRealtime()
  if('Notification' in window && Notification.permission==='default'){ try{notifyReady=(await Notification.requestPermission())==='granted'}catch(e){} }
  else { notifyReady=('Notification' in window)&&Notification.permission==='granted' }
}

// ---------- TABS ----------
function buildTabs(){
  const bar=$('tabBar'); bar.innerHTML=''
  const tabs=[{k:'log',label:'My Task'},{k:'equip',label:'Equipment'}]
  if(isManagerUp()) tabs.push({k:'dash',label:'Live Dashboard'})
  if(isManagerUp()) tabs.push({k:'history',label:'History'})
  if(isManagerUp()) tabs.push({k:'perf',label:'Performance'})
  if(isAdmin()) tabs.push({k:'manage',label:'Manage'})
  tabs.forEach((t,i)=>{const d=document.createElement('div');d.className='tab'+(i===0?' active':'');d.id='tab_'+t.k;d.textContent=t.label;d.onclick=()=>showTab(t.k);bar.appendChild(d)})
  ;['log','equip','dash','history','perf','manage'].forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!=='log')})
}
window.showTab=function(which){
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.toggle('active',t.id==='tab_'+which));
  ['log','equip','dash','history','perf','manage'].forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!==which)})
  if(which==='equip') loadEquip()
  if(which==='dash') refreshDashboard()
  if(which==='history') initHistory()
  if(which==='perf') initPerf()
  if(which==='manage'){ loadJoinCode(); loadWallUrl(); loadAccess(); loadStaff(); loadProducts(); loadEquipReg(); renderTaskList() }
}

// ---------- CATALOG ----------
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
    d.innerHTML=`<div><b>${t.name}</b><div class="meta">${t.station||'—'} · expected ${t.expected_units??'–'} kg · ${t.expected_staff??'–'} ppl${t.requires_units===false?' · no kg':' · kg required'}${t.track_waste?' · waste tracked':''}</div></div>`
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
      <input id="et_units_${id}" type="number" value="${t.expected_units??''}" placeholder="Expected kg" />
      <input id="et_staff_${id}" type="number" value="${t.expected_staff??''}" placeholder="Ppl" />
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_requnits_${id}" style="width:auto" ${t.requires_units!==false?'checked':''}/> Records kg produced (required to finish)</label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px"><input type="checkbox" id="et_waste_${id}" style="width:auto" ${t.track_waste?'checked':''}/> Track waste on this task</label>
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
  const reqUnits=$('et_requnits_'+id).checked
  const {error}=await sb.from('sim_task_catalog').update({name,station,expected_units:units,expected_staff:staff,track_waste:trackWaste,requires_units:reqUnits}).eq('id',id)
  if(error){msg($('addMsg'),error.message,false);return}
  await loadCatalog(); msg($('addMsg'),'Task updated.',true)
}
window.addTask=async function(){
  const name=$('ntName').value.trim(); if(!name){msg($('addMsg'),'Enter a task name.',false);return}
  const station=$('ntStation').value.trim()||null, units=$('ntUnits').value?Number($('ntUnits').value):null
  const order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order)):0)+1
  const {error}=await sb.from('sim_task_catalog').insert({name,station,expected_units:units,expected_staff:1,track_waste:$('ntWaste').checked,requires_units:$('ntReqUnits').checked,sort_order:order})
  if(error){msg($('addMsg'),error.message,false);return}
  $('ntName').value='';$('ntStation').value='';$('ntUnits').value='';$('ntWaste').checked=false;$('ntReqUnits').checked=true;msg($('addMsg'),'Task added.',true);await loadCatalog()
}

// ---------- PRODUCTS / RECIPES ----------
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

// ---------- TASK LOGGING ----------
async function loadActive(){
  const {data}=await sb.from('sim_task_logs').select('*').eq('user_id',me.id).in('status',['in_progress','paused']).order('start_time',{ascending:false}).limit(1)
  activeLog=(data&&data[0])||null; renderActive()
}
function renderActive(){
  if(activeLog){hide($('startCard'));show($('activeCard'));$('activeName').textContent=activeLog.task_name;$('activeMeta').textContent=`${activeLog.product?activeLog.product+' · ':''}${activeLog.staff_count||1} ppl · started ${fmtTime(activeLog.start_time)}`;$('fStaff').value=activeLog.staff_count||1;const _cat=catFor(activeLog);const _tw=!!(_cat&&_cat.track_waste);const _ru=!_cat||_cat.requires_units!==false;$('unitsWrap').classList.toggle('hidden',!_ru);$('fWaste').value='';$('wasteWrap').classList.toggle('hidden',!_tw);$('wasteToggleP').classList.toggle('hidden',_tw);renderPhotoStrip('photoStrip',activeLog);updatePauseUI(activeLog,'activePill','pauseBtn');if(timerInt)clearInterval(timerInt);const tick=()=>{$('activeTimer').textContent=fmtClock(workedSeconds(activeLog))};tick();timerInt=setInterval(tick,1000)}
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
  const {data,error}=await sb.from('sim_task_logs').insert({user_id:me.id,catalog_id:t.id,task_name:t.name,station:t.station,product:$('sProduct').value.trim()||null,staff_count:Number($('sStaff').value)||1,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('logMsg'),error.message,false);return}
  activeLog=data;$('sProduct').value='';clearMsg($('logMsg'));renderActive()
}
window.stopTask=async function(){
  if(!activeLog) return
  const units=$('fUnits').value?Number($('fUnits').value):null
  const waste=$('fWaste').value?Number($('fWaste').value):null
  if(!numberSanityOK(units,waste)) return
  if(requiresUnits(activeLog) && (units==null||isNaN(units))){ unitsGateOK(); return }
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
  data.forEach(l=>{const d=document.createElement('div');d.className='task-item';const status=l.status==='completed'?'<span class="pill done">done</span>':(l.status==='paused'?'<span class="pill off">❚❚ paused</span>':'<span class="pill live">● running</span>');const uph=l.units_per_hour?`${l.units_per_hour} kg/hr`:'';d.innerHTML=`<div><b>${l.task_name}</b> ${status}<div class="meta">${l.product?l.product+' · ':''}${l.units??'–'} kg · ${l.total_minutes??'–'} min · ${uph}${l.waste_kg?' · '+l.waste_kg+' kg waste':''}${l.photos&&l.photos.length?' · 📷 '+l.photos.length:''}</div></div>`;box.appendChild(d)})
}

// ---------- DASHBOARD ----------
async function refreshDashboard(){
  if(!isManagerUp()) return
  const today=new Date().toISOString().slice(0,10)
  const {data:logs}=await sb.from('sim_task_logs').select('*').eq('log_date',today).order('start_time',{ascending:false})
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  const nameFor=l=>{ if(l.user_id){const p=(profs||[]).find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=(staffs||[]).find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  const all=logs||[], running=all.filter(l=>l.status!=='completed'), done=all.filter(l=>l.status==='completed')
  $('stIn').textContent=running.length;$('stDone').textContent=done.length;$('stUnits').textContent=done.reduce((s,l)=>s+(Number(l.units)||0),0)
  const rb=$('dashRunning')
  if(!running.length){rb.innerHTML='<p class="muted">Nobody is on a task right now.</p>'}
  else{rb.innerHTML='';running.forEach(l=>{const el=document.createElement('div');el.className='dash-row';const wk=Math.floor(workedSeconds(l)/60);const badge=l.status==='paused'?'<div class="pill off">❚❚ paused</div>':'<div class="pill live">● '+wk+' min</div>';el.innerHTML=`<div><div class="name">${nameFor(l)}</div><div class="sub">${l.task_name}${l.product?' · '+l.product:''} · ${l.staff_count||1} ppl</div></div><div style="text-align:right">${badge}</div>`;rb.appendChild(el)})}
  const fb=$('dashFeed')
  if(!done.length){fb.innerHTML='<p class="muted">No completed tasks yet today.</p>'}
  else{fb.innerHTML='';done.slice(0,20).forEach(l=>{const cat=catalog.find(c=>c.id===l.catalog_id);let vs='';if(cat&&cat.expected_units&&l.units){const pct=Math.round((l.units/cat.expected_units)*100);vs=pct>=100?`<span class="vs-good">${pct}% of target</span>`:`<span class="vs-bad">${pct}% of target</span>`}const el=document.createElement('div');el.className='feed-item';const thumbs=(l.photos&&l.photos.length)?(()=>{const us=l.photos.map(photoUrl);const lb=us.join('|');return '<div class="feed-thumbs">'+us.slice(0,5).map((u,i)=>'<img loading="lazy" src="'+u+'" data-lb="'+lb+'" data-i="'+i+'" onclick="openLightboxEl(this)" style="cursor:zoom-in">').join('')+'</div>'})():'';el.innerHTML=`<b>${nameFor(l)}</b> finished <b>${l.task_name}</b> · ${l.units??'–'} kg in ${l.total_minutes??'–'} min ${l.units_per_hour?'('+l.units_per_hour+' kg/hr)':''}${l.waste_kg?' · '+l.waste_kg+' kg waste':''} ${vs} <span class="muted">· ${fmtTime(l.finish_time)}</span>${thumbs}`;fb.appendChild(el)});done.forEach(l=>lastFinishIds.add(l.id))}
}

// ---------- EQUIPMENT (cooking vessels) ----------
let equipList=[], equipCooks={}, equipNames={}, equipRegData=[], equipTimer=null, equipOverdueNotified=new Set()
const equipKindLabel=k=>({oven:'Oven',sous_vide:'Sous-vide',combi:'Combi',blast_chiller:'Blast chiller',freezer:'Freezer',other:'Equipment'}[k]||k)
function cookName(c){return c.user_id?(equipNames['u:'+c.user_id]||'—'):(c.staff_id?(equipNames['s:'+c.staff_id]||'Staff'):'—')}
function cookDue(c){if(!c||c.target_minutes==null)return null;const due=new Date(c.start_time).getTime()+c.target_minutes*60000;const rem=due-Date.now();return{due,rem,overdue:rem<0}}
window.loadEquip=async function(){
  const [{data:eq},{data:cooks},{data:profs},{data:staffs}]=await Promise.all([
    sb.from('sim_equipment').select('*').eq('active',true).order('sort_order'),
    sb.from('sim_cook_sessions').select('*').eq('status','cooking'),
    sb.from('sim_profiles').select('id,full_name,email'),
    sb.from('sim_staff').select('id,full_name')
  ])
  equipList=eq||[]; equipCooks={}; (cooks||[]).forEach(c=>{equipCooks[c.equipment_id]=c})
  equipNames={}; (profs||[]).forEach(p=>equipNames['u:'+p.id]=p.full_name||p.email); (staffs||[]).forEach(s=>equipNames['s:'+s.id]=s.full_name)
  renderEquipBoard()
  if(equipTimer)clearInterval(equipTimer); equipTimer=setInterval(tickEquip,1000); tickEquip()
}
function renderEquipBoard(){
  const box=$('equipBoard'); if(!box)return
  if(!equipList.length){box.innerHTML='<div class="card"><p class="muted">No equipment set up yet. An admin can add it in Manage → Cooking equipment.</p></div>';return}
  const busyN=Object.keys(equipCooks).length
  const locs=[...new Set(equipList.map(e=>e.location||'Other'))]
  let html=`<div class="card"><b>${busyN}</b> of <b>${equipList.length}</b> vessels in use right now.</div>`
  locs.forEach(loc=>{
    html+=`<h2 style="margin:16px 0 8px">${loc}</h2>`
    equipList.filter(e=>(e.location||'Other')===loc).forEach(e=>{html+=equipCardHtml(e,equipCooks[e.id])})
  })
  box.innerHTML=html
}
function equipCardHtml(e,c){
  const sub=`${equipKindLabel(e.kind)}${e.capacity?' · '+e.capacity:''}`
  if(!c){
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><b>${e.name}</b><div class="muted">${sub} · <span style="color:var(--green)">empty</span></div></div>
        <button class="green sm" onclick="equipPutIn('${e.id}')">Put in</button>
      </div>
      <div id="ef_${e.id}" class="hidden" style="margin-top:10px">
        <input id="ep_${e.id}" placeholder="What's going in? (product / batch)" />
        <div class="row" style="margin-top:8px">
          <input id="emin_${e.id}" type="number" inputmode="numeric" placeholder="Timer (mins)" />
          <input id="etemp_${e.id}" placeholder="Target temp (optional)" />
        </div>
        <div class="row" style="margin-top:8px">
          <button class="green sm" style="flex:1" onclick="equipStart('${e.id}')">Start</button>
          <button class="ghost sm" style="flex:1" onclick="equipPutIn('${e.id}')">Cancel</button>
        </div>
      </div></div>`
  }
  return `<div class="card" id="ec_${c.id}" style="margin-bottom:10px;border-color:var(--accent)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <b>${e.name}</b><div class="muted">${sub}</div>
        <div style="margin-top:6px"><b>${c.product||'In use'}</b>${c.process?' · '+c.process:''}</div>
        <div class="muted">by ${cookName(c)} · in for <span id="el_${c.id}">–</span>${c.target_temp?' · '+c.target_temp:''}</div>
        <div id="ed_${c.id}" style="margin-top:4px;font-weight:700"></div>
      </div>
      <button class="red sm" onclick="equipTakeOut('${c.id}')">Take out</button>
    </div></div>`
}
function tickEquip(){
  Object.values(equipCooks).forEach(c=>{
    const el=$('el_'+c.id); if(el)el.textContent=fmtClock((Date.now()-new Date(c.start_time))/1000)
    const ded=$('ed_'+c.id); const di=cookDue(c); const card=$('ec_'+c.id)
    if(ded){
      if(!di){ded.textContent=''}
      else if(di.overdue){ded.textContent='⏰ OVERDUE by '+Math.floor(-di.rem/60000)+' min — take out';ded.style.color='var(--red)';if(card)card.style.borderColor='var(--red)'}
      else{ded.textContent='Due in '+Math.ceil(di.rem/60000)+' min';ded.style.color='var(--amber)'}
    }
    if(di&&di.overdue&&!equipOverdueNotified.has(c.id)){equipOverdueNotified.add(c.id);const e=equipList.find(x=>x.id===c.equipment_id);notify('Ready to come out',(c.product||'A cook')+(e?' in '+e.name:''))}
  })
}
window.equipPutIn=function(id){const f=$('ef_'+id);if(f)f.classList.toggle('hidden')}
window.equipStart=async function(id){
  const product=$('ep_'+id).value.trim()
  const tmin=$('emin_'+id).value?Number($('emin_'+id).value):null
  const temp=$('etemp_'+id).value.trim()||null
  const {error}=await sb.from('sim_cook_sessions').insert({equipment_id:id,product:product||null,target_minutes:tmin,target_temp:temp,user_id:me.id,start_time:new Date().toISOString(),status:'cooking'})
  if(error){alert(error.message);return}
  await loadEquip()
}
window.equipTakeOut=async function(sid){
  const {error}=await sb.from('sim_cook_sessions').update({finish_time:new Date().toISOString(),status:'done'}).eq('id',sid)
  if(error){alert(error.message);return}
  equipOverdueNotified.delete(sid); await loadEquip()
}
async function loadEquipReg(){
  if(!isAdmin())return
  const box=$('equipRegList'); if(!box)return; box.innerHTML='<p class="muted">Loading…</p>'
  const {data}=await sb.from('sim_equipment').select('*').order('sort_order')
  equipRegData=data||[]; box.innerHTML=''
  equipRegData.forEach(e=>{
    const d=document.createElement('div');d.className='task-item';d.id='eqr_'+e.id
    d.innerHTML=`<div><b>${e.name}</b><div class="meta">${equipKindLabel(e.kind)}${e.capacity?' · '+e.capacity:''}${e.location?' · '+e.location:''}${e.active?'':' · <span style="color:#fca5a5">inactive</span>'}</div></div>`
    const ctl=document.createElement('div');ctl.style.display='flex';ctl.style.gap='8px';ctl.style.flexShrink='0'
    const ed=document.createElement('button');ed.className='ghost sm';ed.textContent='Edit';ed.onclick=()=>editEquip(e.id)
    const rm=document.createElement('button');rm.className='ghost sm';rm.textContent=e.active?'Remove':'Restore';rm.onclick=async()=>{await sb.from('sim_equipment').update({active:!e.active}).eq('id',e.id);loadEquipReg()}
    ctl.appendChild(ed);ctl.appendChild(rm);d.appendChild(ctl);box.appendChild(d)
  })
  if(!equipRegData.length)box.innerHTML='<p class="muted">No equipment yet.</p>'
}
window.editEquip=function(id){
  const e=equipRegData.find(x=>x.id===id); if(!e)return
  const d=$('eqr_'+id); if(!d)return
  d.style.flexDirection='column'; d.style.alignItems='stretch'
  const esc=s=>(s||'').replace(/"/g,'&quot;')
  const kinds=['oven','sous_vide','combi','blast_chiller','freezer','other']
  d.innerHTML=`<input id="eqn_${id}" value="${esc(e.name)}" placeholder="Name" />
    <div class="row" style="margin-top:8px">
      <select id="eqk_${id}">${kinds.map(k=>`<option value="${k}" ${e.kind===k?'selected':''}>${equipKindLabel(k)}</option>`).join('')}</select>
      <input id="eqc_${id}" value="${esc(e.capacity)}" placeholder="Capacity" />
    </div>
    <input id="eql_${id}" value="${esc(e.location)}" placeholder="Location" style="margin-top:8px" />
    <div class="row" style="margin-top:8px">
      <button class="green sm" style="flex:1" onclick="saveEquip('${id}')">Save</button>
      <button class="ghost sm" style="flex:1" onclick="loadEquipReg()">Cancel</button>
    </div>`
}
window.saveEquip=async function(id){
  const name=$('eqn_'+id).value.trim(); if(!name){alert('Name required');return}
  const {error}=await sb.from('sim_equipment').update({name,kind:$('eqk_'+id).value,capacity:$('eqc_'+id).value.trim()||null,location:$('eql_'+id).value.trim()||null}).eq('id',id)
  if(error){msg($('enMsg'),error.message,false);return}
  loadEquipReg(); msg($('enMsg'),'Updated.',true)
}
window.addEquip=async function(){
  const name=$('enName').value.trim(); if(!name){msg($('enMsg'),'Enter a name.',false);return}
  const order=(equipRegData.length?Math.max(...equipRegData.map(e=>e.sort_order)):0)+1
  const {error}=await sb.from('sim_equipment').insert({name,kind:$('enKind').value,capacity:$('enCap').value.trim()||null,location:$('enLoc').value.trim()||null,sort_order:order})
  if(error){msg($('enMsg'),error.message,false);return}
  $('enName').value='';$('enCap').value='';$('enLoc').value='';msg($('enMsg'),'Added.',true);loadEquipReg()
}

// ---------- PERFORMANCE (manager/admin) ----------
let perfView='team', perfBaseLogs=[], perfPeriodLogs=[], perfNames={}, perfTaskMedian={}, perfWasteMedian={}, perfTaskLabels={}, perfData=[]
const MIN_TASK_LOGS=3, MIN_PERSON_LOGS=5
const W_THRU=0.40, W_QUAL=0.35, W_REL=0.25

function median(arr){const a=arr.filter(x=>x!=null&&!isNaN(x)).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function perHead(l){const uph=l.units_per_hour!=null?Number(l.units_per_hour):((l.units&&l.total_minutes)?Number(l.units)/(Number(l.total_minutes)/60):null);if(uph==null||isNaN(uph))return null;return uph/Math.max(1,Number(l.staff_count)||1)}
function taskKey(l){return l.catalog_id||('name:'+l.task_name)}
function wastePct(l){if(l.waste_kg==null||!l.units||Number(l.units)<=0)return null;return Number(l.waste_kg)/Number(l.units)}
function personKey(l){return l.user_id?('u:'+l.user_id):(l.staff_id?('s:'+l.staff_id):'u:unknown')}
const idxColor=v=>v==null?'':(v>=1.05?'vs-good':(v<0.95?'vs-bad':''))
function idxText(v){if(v==null)return '–';const pct=Math.round((v-1)*100);return v.toFixed(2)+'× ('+(pct>0?'+':'')+pct+'%)'}
function idxCell(v){return `<span class="${idxColor(v)}">${idxText(v)}</span>`}

window.initPerf=async function(){
  if(!$('pFrom').value){const t=new Date();const day=(t.getDay()+6)%7;const mon=new Date(t);mon.setDate(t.getDate()-day);$('pFrom').value=mon.toISOString().slice(0,10)}
  if(!$('pTo').value)$('pTo').value=new Date().toISOString().slice(0,10)
  await loadPerf()
}
window.setPerfView=function(v){
  perfView=v
  ;['team','person','task','daily','time'].forEach(k=>$('pv_'+k).classList.toggle('active',k===v))
  $('pPersonPick').classList.toggle('hidden',v!=='person')
  $('pTaskPick').classList.toggle('hidden',v!=='task')
  renderPerf()
}
window.loadPerf=async function(){
  if(!isManagerUp()) return
  const from=$('pFrom').value, to=$('pTo').value
  $('perfBody').innerHTML='<p class="muted">Crunching numbers…</p>'
  const baseFrom=new Date(Date.now()-180*864e5).toISOString().slice(0,10)
  const {data:logs,error}=await sb.from('sim_task_logs').select('*').gte('log_date',baseFrom).eq('status','completed')
  if(error){$('perfBody').innerHTML='<p class="muted">'+error.message+'</p>';return}
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  perfNames={}
  ;(profs||[]).forEach(p=>perfNames['u:'+p.id]=p.full_name||p.email)
  ;(staffs||[]).forEach(s=>perfNames['s:'+s.id]=s.full_name)
  perfBaseLogs=(logs||[]).filter(l=>Number(l.total_minutes)>=0.5)
  perfPeriodLogs=perfBaseLogs.filter(l=>l.log_date>=from && l.log_date<=to)
  computeBaselines(); computePerf(); populatePerfPickers(); renderPerf()
}
function computeBaselines(){
  perfTaskMedian={}; perfWasteMedian={}; perfTaskLabels={}
  const byTask={}, byWaste={}
  perfBaseLogs.forEach(l=>{
    const k=taskKey(l); perfTaskLabels[k]=l.task_name
    const ph=perHead(l); if(ph!=null)(byTask[k]=byTask[k]||[]).push(ph)
    const wp=wastePct(l); if(wp!=null)(byWaste[k]=byWaste[k]||[]).push(wp)
  })
  Object.keys(byTask).forEach(k=>perfTaskMedian[k]=median(byTask[k]))
  Object.keys(byWaste).forEach(k=>perfWasteMedian[k]=median(byWaste[k]))
}
function computePerf(){
  const people={}
  perfPeriodLogs.forEach(l=>{const pk=personKey(l);(people[pk]=people[pk]||[]).push(l)})
  const rows=[]
  Object.keys(people).forEach(pk=>{
    const logs=people[pk]
    const tasks={}; logs.forEach(l=>{const tk=taskKey(l);(tasks[tk]=tasks[tk]||[]).push(l)})
    let hours=0, kg=0, wasteKg=0
    logs.forEach(l=>{hours+=(Number(l.total_minutes)||0)/60; kg+=Number(l.units)||0; wasteKg+=Number(l.waste_kg)||0})
    let twSum=0, tw=0; const taskBreak=[]
    Object.keys(tasks).forEach(tk=>{
      const tl=tasks[tk]
      const idxs=tl.map(l=>{const ph=perHead(l);const base=perfTaskMedian[tk];return (ph!=null&&base)?ph/base:null}).filter(x=>x!=null)
      const med=median(idxs)
      const th=tl.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)
      if(med!=null){twSum+=med*th; tw+=th}
      taskBreak.push({task:tl[0].task_name,n:tl.length,index:med,hours:th,enough:idxs.length>=MIN_TASK_LOGS,rate:median(tl.map(perHead)),wastePct:median(tl.map(wastePct))})
    })
    taskBreak.sort((a,b)=>b.hours-a.hours)
    const thru=tw>0?twSum/tw:null
    let qSum=0,qN=0
    logs.forEach(l=>{const wp=wastePct(l);const base=perfWasteMedian[taskKey(l)];if(wp!=null&&base!=null){const qi=base>0?(wp>0?base/wp:1.5):1.0;qSum+=Math.min(1.5,qi);qN++}})
    const qual=qN>0?qSum/qN:null
    rows.push({pk,name:perfNames[pk]||'Unknown',hours,kg,wasteKg,n:logs.length,thru,qual,taskBreak,wastePctOverall:kg>0?wasteKg/kg:null})
  })
  const medHours=median(rows.map(r=>r.hours))||1
  rows.forEach(r=>{ r.rel=Math.max(0.5,Math.min(1.5, medHours>0? r.hours/medHours : 1)) })
  rows.forEach(r=>{
    const t=r.thru!=null?r.thru:1.0, q=r.qual!=null?r.qual:1.0, rel=r.rel!=null?r.rel:1.0
    r.composite=W_THRU*t+W_QUAL*q+W_REL*rel
    r.enough=r.n>=MIN_PERSON_LOGS
  })
  rows.sort((a,b)=>(b.enough-a.enough)||(b.composite-a.composite))
  rows.forEach((r,i)=>r.rank=i+1)
  perfData=rows
}
function populatePerfPickers(){
  const ps=$('pPerson'); const curP=ps.value
  ps.innerHTML=perfData.map(r=>`<option value="${r.pk}">${r.name}</option>`).join('')
  if(curP&&perfData.some(r=>r.pk===curP))ps.value=curP
  const taskKeys=[...new Set(perfPeriodLogs.map(taskKey))]
  const ts=$('pTask'); const curT=ts.value
  ts.innerHTML=taskKeys.map(k=>`<option value="${k}">${perfTaskLabels[k]||k}</option>`).join('')
  if(curT&&taskKeys.includes(curT))ts.value=curT
}
function renderPerf(){
  if(perfView==='person') return renderPerfPerson()
  if(perfView==='task') return renderPerfTask()
  if(perfView==='daily') return renderPerfDaily()
  if(perfView==='time') return renderPerfTime()
  return renderPerfTeam()
}
function perfRangeLabel(){return $('pFrom').value+' → '+$('pTo').value}
function renderPerfTeam(){
  const box=$('perfBody')
  if(!perfData.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const totKg=perfData.reduce((s,r)=>s+r.kg,0), totHours=perfData.reduce((s,r)=>s+r.hours,0), totWaste=perfData.reduce((s,r)=>s+r.wasteKg,0), totN=perfData.reduce((s,r)=>s+r.n,0)
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<h2>Team · ${perfRangeLabel()}</h2>
    <div class="stat-grid"><div class="stat"><div class="n">${totN}</div><div class="l">Tasks</div></div><div class="stat"><div class="n">${Math.round(totKg)}</div><div class="l">Kg (line total)</div></div><div class="stat"><div class="n">${totHours.toFixed(1)}</div><div class="l">Hours</div></div></div>
    <p class="muted">Waste: ${totWaste.toFixed(1)} kg (${totKg>0?(100*totWaste/totKg).toFixed(1):'0'}% of output). Ranked by balanced score (40% speed · 35% waste/quality · 25% reliability). 1.00× = team average for that job.</p>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>#</th><th ${th}>Name</th><th ${th}>Overall</th><th ${th}>Speed</th><th ${th}>Quality</th><th ${th}>Reliability</th><th ${th}>Hours</th><th ${th}>Tasks</th></tr></thead><tbody>`
  perfData.forEach(r=>{
    const dim=r.enough?'':'opacity:.55'
    const flag=r.enough?'':' <span class="pill off">needs data</span>'
    html+=`<tr style="${dim}"><td ${td}>${r.rank}</td><td ${td}><a class="link" onclick="openPerson('${r.pk}')">${r.name}</a>${flag}</td><td ${td}><b>${idxText(r.composite)}</b></td><td ${td}>${idxCell(r.thru)}</td><td ${td}>${r.qual==null?'<span class="muted">n/a</span>':idxCell(r.qual)}</td><td ${td}>${idxCell(r.rel)}</td><td ${td}>${r.hours.toFixed(1)}</td><td ${td}>${r.n}</td></tr>`
  })
  html+='</tbody></table></div><p class="muted" style="margin-top:10px">"Quality" = waste vs the team norm for each job (higher is less waste); n/a means that person\'s jobs don\'t track waste. "needs data" = fewer than '+MIN_PERSON_LOGS+' logged tasks, so the score isn\'t reliable yet.</p>'
  box.innerHTML=html
}
window.openPerson=function(pk){ $('pPerson').value=pk; setPerfView('person') }
function renderPerfPerson(){
  const box=$('perfBody')
  if(!perfData.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const pk=$('pPerson').value||perfData[0].pk
  const r=perfData.find(x=>x.pk===pk); if(!r){box.innerHTML='<p class="muted">No data for this person in range.</p>';return}
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">${r.name}</h2><button class="ghost sm" onclick="printReview()">🖨 Print review sheet</button></div>
    <p class="muted">${perfRangeLabel()} · rank #${r.rank} of ${perfData.length}${r.enough?'':' · ⚠ limited data'}</p>
    <div class="stat-grid"><div class="stat"><div class="n ${idxColor(r.composite)}">${r.composite.toFixed(2)}×</div><div class="l">Overall</div></div><div class="stat"><div class="n ${idxColor(r.thru)}">${r.thru==null?'–':r.thru.toFixed(2)+'×'}</div><div class="l">Speed</div></div><div class="stat"><div class="n ${idxColor(r.qual)}">${r.qual==null?'n/a':r.qual.toFixed(2)+'×'}</div><div class="l">Quality</div></div></div>
    <p class="muted">${r.n} tasks · ${r.hours.toFixed(1)} hours · ${Math.round(r.kg)} kg · ${r.wasteKg.toFixed(1)} kg waste${r.wastePctOverall!=null?' ('+(100*r.wastePctOverall).toFixed(1)+'%)':''} · reliability ${r.rel.toFixed(2)}×</p>
    <h2 style="margin-top:18px">By task</h2><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>Task</th><th ${th}>Logs</th><th ${th}>Rate /head</th><th ${th}>vs team</th><th ${th}>Waste</th><th ${th}>Hours</th></tr></thead><tbody>`
  r.taskBreak.forEach(t=>{
    const flag=t.enough?'':' <span class="pill off">low n</span>'
    html+=`<tr><td ${td}>${t.task}${flag}</td><td ${td}>${t.n}</td><td ${td}>${t.rate!=null?t.rate.toFixed(1)+' kg/hr':'–'}</td><td ${td}>${idxCell(t.index)}</td><td ${td}>${t.wastePct!=null?(100*t.wastePct).toFixed(1)+'%':'–'}</td><td ${td}>${t.hours.toFixed(1)}</td></tr>`
  })
  html+='</tbody></table></div>'
  box.innerHTML=html
}
function renderPerfTask(){
  const box=$('perfBody')
  const tk=$('pTask').value
  if(!tk){box.innerHTML='<p class="muted">No tasks in this range.</p>';return}
  const label=perfTaskLabels[tk]||tk, base=perfTaskMedian[tk]
  const byPerson={}
  perfPeriodLogs.filter(l=>taskKey(l)===tk).forEach(l=>{const pk=personKey(l);(byPerson[pk]=byPerson[pk]||[]).push(l)})
  const rows=Object.keys(byPerson).map(pk=>{
    const logs=byPerson[pk]
    const rate=median(logs.map(perHead))
    const idx=(rate!=null&&base)?rate/base:null
    return {name:perfNames[pk]||'Unknown',n:logs.length,rate,idx,wastePct:median(logs.map(wastePct)),hours:logs.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)}
  }).sort((a,b)=>(b.idx==null?-1:b.idx)-(a.idx==null?-1:a.idx))
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<h2>${label} · ${perfRangeLabel()}</h2><p class="muted">Team median: ${base!=null?base.toFixed(1)+' kg/hr per head':'–'}. Per-person rate splits team jobs by headcount.</p>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>#</th><th ${th}>Name</th><th ${th}>Logs</th><th ${th}>Rate /head</th><th ${th}>vs team</th><th ${th}>Waste</th><th ${th}>Hours</th></tr></thead><tbody>`
  rows.forEach((r,i)=>{html+=`<tr><td ${td}>${i+1}</td><td ${td}>${r.name}</td><td ${td}>${r.n}</td><td ${td}>${r.rate!=null?r.rate.toFixed(1)+' kg/hr':'–'}</td><td ${td}>${idxCell(r.idx)}</td><td ${td}>${r.wastePct!=null?(100*r.wastePct).toFixed(1)+'%':'–'}</td><td ${td}>${r.hours.toFixed(1)}</td></tr>`})
  html+='</tbody></table></div>'
  box.innerHTML=html
}
function renderPerfDaily(){
  const box=$('perfBody')
  if(!perfPeriodLogs.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const byDay={}
  perfPeriodLogs.forEach(l=>{(byDay[l.log_date]=byDay[l.log_date]||[]).push(l)})
  const days=Object.keys(byDay).sort().reverse()
  const grandKg=perfPeriodLogs.reduce((s,l)=>s+(Number(l.units)||0),0)
  let html=`<h2>Daily totals · ${perfRangeLabel()}</h2><p class="muted">Total kilograms prepped each day, broken down by task. ${days.length} day${days.length===1?'':'s'} · ${Math.round(grandKg)} kg overall.</p>`
  const td='style="padding:6px 8px;border-bottom:1px solid var(--line)"'
  days.forEach(d=>{
    const logs=byDay[d]
    const dayKg=logs.reduce((s,l)=>s+(Number(l.units)||0),0)
    const dayHours=logs.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)
    const dayWaste=logs.reduce((s,l)=>s+(Number(l.waste_kg)||0),0)
    const byTask={}
    logs.forEach(l=>{const k=l.task_name;(byTask[k]=byTask[k]||{kg:0,n:0});byTask[k].kg+=Number(l.units)||0;byTask[k].n++})
    const rows=Object.keys(byTask).sort((a,b)=>byTask[b].kg-byTask[a].kg)
    html+=`<div class="card" style="background:var(--panel2);margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
        <b style="font-size:16px">${d}</b>
        <span><b style="font-size:22px;color:var(--accent)">${Math.round(dayKg)} kg</b> <span class="muted">· ${logs.length} tasks · ${dayHours.toFixed(1)} h${dayWaste?' · '+dayWaste.toFixed(1)+' kg waste':''}</span></span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px"><tbody>`
    rows.forEach(t=>{html+=`<tr><td ${td}>${t}</td><td ${td} style="text-align:right;font-weight:700">${Math.round(byTask[t].kg)} kg</td><td ${td} style="text-align:right;color:var(--muted);width:48px">${byTask[t].n}×</td></tr>`})
    html+=`</tbody></table></div>`
  })
  box.innerHTML=html
}
function renderPerfTime(){
  const box=$('perfBody')
  if(!perfPeriodLogs.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const buckets={}
  perfPeriodLogs.forEach(l=>{
    const t=l.finish_time||l.start_time; if(!t)return
    const h=new Date(t).getHours()
    const b=buckets[h]=buckets[h]||{kg:0,n:0,idxSum:0,idxN:0}
    b.kg+=Number(l.units)||0; b.n++
    const ph=perHead(l), base=perfTaskMedian[taskKey(l)]
    if(ph!=null&&base){b.idxSum+=ph/base; b.idxN++}
  })
  const hours=Object.keys(buckets).map(Number).sort((a,b)=>a-b)
  const maxKg=Math.max(1,...hours.map(h=>buckets[h].kg))
  let mS=0,mN=0,aS=0,aN=0
  hours.forEach(h=>{const b=buckets[h];if(b.idxN){if(h<12){mS+=b.idxSum;mN+=b.idxN}else{aS+=b.idxSum;aN+=b.idxN}}})
  const mAvg=mN?mS/mN:null, aAvg=aN?aS/aN:null
  let trend=''
  if(mAvg!=null&&aAvg!=null){
    const dir=aAvg>mAvg+0.03?'speeds up':(aAvg<mAvg-0.03?'slows down':'holds steady')
    trend=` Pace ${dir} over the day — morning ${mAvg.toFixed(2)}× vs afternoon ${aAvg.toFixed(2)}×.`
  }
  let html=`<h2>Through the day · ${perfRangeLabel()}</h2><p class="muted">Output (bar) and pace by hour of day, across the selected range. Pace = per-head rate vs each task's team norm; 1.00× = normal.${trend}</p><div style="margin-top:6px">`
  hours.forEach(h=>{
    const b=buckets[h]
    const pace=b.idxN?b.idxSum/b.idxN:null
    const w=Math.round(b.kg/maxKg*100)
    html+=`<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span><b>${String(h).padStart(2,'0')}:00</b> <span class="muted">${b.n} task${b.n===1?'':'s'}</span></span><span>${Math.round(b.kg)} kg · pace <span class="${idxColor(pace)}">${pace==null?'–':pace.toFixed(2)+'×'}</span></span></div>
      <div style="height:10px;background:var(--panel2);border-radius:6px;margin-top:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:var(--accent)"></div></div>
    </div>`
  })
  html+='</div><p class="muted" style="margin-top:6px">Hours combine every day in the range, so a wider range shows the typical daily shape. For one day, set From and To to the same date.</p>'
  box.innerHTML=html
}
window.printReview=function(){
  const pk=$('pPerson').value||(perfData[0]&&perfData[0].pk); if(!pk)return
  const r=perfData.find(x=>x.pk===pk); if(!r)return
  const cell='style="padding:6px 10px;border-bottom:1px solid #ccc;text-align:left"'
  const head='style="padding:6px 10px;border-bottom:2px solid #333;text-align:left"'
  let rowsHtml=''
  r.taskBreak.forEach(t=>{rowsHtml+=`<tr><td ${cell}>${t.task}${t.enough?'':' (low data)'}</td><td ${cell}>${t.n}</td><td ${cell}>${t.rate!=null?t.rate.toFixed(1)+' kg/hr':'–'}</td><td ${cell}>${t.index!=null?t.index.toFixed(2)+'×':'–'}</td><td ${cell}>${t.wastePct!=null?(100*t.wastePct).toFixed(1)+'%':'–'}</td><td ${cell}>${t.hours.toFixed(1)}</td></tr>`})
  $('printArea').innerHTML=`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:0 auto;padding:24px">
      <div style="display:flex;justify-content:space-between;border-bottom:3px solid #f97316;padding-bottom:10px;margin-bottom:16px">
        <div><div style="font-size:22px;font-weight:800">Performance Review</div><div style="color:#555">Willa Ltd · Chefly</div></div>
        <div style="text-align:right;color:#555;font-size:13px">Period: ${perfRangeLabel()}<br>Generated: ${new Date().toLocaleDateString()}</div>
      </div>
      <div style="font-size:18px;font-weight:700;margin-bottom:4px">${r.name}</div>
      <div style="color:#555;margin-bottom:16px">Rank #${r.rank} of ${perfData.length}${r.enough?'':' — limited data, treat as indicative only'}</div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
        <tr><td ${head}>Overall score</td><td ${head}>Speed</td><td ${head}>Quality (waste)</td><td ${head}>Reliability</td></tr>
        <tr><td ${cell}><b>${r.composite.toFixed(2)}×</b></td><td ${cell}>${r.thru==null?'–':r.thru.toFixed(2)+'×'}</td><td ${cell}>${r.qual==null?'n/a':r.qual.toFixed(2)+'×'}</td><td ${cell}>${r.rel.toFixed(2)}×</td></tr>
      </table>
      <div style="color:#555;margin-bottom:6px">1.00× = team average for the same job. ${r.n} tasks · ${r.hours.toFixed(1)} hours · ${Math.round(r.kg)} kg produced · ${r.wasteKg.toFixed(1)} kg waste${r.wastePctOverall!=null?' ('+(100*r.wastePctOverall).toFixed(1)+'%)':''}.</div>
      <div style="font-weight:700;margin:16px 0 6px">By task</div>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr><td ${head}>Task</td><td ${head}>Logs</td><td ${head}>Rate /head</td><td ${head}>vs team</td><td ${head}>Waste</td><td ${head}>Hours</td></tr>
        ${rowsHtml}
      </table>
      <div style="margin-top:24px;color:#555;font-size:13px">Scores compare this person to the team's own median on each task, so different jobs are judged fairly. Speed on shared jobs is split by headcount. Use alongside context (changeovers, training, role) — not in isolation.</div>
      <div style="margin-top:28px;border-top:1px solid #ccc;padding-top:14px">
        <div style="margin-bottom:18px">Manager notes:</div>
        <div style="border-bottom:1px solid #999;height:22px;margin-bottom:14px"></div>
        <div style="border-bottom:1px solid #999;height:22px;margin-bottom:14px"></div>
        <div style="display:flex;justify-content:space-between;margin-top:24px"><div>Reviewer: __________________</div><div>Employee: __________________</div><div>Date: __________</div></div>
      </div>
    </div>`
  window.print()
}

// ---------- MANAGE ----------
async function loadJoinCode(){
  if(!isAdmin()) return
  const {data}=await sb.from('sim_settings').select('value').eq('key','join_code').maybeSingle()
  $('jcInput').value=(data&&data.value)||''
}
window.saveJoinCode=async function(){
  const code=$('jcInput').value
  const {error}=await sb.rpc('sim_set_join_code',{p_code:code})
  if(error){msg($('jcMsg'),error.message,false);return}
  msg($('jcMsg'), code.trim()? 'Join code saved. Share it with staff.' : 'Join code cleared — self-signup is now off.', true)
}
window.createUser=async function(){
  const email=$('cuEmail').value.trim().toLowerCase(), name=$('cuName').value.trim(), role=$('cuRole').value, password=$('cuPass').value
  if(!email||!email.includes('@')){msg($('cuMsg'),'Enter a valid email.',false);return}
  if(password.length<6){msg($('cuMsg'),'Temporary password must be 6+ characters.',false);return}
  const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'create_user',email,name,role,password}})
  if(error||data?.error){msg($('cuMsg'),(data&&data.error)||error.message,false);return}
  msg($('cuMsg'),`Account created for ${email} (${role}). Temp password: ${password} — they set their own on first login.`,true)
  $('cuEmail').value='';$('cuName').value='';$('cuPass').value='';$('cuRole').value='staff'; loadAccess()
}
async function loadAccess(){
  if(!isAdmin()) return
  const box=$('memberList'); box.innerHTML='<p class="muted">Loading…</p>'
  const [{data:allowed,error},{data:profs}] = await Promise.all([
    sb.from('sim_allowed_users').select('*').order('full_name'),
    sb.from('sim_profiles').select('email')
  ])
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  const activeEmails=new Set((profs||[]).map(p=>(p.email||'').toLowerCase()))
  box.innerHTML=''
  ;(allowed||[]).forEach(u=>{
    const d=document.createElement('div'); d.className='member'
    const self=(u.email||'').toLowerCase()===(me.email||'').toLowerCase()
    const active=activeEmails.has((u.email||'').toLowerCase())
    d.innerHTML=`<div><div class="name">${u.full_name||u.email} ${self?'<span class="muted">(you)</span>':''}</div><div class="sub">${u.email} · ${active?'<span class="pill live">● active</span>':'<span class="pill off">not logged in</span>'}</div></div>`
    const ctl=document.createElement('div'); ctl.className='ctl'
    const sel=document.createElement('select'); ['staff','manager','admin'].forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;if(u.role===r)o.selected=true;sel.appendChild(o)}); sel.disabled=self
    sel.onchange=async()=>{const {error}=await sb.rpc('sim_set_user_role',{p_email:u.email,p_role:sel.value});if(error){msg($('memberMsg'),error.message,false);sel.value=u.role}else{msg($('memberMsg'),`${u.full_name||u.email} is now ${sel.value}.`,true);u.role=sel.value}}
    ctl.appendChild(sel)
    if(!self){
      const rp=document.createElement('button');rp.className='ghost sm';rp.textContent='Reset pw'
      rp.onclick=async()=>{const np=prompt('New temporary password for '+u.email+' (6+ chars):');if(!np)return;const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'set_password',email:u.email,password:np}});if(error||data?.error){msg($('memberMsg'),(data&&data.error)||error.message,false)}else{msg($('memberMsg'),'Password reset for '+u.email+'.',true)}}
      ctl.appendChild(rp)
      const rm=document.createElement('button');rm.className='ghost sm';rm.textContent='Remove'
      rm.onclick=async()=>{if(!confirm('Remove access for '+u.email+'?'))return;const {error}=await sb.rpc('sim_remove_user',{p_email:u.email});if(error){msg($('memberMsg'),error.message,false)}else{msg($('memberMsg'),'Removed '+u.email,true);loadAccess()}}
      ctl.appendChild(rm)
    }
    d.appendChild(ctl); box.appendChild(d)
  })
  if(!allowed||!allowed.length) box.innerHTML='<p class="muted">No users yet.</p>'
}

// ---------- FLOOR STAFF (admin) ----------
async function loadStaff(){
  if(!isAdmin()) return
  const box=$('staffList'); if(!box) return; box.innerHTML='<p class="muted">Loading…</p>'
  const {data,error}=await sb.from('sim_staff').select('*').order('full_name')
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  box.innerHTML=''
  ;(data||[]).forEach(s=>{
    const d=document.createElement('div'); d.className='member'
    d.innerHTML=`<div><div class="name">${s.full_name}</div><div class="sub">${s.station||'—'} · ${s.active?'<span class="pill live">active</span>':'<span class="pill off">inactive</span>'} · ${s.pin_hash?'PIN set':'<span style="color:#fca5a5">no PIN</span>'}</div></div>`
    const ctl=document.createElement('div'); ctl.className='ctl'
    const pinB=document.createElement('button'); pinB.className='ghost sm'; pinB.textContent='Set PIN'
    pinB.onclick=async()=>{const p=prompt('New 4-digit PIN for '+s.full_name+':');if(!p)return;if(!/^\d{4}$/.test(p)){alert('PIN must be 4 digits');return}const {error}=await sb.rpc('sim_save_staff',{p_id:s.id,p_name:s.full_name,p_station:s.station,p_pin:p});if(error){msg($('fsMsg'),error.message,false)}else{msg($('fsMsg'),'PIN updated for '+s.full_name,true);loadStaff()}}
    const actB=document.createElement('button'); actB.className='ghost sm'; actB.textContent=s.active?'Deactivate':'Activate'
    actB.onclick=async()=>{const {error}=await sb.rpc('sim_set_staff_active',{p_id:s.id,p_active:!s.active});if(error){msg($('fsMsg'),error.message,false)}else{loadStaff()}}
    ctl.appendChild(pinB); ctl.appendChild(actB); d.appendChild(ctl); box.appendChild(d)
  })
  if(!data||!data.length) box.innerHTML='<p class="muted">No floor staff yet.</p>'
}
window.addStaff=async function(){
  const name=$('fsName').value.trim(), station=$('fsStation').value.trim(), pin=$('fsPin').value.trim()
  if(!name){msg($('fsMsg'),'Enter a name.',false);return}
  if(pin && !/^\d{4}$/.test(pin)){msg($('fsMsg'),'PIN must be 4 digits.',false);return}
  const {error}=await sb.rpc('sim_save_staff',{p_id:null,p_name:name,p_station:station,p_pin:pin||null})
  if(error){msg($('fsMsg'),error.message,false);return}
  $('fsName').value='';$('fsStation').value='';$('fsPin').value='';msg($('fsMsg'),'Staff added.'+(pin?'':' Set a PIN before they can log in.'),true);loadStaff()
}

// ---------- KIOSK (shared device) ----------
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
    const c=catFor(kActiveLog); const tw=!!(c&&c.track_waste); const ru=!c||c.requires_units!==false
    $('kUnitsWrap').classList.toggle('hidden',!ru)
    $('kWaste').value=''; $('kWasteWrap').classList.toggle('hidden',!tw); $('kWasteToggleP').classList.toggle('hidden',tw); renderPhotoStrip('kPhotoStrip',kActiveLog); updatePauseUI(kActiveLog,'kActivePill','kPauseBtn')
    if(kTimerInt)clearInterval(kTimerInt); const tick=()=>{$('kTimer').textContent=fmtClock(workedSeconds(kActiveLog))}; tick(); kTimerInt=setInterval(tick,1000)
  } else { $('kStartCard').classList.remove('hidden'); $('kActiveCard').classList.add('hidden'); if(kTimerInt)clearInterval(kTimerInt) }
}
window.kioskShowWaste=function(){$('kWasteWrap').classList.remove('hidden');$('kWasteToggleP').classList.add('hidden')}
window.kioskStart=async function(){
  const t=catalog.find(c=>c.id===$('kSelTask').value); if(!t){msg($('kTaskMsg'),'Pick a task.',false);return}
  const {data,error}=await sb.from('sim_task_logs').insert({staff_id:kStaff.id,catalog_id:t.id,task_name:t.name,station:t.station,product:$('kProduct').value.trim()||null,staff_count:Number($('kCount').value)||1,start_time:new Date().toISOString(),status:'in_progress'}).select().single()
  if(error){msg($('kTaskMsg'),error.message,false);return}
  kActiveLog=data; $('kProduct').value=''; clearMsg($('kTaskMsg')); kioskRenderActive()
}
window.kioskStop=async function(){
  if(!kActiveLog) return
  const units=$('kUnits').value?Number($('kUnits').value):null
  const waste=$('kWaste').value?Number($('kWaste').value):null
  if(!numberSanityOK(units,waste)) return
  // Kiosk is used by floor staff directly, so kg + photo are strictly required (no skip).
  if(requiresUnits(kActiveLog) && (units==null||isNaN(units))){ alert('Please enter the kilograms produced before finishing this task.'); return }
  if(!(kActiveLog.photos&&kActiveLog.photos.length)){ alert('A photo of the work is required before finishing.\n\nPlease add a photo above, then finish.'); return }
  let ps=kActiveLog.paused_seconds||0; if(kActiveLog.status==='paused'&&kActiveLog.pause_started_at) ps+=(Date.now()-new Date(kActiveLog.pause_started_at))/1000
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:Number($('kStaffCount').value)||1,changeover_mins:$('kChange').value?Number($('kChange').value):null,comments:$('kComments').value.trim()||null,status:'completed'}).eq('id',kActiveLog.id)
  if(error){alert(finishErr(error));return}
  $('kUnits').value='';$('kWaste').value='';$('kChange').value='';$('kComments').value=''
  alert('Logged — thanks '+kStaff.full_name+'!')
  kioskBackToGrid()
}

// ---------- WALL DISPLAY (admin) ----------
async function loadWallUrl(){
  if(!isAdmin()) return
  const {data}=await sb.from('sim_settings').select('value').eq('key','wall_token').maybeSingle()
  const tok=data&&data.value
  $('wallUrl').value = tok ? (location.origin+'/wall.html?t='+tok) : '(not generated yet — tap Generate)'
}
window.genWallToken=async function(){
  if(!confirm('Generate a new wall link? Any existing link will stop working.'))return
  const {data,error}=await sb.rpc('sim_set_wall_token')
  if(error){msg($('wallMsg'),error.message,false);return}
  $('wallUrl').value=location.origin+'/wall.html?t='+data
  msg($('wallMsg'),'New wall link ready. Open it on the office screen.',true)
}
window.copyWall=function(){const v=$('wallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Copied to clipboard.',true)}}

// ---------- HISTORY / REPORTS (manager/admin) ----------
let historyRows=[]
function initHistory(){
  if(!$('hTo').value) $('hTo').value=new Date().toISOString().slice(0,10)
  if(!$('hFrom').value) $('hFrom').value=new Date(Date.now()-6*864e5).toISOString().slice(0,10)
  loadHistory()
}
window.loadHistory=async function(){
  if(!isManagerUp()) return
  const from=$('hFrom').value, to=$('hTo').value
  const box=$('hBody'); box.innerHTML='<p class="muted">Loading…</p>'
  const {data:logs,error}=await sb.from('sim_task_logs').select('*').gte('log_date',from).lte('log_date',to).eq('status','completed').order('finish_time',{ascending:false})
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  const nameFor=l=>{ if(l.user_id){const p=(profs||[]).find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=(staffs||[]).find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  historyRows=(logs||[]).map(l=>({date:l.log_date,who:nameFor(l),task:l.task_name,station:l.station||'',product:l.product||'',kg:l.units??'',mins:l.total_minutes??'',uph:l.units_per_hour??'',waste:l.waste_kg??'',staff:l.staff_count??'',photos:(l.photos||[]).length,comments:l.comments||''}))
  const num=v=>Number(v)||0
  const totKg=historyRows.reduce((s,r)=>s+num(r.kg),0), totMin=historyRows.reduce((s,r)=>s+num(r.mins),0), totWaste=historyRows.reduce((s,r)=>s+num(r.waste),0)
  $('hSummary').innerHTML=`<b>${historyRows.length}</b> tasks · <b>${totKg}</b> kg · <b>${totMin}</b> min · <b>${totWaste}</b> kg waste`
  if(!historyRows.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  box.innerHTML='<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'+
    ['Date','Who','Task','Product','kg','min','kg/hr','Waste','Ppl','📷'].map(h=>`<th ${th}>${h}</th>`).join('')+'</tr></thead><tbody>'+
    historyRows.map(r=>'<tr>'+[r.date,r.who,r.task,r.product,r.kg,r.mins,r.uph,r.waste,r.staff,r.photos].map(c=>`<td ${td}>${c===''||c==null?'–':c}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>'
}
window.exportCsv=function(){
  if(!historyRows.length){alert('Nothing to export — load a range first.');return}
  const cols=['date','who','task','station','product','kg','mins','uph','waste','staff','photos','comments']
  const head=['Date','Name','Task','Station','Product','Kg','Minutes','Kg per hour','Waste kg','People','Photos','Comments']
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'
  const csv=[head.join(',')].concat(historyRows.map(r=>cols.map(c=>esc(r[c])).join(','))).join('\n')
  const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a')
  a.href=URL.createObjectURL(blob); a.download=`sim-history-${$('hFrom').value}_to_${$('hTo').value}.csv`; a.click()
}

// ---------- REALTIME ----------
function notify(t,b){if(notifyReady){try{new Notification(t,{body:b})}catch(e){}}}
function subscribeRealtime(){
  sb.channel('sim-logs').on('postgres_changes',{event:'*',schema:'public',table:'sim_task_logs'},(payload)=>{
    if(payload.eventType==='UPDATE'&&payload.new.status==='completed'&&!lastFinishIds.has(payload.new.id)){lastFinishIds.add(payload.new.id);if(isManagerUp()&&payload.new.user_id!==me.id)notify('Task finished',`${payload.new.task_name} · ${payload.new.units??'–'} kg`)}
    if(isManagerUp())refreshDashboard()
    if(payload.new&&payload.new.user_id===me.id){loadActive();refreshMyRecent()}
  }).subscribe()
  sb.channel('sim-cooks').on('postgres_changes',{event:'*',schema:'public',table:'sim_cook_sessions'},()=>{
    const et=$('equipTab'); if(et&&!et.classList.contains('hidden')) loadEquip()
  }).subscribe()
  setInterval(()=>{if(isManagerUp()&&!$('dashTab').classList.contains('hidden'))refreshDashboard()},30000)
}
