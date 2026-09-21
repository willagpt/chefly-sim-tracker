/* MANAGE: join code, user access, floor staff, wall link, History/reports + CSV, packing roster. */

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
    sb.from('sim_profiles').select('email,suspended,packing_team,ws_team')
  ])
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  const activeEmails=new Set((profs||[]).map(p=>(p.email||'').toLowerCase()))
  const suspendedByEmail=new Map((profs||[]).map(p=>[(p.email||'').toLowerCase(), !!p.suspended]))
  const packingByEmail=new Map((profs||[]).map(p=>[(p.email||'').toLowerCase(), !!p.packing_team]))
  const wsTeamByEmail=new Map((profs||[]).map(p=>[(p.email||'').toLowerCase(), p.ws_team||'']))
  box.innerHTML=''
  ;(allowed||[]).forEach(u=>{
    const em=(u.email||'').toLowerCase()
    const d=document.createElement('div'); d.className='member'
    const self=em===(me.email||'').toLowerCase()
    const active=activeEmails.has(em)
    const sus=suspendedByEmail.get(em)===true
    const packLead=packingByEmail.get(em)===true
    const stateBadge = sus ? '<span class="pill off">suspended</span>' : (active?'<span class="pill live">● active</span>':'<span class="pill off">not logged in</span>')
    const packBadge = packLead ? '<span class="pill" style="background:rgba(249,115,22,.2);color:#fdba74">packing lead</span>' : ''
    const wsTeam = wsTeamByEmail.get(em)||''
    const wsBadge = wsTeam ? `<span class="pill" style="background:rgba(59,130,246,.2);color:#93c5fd">WS station · Team ${esc(wsTeam)}</span>` : ''
    d.innerHTML=`<div><div class="name">${esc(u.full_name||u.email)} ${self?'<span class="muted">(you)</span>':''}</div><div class="sub"><span class="email">${esc(u.email)}</span>${stateBadge}${packBadge}${wsBadge}</div></div>`
    const ctl=document.createElement('div'); ctl.className='ctl'
    const sel=document.createElement('select'); ['staff','manager','admin'].forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;if(u.role===r)o.selected=true;sel.appendChild(o)}); sel.disabled=self
    sel.onchange=async()=>{const {error}=await sb.rpc('sim_set_user_role',{p_email:u.email,p_role:sel.value});if(error){msg($('memberMsg'),error.message,false);sel.value=u.role}else{msg($('memberMsg'),`${u.full_name||u.email} is now ${sel.value}.`,true);u.role=sel.value}}
    ctl.appendChild(sel)
    const pkB=document.createElement('button');pkB.className='ghost sm';pkB.textContent=packLead?'Remove packing':'Packing lead'
    pkB.onclick=async()=>{const {error}=await sb.rpc('sim_set_packing',{p_email:u.email,p_on:!packLead});if(error){msg($('memberMsg'),error.message,false)}else{msg($('memberMsg'),(packLead?'Removed packing access for ':'Packing lead access for ')+u.email,true);loadAccess()}}
    ctl.appendChild(pkB)
    // Wholesale pack-line station: pin this login to Team A or B. Non-manager
    // accounts with a team set see ONLY the Wholesale pack-day screen.
    const wsSel=document.createElement('select')
    ;[['','WS station: off'],['A','WS station: Team A'],['B','WS station: Team B']].forEach(([vv,ll])=>{const o=document.createElement('option');o.value=vv;o.textContent=ll;if(wsTeam===vv)o.selected=true;wsSel.appendChild(o)})
    wsSel.onchange=async()=>{
      const val=wsSel.value||null
      const {error}=await sb.rpc('sim_set_ws_team',{p_email:u.email,p_team:val})
      if(error){msg($('memberMsg'),error.message,false);wsSel.value=wsTeam}
      else{msg($('memberMsg'),val?((u.full_name||u.email)+' is now the wholesale Team '+val+' station — that login shows only its pack-day screen.'):('Cleared wholesale station for '+u.email),true);loadAccess()}
    }
    ctl.appendChild(wsSel)
    if(!self){
      const susB=document.createElement('button');susB.className='ghost sm';susB.textContent=sus?'Unsuspend':'Suspend'
      susB.onclick=async()=>{if(!confirm((sus?'Unsuspend ':'Suspend ')+(u.full_name||u.email)+'?'+(sus?'':'\n\nThey will be unable to log in or clock in until unsuspended.')))return;const {data,error}=await sb.functions.invoke('sim-admin',{body:{action:'set_suspended',email:u.email,suspended:!sus}});if(error||data?.error){msg($('memberMsg'),(data&&data.error)||error.message,false)}else{msg($('memberMsg'),(sus?'Unsuspended ':'Suspended ')+u.email,true);loadAccess()}}
      ctl.appendChild(susB)
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

// ---- floor staff (admin) ----
async function loadStaff(){
  if(!isAdmin()) return
  const box=$('staffList'); if(!box) return; box.innerHTML='<p class="muted">Loading…</p>'
  const {data,error}=await sb.from('sim_staff').select('*').order('full_name')
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  box.innerHTML=''
  ;(data||[]).forEach(s=>{
    const d=document.createElement('div'); d.className='member'
    d.innerHTML=`<div><div class="name">${esc(s.full_name)}</div><div class="sub">${esc(s.station)||'—'} · ${s.active?'<span class="pill live">active</span>':'<span class="pill off">inactive</span>'} · ${s.pin_hash?'PIN set':'<span style="color:#fca5a5">no PIN</span>'}</div></div>`
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

// ---- packing team roster (admin) ----
function _poDayLabel(d){
  if(!d)return ''
  return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
}
window.poDayHint=function(){
  const el=$('poDay'); if(!el)return
  const d=$('poDate').value
  if(!d){el.textContent='';return}
  const today=new Date().toISOString().slice(0,10)
  const lbl=_poDayLabel(d)
  if(d<today){el.innerHTML='<b style="color:#fca5a5">'+lbl+' — that is in the PAST.</b>'}
  else if(d===today){el.innerHTML='<b style="color:#fcd34d">'+lbl+' — that is TODAY.</b>'}
  else {el.innerHTML='<b style="color:#86efac">'+lbl+'</b>'}
}
function _poEnsureDay(){
  if(!$('poDay')){
    const inp=$('poDate')
    if(inp&&inp.parentNode){
      const d=document.createElement('div'); d.id='poDay'; d.className='muted'; d.style.cssText='margin:2px 0 6px;font-size:13px'
      inp.parentNode.insertBefore(d,inp.nextSibling)
      inp.addEventListener('change',window.poDayHint)
    }
  }
  _poEnsureFile()
}
const _PO_URL_RE=/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
function _poEnsureFile(){
  if($('poFileBtn'))return
  const ta=$('poText'); if(!ta||!ta.parentNode)return
  const w=document.createElement('div'); w.style.cssText='margin:6px 0 2px'
  w.innerHTML='<button id="poFileBtn" class="ghost sm" onclick="poPickFile()">📄 Import from file (.xlsx / .csv)</button>'
    +' <span class="muted" style="font-size:12px">…or drop the file / paste the Google Sheets link into the box above</span>'
    +'<input id="poFile" type="file" accept=".xlsx,.xls,.csv" style="display:none">'
  ta.parentNode.insertBefore(w,ta.nextSibling)
  $('poFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)poReadFile(f);e.target.value=''})
  ;['dragover','dragenter'].forEach(ev=>ta.addEventListener(ev,e=>{e.preventDefault();ta.style.outline='2px dashed var(--accent)'}))
  ;['dragleave','dragend'].forEach(ev=>ta.addEventListener(ev,()=>{ta.style.outline=''}))
  ta.addEventListener('drop',e=>{
    e.preventDefault(); ta.style.outline=''
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]
    if(f){poReadFile(f);return}
    const txt=(e.dataTransfer&&(e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain'))||'').trim()
    if(_PO_URL_RE.test(txt))poFetchSheet(txt)
  })
  ta.addEventListener('paste',e=>{
    const txt=((e.clipboardData&&e.clipboardData.getData('text'))||'').trim()
    if(_PO_URL_RE.test(txt)&&txt.split(/\s/).length===1){e.preventDefault();poFetchSheet(txt)}
  })
}
window.poPickFile=function(){const f=$('poFile');if(f)f.click()}
async function _poXlsxLib(){
  if(window.XLSX)return
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';sc.onload=res;sc.onerror=()=>rej(new Error('Could not load the spreadsheet reader - check the internet connection.'));document.head.appendChild(sc)})
}
function _poSheetToText(wb){
  const name=wb.SheetNames.find(n=>/all\s*dishes/i.test(n))||wb.SheetNames[0]
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:''})
  const lines=rows.map(r=>r.map(c=>String(c==null?'':c).replace(/\t/g,' ').trim()).join('\t'))
    .filter(l=>l.replace(/\t/g,'').trim()!=='')
  return {tab:name,text:lines.join('\n')}
}
function _poFinish(srcLabel,wb){
  const {tab,text}=_poSheetToText(wb)
  if(!text){msg($('poMsg'),'That '+srcLabel+' looks empty - is it the right one?',false);return}
  $('poText').value=text
  const rows=_parsePackOrders(text)
  const meals=rows.reduce((s,r)=>s+r.qty,0)
  if(!rows.length){msg($('poMsg'),'Read the '+srcLabel+' (tab: '+tab+') but found no dish rows - check it has Dish Name, SKU, Quantity … Total columns.',false);return}
  msg($('poMsg'),'Read the '+srcLabel+' (tab: '+tab+'): '+rows.length+' dishes, '+meals+' meals. Check the date above, then hit Load orders.',true)
  $('poPreview').innerHTML=rows.map(r=>esc(r.sku)+' · '+esc(r.dish_name)+' — <b>'+r.qty+'</b>').join('<br>')
}
window.poReadFile=async function(f){
  try{await _poXlsxLib()}catch(e){msg($('poMsg'),e.message,false);return}
  try{
    const buf=await f.arrayBuffer()
    _poFinish('file "'+f.name+'"',XLSX.read(buf,{type:'array'}))
  }catch(e){msg($('poMsg'),'Could not read that file: '+(e.message||e),false)}
}
window.poFetchSheet=async function(url){
  const m=String(url).match(_PO_URL_RE)
  if(!m){msg($('poMsg'),'That does not look like a Google Sheets link.',false);return}
  const id=m[1]
  msg($('poMsg'),'Fetching the Google Sheet…',true)
  try{await _poXlsxLib()}catch(e){msg($('poMsg'),e.message,false);return}
  let wb=null
  try{
    const r=await fetch('https://docs.google.com/spreadsheets/d/'+id+'/export?format=xlsx')
    if(!r.ok)throw new Error('export blocked')
    wb=XLSX.read(await r.arrayBuffer(),{type:'array'})
  }catch(e1){
    try{
      const r2=await fetch('https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:csv&sheet='+encodeURIComponent('All Dishes'))
      const t2=await r2.text()
      if(!r2.ok||t2.trim().startsWith('<'))throw new Error('gviz blocked')
      wb=XLSX.read(t2,{type:'string'})
      wb.SheetNames[0]='All Dishes'; wb.Sheets['All Dishes']=wb.Sheets[Object.keys(wb.Sheets)[0]]
    }catch(e2){
      msg($('poMsg'),'Could not open that Google Sheet. In Google Sheets go to Share and set "Anyone with the link" to "Viewer", then paste the link again — or use File → Download → .xlsx and drop the file here instead.',false)
      return
    }
  }
  try{_poFinish('Google Sheet',wb)}catch(e){msg($('poMsg'),'Could not read that sheet: '+(e.message||e),false)}
}
function _poDefaultDate(){
  _poEnsureDay()
  const el=$('poDate'); if(!el)return
  if(!el.value){ const d=new Date(); while(d.getDay()!==1){d.setDate(d.getDate()+1)} el.value=d.toISOString().slice(0,10) }  // today if Monday, else next Monday
  poDayHint()
}
async function loadPackRoster(){
  _poDefaultDate()
  if(!isAdmin()) return
  const box=$('packRosterList'); if(!box) return; box.innerHTML='<p class="muted">Loading…</p>'
  const {data,error}=await sb.from('sim_pack_members').select('*').order('sort_order').order('full_name')
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  box.innerHTML=''
  ;(data||[]).forEach(m=>{
    const d=document.createElement('div'); d.className='member'
    d.innerHTML=`<div><div class="name">${esc(m.full_name)}</div><div class="sub">${m.active?'<span class="pill live">active</span>':'<span class="pill off">inactive</span>'}</div></div>`
    const ctl=document.createElement('div'); ctl.className='ctl'
    const ed=document.createElement('button'); ed.className='ghost sm'; ed.textContent='Rename'
    ed.onclick=async()=>{const nn=prompt('Edit name:', m.full_name);if(nn===null)return;const name=nn.trim();if(!name){alert('Name cannot be blank.');return}const {error}=await sb.from('sim_pack_members').update({full_name:name}).eq('id',m.id);if(error){msg($('pmMsg'),error.message,false)}else{msg($('pmMsg'),'Renamed.',true);loadPackRoster()}}
    const act=document.createElement('button'); act.className='ghost sm'; act.textContent=m.active?'Remove':'Restore'
    act.onclick=async()=>{await sb.from('sim_pack_members').update({active:!m.active}).eq('id',m.id);loadPackRoster()}
    ctl.appendChild(ed); ctl.appendChild(act); d.appendChild(ctl); box.appendChild(d)
  })
  if(!data||!data.length) box.innerHTML='<p class="muted">No packing team members yet.</p>'
}
window.addPackMember=async function(){
  const name=$('pmName').value.trim(); if(!name){msg($('pmMsg'),'Enter a name.',false);return}
  const {error}=await sb.from('sim_pack_members').insert({full_name:name})
  if(error){msg($('pmMsg'),error.message,false);return}
  $('pmName').value='';msg($('pmMsg'),'Added.',true);loadPackRoster()
}

// ---- wall display links (admin) ----
function ensurePackWallEl(){
  if($('packWallUrl')) return
  const host=$('wallUrl'); if(!host||!host.parentNode) return
  const wrap=document.createElement('div')
  wrap.innerHTML='<label for="packWallUrl" style="display:block;margin-top:14px">Packing line wall link</label>'+
    '<input id="packWallUrl" type="text" readonly style="width:100%" value="(generate the link above first)" />'+
    '<div class="row" style="margin-top:6px"><button class="ghost" onclick="copyPackWall()">Copy packing wall link</button></div>'+
    '<label for="kitchenWallUrl" style="display:block;margin-top:14px">Kitchen wall link (cook queue)</label>'+
    '<input id="kitchenWallUrl" type="text" readonly style="width:100%" value="(generate the link above first)" />'+
    '<div class="row" style="margin-top:6px"><button class="ghost" onclick="copyKitchenWall()">Copy kitchen wall link</button></div>'
  const anchor=$('wallMsg')
  if(anchor&&anchor.parentNode===host.parentNode) host.parentNode.insertBefore(wrap,anchor)
  else host.parentNode.appendChild(wrap)
}
async function loadWallUrl(){
  if(!isAdmin()) return
  ensurePackWallEl()
  const {data}=await sb.from('sim_settings').select('value').eq('key','wall_token').maybeSingle()
  const tok=data&&data.value
  $('wallUrl').value = tok ? (location.origin+'/wall.html?t='+tok) : '(not generated yet — tap Generate)'
  if($('packWallUrl')) $('packWallUrl').value = tok ? (location.origin+'/packwall.html?t='+tok) : '(generate the link above first)'
  if($('kitchenWallUrl')) $('kitchenWallUrl').value = tok ? (location.origin+'/kitchenwall.html?t='+tok) : '(generate the link above first)'
}
window.genWallToken=async function(){
  if(!confirm('Generate a new wall link? Any existing link will stop working.'))return
  const {data,error}=await sb.rpc('sim_set_wall_token')
  if(error){msg($('wallMsg'),error.message,false);return}
  ensurePackWallEl()
  $('wallUrl').value=location.origin+'/wall.html?t='+data
  if($('packWallUrl')) $('packWallUrl').value=location.origin+'/packwall.html?t='+data
  if($('kitchenWallUrl')) $('kitchenWallUrl').value=location.origin+'/kitchenwall.html?t='+data
  msg($('wallMsg'),'New links ready — office board (wall.html) and packing line (packwall.html).',true)
}
window.copyWall=function(){const v=$('wallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Office wall link copied.',true)}}
window.copyPackWall=function(){const v=$('packWallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Packing wall link copied.',true)}}
window.copyKitchenWall=function(){const v=$('kitchenWallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Kitchen wall link copied.',true)}}

// ---- history / reports (manager/admin) ----
let historyRows=[], histLogs=[], histAllLogs=[], histProfs=[], histStaffs=[], leCurrentId=null, histView='summary'
function initHistory(){
  if(!$('hTo').value) $('hTo').value=new Date().toISOString().slice(0,10)
  if(!$('hFrom').value) $('hFrom').value=new Date(Date.now()-6*864e5).toISOString().slice(0,10)
  loadHistory()
}
/* Job filter: injected here (same pattern as _poEnsureFile) so index.html
   stays untouched. "All jobs" shows everything; picking a job filters the
   summary, detail log, HACCP view and CSV export together — no refetch. */
function _histEnsureJobPicker(){
  if($('hJob')) return
  const anchor=$('hv_summary'); if(!anchor||!anchor.parentNode) return
  const tabs=anchor.parentNode
  const wrap=document.createElement('div')
  wrap.id='hJobRow'
  wrap.style.marginTop='12px'
  wrap.innerHTML='<label for="hJob">Job — pick one to isolate it (times, totals and rates filter with it)</label><select id="hJob" onchange="histJobChanged()"><option value="">All jobs</option></select>'
  tabs.parentNode.insertBefore(wrap,tabs)
}
function _histFillJobPicker(){
  const sel=$('hJob'); if(!sel) return
  const cur=sel.value
  const counts={}
  histAllLogs.forEach(l=>{const k=l.task_name||'(unnamed)';counts[k]=(counts[k]||0)+1})
  const names=Object.keys(counts).sort((a,b)=>a.localeCompare(b))
  sel.innerHTML='<option value="">All jobs ('+histAllLogs.length+')</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)} (${counts[n]})</option>`).join('')
  if(cur && names.includes(cur)) sel.value=cur
}
window.histJobChanged=function(){ _renderHistAll() }
window.loadHistory=async function(){
  if(!isManagerUp()) return
  const from=$('hFrom').value, to=$('hTo').value
  const box=$('hBody'); box.innerHTML='<p class="muted">Loading…</p>'
  const {data:logs,error}=await sb.from('sim_task_logs').select('*').gte('log_date',from).lte('log_date',to).eq('status','completed').order('finish_time',{ascending:false})
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  histAllLogs=logs||[]; histProfs=profs||[]; histStaffs=staffs||[]
  _histEnsureJobPicker(); _histFillJobPicker(); _histEnsureEodBtn()
  _renderHistAll()
}
function _renderHistAll(){
  const box=$('hBody')
  const job=$('hJob')?$('hJob').value:''
  histLogs = job ? histAllLogs.filter(l=>(l.task_name||'(unnamed)')===job) : histAllLogs
  historyRows=histLogs.map(l=>({id:l.id,date:l.log_date,start:_clock(l.start_time),finish:_clock(l.finish_time),who:_haccpName(l),task:l.task_name,station:l.station||'',product:l.product||'',kg:l.units??'',uom:uomFor(l),mins:l.total_minutes??'',uph:l.units_per_hour??'',waste:l.waste_kg??'',staff:l.staff_count??'',photos:(l.photos||[]).length,comments:l.comments||''}))
  const num=v=>Number(v)||0
  const totKg=historyRows.reduce((s,r)=>s+num(r.kg),0), totMin=historyRows.reduce((s,r)=>s+num(r.mins),0), totWaste=historyRows.reduce((s,r)=>s+num(r.waste),0)
  $('hSummary').innerHTML=(job?'<b>'+esc(job)+'</b> · ':'')+`<b>${historyRows.length}</b> tasks · <b>${Math.round(totKg)}</b> produced · <b>${Math.round(totMin)}</b> min · <b>${totWaste.toFixed(1)}</b> waste`
  renderHistorySummary(); renderHaccp()
  if(!historyRows.length){box.innerHTML='<p class="muted">No completed tasks in this range'+(job?' for '+esc(job):'')+'.</p>';return}
  const canEdit=isManagerUp()
  box.innerHTML=histLogs.map(l=>{
    const who=_haccpName(l), u=uomFor(l)
    const photos=l.photos||[]
    const strip=photoThumbs(photos,54)
    const rate=l.units_per_hour!=null?` · <b style="color:var(--accent)">${l.units_per_hour} ${u}/hr</b>`:''
    const wasteTxt=l.waste_kg?` · ${l.waste_kg} ${u} waste`:''
    const editLink=canEdit?`<a class="link" style="flex-shrink:0;font-size:13px" onclick="editLog('${l.id}')">✏️ Edit</a>`:''
    const timeTxt=(l.start_time||l.finish_time)?` · ${_clock(l.start_time)||'–'} → ${_clock(l.finish_time)||'–'}`:''
    return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0"><b style="font-size:15px">${esc(l.task_name)}</b> <span class="muted">· ${esc(who)}</span><div class="muted" style="font-size:12px;margin-top:1px">${l.log_date}${timeTxt}${l.product?' · '+esc(l.product):''}${l.station?' · '+esc(l.station):''}</div></div>
        ${editLink}
      </div>
      <div style="font-size:14px"><b>${l.units??'–'} ${u}</b>${rate} · ${l.total_minutes??'–'} min${wasteTxt} · ${l.staff_count??1} ppl${photos.length?' · 📷 '+photos.length:''}</div>
      ${strip}
    </div>`
  }).join('')
}

// ---- consolidated shift / team summary ----
function _isoLocalH(d){const y=d.getFullYear(),mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+mm+'-'+dd}
function niceDate(iso){if(!iso)return '';const d=new Date(iso+'T00:00:00');return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+d.getDate()+'/'+(d.getMonth()+1)}
function sumOf(map){return Object.values(map).reduce((s,v)=>s+v,0)}
function addAmt(map,uom,val){if(!val)return;const u=uom||'kg';map[u]=(map[u]||0)+val}
function fmtAmt(map){const parts=Object.keys(map).filter(u=>map[u]).map(u=>`${Math.round(map[u]*10)/10} ${u}`);return parts.length?parts.join(' · '):'–'}
function sumTable(title,rows,headers){
  if(!rows.length)return ''
  const th='<tr>'+headers.map((hd,i)=>`<th style="text-align:${i===0?'left':'right'};padding:6px 8px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)">${hd}</th>`).join('')+'</tr>'
  const trs=rows.map(r=>`<tr>${r.map((c,i)=>`<td style="text-align:${i===0?'left':'right'};padding:6px 8px;border-bottom:1px solid var(--line);${i===1?'font-weight:700':''}">${c}</td>`).join('')}</tr>`).join('')
  return `<div style="margin-top:16px"><div style="font-weight:700;margin-bottom:4px">${title}</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">${th}${trs}</table></div></div>`
}
window.setHistView=function(v){
  histView=v
  ;['summary','detail','haccp'].forEach(k=>{const tab=$('hv_'+k);if(tab)tab.classList.toggle('active',v===k)})
  const map={summary:'hSummaryCard',detail:'hDetailCard',haccp:'hHaccpCard'}
  Object.keys(map).forEach(k=>{const c=$(map[k]);if(c)c.classList.toggle('hidden',v!==k)})
}
function _haccpName(l){ if(l.user_id){const p=histProfs.find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=histStaffs.find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
function _clock(ts){if(!ts)return '';const d=new Date(ts);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function renderHaccp(){
  const box=$('hHaccpBody'); if(!box)return
  const rows=histLogs.filter(l=>{const c=catalog.find(x=>x.id===l.catalog_id);return c&&c.records_temp})
  if(!rows.length){box.innerHTML='<p class="muted">No cook/chill temperature records in this range.</p>';return}
  const cell=(txt,left,extra)=>`<td style="text-align:${left?'left':'right'};padding:5px 8px;border-bottom:1px solid var(--line);${extra||''}">${txt}</td>`
  const trs=rows.map(l=>{
    const c=catalog.find(x=>x.id===l.catalog_id); const tgt=c?c.temp_target:null; const dir=c?(c.temp_dir||'min'):'min'; const maxM=c?c.temp_max_minutes:null
    const durMin=(l.start_temp_at&&l.finish_temp_at)?Math.round((new Date(l.finish_temp_at)-new Date(l.start_temp_at))/60000):(l.total_minutes==null?null:Number(l.total_minutes))
    let pass=null
    if(tgt!=null && l.finish_temp!=null){ pass = dir==='max' ? (Number(l.finish_temp)<=tgt && (maxM?(durMin!=null&&durMin<=maxM):true)) : (Number(l.finish_temp)>=tgt) }
    const badge = pass==null?'<span class="muted">—</span>':(pass?'<b style="color:var(--green)">PASS</b>':'<b style="color:var(--red)">FAIL</b>')
    const tgtTxt = tgt!=null?((dir==='max'?'≤':'≥')+tgt+'°'+(maxM?('/'+maxM+'m'):'')):'—'
    const clk=(l.start_temp_at||l.finish_temp_at)?`<div class="muted" style="font-size:11px">${_clock(l.start_temp_at)||'–'}→${_clock(l.finish_temp_at)||'–'}</div>`:'';
    const tempCell=(l.start_temp==null?'–':l.start_temp)+'→'+(l.finish_temp==null?'–':l.finish_temp)+'°'+clk;
    return `<tr>${cell(l.log_date,true)}${cell(esc(l.task_name),true)}${cell(esc(_haccpName(l)),true)}${cell(tempCell,false)}${cell((durMin==null?'–':durMin)+'m',false)}${cell(tgtTxt,false)}${cell(badge,false)}</tr>`
  }).join('')
  const th=['Date','Step','Who','Temp','Time','Target','Result'].map((h,i)=>`<th style="text-align:${i<3?'left':'right'};padding:5px 8px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)">${h}</th>`).join('')
  box.innerHTML=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr>${th}</tr>${trs}</table></div>`
}
window.histToday=function(){const t=_isoLocalH(new Date());$('hFrom').value=t;$('hTo').value=t;loadHistory()}
window.histThisWeek=function(){const now=new Date();const off=(now.getDay()+6)%7;const mon=new Date(now);mon.setDate(now.getDate()-off);$('hFrom').value=_isoLocalH(mon);$('hTo').value=_isoLocalH(now);loadHistory()}
function renderHistorySummary(){
  const box=$('hSummaryBody'); if(!box)return
  const from=$('hFrom').value,to=$('hTo').value
  if(!historyRows.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const num=v=>Number(v)||0
  const totMap={},byPerson={},byTask={},byProduct={},byDay={},byDayTask={}
  let totMin=0,totWaste=0,totPeopleMin=0
  historyRows.forEach(r=>{
    const kg=num(r.kg),mins=num(r.mins),waste=num(r.waste),staff=num(r.staff)||1
    addAmt(totMap,r.uom,kg); totMin+=mins; totWaste+=waste; totPeopleMin+=mins*staff
    const P=byPerson[r.who]||(byPerson[r.who]={amt:{},mins:0,tasks:0}); addAmt(P.amt,r.uom,kg);P.mins+=mins;P.tasks++
    const T=byTask[r.task]||(byTask[r.task]={amt:{},mins:0,times:0,uom:r.uom}); addAmt(T.amt,r.uom,kg);T.mins+=mins;T.times++
    if(r.product){const Pr=byProduct[r.product]||(byProduct[r.product]={amt:{}});addAmt(Pr.amt,r.uom,kg)}
    const D=byDay[r.date]||(byDay[r.date]={amt:{},tasks:0,mins:0,uom:r.uom});addAmt(D.amt,r.uom,kg);D.tasks++;D.mins+=mins
    const DT=byDayTask[r.date]||(byDayTask[r.date]={})
    const V=DT[r.task]||(DT[r.task]={amt:{},mins:0,times:0,uom:r.uom}); addAmt(V.amt,r.uom,kg);V.mins+=mins;V.times++
  })
  const days=Object.keys(byDay).sort()
  const jobSel=$('hJob'); const jobLbl=jobSel&&jobSel.value?esc(jobSel.value)+' · ':''
  const rangeLbl = from===to ? niceDate(from) : `${niceDate(from)} → ${niceDate(to)}`
  let h=`<div style="margin-bottom:14px"><div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)">${jobLbl}${from===to?'Shift report':'Team output'} · ${rangeLbl}</div>
    <div style="font-size:26px;font-weight:800;margin-top:4px">${fmtAmt(totMap)}</div>
    <div class="muted">${historyRows.length} tasks · ${(totMin/60).toFixed(1)} h logged · ${(totPeopleMin/60).toFixed(1)} people-h · ${totWaste?totWaste.toFixed(1)+' waste':'no waste logged'}</div></div>`
  h+=sumTable('By person', Object.entries(byPerson).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt)).map(([k,v])=>[esc(k),fmtAmt(v.amt),v.tasks,(v.mins/60).toFixed(1)+' h']), ['Name','Produced','Tasks','Time'])
  h+=sumTable('By task', Object.entries(byTask).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt)).map(([k,v])=>{const hrs=v.mins/60;const rate=hrs>0?Math.round(sumOf(v.amt)/hrs):null;return [esc(k),fmtAmt(v.amt),v.times,rate!=null?rate+' '+(v.uom||'kg')+'/hr':'–']}), ['Task','Produced','Times','Avg rate'])
  const prodRows=Object.entries(byProduct).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt))
  if(prodRows.length) h+=sumTable('By product', prodRows.map(([k,v])=>[esc(k),fmtAmt(v.amt)]), ['Product','Produced'])
  // Day breakdown. One job selected: a per-day line with that job's rate each
  // day. All jobs: every day broken down task by task, each with its own rate.
  const jobPicked=jobSel&&jobSel.value
  if(jobPicked){
    h+=sumTable('By day — '+esc(jobSel.value), days.map(d=>{
      const v=byDay[d], hrs=v.mins/60
      const rate=hrs>0?Math.round(sumOf(v.amt)/hrs)+' '+(v.uom||'kg')+'/hr':'–'
      return [niceDate(d),fmtAmt(v.amt),v.tasks,hrs.toFixed(1)+' h',rate]
    }), ['Day','Produced','Runs','Time','Rate'])
  } else {
    const dtRows=[]
    days.forEach(d=>{
      const dv=byDay[d], dh=dv.mins/60
      dtRows.push(['<b>'+niceDate(d)+'</b>','<b>'+fmtAmt(dv.amt)+'</b>','<b>'+dv.tasks+'</b>','<b>'+dh.toFixed(1)+' h</b>',''])
      Object.entries(byDayTask[d]).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt)).forEach(([t,v])=>{
        const hrs=v.mins/60
        const rate=hrs>0?Math.round(sumOf(v.amt)/hrs)+' '+(v.uom||'kg')+'/hr':'–'
        dtRows.push(['&nbsp;&nbsp;&nbsp;'+esc(t),fmtAmt(v.amt),v.times,hrs.toFixed(1)+' h',rate])
      })
    })
    if(dtRows.length) h+=sumTable('Each day, task by task', dtRows, ['Day / task','Produced','Runs','Time','Rate'])
  }
  box.innerHTML=h
}

/* ---- End-of-day report (printable) ---------------------------------------
   Two flavours of the same day, both built to be ticked against the paper
   records before filing:
     summary — one page a day: the numbers, the temperature result, and the
               paperwork checklist. What the office signs off.
     full    — the summary plus every completed job in the order it ran.
               What you reach for when the summary does not add up.
   Rendered into #printArea, which styles.css already isolates for printing. */
const _EOD_SHEETS = [
  { re: /brisket.*(trim|unpack|pack|bulk fat)|meat prep|vacuum (pack|tumbl)|loading cook tank/i, code: '0008', name: 'Brisket Phase 1 — Meat Room' },
  { re: /trim machine|bulk fat|r[uü]hle|sr ?1|dicer/i,          code: '0011',  name: 'Rühle SR1 — Parts Control &amp; Cleaning' },
  { re: /brisket unloading|cook ?tank|sous vide/i,              code: '0009',  name: 'Brisket Phase 2 — Ovens &amp; Cooktanks' },
  { re: /mexican rice/i,                                        code: '0001',  name: 'Rice — Shift Record (0001A night · 0001B day)' },
  { re: /fajita/i,                                              code: '0002',  name: 'Fajita Vegetables (0002A night · 0002B day)' },
  { re: /rice ?& ?bean|rice and bean/i,                         code: '0003',  name: 'Rice &amp; Beans Mix — Tumbler' },
  { re: /black bean/i,                                          code: '0004',  name: 'Black Beans — Shift Record' },
  { re: /salsa/i,                                               code: '0005',  name: 'Smoky Salsa — Shift Record' },
  { re: /cauliflower/i,                                         code: '—',     name: 'Cauliflower Rice — no sheet issued yet (tracker note only)' },
]
const _EOD_ALSO = [
  ['0012',  'Proseal GT0s — Start-Up, Seal &amp; Gas Record'],
  ['0017',  'Proseal End of Line — Seal Reject Log'],
  ['0014',  'Unit 12 — Pre-7am Component Staging'],
  ['0015',  'Simmer Pallet Transfer — Unit 17 to 12'],
  ['0013B', 'Despatch Day — Pack-Out Record'],
  ['0016',  'Weekly Packaging Stocktake'],
]
function _eodBox(){ return '<span style="display:inline-block;width:11px;height:11px;border:1.2px solid #000;vertical-align:-1px"></span>' }
function _eodTH(t, r){ return '<th style="text-align:' + (r ? 'right' : 'left') + ';border-bottom:1.5px solid #000;padding:3px 5px;font-size:8.5px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap">' + t + '</th>' }
function _eodTD(t, r, b){ return '<td style="text-align:' + (r ? 'right' : 'left') + ';border-bottom:1px solid #ccc;padding:3px 5px' + (b ? ';font-weight:700' : '') + '">' + t + '</td>' }
function _eodH2(t){ return '<div style="background:#111;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:3px 7px;margin:10px 0 4px">' + t + '</div>' }
function _eodTable(head, body){ return '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' }

function _eodDayHtml(date, logs, last, mode){
  const full = mode === 'full'
  const n = v => Number(v) || 0
  const rows = logs.slice().sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')))
  const tot = {}, byTask = {}, byPerson = {}
  let totMin = 0, totWaste = 0, totPeopleMin = 0
  const noQty = [], notes = []
  rows.forEach(l => {
    const u = uomFor(l), q = n(l.units), m = n(l.total_minutes), w = n(l.waste_kg), st = n(l.staff_count) || 1
    if (l.units == null || l.units === '') noQty.push(l)
    if ((l.comments || '').trim()) notes.push(l)
    addAmt(tot, u, q); totMin += m; totWaste += w; totPeopleMin += m * st
    const T = byTask[l.task_name] || (byTask[l.task_name] = { amt: {}, mins: 0, runs: 0, uom: u, waste: 0 })
    addAmt(T.amt, u, q); T.mins += m; T.runs++; T.waste += w
    const who = _haccpName(l)
    const P = byPerson[who] || (byPerson[who] = { amt: {}, mins: 0, runs: 0, uom: u })
    addAmt(P.amt, u, q); P.mins += m; P.runs++
  })
  const firstStart = rows.length ? (_clock(rows[0].start_time) || '–') : '–'
  let lastFinish = '–'
  rows.forEach(l => { const f = _clock(l.finish_time); if (f && (lastFinish === '–' || f > lastFinish)) lastFinish = f })
  const rate = (amt, mins, u) => { const h = mins / 60, q = sumOf(amt); return (h > 0 && q > 0) ? Math.round(q / h) + ' ' + (u || 'kg') + '/hr' : '–' }
  let sn = 0
  const S = t => _eodH2((++sn) + ' · ' + t)

  let h = '<section style="' + (last ? '' : 'page-break-after:always;') + 'color:#000;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:11px">'
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #000;padding-bottom:5px">'
    + '<div><div style="font-size:17px;font-weight:700">END OF DAY PRODUCTION REPORT'
    + (full ? '<span style="font-size:11px;font-weight:400"> — full detail</span>' : '<span style="font-size:11px;font-weight:400"> — summary</span>') + '</div>'
    + '<div style="font-size:10px">Willa Ltd · Chefly production &nbsp;·&nbsp; check every line against the paperwork before filing</div></div>'
    + '<div style="text-align:right;font-size:10px"><div style="border:2px solid #000;padding:2px 9px;font-weight:700;font-size:12px;display:inline-block">' + niceDate(date) + '</div>'
    + '<div style="margin-top:3px">' + date + '</div>'
    + '<div>Shift: ' + _eodBox() + ' Day &nbsp; ' + _eodBox() + ' Night</div></div></div>'

  const kpi = (v, l) => '<div style="flex:1;border:2px solid #000;padding:3px 5px;text-align:center"><div style="font-size:13px;font-weight:700">' + v + '</div><div style="font-size:8px;text-transform:uppercase">' + l + '</div></div>'
  h += '<div style="display:flex;gap:5px;margin-top:7px">'
    + kpi(fmtAmt(tot), 'Produced')
    + kpi(rows.length, 'Jobs logged')
    + kpi((totMin / 60).toFixed(1) + ' h', 'Time on task')
    + kpi((totPeopleMin / 60).toFixed(1) + ' h', 'People-hours')
    + kpi(totWaste ? totWaste.toFixed(1) : '0', 'Waste')
    + kpi(firstStart + '–' + lastFinish, 'First start / last finish')
    + '</div>'

  if (!rows.length) {
    h += '<div style="border:1.5px solid #000;padding:6px 8px;margin-top:9px;font-size:11px;font-weight:700">No completed jobs were logged on this date. If the kitchen ran, nothing was recorded in the tracker — find out why before filing.</div>'
    h += '</section>'
    return h
  }

  // ---- the day's numbers: side by side on the summary, stacked on the full ----
  const taskTable = _eodTable(_eodTH('Job') + _eodTH('Produced', 1) + _eodTH('Runs', 1) + _eodTH('Time', 1) + _eodTH('Rate', 1) + _eodTH('Waste', 1),
    Object.keys(byTask).sort((a, b) => sumOf(byTask[b].amt) - sumOf(byTask[a].amt)).map(k => {
      const v = byTask[k]
      return '<tr>' + _eodTD(esc(k)) + _eodTD(fmtAmt(v.amt), 1, true) + _eodTD(v.runs, 1)
        + _eodTD((v.mins / 60).toFixed(1) + ' h', 1) + _eodTD(rate(v.amt, v.mins, v.uom), 1)
        + _eodTD(v.waste ? v.waste.toFixed(1) : '–', 1) + '</tr>'
    }).join(''))
  const personTable = _eodTable(_eodTH('Name') + _eodTH('Produced', 1) + _eodTH('Jobs', 1) + _eodTH('Time', 1) + _eodTH('Rate', 1),
    Object.keys(byPerson).sort((a, b) => sumOf(byPerson[b].amt) - sumOf(byPerson[a].amt)).map(k => {
      const v = byPerson[k]
      return '<tr>' + _eodTD(esc(k)) + _eodTD(fmtAmt(v.amt), 1, true) + _eodTD(v.runs, 1)
        + _eodTD((v.mins / 60).toFixed(1) + ' h', 1) + _eodTD(rate(v.amt, v.mins, v.uom), 1) + '</tr>'
    }).join(''))

  if (full) {
    // every job, in the order it ran
    h += S('Jobs completed — in the order they were run')
    const body = rows.map(l => {
      const u = uomFor(l)
      const c = (l.comments || '').trim()
      const tr = '<tr>'
        + _eodTD((_clock(l.start_time) || '–') + ' → ' + (_clock(l.finish_time) || '–'))
        + _eodTD(esc(l.task_name || ''), false, true)
        + _eodTD(esc(l.product || l.station || ''))
        + _eodTD(esc(_haccpName(l)))
        + _eodTD(l.units == null ? '<b>—</b>' : (l.units + ' ' + u), true)
        + _eodTD(l.total_minutes == null ? '–' : l.total_minutes, true)
        + _eodTD(l.units_per_hour != null ? (l.units_per_hour + ' ' + u + '/hr') : '–', true)
        + _eodTD(l.waste_kg ? l.waste_kg : '–', true)
        + _eodTD(l.staff_count == null ? 1 : l.staff_count, true)
        + _eodTD(l.photos && l.photos.length ? l.photos.length : '–', true)
        + _eodTD(_eodBox(), true)
        + '</tr>'
      return c ? tr + '<tr><td colspan="11" style="border-bottom:1px solid #ccc;padding:1px 5px 3px 5px;font-size:9px;font-style:italic">Note: ' + esc(c) + '</td></tr>' : tr
    }).join('')
    h += _eodTable(
      _eodTH('Time') + _eodTH('Job') + _eodTH('Product / station') + _eodTH('Who')
      + _eodTH('Qty', 1) + _eodTH('Mins', 1) + _eodTH('Rate', 1) + _eodTH('Waste', 1)
      + _eodTH('Ppl', 1) + _eodTH('Photos', 1) + _eodTH('Checked', 1), body)
    h += '<div style="page-break-inside:avoid">' + S('Totals by job') + taskTable + '</div>'
    h += '<div style="page-break-inside:avoid">' + S('Totals by person') + personTable + '</div>'
  } else {
    h += '<div style="display:flex;gap:12px;page-break-inside:avoid">'
      + '<div style="flex:1;min-width:0">' + S('Totals by job') + taskTable + '</div>'
      + '<div style="flex:1;min-width:0">' + S('Totals by person') + personTable + '</div>'
      + '</div>'
  }

  if (noQty.length) h += '<div style="border:1.5px solid #000;padding:3px 6px;margin-top:5px;font-size:9px;font-weight:700">'
    + noQty.length + ' job' + (noQty.length > 1 ? 's have' : ' has') + ' no quantity recorded: '
    + noQty.map(l => esc(l.task_name || '') + ' (' + (_clock(l.start_time) || '?') + ', ' + esc(_haccpName(l)) + ')').join(' · ')
    + '. Take the figure off the paper sheet and add it in History → Edit.</div>'

  // ---- temperature records ----
  const temps = rows.filter(l => { const c = catalog.find(x => x.id === l.catalog_id); return c && c.records_temp })
  const judged = temps.map(l => {
    const c = catalog.find(x => x.id === l.catalog_id)
    const tgt = c ? c.temp_target : null, dir = c ? (c.temp_dir || 'min') : 'min', maxM = c ? c.temp_max_minutes : null
    const dur = (l.start_temp_at && l.finish_temp_at) ? Math.round((new Date(l.finish_temp_at) - new Date(l.start_temp_at)) / 60000) : (l.total_minutes == null ? null : Number(l.total_minutes))
    let pass = null
    if (tgt != null && l.finish_temp != null) pass = dir === 'max' ? (Number(l.finish_temp) <= tgt && (maxM ? (dur != null && dur <= maxM) : true)) : (Number(l.finish_temp) >= tgt)
    return { l: l, pass: pass, dur: dur, tgtTxt: tgt != null ? ((dir === 'max' ? '≤' : '≥') + tgt + '°' + (maxM ? ' / ' + maxM + 'm' : '')) : '—' }
  })
  const fails = judged.filter(j => j.pass === false), unknown = judged.filter(j => j.pass == null)
  const tempRow = j => '<tr>' + _eodTD(esc(j.l.task_name || '')) + _eodTD(esc(_haccpName(j.l)))
    + _eodTD((_clock(j.l.start_temp_at) || '–') + ' → ' + (_clock(j.l.finish_temp_at) || '–'))
    + _eodTD((j.l.start_temp == null ? '–' : j.l.start_temp) + '° → ' + (j.l.finish_temp == null ? '–' : j.l.finish_temp) + '°', 1, true)
    + _eodTD(j.dur == null ? '–' : j.dur + 'm', 1) + _eodTD(j.tgtTxt, 1)
    + _eodTD(j.pass == null ? '—' : (j.pass ? 'PASS' : '<b>FAIL</b>'), 1) + '</tr>'
  const tempHead = _eodTH('Step') + _eodTH('Who') + _eodTH('Clock') + _eodTH('Temp', 1) + _eodTH('Time', 1) + _eodTH('Target', 1) + _eodTH('Result', 1)
  h += '<div style="page-break-inside:avoid">' + S('Temperature records (CCP evidence)')
  if (!judged.length) {
    h += '<div style="padding:4px 0;font-size:10px">No cook or chill step with temperature recording was logged today. If a cook ran, the reading exists only on paper — find out why it was not logged.</div>'
  } else if (full) {
    h += _eodTable(tempHead, judged.map(tempRow).join(''))
  } else {
    h += '<div style="font-size:10.5px;padding:2px 0 4px"><b>' + judged.length + '</b> recorded · <b>' + (judged.length - fails.length - unknown.length) + '</b> pass'
      + (fails.length ? ' · <b>' + fails.length + ' FAIL</b>' : ' · no failures')
      + (unknown.length ? ' · ' + unknown.length + ' with no reading' : '')
      + ' &nbsp;—&nbsp; every reading is listed on the full report.</div>'
    if (fails.length || unknown.length) h += _eodTable(tempHead, fails.concat(unknown).map(tempRow).join(''))
  }
  if (fails.length) h += '<div style="border:2px solid #000;padding:3px 6px;margin-top:4px;font-size:9.5px;font-weight:700">'
    + fails.length + ' reading(s) FAILED the limit. The corrective action and product disposition must be written on the paper record and signed by the manager before this report is filed.</div>'
  h += '</div>'

  // ---- notes off the floor (the full report carries them under each job) ----
  if (!full && notes.length) {
    h += '<div style="page-break-inside:avoid">' + S('Notes logged with the jobs')
      + notes.map(l => '<div style="font-size:9.5px;padding:1px 0">' + (_clock(l.start_time) || '–') + ' · <b>' + esc(l.task_name || '') + '</b> (' + esc(_haccpName(l)) + ') — ' + esc((l.comments || '').trim()) + '</div>').join('')
      + '</div>'
  }

  // ---- paperwork ----
  const sheets = {}
  Object.keys(byTask).forEach(nm => _EOD_SHEETS.forEach(s => {
    if (s.re.test(nm)) { const e = sheets[s.code] || (sheets[s.code] = { name: s.name, tasks: [] }); e.tasks.push(nm) }
  }))
  h += '<div style="page-break-inside:avoid">' + S('Paperwork check — the sheets today’s jobs should have produced')
  const sheetRows = Object.keys(sheets).sort().map(code => '<tr>'
    + _eodTD('<b>' + code + '</b>') + _eodTD(sheets[code].name)
    + _eodTD('<span style="font-size:9px">' + sheets[code].tasks.map(esc).join(' · ') + '</span>')
    + _eodTD(_eodBox(), 1) + _eodTD(_eodBox(), 1) + _eodTD('', 1) + '</tr>').join('')
  const alsoRows = _EOD_ALSO.filter(a => !sheets[a[0]]).map(a => '<tr>'
    + _eodTD('<b>' + a[0] + '</b>') + _eodTD(a[1])
    + _eodTD('<span style="font-size:9px;color:#555">if run today — else mark N/A</span>')
    + _eodTD(_eodBox(), 1) + _eodTD(_eodBox(), 1) + _eodTD('', 1) + '</tr>').join('')
  h += _eodTable(_eodTH('Doc') + _eodTH('Record sheet') + _eodTH('Because of') + _eodTH('Sheet complete', 1) + _eodTH('Filed', 1) + _eodTH('Init.', 1),
    (sheetRows || '<tr>' + _eodTD('—') + _eodTD('No job today maps to a production record sheet') + _eodTD('') + _eodTD('', 1) + _eodTD('', 1) + _eodTD('', 1) + '</tr>') + alsoRows)
  h += '<div style="border:1.5px dashed #000;padding:3px 7px;margin-top:4px;font-size:9px">A sheet ticked <b>complete</b> means every line, temperature and signature on it is filled in — not that the sheet exists. Anything missing goes in the box below before this report is signed.</div></div>'

  // ---- discrepancies + sign-off ----
  h += '<div style="page-break-inside:avoid">' + S('Discrepancies, missing records and anything the numbers do not explain')
  h += '<div style="border:1px solid #000;height:' + (full ? 56 : 44) + 'px;margin-bottom:3px"></div>'
  h += '<div style="display:flex;gap:18px;margin-top:8px">'
    + '<div style="flex:1;border-top:1px solid #000;padding-top:3px;font-size:9.5px">Shift lead — report matches what was run &nbsp; sign &amp; time</div>'
    + '<div style="flex:1;border-top:1px solid #000;padding-top:3px;font-size:9.5px">Manager — app checked against the paperwork &nbsp; sign &amp; date</div>'
    + '</div>'
  h += '<div style="margin-top:5px;font-size:8.5px;color:#333">' + (full ? '' : 'Summary — the job-by-job detail is on the full report. ')
    + 'Only completed jobs appear; anything still running when this was printed is not on the report. Rates are produced ÷ logged task time. Printed '
    + new Date().toLocaleString('en-GB') + (me && (me.full_name || me.email) ? ' by ' + esc(me.full_name || me.email) : '') + '.</div></div>'
  h += '</section>'
  return h
}

window.eodReport = function(mode){
  if (!isManagerUp()) return
  if (!histAllLogs.length) { alert('Load a date range first — the report is built from the days you have loaded.'); return }
  const byDate = {}
  histAllLogs.forEach(l => { (byDate[l.log_date] || (byDate[l.log_date] = [])).push(l) })
  const days = Object.keys(byDate).sort()
  const pa = $('printArea'); if (!pa) return
  if (!window._eodAfterPrint) {
    window._eodAfterPrint = true
    window.addEventListener('afterprint', () => { const p = $('printArea'); if (p) p.innerHTML = '' })
  }
  pa.innerHTML = '<style>@page{size:A4 landscape;margin:11mm}</style>'
    + days.map((d, i) => _eodDayHtml(d, byDate[d], i === days.length - 1, mode === 'full' ? 'full' : 'summary')).join('')
  window.print()
}
function _histEnsureEodBtn(){
  if ($('eodBtn')) return
  const ex = document.querySelector('#historyTab button[onclick*="exportCsv"]')
  if (!ex || !ex.parentNode || !ex.parentNode.parentNode) return
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = '<button id="eodBtn" class="ghost" onclick="eodReport(\'summary\')">🖨 End of day — 1 page a day</button>'
    + '<button id="eodBtnFull" class="ghost" onclick="eodReport(\'full\')">🖨 Full detail</button>'
  ex.parentNode.parentNode.insertBefore(row, ex.parentNode.nextSibling)
}

// ---- full log editor (manager/admin) ----
window.leTaskChanged=function(){
  const cat=catalog.find(c=>c.id===$('leTask').value)
  const _eu=cat?(cat.uom||'kg'):'kg'
  const kl=$('leKgLabel'); if(kl)kl.textContent=_eu+' produced'
  const wl=$('leWasteLabel'); if(wl)wl.textContent='Waste ('+_eu+')'
}
window.leTimesChanged=function(){
  const d=$('leDate').value||new Date().toISOString().slice(0,10)
  const st=$('leStart').value, fi=$('leFinish').value
  if(!st||!fi) return
  let s=new Date(d+'T'+st+':00'), f=new Date(d+'T'+fi+':00')
  if(f<s) f=new Date(f.getTime()+864e5)
  const mins=Math.round(((f-s)/60000)*100)/100
  if(mins>0) $('leMins').value=mins
}
window.newLog=async function(){
  if(!isManagerUp()) return
  leCurrentId=null
  if(!histProfs.length){const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email');histProfs=profs||[]}
  if(!histStaffs.length){const {data:staffs}=await sb.from('sim_staff').select('id,full_name');histStaffs=staffs||[]}
  const ts=$('leTask'); ts.innerHTML=''
  catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;ts.appendChild(o)})
  const ws=$('leWho'); ws.innerHTML='<option value="">— pick who —</option>'
  histProfs.forEach(p=>{const o=document.createElement('option');o.value='u:'+p.id;o.textContent=(p.full_name||p.email);ws.appendChild(o)})
  histStaffs.forEach(s=>{const o=document.createElement('option');o.value='s:'+s.id;o.textContent=s.full_name+' (floor)';ws.appendChild(o)})
  $('leDate').value=new Date().toISOString().slice(0,10)
  $('leProduct').value='';$('leKg').value='';$('leWaste').value='';$('lePeople').value=1;$('leMins').value='';$('leChange').value='';$('leComments').value='';$('leStart').value='';$('leFinish').value=''
  leTaskChanged()
  const t=$('leTitle'); if(t)t.textContent='Add manual entry'
  const db=$('leDelBtn'); if(db)db.style.display='none'
  clearMsg($('leMsg'))
  $('logEdit').classList.remove('hidden')
}
window.editLog=function(id){
  if(!isManagerUp()) return
  const l=histLogs.find(x=>x.id===id); if(!l) return
  leCurrentId=id
  const _t=$('leTitle'); if(_t)_t.textContent='Edit log'
  const _db=$('leDelBtn'); if(_db)_db.style.display=''
  const ts=$('leTask'); ts.innerHTML=''; let hasCat=false
  catalog.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.station?`${t.name} — ${t.station}`:t.name;if(t.id===l.catalog_id){o.selected=true;hasCat=true}ts.appendChild(o)})
  if(!hasCat){const o=document.createElement('option');o.value=l.catalog_id||'';o.textContent=(l.task_name||'(this task)')+' — current';o.selected=true;ts.insertBefore(o,ts.firstChild)}
  const ws=$('leWho'); ws.innerHTML=''
  histProfs.forEach(p=>{const o=document.createElement('option');o.value='u:'+p.id;o.textContent=(p.full_name||p.email);if(l.user_id===p.id)o.selected=true;ws.appendChild(o)})
  histStaffs.forEach(s=>{const o=document.createElement('option');o.value='s:'+s.id;o.textContent=s.full_name+' (floor)';if(l.staff_id===s.id)o.selected=true;ws.appendChild(o)})
  $('leDate').value=l.log_date||''
  $('leProduct').value=l.product||''
  const _eu=uomFor(l)
  const _kl=$('leKgLabel'); if(_kl)_kl.textContent=_eu+' produced'
  const _wl=$('leWasteLabel'); if(_wl)_wl.textContent='Waste ('+_eu+')'
  $('leKg').value=l.units??''
  $('leWaste').value=l.waste_kg??''
  $('lePeople').value=l.staff_count??1
  const _hhmm=t=>{if(!t)return '';const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
  $('leStart').value=_hhmm(l.start_time)
  $('leFinish').value=_hhmm(l.finish_time)
  $('leMins').value=l.total_minutes??''
  $('leChange').value=l.changeover_mins??''
  $('leComments').value=l.comments||''
  clearMsg($('leMsg'))
  $('logEdit').classList.remove('hidden')
}
window.closeLogEdit=function(){ $('logEdit').classList.add('hidden'); leCurrentId=null }
window.saveLogEdit=async function(){
  const id=leCurrentId
  const l=id?histLogs.find(x=>x.id===id):null
  if(id && !l) return
  const numOrNull=v=>{v=String(v).trim();return v===''?null:Number(v)}
  const units=numOrNull($('leKg').value), waste=numOrNull($('leWaste').value)
  if((units!=null&&isNaN(units))||(waste!=null&&isNaN(waste))){msg($('leMsg'),'Amount and waste must be numbers.',false);return}
  const _cat=catalog.find(c=>c.id===$('leTask').value)
  const _eu=l?uomFor(l):(_cat?(_cat.uom||'kg'):'kg')
  if(_eu==='kg' && ((units!=null&&units>1000)||(waste!=null&&waste>1000))){msg($('leMsg'),'A value is over the 1000 kg limit — please re-check (e.g. a dropped decimal point).',false);return}
  if(!id){
    // ---- create a manual entry ----
    if(!_cat){msg($('leMsg'),'Pick a task.',false);return}
    const who=$('leWho').value; if(!who){msg($('leMsg'),'Pick who did the task.',false);return}
    const date=$('leDate').value||new Date().toISOString().slice(0,10)
    const _st=$('leStart').value, _fi=$('leFinish').value
    let start, finish
    if(_st&&_fi){
      start=new Date(date+'T'+_st+':00'); finish=new Date(date+'T'+_fi+':00')
      if(finish<start) finish=new Date(finish.getTime()+864e5)
      if((finish-start)<=0){msg($('leMsg'),'Finish time must be after the start time.',false);return}
    } else {
      const mm=numOrNull($('leMins').value)
      if(mm==null||isNaN(mm)||mm<=0){msg($('leMsg'),'Enter start & finish times, or the minutes it took.',false);return}
      start=new Date(date+'T12:00:00'); finish=new Date(start.getTime()+mm*60000)
    }
    const row={catalog_id:_cat.id,task_name:_cat.name,station:_cat.station,uom:_eu,
      product:$('leProduct').value.trim()||null,units,waste_kg:waste,
      staff_count:Number($('lePeople').value)||1,changeover_mins:numOrNull($('leChange').value),
      comments:$('leComments').value.trim()||null,log_date:date,
      start_time:start.toISOString(),finish_time:finish.toISOString(),paused_seconds:0,status:'completed'}
    if(who.startsWith('u:'))row.user_id=who.slice(2); else if(who.startsWith('s:'))row.staff_id=who.slice(2)
    const {error}=await sb.from('sim_task_logs').insert(row)
    if(error){msg($('leMsg'),finishErr(error),false);return}
    closeLogEdit(); loadHistory(); return
  }
  const upd={
    product:$('leProduct').value.trim()||null,
    units, waste_kg:waste,
    staff_count:Number($('lePeople').value)||1,
    changeover_mins:numOrNull($('leChange').value),
    comments:$('leComments').value.trim()||null,
    log_date:$('leDate').value||l.log_date
  }
  const who=$('leWho').value
  if(who.startsWith('u:')){upd.user_id=who.slice(2);upd.staff_id=null}
  else if(who.startsWith('s:')){upd.staff_id=who.slice(2);upd.user_id=null}
  const cat=catalog.find(c=>c.id===$('leTask').value)
  if(cat){upd.catalog_id=cat.id;upd.task_name=cat.name;upd.station=cat.station}
  const _est=$('leStart').value, _efi=$('leFinish').value
  const _ed=upd.log_date||l.log_date
  if(_est && _efi){
    let s=new Date(_ed+'T'+_est+':00'), f=new Date(_ed+'T'+_efi+':00')
    if(f<s) f=new Date(f.getTime()+864e5)
    upd.start_time=s.toISOString(); upd.finish_time=f.toISOString(); upd.paused_seconds=0
  } else {
    const m=numOrNull($('leMins').value)
    if(m!=null && !isNaN(m) && l.start_time){
      const startMs=new Date(l.start_time).getTime(); const paused=Number(l.paused_seconds)||0
      upd.finish_time=new Date(startMs + (m*60 + paused)*1000).toISOString()
    }
  }
  const {error}=await sb.from('sim_task_logs').update(upd).eq('id',id)
  if(error){msg($('leMsg'),finishErr(error),false);return}
  closeLogEdit(); loadHistory()
}
window.delLog=async function(id){
  if(!isManagerUp()) return
  if(!confirm('Delete this log permanently? This cannot be undone.')) return
  const {error}=await sb.from('sim_task_logs').delete().eq('id',id)
  if(error){alert(error.message);return}
  closeLogEdit(); loadHistory()
}
window.exportCsv=function(){
  if(!historyRows.length){alert('Nothing to export — load a range first.');return}
  const cols=['date','start','finish','who','task','station','product','kg','uom','mins','uph','waste','staff','photos','comments']
  const head=['Date','Start','Finish','Name','Task','Station','Product','Qty','Unit','Minutes','Per hour','Waste','People','Photos','Comments']
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'
  const job=$('hJob')&&$('hJob').value?'_'+$('hJob').value.replace(/[^a-z0-9]+/gi,'-').toLowerCase():''
  const csv=[head.join(',')].concat(historyRows.map(r=>cols.map(c=>esc(r[c])).join(','))).join('\n')
  const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a')
  a.href=URL.createObjectURL(blob); a.download=`sim-history-${$('hFrom').value}_to_${$('hTo').value}${job}.csv`; a.click()
}

// ---- weekly packing orders importer (manager/admin) ----
function _parsePackOrders(text){
  const isNum=s=>{s=String(s).trim();return s!==''&&/^-?\d+(\.\d+)?$/.test(s)}
  const out=[]; let idx=0
  ;(text||'').split(/\r?\n/).forEach(ln=>{
    if(!ln.trim())return
    const tab=ln.indexOf('\t')>=0
    const toks=(tab?ln.split('\t'):ln.split(',')).map(t=>t.trim())
    let j=toks.length
    while(j>0 && (toks[j-1]===''||isNum(toks[j-1]))) j--
    const name=(tab?toks.slice(0,j).join(' '):toks.slice(0,j).join(', ')).trim()
    const nums=toks.slice(j).filter(t=>t!=='')
    if(!name||nums.length<2)return
    const up=name.toUpperCase()
    if(up==='MEALS'||up==='BOXES'||up.indexOf('DISH NAME')===0)return
    const total=Math.round(Number(nums[nums.length-1]))
    if(!total||isNaN(total)||total<=0)return
    out.push({sku:String(nums[0]),dish_name:name,qty:total,sort_order:idx++})
  })
  return out
}
window.importPackOrders=async function(){
  if(!isManagerUp()){msg($('poMsg'),'Managers/admins only.',false);return}
  const date=$('poDate').value; if(!date){msg($('poMsg'),'Pick the packing date first.',false);return}
  const rows=_parsePackOrders($('poText').value)
  if(!rows.length){msg($('poMsg'),'No dishes found. Paste the All Dishes rows (Dish, SKU, Quantity … Total).',false);return}
  const meals=rows.reduce((s,r)=>s+r.qty,0)
  const today=new Date().toISOString().slice(0,10)
  const lbl=_poDayLabel(date).toUpperCase()
  let warn=''
  if(date<today)warn='\n\nWARNING: that date is in the PAST. The pack team will never see this list.'
  else if(date===today)warn='\n\nNOTE: that is TODAY. The pack team loads this list today, not later in the week.'
  if(!confirm('This list will be packed on:\n\n'+lbl+'\n\n'+rows.length+' dishes, '+meals+' meals. It replaces any existing list for that date.'+warn+'\n\nCorrect?'))return
  const {data,error}=await sb.rpc('sim_import_pack_dishes',{p_date:date,p_rows:rows})
  if(error){msg($('poMsg'),error.message,false);return}
  msg($('poMsg'),'Loaded '+data+' dishes ('+meals+' meals) for '+_poDayLabel(date)+'. On that day, open Packing → "Load today’s dish list".',true)
  $('poPreview').innerHTML=rows.map(r=>esc(r.sku)+' · '+esc(r.dish_name)+' — <b>'+r.qty+'</b>').join('<br>')
  $('poText').value=''
}
