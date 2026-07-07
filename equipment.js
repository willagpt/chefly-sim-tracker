/* EQUIPMENT: cooking-vessel board (load/unload, countdowns, overdue) + admin register. */

let equipList=[], equipCooks={}, equipNames={}, equipRegData=[], equipTimer=null, equipOverdueNotified=new Set()
const EQUIP_KINDS=['oven','bratt_pan','sous_vide','combi','blast_chiller','freezer','other']  // add new sections here - all dropdowns build from this list
const equipKindLabel=k=>({oven:'Oven',bratt_pan:'Bratt pan',sous_vide:'Sous-vide',combi:'Combi',blast_chiller:'Blast chiller',freezer:'Freezer',other:'Equipment'}[k]||k)
function equipKindOptions(sel,withEmpty){if(!sel)return;const cur=sel.value;sel.innerHTML=(withEmpty?'<option value="">—</option>':'')+EQUIP_KINDS.map(k=>'<option value="'+k+'">'+equipKindLabel(k)+'</option>').join('');if(cur)sel.value=cur}
equipKindOptions(document.getElementById('enKind'));equipKindOptions(document.getElementById('ntKind'),true)
/* tasks.js builds the task-editor vessel-type select from its own hardcoded list;
   wrap editTask (tasks.js loads before this file) so that select follows EQUIP_KINDS too. */
if(typeof window.editTask==='function'){
  const _origEditTask=window.editTask
  window.editTask=function(id){
    _origEditTask(id)
    const sel=document.getElementById('et_kind_'+id)
    if(sel){const cur=sel.value;sel.innerHTML='<option value="">— vessel type —</option>'+EQUIP_KINDS.map(k=>'<option value="'+k+'">'+equipKindLabel(k)+'</option>').join('');sel.value=cur}
  }
}
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
  await loadEquipState()
  equipNames={}; (profs||[]).forEach(p=>equipNames['u:'+p.id]=p.full_name||p.email); (staffs||[]).forEach(s=>equipNames['s:'+s.id]=s.full_name)
  renderEquipBoard()
  if(equipTimer)clearInterval(equipTimer); equipTimer=setInterval(tickEquip,1000); tickEquip()
}
function renderEquipBoard(){
  const box=$('equipBoard'); if(!box)return
  if(!equipList.length){box.innerHTML='<div class="card"><p class="muted">No equipment set up yet. An admin can add it in Manage → Cooking equipment.</p></div>';return}
  const busyN=equipState&&equipState.length?equipState.filter(e=>e.busy).length:Object.keys(equipCooks).length
  const locs=[...new Set(equipList.map(e=>e.location||'Other'))]
  let html=`<div class="card"><b>${busyN}</b> of <b>${equipList.length}</b> vessels in use right now.</div>`
  locs.forEach(loc=>{
    html+=`<h2 style="margin:16px 0 8px">${esc(loc)}</h2>`
    equipList.filter(e=>(e.location||'Other')===loc).forEach(e=>{html+=equipCardHtml(e,equipCooks[e.id])})
  })
  box.innerHTML=html
}
function equipCardHtml(e,c){
  const sub=`${equipKindLabel(e.kind)}${e.capacity?' · '+esc(e.capacity):''}${(e.time_factor&&Number(e.time_factor)!==1)?' · ×'+e.time_factor+' cook time':''}`
  if(!c){
    const es=(typeof equipById==='function')?equipById(e.id):null
    if(es&&es.busy&&es.source==='task'){
      return `<div class="card" style="margin-bottom:10px;border-color:var(--accent)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0"><b>${esc(e.name)}</b><div class="muted">${sub}</div>
          <div style="margin-top:6px"><b>${esc(es.activity||'In use')}</b>${es.product?' · '+esc(es.product):''}</div>
          <div class="muted">by ${esc(es.occupant||'')} · task in progress</div></div>
          <div class="pill live">● in use</div>
        </div></div>`
    }
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><b>${esc(e.name)}</b><div class="muted">${sub} · <span style="color:var(--green)">empty</span></div></div>
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
        <b>${esc(e.name)}</b><div class="muted">${sub}</div>
        <div style="margin-top:6px"><b>${esc(c.product)||'In use'}</b>${c.process?' · '+esc(c.process):''}</div>
        <div class="muted">by ${esc(cookName(c))} · in for <span id="el_${c.id}">–</span>${c.target_temp?' · '+esc(c.target_temp):''}</div>
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
    d.innerHTML=`<div><b>${esc(e.name)}</b><div class="meta">${equipKindLabel(e.kind)}${e.capacity?' · '+esc(e.capacity):''}${e.location?' · '+esc(e.location):''}${(e.time_factor&&Number(e.time_factor)!==1)?' · ×'+e.time_factor+' cook time':''}${e.active?'':' · <span style="color:#fca5a5">inactive</span>'}</div></div>`
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
  const kinds=EQUIP_KINDS
  d.innerHTML=`<input id="eqn_${id}" value="${esc(e.name)}" placeholder="Name" />
    <div class="row" style="margin-top:8px">
      <select id="eqk_${id}">${kinds.map(k=>`<option value="${k}" ${e.kind===k?'selected':''}>${equipKindLabel(k)}</option>`).join('')}</select>
      <input id="eqc_${id}" value="${esc(e.capacity)}" placeholder="Capacity" />
    </div>
    <input id="eql_${id}" value="${esc(e.location)}" placeholder="Location" style="margin-top:8px" />
    <div style="margin-top:8px"><label style="font-size:12px;color:var(--muted)">Cook-time factor — 1 = standard · 1.2 = 20% slower · 0.8 = 20% faster</label><input id="eqtf_${id}" type="number" step="0.05" min="0.1" value="${e.time_factor??1}" /></div>
    <div class="row" style="margin-top:8px">
      <button class="green sm" style="flex:1" onclick="saveEquip('${id}')">Save</button>
      <button class="ghost sm" style="flex:1" onclick="loadEquipReg()">Cancel</button>
    </div>`
}
window.saveEquip=async function(id){
  const name=$('eqn_'+id).value.trim(); if(!name){alert('Name required');return}
  const {error}=await sb.from('sim_equipment').update({name,kind:$('eqk_'+id).value,capacity:$('eqc_'+id).value.trim()||null,location:$('eql_'+id).value.trim()||null,time_factor:(Number($('eqtf_'+id).value)||1)}).eq('id',id)
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
