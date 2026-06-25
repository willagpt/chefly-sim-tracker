/* MANAGE: join code, user access, floor staff, wall link, and History/reports + CSV. */

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

// ---- floor staff (admin) ----
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

// ---- wall display link (admin) ----
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

// ---- history / reports (manager/admin) ----
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
