/* AUTH: login / signup / bootstrap, profile load, app shell + tab routing. */

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

const TAB_KEYS=['log','equip','pack','dash','history','perf','plan','manage']
function buildTabs(){
  const bar=$('tabBar'); bar.innerHTML=''
  const tabs=[{k:'log',label:'My Task'},{k:'equip',label:'Equipment'}]
  if(isManagerUp()||(profile&&profile.packing_team)) tabs.push({k:'pack',label:'Packing'})
  if(isManagerUp()) tabs.push({k:'dash',label:'Live Dashboard'})
  if(isManagerUp()) tabs.push({k:'history',label:'History'})
  if(isManagerUp()) tabs.push({k:'perf',label:'Performance'})
  if(isManagerUp()) tabs.push({k:'plan',label:'Plan'})
  if(isAdmin()) tabs.push({k:'manage',label:'Manage'})
  tabs.forEach((t,i)=>{const d=document.createElement('div');d.className='tab'+(i===0?' active':'');d.id='tab_'+t.k;d.textContent=t.label;d.onclick=()=>showTab(t.k);bar.appendChild(d)})
  TAB_KEYS.forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!=='log')})
}
window.showTab=function(which){
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.toggle('active',t.id==='tab_'+which))
  TAB_KEYS.forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!==which)})
  if(which==='equip') loadEquip()
  if(which==='pack') loadPacking()
  if(which==='dash') refreshDashboard()
  if(which==='history') initHistory()
  if(which==='perf') initPerf()
  if(which==='plan') loadPlan()
  if(which==='manage'){ loadJoinCode(); loadWallUrl(); loadAccess(); loadStaff(); loadProducts(); loadEquipReg(); loadPackRoster(); renderTaskList(); loadRoutes() }
}
