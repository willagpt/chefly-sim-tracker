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
function numberSanityOK(units,waste){
  const issues=[]
  if(units!=null && units>1000) issues.push('Produced = '+units+' kg (over 1000)')
  if(waste!=null && waste>1000) issues.push('Waste = '+waste+' kg (over 1000)')
  if(units!=null && waste!=null && waste>units && waste>20) issues.push('Waste ('+waste+' kg) is more than produced ('+units+' kg)')
  if(!issues.length) return true
  return confirm('⚠ Please double-check these numbers:\n\n• '+issues.join('\n• ')+'\n\nTap OK to save anyway, or Cancel to go back and fix.')
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
  paths.forEach(p=>{
    const wrap=document.createElement('div'); wrap.className='pwrap'
    const a=document.createElement('a'); a.href=photoUrl(p); a.target='_blank'
    const img=document.createElement('img'); img.src=photoUrl(p); img.loading='lazy'; a.appendChild(img); wrap.appendChild(a)
    const x=document.createElement('button'); x.className='del'; x.textContent='✕'; x.title='Remove photo'
    x.onclick=(e)=>{e.preventDefault(); delPhoto(log,p,id)}
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
  const tabs=[{k:'log',label:'My Task'}]
  if(isManagerUp()) tabs.push({k:'dash',label:'Live Dashboard'})
  if(isManagerUp()) tabs.push({k:'history',label:'History'})
  if(isAdmin()) tabs.push({k:'manage',label:'Manage'})
  tabs.forEach((t,i)=>{const d=document.createElement('div');d.className='tab'+(i===0?' active':'');d.id='tab_'+t.k;d.textContent=t.label;d.onclick=()=>showTab(t.k);bar.appendChild(d)})
  ;['log','dash','history','manage'].forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!=='log')})
}
window.showTab=function(which){
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.toggle('active',t.id==='tab_'+which));
  ['log','dash','history','manage'].forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!==which)})
  if(which==='dash') refreshDashboard()
  if(which==='history') initHistory()
  if(which==='manage'){ loadJoinCode(); loadWallUrl(); loadAccess(); loadStaff(); loadProducts(); renderTaskList() }
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
    d.innerHTML=`<div><b>${t.name}</b><div class="meta">${t.station||'—'} · expected ${t.expected_units??'–'} kg · ${t.expected_staff??'–'} ppl${t.track_waste?' · waste tracked':''}</div></div>`
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
  const {error}=await sb.from('sim_task_catalog').update({name,station,expected_units:units,expected_staff:staff,track_waste:trackWaste}).eq('id',id)
  if(error){msg($('addMsg'),error.message,false);return}
  await loadCatalog(); msg($('addMsg'),'Task updated.',true)
}
window.addTask=async function(){
  const name=$('ntName').value.trim(); if(!name){msg($('addMsg'),'Enter a task name.',false);return}
  const station=$('ntStation').value.trim()||null, units=$('ntUnits').value?Number($('ntUnits').value):null
  const order=(catalog.length?Math.max(...catalog.map(c=>c.sort_order)):0)+1
  const {error}=await sb.from('sim_task_catalog').insert({name,station,expected_units:units,expected_staff:1,track_waste:$('ntWaste').checked,sort_order:order})
  if(error){msg($('addMsg'),error.message,false);return}
  $('ntName').value='';$('ntStation').value='';$('ntUnits').value='';$('ntWaste').checked=false;msg($('addMsg'),'Task added.',true);await loadCatalog()
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
  if(activeLog){hide($('startCard'));show($('activeCard'));$('activeName').textContent=activeLog.task_name;$('activeMeta').textContent=`${activeLog.product?activeLog.product+' · ':''}${activeLog.staff_count||1} ppl · started ${fmtTime(activeLog.start_time)}`;$('fStaff').value=activeLog.staff_count||1;const _cat=catalog.find(c=>c.id===activeLog.catalog_id);const _tw=!!(_cat&&_cat.track_waste);$('fWaste').value='';$('wasteWrap').classList.toggle('hidden',!_tw);$('wasteToggleP').classList.toggle('hidden',_tw);renderPhotoStrip('photoStrip',activeLog);updatePauseUI(activeLog,'activePill','pauseBtn');if(timerInt)clearInterval(timerInt);const tick=()=>{$('activeTimer').textContent=fmtClock(workedSeconds(activeLog))};tick();timerInt=setInterval(tick,1000)}
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
  if(!photoGateOK(activeLog)) return
  let ps=activeLog.paused_seconds||0; if(activeLog.status==='paused'&&activeLog.pause_started_at) ps+=(Date.now()-new Date(activeLog.pause_started_at))/1000
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:Number($('fStaff').value)||1,changeover_mins:$('fChange').value?Number($('fChange').value):null,comments:$('fComments').value.trim()||null,status:'completed'}).eq('id',activeLog.id)
  if(error){alert(error.message);return}
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
  else{fb.innerHTML='';done.slice(0,20).forEach(l=>{const cat=catalog.find(c=>c.id===l.catalog_id);let vs='';if(cat&&cat.expected_units&&l.units){const pct=Math.round((l.units/cat.expected_units)*100);vs=pct>=100?`<span class="vs-good">${pct}% of target</span>`:`<span class="vs-bad">${pct}% of target</span>`}const el=document.createElement('div');el.className='feed-item';el.innerHTML=`<b>${nameFor(l)}</b> finished <b>${l.task_name}</b> · ${l.units??'–'} kg in ${l.total_minutes??'–'} min ${l.units_per_hour?'('+l.units_per_hour+' kg/hr)':''}${l.waste_kg?' · '+l.waste_kg+' kg waste':''} ${vs} <span class="muted">· ${fmtTime(l.finish_time)}</span>${l.photos&&l.photos.length?'<div class="feed-thumbs">'+l.photos.slice(0,5).map(p=>'<a href="'+photoUrl(p)+'" target="_blank"><img loading="lazy" src="'+photoUrl(p)+'"></a>').join('')+'</div>':''}`;fb.appendChild(el)});done.forEach(l=>lastFinishIds.add(l.id))}
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

// ---------- KIOSK (shared device, manager/admin) ----------
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
    const c=catalog.find(x=>x.id===kActiveLog.catalog_id); const tw=!!(c&&c.track_waste)
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
  if(!(kActiveLog.photos&&kActiveLog.photos.length)){ if(!confirm('No photo added for this task. Finish without a photo?\n\n(Manager override at the kiosk.)')) return }
  let ps=kActiveLog.paused_seconds||0; if(kActiveLog.status==='paused'&&kActiveLog.pause_started_at) ps+=(Date.now()-new Date(kActiveLog.pause_started_at))/1000
  const {error}=await sb.from('sim_task_logs').update({finish_time:new Date().toISOString(),units,waste_kg:waste,paused_seconds:ps,pause_started_at:null,staff_count:Number($('kStaffCount').value)||1,changeover_mins:$('kChange').value?Number($('kChange').value):null,comments:$('kComments').value.trim()||null,status:'completed'}).eq('id',kActiveLog.id)
  if(error){alert(error.message);return}
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
  setInterval(()=>{if(isManagerUp()&&!$('dashTab').classList.contains('hidden'))refreshDashboard()},30000)
}
