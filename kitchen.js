/* KITCHEN: live cook queue — derived from today's packing queue (derive, don't sync).
   One source of truth = sim_pack_runs (pending, in pack order) → sim_dish_bom → components,
   grouped by station. Chefs tap Start / Ready; status lives in sim_component_status.
   Packing's READY/BLOCKED badges and this screen both live-update via realtime. */
let kitchenData=null, kitchenChannel=null, kitchenT=null, kitchenStation=''

window.loadKitchen=async function(){
  const box=$('kitchenBody'); if(!box)return
  const {data,error}=await sb.rpc('sim_kitchen_queue')
  if(error){box.innerHTML='<div class="card"><p class="muted">'+esc(error.message)+'</p></div>';return}
  kitchenData=data
  renderKitchen()
  kitchenSubscribe()
}
function kitchenSubscribe(){
  if(kitchenChannel)return
  kitchenChannel=sb.channel('sim-kitchen')
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_pack_runs'},kitchenLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_component_status'},kitchenLiveRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'sim_dish_bom'},kitchenLiveRefresh)
    .subscribe()
}
function kitchenLiveRefresh(){
  const et=$('kitchenTab'); if(!et||et.classList.contains('hidden'))return
  clearTimeout(kitchenT); kitchenT=setTimeout(()=>{loadKitchen()},400)
}
function kitchenStatusPill(st){
  if(st==='ready')return '<span class="pill done">ready</span>'
  if(st==='in_progress')return '<span class="pill live">● cooking</span>'
  return '<span class="pill off">to do</span>'
}
function renderKitchen(){
  const box=$('kitchenBody'); if(!box)return
  const comps=(kitchenData&&kitchenData.components)||[]
  const stations=[...new Set(comps.map(c=>c.station))]
  const nReady=comps.filter(c=>c.status==='ready').length
  const nCook=comps.filter(c=>c.status==='in_progress').length
  let html='<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Kitchen — cook queue</h2>'
  html+='<span style="font-size:13px"><span class="pill done">'+nReady+' ready</span> <span class="pill live">'+nCook+' cooking</span> <span class="pill off">'+(comps.length-nReady-nCook)+' to do</span></span></div>'
  html+='<p class="muted" style="margin:6px 0 0">Driven live by the packing queue — order = when packing needs it. Tap ▶ when you start a component, ✓ when it is ready.</p>'
  if(stations.length>1){
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">'
    html+='<button class="'+(kitchenStation===''?'green':'ghost')+' sm" onclick="kitchenFilter(\'\')">All stations</button>'
    stations.forEach(s=>{html+='<button class="'+(kitchenStation===s?'green':'ghost')+' sm" onclick="kitchenFilter(\''+esc(s).replace(/'/g,"\\'")+'\')">'+esc(s)+'</button>'})
    html+='</div>'
  }
  html+='</div>'
  if(!comps.length){
    html+='<div class="card"><p class="muted">Nothing in the cook queue — no pending dishes in today’s packing list yet. Once the dish list is loaded on the Packing tab, the queue appears here automatically.</p></div>'
    box.innerHTML=html; return
  }
  stations.forEach(st=>{
    if(kitchenStation&&st!==kitchenStation)return
    const rows=comps.filter(c=>c.station===st)
    if(!rows.length)return
    const stReady=rows.filter(c=>c.status==='ready').length
    html+='<div class="card"><h2>'+esc(st)+' <span class="pill '+(stReady===rows.length?'done':'off')+'">'+stReady+'/'+rows.length+' ready</span></h2>'
    rows.forEach(c=>{html+=kitchenCompRow(c)})
    html+='</div>'
  })
  box.innerHTML=html
}
function kitchenCompRow(c){
  const kg=c.kg!=null?(c.kg+' kg'+(c.unknown_grams>0?' +?':'')):(c.unknown_grams>0?'qty t.b.c.':'')
  const dishes=(c.dishes||[])
  const dTxt=dishes.slice(0,3).map(d=>'#'+d.pos+' '+esc(d.dish||'')+(d.qty?' ×'+d.qty:'')).join(' · ')+(dishes.length>3?' · +'+(dishes.length-3)+' more':'')
  let who=''
  if(c.status!=='pending'&&c.status_updated_at){who='<span class="muted" style="font-size:12px"> · '+(c.status==='ready'?'ready':'started')+' '+fmtTime(c.status_updated_at)+(c.updated_by_name?' · '+esc(c.updated_by_name):'')+'</span>'}
  let act=''
  if(c.status==='pending')act='<button class="green sm" onclick="kitchenSetStatus(\''+c.component_id+'\',\'in_progress\')">▶ Start</button>'
  else if(c.status==='in_progress')act='<button class="green sm" onclick="kitchenSetStatus(\''+c.component_id+'\',\'ready\')">✓ Ready</button> <a class="link" style="font-size:12px" onclick="kitchenSetStatus(\''+c.component_id+'\',\'pending\')">undo</a>'
  else act='<a class="link" style="font-size:12px" onclick="kitchenSetStatus(\''+c.component_id+'\',\'in_progress\')">↩ not ready after all</a>'
  const dim=c.status==='ready'?'opacity:.55;':''
  return '<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px;'+dim+'">'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">PACK #</div><div style="font-size:20px;font-weight:900;line-height:1">'+c.priority+'</div></div>'
    +'<b style="flex:1;min-width:0;font-size:15px">'+esc(c.name)+'</b>'
    +'<div style="flex:0 0 auto;text-align:right;min-width:56px;font-weight:800">'+kg+'</div>'
    +'</div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">'+kitchenStatusPill(c.status)+who+'</span><span style="flex-shrink:0">'+act+'</span></div>'
    +'<div class="muted" style="font-size:12px">for '+dTxt+'</div>'
    +'</div>'
}
window.kitchenFilter=function(st){kitchenStation=st;renderKitchen()}
window.kitchenSetStatus=async function(cid,status){
  const today=new Date().toISOString().slice(0,10)
  const {error}=await sb.from('sim_component_status').upsert(
    {shift_date:today,component_id:cid,status:status,updated_by:(me&&me.id)||null,updated_at:new Date().toISOString()},
    {onConflict:'shift_date,component_id'})
  if(error){alert(error.message);return}
  loadKitchen()
}
