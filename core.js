/* CORE: Supabase client, shared state, helpers, photo handling, lightbox.
   Loaded as a classic script — top-level let/const/functions are shared with the
   other feature scripts (auth.js, tasks.js, etc.). Supabase is the UMD global. */

const SUPABASE_URL = 'https://fhztszxpgqhunogwcoxw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3g-avL7NqQQsIMESfiGk4Q_8dBIarve'

/* Retry at the CLIENT level so every request in the app is covered -- reads,
   writes, auth, storage, edge functions -- rather than each call site having
   to remember. Staff work on phones on mobile data and a request that dies in
   flight surfaces as a bare "TypeError: Load failed" (Safari) / "Failed to
   fetch" (Chrome). Caught live 17 Aug 2026: a staff phone on iCloud Private
   Relay showed exactly that on START NOW, and the server logs show the
   request never arrived at all -- so the task did not exist while the person
   believed they had started it.

   Only transport failures are retried (fetch itself rejecting). Anything the
   server actually answered -- 400, 403, a permission error -- is returned
   untouched on the first attempt, so real errors still surface immediately
   and nothing is double-submitted after a response was received. */
async function simFetchWithRetry(input, init, tries = 3){
  let last
  for(let i = 0; i < tries; i++){
    try { return await fetch(input, init) }
    catch(e){
      last = e
      // AbortError means we cancelled it on purpose -- never retry those.
      if(e && (e.name === 'AbortError' || (init && init.signal && init.signal.aborted))) throw e
      if(i < tries - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)))
    }
  }
  throw last
}

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: (input, init) => simFetchWithRetry(input, init) }
})

// ---- shared state ----
let me=null, profile=null, catalog=[], products=[], activeLogs=[], timerInt=null
let lastFinishIds=new Set(), notifyReady=false, booting=false, kStaff=null, kActiveLogs=[], kTimerInt=null

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
/* Wholesale team station: a non-manager profile pinned to packing Team A or B.
   These logins (one per pack-line tablet) see ONLY the Wholesale pack-day
   screen for their team — no tabs, no other screens. */
const wsStation=()=> !!(profile && !isManagerUp() && (profile.ws_team==='A'||profile.ws_team==='B'))
function notify(t,b){if(notifyReady){try{new Notification(t,{body:b})}catch(e){}}}

/* Once simFetchWithRetry has exhausted its attempts the failure is real, and
   what reaches the screen must be an instruction rather than a stack-trace
   string. "TypeError: Load failed" tells a packer nothing; it also does not
   tell them the crucial part -- that their work was NOT saved and the task
   needs starting again. */
function isNetworkError(e){
  if(!e) return false
  const m=String(e.message||e)
  return /load failed|failed to fetch|networkerror|network error|timed out|timeout|connection (closed|reset|refused)/i.test(m)
}
function netErr(error){
  if(!error) return ''
  if(isNetworkError(error)){
    return (navigator.onLine===false)
      ? 'No internet connection — nothing was saved. Reconnect, then try again.'
      : 'Could not reach the server — nothing was saved. Check your signal and try again.'
  }
  return error.message
}

// ---- task helpers ----
function catFor(log){return catalog.find(c=>c.id===log.catalog_id)}
function uomCat(c){return (c&&c.uom)||'kg'}
function uomFor(log){return (log&&log.uom)||uomCat(catFor(log))}
function requiresUnits(log){const c=catFor(log);return !c || c.requires_units!==false}
function requiresWaste(log){const c=catFor(log);return !!(c&&c.require_waste)}
function showsWaste(log){const c=catFor(log);return !!(c&&(c.track_waste||c.require_waste))}
function finishErr(error){
  if(/VALUE_TOO_HIGH/.test(error.message)) return 'That number looks wrong — it is over the 1000 kg per-task limit. Please re-check and re-enter (e.g. 22.94, not 2294).'
  if(/KG_REQUIRED/.test(error.message)) return 'Please enter the amount produced before finishing this task.'
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
/* Three sizes, because we were serving ONE: the full original, everywhere.
   The 1,232 photos already in the bucket average 2.81 MB, so a task showing
   five 48px thumbnails was pulling ~22 MB down a phone connection to draw
   five postage stamps -- which is why history and dashboard screens crawled
   on the floor. Storage image transformation is enabled on this project, so
   the resizing happens at the CDN and the stored originals are never
   touched. That matters: these photos are the evidence attached to a
   completed task, and quietly re-compressing food-production records to save
   space is not a trade worth making. Measured on a real 4.37 MB photo:
     thumbnail  160px cover  q55 -> 7.7 KB   (a 5-photo strip: 22 MB -> 38 KB)
     full view 1400px contain q78 -> 524 KB  (8.6x less to open one)
   photoUrl() still returns the untouched original for anything that needs it. */
const photoUrl=p=>sb.storage.from('sim-photos').getPublicUrl(p).data.publicUrl
const photoThumbUrl=(p,w)=>sb.storage.from('sim-photos')
  .getPublicUrl(p,{transform:{width:w||160,height:w||160,resize:'cover',quality:55}}).data.publicUrl
const photoViewUrl=p=>sb.storage.from('sim-photos')
  .getPublicUrl(p,{transform:{width:1400,resize:'contain',quality:78}}).data.publicUrl

/* ---- shrink before upload ----
   Phone cameras produce 2-6 MB originals and this app used to upload them
   untouched, one after another. Measured 17 Aug 2026: 1,232 photos in the
   bucket averaging 2.81 MB (435 of them over 3 MB, 3.4 GB in total) -- while
   the SERVER handled each upload in about 274 ms. So none of the "2 to 4
   minutes" the floor reported was the server: it was a phone pushing ~22
   Mbit up a weak mobile link inside a metal-clad building. A transfer that
   long on a flaky link is exactly what dies part-way and surfaces as
   "Failed to fetch" -- and because it never completes it never reaches the
   server, which is why the logs show zero upload errors while staff were
   being blocked.

   Re-encoding to 1600 px / JPEG q0.72 in the browser first takes a typical
   photo to roughly 200 KB: ~14x less to push, seconds instead of minutes,
   and a short transfer is far less likely to be killed mid-flight. It also
   converts iPhone HEIC to JPEG, so every photo is viewable on every device.
   1600 px is still plenty to evidence a tray of food or a label.

   If anything unexpected happens (odd format, out of memory, a browser
   without canvas encoding) this falls back to the original file rather than
   refusing: a slow photo is bad, a lost photo is worse. */
const PHOTO_MAX_EDGE=1600, PHOTO_QUALITY=0.72
async function _photoDecode(file){
  if(typeof createImageBitmap==='function'){
    try{ return await createImageBitmap(file,{imageOrientation:'from-image'}) }catch(e){}
    try{ return await createImageBitmap(file) }catch(e){}
  }
  return await new Promise((res,rej)=>{
    const url=URL.createObjectURL(file), img=new Image()
    img.onload=()=>{ URL.revokeObjectURL(url); res(img) }
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('decode failed')) }
    img.src=url
  })
}
async function shrinkPhoto(file){
  const orig={blob:file, ext:((file.name||'').split('.').pop()||'jpg').toLowerCase(),
              type:file.type||'image/jpeg', before:file.size, after:file.size, shrunk:false}
  try{
    const bmp=await _photoDecode(file)
    const w=bmp.width||bmp.naturalWidth, h=bmp.height||bmp.naturalHeight
    if(!w||!h) throw new Error('no dimensions')
    const scale=Math.min(1, PHOTO_MAX_EDGE/Math.max(w,h))
    const tw=Math.max(1,Math.round(w*scale)), th=Math.max(1,Math.round(h*scale))
    const c=document.createElement('canvas'); c.width=tw; c.height=th
    const ctx=c.getContext('2d'); if(!ctx) throw new Error('no canvas')
    ctx.drawImage(bmp,0,0,tw,th)
    if(bmp.close) bmp.close()
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',PHOTO_QUALITY))
    // Never upload something we made BIGGER (already-small or already-compressed images).
    if(!blob || blob.size>=file.size) return orig
    return {blob, ext:'jpg', type:'image/jpeg', before:file.size, after:blob.size, shrunk:true}
  }catch(e){ return orig }
}
const fmtBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'
function renderPhotoStrip(id,log){
  const box=$(id); if(!box) return; box.innerHTML=''
  const paths=(log&&log.photos)||[]
  // Thumbnails load the tiny version; the lightbox gets the large-but-not-original one.
  const lb=paths.map(photoViewUrl).join('|')
  paths.forEach((p,idx)=>{
    const wrap=document.createElement('div'); wrap.className='pwrap'
    const img=document.createElement('img'); img.src=photoThumbUrl(p,160); img.loading='lazy'; img.style.cursor='zoom-in'
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
  if(!files.length) return
  const stripId=(mode==='kiosk'?'ph_k_':'ph_s_')+log.id
  /* Say what is happening. Previously the screen sat silent for minutes with
     no sign of life, so people assumed it had hung and tapped again -- which
     started a second upload competing for the same weak connection. */
  const say=t=>{ const el=$(stripId); if(el) el.innerHTML='<div class="muted" style="font-size:13px;padding:6px 0">'+t+'</div>' }
  const n=files.length, plural=n>1?'s':''

  say('Preparing '+n+' photo'+plural+'…')
  const prepared=[]
  for(const f of files) prepared.push(await shrinkPhoto(f))
  const after=prepared.reduce((s,p)=>s+p.after,0)

  let done=0
  say('Uploading '+n+' photo'+plural+' ('+fmtBytes(after)+')…')
  const results=await Promise.all(prepared.map(async p=>{
    const path=`${log.id}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.${p.ext}`
    const up=await sb.storage.from('sim-photos').upload(path,p.blob,{contentType:p.type})
    done++; say('Uploading… '+done+' of '+n)
    return up.error?{err:up.error}:{path}
  }))
  const ok=results.filter(r=>r.path).map(r=>r.path), failed=results.filter(r=>r.err)

  if(ok.length){
    log.photos=[...(log.photos||[]),...ok]
    const u=await sb.from('sim_task_logs').update({photos:log.photos}).eq('id',log.id)
    if(u.error){
      log.photos=(log.photos||[]).filter(x=>!ok.includes(x))
      renderPhotoStrip(stripId,log)
      alert('The photo uploaded but could not be attached to this task.\n\n'+netErr(u.error))
      return
    }
  }
  renderPhotoStrip(stripId,log)
  if(failed.length){
    alert(failed.length+' of '+n+' photo'+plural+' did not upload.\n\n'+netErr(failed[0].err)+
      (ok.length?'\n\nThe '+ok.length+' that did upload are saved — just add the missing one again.':''))
  }
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
