/* PICKING: after production, orders are picked and packed out on a line of stations
   (make outbox → liner part 1 → liner part 2 → ice → picking → closing → transport).
   Each person taps Start / Finish on their station so we learn how long every role takes.
   Managers set a target (minutes) per station, record the day's box counts (small/large),
   and can edit times afterwards. Data: sim_pick_areas / sim_pick_days / sim_pick_records. */

let pickAreas=[], pickDay=null, pickRecords=[], pickViewDate=null, pickTimerInt=null

window.loadPicking=async function(){
  const box=$('pickingBody'); if(!box)return
  const today=new Date().toISOString().slice(0,10)
  const qd=pickViewDate||today
  const [{data:areas},{data:days}]=await Promise.all([
    sb.from('sim_pick_areas').select('*').eq('active',true).order('sort_order'),
    sb.from('sim_pick_days').select('*').eq('pick_date',qd).limit(1)
  ])
  pickAreas=areas||[]
  pickDay=(days&&days[0])||null
  if(!pickDay){
    const {data:ins}=await sb.from('sim_pick_days').insert({pick_date:qd}).select().single()
    pickDay=ins||null
  }
  pickRecords=[]
  if(pickDay){
    const {data:recs}=await sb.from('sim_pick_records').select('*').eq('pick_day_id',pickDay.id).order('created_at')
    pickRecords=recs||[]
  }
  renderPicking()
  clearInterval(pickTimerInt)
  pickTimerInt=setInterval(()=>{const et=$('pickingTab'); if(et&&!et.classList.contains('hidden')&&pickRecords.some(r=>r.start_time&&!r.finish_time)) renderPicking()},30000)
}

function _pkToday(){return new Date().toISOString().slice(0,10)}
function _pkDayLabel(d){return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}
function _pkMins(r){
  if(r.total_minutes!=null)return Number(r.total_minutes)
  if(r.start_time&&r.finish_time)return (new Date(r.finish_time)-new Date(r.start_time))/60000
  if(r.start_time)return (Date.now()-new Date(r.start_time))/60000
  return null
}
function _pkFmtMins(m){ if(m==null)return '—'; m=Math.round(m); return m>=60?Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m':m+' min' }
function _pkAreaSpan(recs){
  const st=recs.filter(r=>r.start_time).map(r=>new Date(r.start_time).getTime())
  if(!st.length)return null
  const open=recs.some(r=>r.start_time&&!r.finish_time)
  const fin=recs.filter(r=>r.finish_time).map(r=>new Date(r.finish_time).getTime())
  const end=open?Date.now():(fin.length?Math.max(...fin):null)
  return end==null?null:(end-Math.min(...st))/60000
}

window.renderPicking=function(){
  const box=$('pickingBody'); if(!box)return
  const today=_pkToday()
  const qd=(pickDay&&pickDay.pick_date)||pickViewDate||today
  const isToday=qd===today
  const mgr=(typeof isManagerUp==='function')&&isManagerUp()
  let html='<div class="card">'
  html+='<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
  html+='<h2 style="margin:0">Picking — '+esc(_pkDayLabel(qd))+'</h2>'
  html+=isToday?'<span class="pill live">● TODAY</span>':'<span class="pill off">viewing another day</span>'
  html+='</div>'
  html+='<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:8px">'
  html+='<div><label for="pickDate">📅 View day</label><input id="pickDate" type="date" value="'+esc(qd)+'" onchange="pickSetDate(this.value)" /></div>'
  if(mgr) html+='<button class="ghost sm" onclick="pickImportRoster()">📋 Import roster from Google Sheet</button>'
  html+='</div>'
  if(!isToday) html+='<p class="muted" style="margin:8px 0 0">Timers only run on the day itself — this view is for planning and reviewing. Managers can still correct times.</p>'
  html+='</div>'

  // box counts
  const bs=pickDay?pickDay.boxes_small:null, bl=pickDay?pickDay.boxes_large:null
  html+='<div class="card"><h2>Boxes today</h2>'
  html+='<p class="muted" style="margin-top:-8px">Small boxes go down the line first (orders print by order number, not size — split them by hand). Enter the counts so we can work out boxes per hour.</p>'
  html+='<div class="row"><div><label for="pickBoxS">Small boxes</label><input id="pickBoxS" type="number" inputmode="numeric" min="0" value="'+(bs==null?'':esc(String(bs)))+'" /></div>'
  html+='<div><label for="pickBoxL">Large boxes</label><input id="pickBoxL" type="number" inputmode="numeric" min="0" value="'+(bl==null?'':esc(String(bl)))+'" /></div></div>'
  html+='<button class="green sm" onclick="pickSaveBoxes()">Save box counts</button>'
  html+='<div id="pickBoxMsg" class="msg"></div></div>'

  // stations
  const totalBoxes=(Number(bs)||0)+(Number(bl)||0)
  pickAreas.forEach(a=>{
    const recs=pickRecords.filter(r=>r.area_id===a.id)
    const span=_pkAreaSpan(recs)
    const tgt=a.target_minutes!=null?Number(a.target_minutes):null
    let pill=''
    if(span!=null&&tgt!=null){
      const over=span>tgt
      pill='<span class="pill '+(over?'live':'done')+'">'+(over?'+':'')+Math.round(span-tgt)+' min vs target</span>'
    }
    html+='<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
    html+='<h2 style="margin:0">'+esc(a.name)+'</h2><div>'+pill
    html+=' <span class="muted" style="font-size:13px">target: '+(tgt!=null?_pkFmtMins(tgt):'—')+'</span>'
    if(mgr) html+=' <a class="link" style="font-size:13px" onclick="pickSetTarget(\''+a.id+'\')">set</a>'
    html+='</div></div>'
    if(span!=null){
      html+='<p class="muted" style="margin:4px 0 6px">Station time: <b style="color:var(--txt)">'+_pkFmtMins(span)+'</b>'
      if(totalBoxes>0&&span>0) html+=' · '+Math.round(totalBoxes/(span/60))+' boxes/hr'
      html+='</p>'
    }
    if(!recs.length) html+='<p class="muted">Nobody on this station yet.</p>'
    recs.forEach(r=>{
      const running=r.start_time&&!r.finish_time
      html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)">'
      html+='<b style="min-width:110px">'+esc(r.person_name||'(no name)')+'</b>'
      html+='<span class="muted" style="font-size:13px">'+(r.start_time?fmtTime(r.start_time):'not started')+(r.finish_time?' → '+fmtTime(r.finish_time):(running?' → running':''))+'</span>'
      html+='<b>'+_pkFmtMins(_pkMins(r))+'</b>'
      if(isToday&&!r.start_time) html+='<button class="green sm" onclick="pickStart(\''+r.id+'\')">▶ Start</button>'
      if(isToday&&running) html+='<button class="sm" onclick="pickFinish(\''+r.id+'\')">✓ Finish</button>'
      if(!isToday&&!r.start_time) html+='<span class="muted" style="font-size:12px">starts on the day</span>'
      if(mgr) html+='<a class="link" style="font-size:12px" onclick="pickEditTimes(\''+r.id+'\')">edit times</a><a class="link" style="font-size:12px" onclick="pickDelRecord(\''+r.id+'\')">remove</a>'
      html+='</div>'
    })
    html+='<div style="display:flex;gap:8px;margin-top:8px"><input id="pickName_'+a.id+'" placeholder="Name" style="max-width:200px" /><button class="ghost sm" onclick="pickAddPerson(\''+a.id+'\')">+ Add person</button></div>'
    html+='</div>'
  })

  // summary
  const done=pickRecords.filter(r=>r.finish_time)
  if(done.length){
    html+='<div class="card"><h2>Day summary</h2><table class="tbl"><thead><tr><th>Station</th><th>Person</th><th>Time</th><th>Target</th><th></th></tr></thead><tbody>'
    pickAreas.forEach(a=>{
      pickRecords.filter(r=>r.area_id===a.id&&r.finish_time).forEach(r=>{
        const m=_pkMins(r), tgt=a.target_minutes!=null?Number(a.target_minutes):null
        let vs='—', cls=''
        if(m!=null&&tgt!=null){const d=Math.round(m-tgt); vs=(d>0?'+':'')+d+' min'; cls=d>0?' style="color:var(--bad,#c0392b)"':' style="color:var(--ok,#27ae60)"'}
        html+='<tr><td>'+esc(a.name)+'</td><td>'+esc(r.person_name)+'</td><td>'+_pkFmtMins(m)+'</td><td>'+(tgt!=null?_pkFmtMins(tgt):'—')+'</td><td'+cls+'>'+vs+'</td></tr>'
      })
    })
    html+='</tbody></table></div>'
  }
  box.innerHTML=html
}

window.pickSetDate=function(d){ const today=_pkToday(); pickViewDate=(d&&d!==today)?d:null; pickDay=null; loadPicking() }

window.pickAddPerson=async function(areaId){
  const el=$('pickName_'+areaId); const nm=(el&&el.value||'').trim()
  if(!nm){alert('Type a name first.');return}
  if(!pickDay)return
  await sb.from('sim_pick_records').insert({pick_day_id:pickDay.id,area_id:areaId,person_name:nm})
  loadPicking()
}
window.pickStart=async function(id){ await sb.from('sim_pick_records').update({start_time:new Date().toISOString()}).eq('id',id); loadPicking() }
window.pickFinish=async function(id){
  const r=pickRecords.find(x=>x.id===id); if(!r)return
  const fin=new Date().toISOString()
  const mins=r.start_time?Math.round((new Date(fin)-new Date(r.start_time))/6000)/10:null
  await sb.from('sim_pick_records').update({finish_time:fin,total_minutes:mins}).eq('id',id)
  loadPicking()
}
window.pickDelRecord=async function(id){ if(!confirm('Remove this person from the station for this day?'))return; await sb.from('sim_pick_records').delete().eq('id',id); loadPicking() }

window.pickSetTarget=async function(areaId){
  const a=pickAreas.find(x=>x.id===areaId); if(!a)return
  const v=prompt('Target minutes for "'+a.name+'" (blank to clear):', a.target_minutes!=null?a.target_minutes:'')
  if(v===null)return
  const num=v.trim()===''?null:Number(v)
  if(v.trim()!==''&&(!isFinite(num)||num<0)){alert('Enter a number of minutes.');return}
  await sb.from('sim_pick_areas').update({target_minutes:num}).eq('id',areaId)
  loadPicking()
}

window.pickEditTimes=async function(id){
  const r=pickRecords.find(x=>x.id===id); if(!r)return
  const qd=(pickDay&&pickDay.pick_date)||_pkToday()
  const cur=t=>t?new Date(t).toTimeString().slice(0,5):''
  const s=prompt('Start time (HH:MM, blank to clear):',cur(r.start_time)); if(s===null)return
  const f=prompt('Finish time (HH:MM, blank to clear):',cur(r.finish_time)); if(f===null)return
  const toIso=v=>{v=v.trim(); if(!v)return null; if(!/^\d{1,2}:\d{2}$/.test(v)){alert('Use HH:MM, e.g. 14:30');throw new Error('bad time')} return new Date(qd+'T'+v.padStart(5,'0')+':00').toISOString()}
  let st,ft; try{st=toIso(s); ft=toIso(f)}catch(e){return}
  const mins=(st&&ft)?Math.round((new Date(ft)-new Date(st))/6000)/10:null
  await sb.from('sim_pick_records').update({start_time:st,finish_time:ft,total_minutes:mins}).eq('id',id)
  loadPicking()
}

window.pickSaveBoxes=async function(){
  if(!pickDay)return
  const s=$('pickBoxS').value, l=$('pickBoxL').value
  await sb.from('sim_pick_days').update({boxes_small:s===''?null:parseInt(s,10),boxes_large:l===''?null:parseInt(l,10)}).eq('id',pickDay.id)
  const m=$('pickBoxMsg'); if(m)msg(m,'Saved.',true)
  const {data}=await sb.from('sim_pick_days').select('*').eq('id',pickDay.id).single()
  if(data)pickDay=data
  renderPicking()
}

// ---- roster import from a Google Sheet (Date | Position | Name | Notes) ----
const _PK_URL_RE=/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
function _pkParseCSV(text){
  const rows=[]; let row=[],cell='',q=false
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++} else q=false } else cell+=c }
    else if(c==='"')q=true
    else if(c===','){row.push(cell);cell=''}
    else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}
    else if(c!=='\r')cell+=c
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row)}
  return rows
}
function _pkMapPos(pos){
  const p=(pos||'').toLowerCase()
  if(!p)return null
  if(p.includes('liner'))return 'LINER'
  if(p.includes('box'))return 'Boxes (make outbox)'
  if(p.includes('ice'))return 'Ice placement'
  if(p.includes('pick'))return 'Picking'
  if(p.includes('clos'))return 'Closing'
  if(p.includes('transport')||p.includes('driver'))return 'Transport'
  return null
}
window.pickImportRoster=async function(){
  const url=prompt('Paste the Google Sheet link for the picking roster (columns: Date, Position, Name):')
  if(!url)return
  const m=url.match(_PK_URL_RE)
  if(!m){alert('That does not look like a Google Sheets link.');return}
  let gid=''; const gm=url.match(/[#&?]gid=(\d+)/); if(gm)gid='&gid='+gm[1]
  let text=null
  try{
    const res=await fetch('https://docs.google.com/spreadsheets/d/'+m[1]+'/gviz/tq?tqx=out:csv'+gid)
    if(res.ok)text=await res.text()
  }catch(e){}
  if(!text||text.trim().startsWith('<')){alert('Could not read the sheet. In Google Sheets set Share to "Anyone with the link - Viewer", then try again.');return}
  const rows=_pkParseCSV(text)
  if(!rows.length){alert('The sheet appears to be empty.');return}
  const head=rows[0].map(h=>h.toLowerCase())
  const iPos=head.findIndex(h=>h.includes('position')), iName=head.findIndex(h=>h.includes('name'))
  if(iPos<0||iName<0){alert('Could not find "Position" and "Name" columns in the sheet.');return}
  if(!pickDay){alert('No picking day loaded.');return}
  const byName={}; pickAreas.forEach(a=>byName[a.name]=a)
  let linerN=0, added=0, skipped=[]
  const inserts=[]
  const have=new Set(pickRecords.map(r=>r.area_id+'|'+(r.person_name||'').toLowerCase()))
  rows.slice(1).forEach(r=>{
    const pos=(r[iPos]||'').trim(), nm=(r[iName]||'').trim()
    if(!pos&&!nm)return
    let target=_pkMapPos(pos)
    if(target==='LINER'){linerN++; target=linerN===1?'Liner part 1':'Liner part 2'}
    if(!nm)return
    if(!target||!byName[target]){skipped.push(pos||'(blank)');return}
    if(have.has(byName[target].id+'|'+nm.toLowerCase()))return
    inserts.push({pick_day_id:pickDay.id,area_id:byName[target].id,person_name:nm}); added++
  })
  if(inserts.length)await sb.from('sim_pick_records').insert(inserts)
  let note=added+' people added to today\'s stations.'
  if(skipped.length)note+=' Could not match: '+skipped.join(', ')+'.'
  alert(note)
  loadPicking()
}
