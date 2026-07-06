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
    sb.from('sim_profiles').select('email,suspended,packing_team')
  ])
  if(error){box.innerHTML='<p class="muted">'+error.message+'</p>';return}
  const activeEmails=new Set((profs||[]).map(p=>(p.email||'').toLowerCase()))
  const suspendedByEmail=new Map((profs||[]).map(p=>[(p.email||'').toLowerCase(), !!p.suspended]))
  const packingByEmail=new Map((profs||[]).map(p=>[(p.email||'').toLowerCase(), !!p.packing_team]))
  box.innerHTML=''
  ;(allowed||[]).forEach(u=>{
    const em=(u.email||'').toLowerCase()
    const d=document.createElement('div'); d.className='member'
    const self=em===(me.email||'').toLowerCase()
    const active=activeEmails.has(em)
    const sus=suspendedByEmail.get(em)===true
    const packLead=packingByEmail.get(em)===true
    const stateBadge = sus ? '<span class="pill off">suspended</span>' : (active?'<span class="pill live">● active</span>':'<span class="pill off">not logged in</span>')
    const packBadge = packLead ? ' · <span class="pill" style="background:rgba(249,115,22,.2);color:#fdba74">packing lead</span>' : ''
    d.innerHTML=`<div><div class="name">${esc(u.full_name||u.email)} ${self?'<span class="muted">(you)</span>':''}</div><div class="sub">${esc(u.email)} · ${stateBadge}${packBadge}</div></div>`
    const ctl=document.createElement('div'); ctl.className='ctl'
    const sel=document.createElement('select'); ['staff','manager','admin'].forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;if(u.role===r)o.selected=true;sel.appendChild(o)}); sel.disabled=self
    sel.onchange=async()=>{const {error}=await sb.rpc('sim_set_user_role',{p_email:u.email,p_role:sel.value});if(error){msg($('memberMsg'),error.message,false);sel.value=u.role}else{msg($('memberMsg'),`${u.full_name||u.email} is now ${sel.value}.`,true);u.role=sel.value}}
    ctl.appendChild(sel)
    const pkB=document.createElement('button');pkB.className='ghost sm';pkB.textContent=packLead?'Remove packing':'Packing lead'
    pkB.onclick=async()=>{const {error}=await sb.rpc('sim_set_packing',{p_email:u.email,p_on:!packLead});if(error){msg($('memberMsg'),error.message,false)}else{msg($('memberMsg'),(packLead?'Removed packing access for ':'Packing lead access for ')+u.email,true);loadAccess()}}
    ctl.appendChild(pkB)
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
async function loadPackRoster(){
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
    '<div class="row" style="margin-top:6px"><button class="ghost" onclick="copyPackWall()">Copy packing wall link</button></div>'
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
}
window.genWallToken=async function(){
  if(!confirm('Generate a new wall link? Any existing link will stop working.'))return
  const {data,error}=await sb.rpc('sim_set_wall_token')
  if(error){msg($('wallMsg'),error.message,false);return}
  ensurePackWallEl()
  $('wallUrl').value=location.origin+'/wall.html?t='+data
  if($('packWallUrl')) $('packWallUrl').value=location.origin+'/packwall.html?t='+data
  msg($('wallMsg'),'New links ready — office board (wall.html) and packing line (packwall.html).',true)
}
window.copyWall=function(){const v=$('wallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Office wall link copied.',true)}}
window.copyPackWall=function(){const v=$('packWallUrl').value; if(v&&!v.startsWith('(')&&navigator.clipboard){navigator.clipboard.writeText(v); msg($('wallMsg'),'Packing wall link copied.',true)}}

// ---- history / reports (manager/admin) ----
let historyRows=[], histLogs=[], histProfs=[], histStaffs=[], leCurrentId=null, histView='summary'
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
  histLogs=logs||[]; histProfs=profs||[]; histStaffs=staffs||[]
  const nameFor=l=>{ if(l.user_id){const p=histProfs.find(x=>x.id===l.user_id);return p?(p.full_name||p.email):'Someone'} if(l.staff_id){const s=histStaffs.find(x=>x.id===l.staff_id);return s?s.full_name:'Staff'} return 'Someone' }
  historyRows=histLogs.map(l=>({id:l.id,date:l.log_date,who:nameFor(l),task:l.task_name,station:l.station||'',product:l.product||'',kg:l.units??'',uom:uomFor(l),mins:l.total_minutes??'',uph:l.units_per_hour??'',waste:l.waste_kg??'',staff:l.staff_count??'',photos:(l.photos||[]).length,comments:l.comments||''}))
  const num=v=>Number(v)||0
  const totKg=historyRows.reduce((s,r)=>s+num(r.kg),0), totMin=historyRows.reduce((s,r)=>s+num(r.mins),0), totWaste=historyRows.reduce((s,r)=>s+num(r.waste),0)
  $('hSummary').innerHTML=`<b>${historyRows.length}</b> tasks · <b>${Math.round(totKg)}</b> produced · <b>${Math.round(totMin)}</b> min · <b>${totWaste.toFixed(1)}</b> waste`
  renderHistorySummary(); renderHaccp()
  if(!historyRows.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const canEdit=isManagerUp()
  box.innerHTML=histLogs.map(l=>{
    const who=nameFor(l), u=uomFor(l)
    const photos=l.photos||[]
    const strip=photoThumbs(photos,54)
    const rate=l.units_per_hour!=null?` · <b style="color:var(--accent)">${l.units_per_hour} ${u}/hr</b>`:''
    const wasteTxt=l.waste_kg?` · ${l.waste_kg} ${u} waste`:''
    const editLink=canEdit?`<a class="link" style="flex-shrink:0;font-size:13px" onclick="editLog('${l.id}')">✏️ Edit</a>`:''
    return `<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0"><b style="font-size:15px">${esc(l.task_name)}</b> <span class="muted">· ${esc(who)}</span><div class="muted" style="font-size:12px;margin-top:1px">${l.log_date}${l.product?' · '+esc(l.product):''}${l.station?' · '+esc(l.station):''}</div></div>
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
  const totMap={},byPerson={},byTask={},byProduct={},byDay={}
  let totMin=0,totWaste=0,totPeopleMin=0
  historyRows.forEach(r=>{
    const kg=num(r.kg),mins=num(r.mins),waste=num(r.waste),staff=num(r.staff)||1
    addAmt(totMap,r.uom,kg); totMin+=mins; totWaste+=waste; totPeopleMin+=mins*staff
    const P=byPerson[r.who]||(byPerson[r.who]={amt:{},mins:0,tasks:0}); addAmt(P.amt,r.uom,kg);P.mins+=mins;P.tasks++
    const T=byTask[r.task]||(byTask[r.task]={amt:{},mins:0,times:0,uom:r.uom}); addAmt(T.amt,r.uom,kg);T.mins+=mins;T.times++
    if(r.product){const Pr=byProduct[r.product]||(byProduct[r.product]={amt:{}});addAmt(Pr.amt,r.uom,kg)}
    const D=byDay[r.date]||(byDay[r.date]={amt:{},tasks:0});addAmt(D.amt,r.uom,kg);D.tasks++
  })
  const days=Object.keys(byDay).sort()
  const rangeLbl = from===to ? niceDate(from) : `${niceDate(from)} → ${niceDate(to)}`
  let h=`<div style="margin-bottom:14px"><div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)">${from===to?'Shift report':'Team output'} · ${rangeLbl}</div>
    <div style="font-size:26px;font-weight:800;margin-top:4px">${fmtAmt(totMap)}</div>
    <div class="muted">${historyRows.length} tasks · ${(totMin/60).toFixed(1)} h logged · ${(totPeopleMin/60).toFixed(1)} people-h · ${totWaste?totWaste.toFixed(1)+' waste':'no waste logged'}</div></div>`
  h+=sumTable('By person', Object.entries(byPerson).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt)).map(([k,v])=>[esc(k),fmtAmt(v.amt),v.tasks,(v.mins/60).toFixed(1)+' h']), ['Name','Produced','Tasks','Time'])
  h+=sumTable('By task', Object.entries(byTask).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt)).map(([k,v])=>{const hrs=v.mins/60;const rate=hrs>0?Math.round(sumOf(v.amt)/hrs):null;return [esc(k),fmtAmt(v.amt),v.times,rate!=null?rate+' '+(v.uom||'kg')+'/hr':'–']}), ['Task','Produced','Times','Avg rate'])
  const prodRows=Object.entries(byProduct).sort((a,b)=>sumOf(b[1].amt)-sumOf(a[1].amt))
  if(prodRows.length) h+=sumTable('By product', prodRows.map(([k,v])=>[esc(k),fmtAmt(v.amt)]), ['Product','Produced'])
  if(days.length>1) h+=sumTable('By day', days.map(d=>[niceDate(d),fmtAmt(byDay[d].amt),byDay[d].tasks]), ['Day','Produced','Tasks'])
  box.innerHTML=h
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
  const cols=['date','who','task','station','product','kg','uom','mins','uph','waste','staff','photos','comments']
  const head=['Date','Name','Task','Station','Product','Qty','Unit','Minutes','Per hour','Waste','People','Photos','Comments']
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'
  const csv=[head.join(',')].concat(historyRows.map(r=>cols.map(c=>esc(r[c])).join(','))).join('\n')
  const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a')
  a.href=URL.createObjectURL(blob); a.download=`sim-history-${$('hFrom').value}_to_${$('hTo').value}.csv`; a.click()
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
  if(!confirm('Load '+rows.length+' dishes ('+meals+' meals) for '+date+'?\n\nThis replaces any existing list for that date.'))return
  const {data,error}=await sb.rpc('sim_import_pack_dishes',{p_date:date,p_rows:rows})
  if(error){msg($('poMsg'),error.message,false);return}
  msg($('poMsg'),'Loaded '+data+' dishes ('+meals+' meals) for '+date+'. On that day, open Packing → "Load today’s dish list".',true)
  $('poPreview').innerHTML=rows.map(r=>esc(r.sku)+' · '+esc(r.dish_name)+' — <b>'+r.qty+'</b>').join('<br>')
  $('poText').value=''
}
