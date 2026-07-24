/* CORE: Supabase client, shared state, helpers, photo handling, lightbox.
   Loaded as a classic script — top-level let/const/functions are shared with the
   other feature scripts (auth.js, tasks.js, etc.). Supabase is the UMD global. */

const SUPABASE_URL = 'https://fhztszxpgqhunogwcoxw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3g-avL7NqQQsIMESfiGk4Q_8dBIarve'
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ---- shared state ----
let me=null, profile=null, catalog=[], products=[], activeLogs=[], timerInt=null
let lastFinishIds=new Set(), notifyReady=false, booting=false, kStaff=null, kActiveLogs=[], kTimerInt=null
let simProducts=[]  // cached sim_products (with shelf_life_days) for Use By / batch code

// ---- Use By + batch code (traceability) ----
async function ensureSimProducts(force){
  if(simProducts.length&&!force) return
  const {data}=await sb.from('sim_products').select('id,name,active,sort_order,shelf_life_days').order('sort_order').order('name')
  simProducts=data||[]
}
function shelfLifeFor(productName){
  const n=String(productName||'').trim().toLowerCase()
  const p=simProducts.find(x=>String(x.name||'').trim().toLowerCase()===n)
  const d=(p&&p.shelf_life_days!=null)?Number(p.shelf_life_days):9
  return (d==null||isNaN(d))?9:d
}
function _traceIsoDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function useByFor(logDate,productName){
  const base=(logDate&&/^\d{4}-\d{2}-\d{2}/.test(logDate))?new Date(logDate.slice(0,10)+'T00:00:00'):new Date()
  base.setDate(base.getDate()+shelfLifeFor(productName))
  return _traceIsoDate(base)
}
function batchCodeFor(productName,logDate){
  const alnum=String(productName||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4)||'PROD'
  const iso=(logDate&&/^\d{4}-\d{2}-\d{2}/.test(logDate))?logDate.slice(0,10):_traceIsoDate(new Date())
  return alnum+'-'+iso.slice(2).replace(/-/g,'')
}

// ---- tiny helpers ----
const $ = id => document.getElementById(id)
const show=el=>el.classList.remove('hidden'), hide=el=>el.classList.add('hidden')
function msg(el,t,ok){el.textContent=t; el.className='msg show '+(ok?'ok':'err')}
function clearMsg(el){el.className='msg'}
function fmtClock(s){s=Math.max(0,Math.floor(s));const h=String(Math.floor(s/3600)).padStart(2,'0'),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),x=String(s%60).padStart(2,'0');return `${h}:${m}:${x}`}
const mins=(a,b)=>((new Date(b)-new Date(a))/60000)
const fmtTime=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
function workedSeconds(l){let s=(Date.now()-new Date(l.start_time))/1000-(l.paused_seconds||0);if(l.status==='paused'&&l.pause_started_at)s-=(Date.now()-new Date(l.pause_started_at))/1000;return Math.max(0,s)}
function updatePauseUI(l,pillId,btnId){const paused=l.status==='paused';const pill=$(pillId);if(pill){pill.textContent=paused?'❚❚ PAUSED':'● RUNNING';pill.className='pill '+(paused?'off':'live')}const btn=$(btnId);if(btn){btn.textContent=paused?'▶ Resume':'⏸ Pause';btn.className=paused?'green':'ghost'}}
const isManagerUp=()=> profile && (profile.role==='manager'||profile.role==='admin')
const isAdmin=()=> profile && profile.role==='admin'
function notify(t,b){if(notifyReady){try{new Notification(t,{body:b})}catch(e){}}}

// ---- task helpers ----
function catFor(log){return catalog.find(c=>c.id===log.catalog_id)}
function uomCat(c){return (c&&c.uom)||'kg'}
function uomFor(log){return (log&&log.uom)||uomCat(catFor(log))}
function requiresUnits(log){const c=catFor(log);return !c || c.requires_units!==false}
function requiresLot(log){const c=catFor(log);return !!(c && c.requires_lot)}
function requiresWaste(log){const c=catFor(log);return !!(c&&c.require_waste)}
function showsWaste(log){const c=catFor(log);return !!(c&&(c.track_waste||c.require_waste))}
function finishErr(error){
  if(/VALUE_TOO_HIGH/.test(error.message)) return 'That number looks wrong — it is over the 1000 kg per-task limit. Please re-check and re-enter (e.g. 22.94, not 2294).'
  if(/KG_REQUIRED/.test(error.message)) return 'Please enter the amount produced before finishing this task.'
  if(/LOT_REQUIRED/.test(error.message)) return 'Record the ingredient lot(s) used before finishing this task.'
  if(/WASTE_REQUIRED/.test(error.message)) return 'Please enter the waste (kg) for this task before finishing.'
  return error.message
}
// hard block (no override): implausible magnitudes. Returns a message, or null if OK.
function numberHardError(units,waste,uom){
  const isKg=(!uom||uom==='kg'); const cap=isKg?1000:100000; const u=isKg?'kg':uom
  if(units!=null && units>cap) return 'That looks wrong: '+units+' '+u+' in one task. The maximum is '+cap+' '+u+(isKg?' — did you drop a decimal point (e.g. '+(units/100).toFixed(2)+')?':'.')+' Please re-enter.'
  if(waste!=null && waste>cap) return 'That waste figure looks wrong: '+waste+' '+u+'. The maximum is '+cap+' '+u+'. Please re-enter.'
  return null
}
// soft warning (overridable) for plausible-but-odd numbers
function numberSanityOK(units,waste){
  const issues=[]
  if(units!=null && waste!=null && waste>units && waste>20) issues.push('Waste ('+waste+' kg) is more than produced ('+units+' kg)')
  if(!issues.length) return true
  return confirm('⚠ Please double-check these numbers:\n\n• '+issues.join('\n• ')+'\n\nTap OK to save anyway, or Cancel to go back and fix.')
}
function unitsGateOK(){
  alert('Please enter the amount produced before finishing this task.\n\nIf this job genuinely has no output to record, an admin can untick "Records amount produced" for it in Manage → Tasks.')
  return false
}
function wasteGateOK(){
  alert('Please enter the waste for this task before finishing.\n\nIf there was genuinely no waste, enter 0.')
  return false
}
function photoGateOK(log){
  if(log.photos && log.photos.length) return true
  if(isManagerUp()) return confirm('No photo added. Finish without a photo?\n\n(Manager override — staff cannot skip this.)')
  alert('A photo is required to finish this task.\n\nPlease add a photo of the work above. If it will not upload, ask a manager to finish it for you.')
  return false
}

// ---- photos ----
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
window.uploadPhotosFor=async function(ev,logId,mode){
  const arr=mode==='kiosk'?kActiveLogs:activeLogs
  const log=arr.find(x=>x.id===logId)
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
  renderPhotoStrip((mode==='kiosk'?'ph_k_':'ph_s_')+log.id, log)
}

// ---- photo lightbox ----
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
