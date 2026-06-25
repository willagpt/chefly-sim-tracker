/* CORE: Supabase client, shared state, helpers, photo handling, lightbox.
   Loaded as a classic script — top-level let/const/functions are shared with the
   other feature scripts (auth.js, tasks.js, etc.). Supabase is the UMD global. */

const SUPABASE_URL = 'https://fhztszxpgqhunogwcoxw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3g-avL7NqQQsIMESfiGk4Q_8dBIarve'
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ---- shared state ----
let me=null, profile=null, catalog=[], products=[], activeLog=null, timerInt=null
let lastFinishIds=new Set(), notifyReady=false, booting=false, kStaff=null, kActiveLog=null, kTimerInt=null

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
function requiresUnits(log){const c=catFor(log);return !c || c.requires_units!==false}
function requiresWaste(log){const c=catFor(log);return !!(c&&c.require_waste)}
function showsWaste(log){const c=catFor(log);return !!(c&&(c.track_waste||c.require_waste))}
function finishErr(error){
  if(/KG_REQUIRED/.test(error.message)) return 'Please enter the kilograms produced before finishing this task.'
  if(/WASTE_REQUIRED/.test(error.message)) return 'Please enter the waste (kg) for this task before finishing.'
  return error.message
}
function numberSanityOK(units,waste){
  const issues=[]
  if(units!=null && units>1000) issues.push('Produced = '+units+' kg (over 1000)')
  if(waste!=null && waste>1000) issues.push('Waste = '+waste+' kg (over 1000)')
  if(units!=null && waste!=null && waste>units && waste>20) issues.push('Waste ('+waste+' kg) is more than produced ('+units+' kg)')
  if(!issues.length) return true
  return confirm('⚠ Please double-check these numbers:\n\n• '+issues.join('\n• ')+'\n\nTap OK to save anyway, or Cancel to go back and fix.')
}
function unitsGateOK(){
  alert('Please enter the kilograms produced before finishing this task.\n\nIf this job genuinely has no weight, an admin can untick "Records kg" for it in Manage → Tasks.')
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
