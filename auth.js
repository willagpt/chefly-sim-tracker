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
  /* The reset link lands wherever Supabase's Site URL points, NOT necessarily
     where redirectTo asks -- GoTrue silently falls back to Site URL when the
     requested address is not in the project's allow-list. On 17 Aug 2026 that
     fallback was still http://localhost:3000 from early development, so every
     reset link logged the person in correctly and then dropped them on a blank
     page. Two staff read that as "reset is broken", hammered the button, and
     hit the email rate limit -- a lockout that was never really a lockout.
     Until Site URL is corrected in the dashboard the message below has to name
     that failure mode explicitly, so nobody loses another shift to it. */
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname})
  if(error){
    const m=String(error.message||'')
    msg($('loginMsg'), isNetworkError(error)?netErr(error)
      : /rate limit|after \d+ seconds/i.test(m)
        ? 'Too many reset emails requested — wait a minute before trying again, or ask a manager to reset it for you.'
        : m, false)
    return
  }
  msg($('loginMsg'),'Reset email sent — open the link ONCE. If it opens a blank page or an error, the link still worked but could not return you here: come back to this page and log in with your new password. If you are stuck, ask a manager to reset it in Manage → User access.',true)
}
window.setMyPassword=async function(){
  const a=$('np1').value, b=$('np2').value
  if(a.length<6){msg($('loginMsg'),'Password must be 6+ characters.',false);return}
  if(a!==b){msg($('loginMsg'),'Passwords do not match.',false);return}
  // Set the password through the sim-admin function (service role) so ANY password is
  // accepted, including one the person used before — the standard auth.updateUser call
  // rejects reusing a password ("New password should be different from the old password").
  const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'set_own_password',password:a}})
  if(error||data?.error){msg($('loginMsg'),(data&&data.error)||error.message,false);return}
  // Re-authenticate with the new password in case the server-side update revoked this session.
  const em=(me&&me.email)||$('email').value.trim().toLowerCase()
  if(em){const {data:s}=await sb.auth.signInWithPassword({email:em,password:a}); if(s&&s.user) me=s.user}
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
  if(wsStation()){
    // Dedicated pack-line tablet: one screen only — Wholesale pack day for this team.
    badge.textContent='Team '+profile.ws_team
    $('tabBar').classList.add('hidden')
    const sub=$('subTabBar'); if(sub) sub.classList.add('hidden')
    TAB_KEYS.forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!=='ws')})
    await loadWholesale()
    return
  }
  buildTabs()
  await loadCatalog(); await loadProducts(); await loadActive(); await refreshMyRecent()
  if(isManagerUp()) await refreshDashboard()
  subscribeRealtime()
  if('Notification' in window && Notification.permission==='default'){ try{notifyReady=(await Notification.requestPermission())==='granted'}catch(e){} }
  else { notifyReady=('Notification' in window)&&Notification.permission==='granted' }
}

const TAB_KEYS=['log','equip','pack','picking','kitchen','units','labels','dash','history','perf','plan','ws','trace','devhub','manage']
/* Two-level navigation: a few big primary groups (organised by job, not by
   feature), each with a lighter secondary row of screens beneath. Groups with
   no visible screens for this role disappear entirely; a group with a single
   screen shows no secondary row. Last-used screen per group is remembered. */
const NAV_GROUPS=[
  {k:'work',label:'Work',screens:[
    {k:'log',label:'My Task',show:()=>true},
    {k:'equip',label:'Equipment',show:()=>true},
    {k:'kitchen',label:'Kitchen',show:()=>true},
  ]},
  {k:'packing',label:'Packing',screens:[
    {k:'pack',label:'Pack line',show:()=>isManagerUp()||(profile&&profile.packing_team)},
    {k:'picking',label:'Picking',show:()=>isManagerUp()||(profile&&profile.packing_team)},
  ]},
  {k:'wholesale',label:'Wholesale',screens:[
    {k:'ws',label:'Wholesale',show:()=>isManagerUp()||(profile&&profile.packing_team)},
  ]},
  {k:'tracegrp',label:'Trace',screens:[
    {k:'units',label:'Batches & Units',show:()=>true},
    {k:'labels',label:'Labels',show:()=>true},
    {k:'trace',label:'Goods in & trace',show:()=>isManagerUp()},
  ]},
  {k:'office',label:'Office',screens:[
    {k:'dash',label:'Live Dashboard',show:()=>isManagerUp()},
    {k:'plan',label:'Plan',show:()=>isManagerUp()},
    {k:'history',label:'History',show:()=>isManagerUp()},
    {k:'perf',label:'Performance',show:()=>isManagerUp()},
    {k:'devhub',label:'R&D Hub',show:()=>isManagerUp()},
    {k:'manage',label:'Manage',show:()=>isAdmin()},
  ]},
]
let navGroup='work'
const navLast={}
function navVisScreens(g){return g.screens.filter(s=>{try{return s.show()}catch(e){return false}})}
function navVisGroups(){return NAV_GROUPS.filter(g=>navVisScreens(g).length)}
function navGroupOf(k){return NAV_GROUPS.find(g=>g.screens.some(s=>s.k===k))}
function renderNav(active){
  const bar=$('tabBar'); if(!bar)return
  bar.classList.add('nav-primary')
  let sub=$('subTabBar')
  if(!sub){sub=document.createElement('div');sub.id='subTabBar';sub.className='tabs nav-sub';bar.insertAdjacentElement('afterend',sub)}
  bar.innerHTML=''
  navVisGroups().forEach(g=>{
    const d=document.createElement('div')
    d.className='tab'+(g.k===navGroup?' active':''); d.id='tab_'+g.k; d.textContent=g.label
    d.onclick=()=>setNavGroup(g.k); bar.appendChild(d)
  })
  const g=NAV_GROUPS.find(x=>x.k===navGroup)
  const screens=g?navVisScreens(g):[]
  sub.classList.toggle('hidden',screens.length<2)
  sub.innerHTML=''
  screens.forEach(s=>{
    const d=document.createElement('div')
    d.className='tab'+(s.k===active?' active':''); d.id='tab_'+s.k; d.textContent=s.label
    d.onclick=()=>showTab(s.k); sub.appendChild(d)
  })
}
window.setNavGroup=function(gk){
  const g=NAV_GROUPS.find(x=>x.k===gk); if(!g)return
  navGroup=gk
  const screens=navVisScreens(g); if(!screens.length)return
  const last=navLast[gk]
  showTab(screens.some(s=>s.k===last)?last:screens[0].k)
}
function buildTabs(){
  navGroup='work'
  renderNav('log')
  TAB_KEYS.forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!=='log')})
}
window.showTab=function(which){
  const g=navGroupOf(which); if(g){navGroup=g.k; navLast[g.k]=which}
  renderNav(which)
  TAB_KEYS.forEach(k=>{const el=$(k+'Tab');if(el)el.classList.toggle('hidden',k!==which)})
  if(which==='equip') loadEquip()
  if(which==='pack') loadPacking()
  if(which==='picking') loadPicking()
  if(which==='kitchen') loadKitchen()
  if(which==='units') loadUnits()
  if(which==='labels') initLabels()
  if(which==='dash') refreshDashboard()
  if(which==='history') initHistory()
  if(which==='perf') initPerf()
  if(which==='plan') loadPlan()
  if(which==='ws') loadWholesale()
  if(which==='trace') initTrace()
  if(which==='devhub') loadDevHub()
  if(which==='manage'){ loadJoinCode(); loadWallUrl(); loadAccess(); loadStaff(); loadProducts(); loadEquipReg(); loadPackRoster(); renderTaskList(); loadRoutes() }
}
