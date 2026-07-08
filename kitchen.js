/* KITCHEN: live cook queue — derived from today's packing queue (derive, don't sync).
   One source of truth = sim_pack_runs (pending, in pack order) → sim_dish_bom → components,
   grouped by station. Chefs tap Start / Ready; status lives in sim_component_status.
   Packing's READY/BLOCKED badges and this screen both live-update via realtime. */
let kitchenData=null, kitchenChannel=null, kitchenT=null, kitchenStation=''
let kitchenRecipes=[]   // {id,name,component_id} from sim_component_recipes (weekly + meat books)

window.loadKitchen=async function(){
  const box=$('kitchenBody'); if(!box)return
  const [{data,error},recs]=await Promise.all([
    sb.rpc('sim_kitchen_queue'),
    sb.from('sim_component_recipes').select('id,name,component_id,prep_type')
  ])
  if(error){box.innerHTML='<div class="card"><p class="muted">'+esc(error.message)+'</p></div>';return}
  kitchenRecipes=(recs&&recs.data)||[]
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
  const rec=kitchenRecipes.find(x=>x.component_id===c.component_id)
  const recLink=rec?' <a class="link" style="font-size:12px" onclick="kitchenShowRecipe(\''+rec.id+'\','+(c.kg!=null?c.kg:'null')+')">\u{1F4D6} Recipe</a>':''
  const dim=c.status==='ready'?'opacity:.55;':''
  return '<div class="task-item" style="flex-direction:column;align-items:stretch;gap:4px;'+dim+'">'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">PACK #</div><div style="font-size:20px;font-weight:900;line-height:1">'+c.priority+'</div></div>'
    +'<b style="flex:1;min-width:0;font-size:15px">'+esc(c.name)+'</b>'
    +'<div style="flex:0 0 auto;text-align:right;min-width:56px;font-weight:800">'+kg+'</div>'
    +'</div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px">'+kitchenStatusPill(c.status)+recLink+who+'</span><span style="flex-shrink:0">'+act+'</span></div>'
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

/* ---------- RECIPE VIEWER (from sim_component_recipes / _ingredients) ---------- */
function _kNorm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
function _kRecipeForName(name){
  let n=_kNorm(name)
  const variants=[n,n.replace(/ (cooked|steamed|roasted)$/,''),n.replace(/s$/,'')]
  for(const v of variants){ const r=kitchenRecipes.find(x=>_kNorm(x.name)===v); if(r)return r }
  return null
}
function _kFmtQty(kg){
  if(kg==null)return ''
  if(kg<0.1)return Math.round(kg*1000)+' g'
  if(kg<1)return (Math.round(kg*100)/100)+' kg'
  return (Math.round(kg*10)/10)+' kg'
}
window.kitchenCloseRecipe=function(){const m=$('kitchenRecipeModal'); if(m)m.remove()}
window.kitchenShowRecipe=async function(rid,kg){
  const {data:r,error}=await sb.from('sim_component_recipes').select('*, sim_component_ingredients(*)').eq('id',rid).maybeSingle()
  if(error||!r){alert(error?error.message:'Recipe not found.');return}
  const ings=(r.sim_component_ingredients||[]).sort((a,b)=>a.sort_order-b.sort_order)
  const scaled=kg!=null&&!isNaN(kg)
  let rows=''
  ings.forEach(i=>{
    const sub=_kRecipeForName(i.name)
    const nm=sub?('<a class="link" onclick="kitchenShowRecipe(\''+sub.id+'\','+(scaled&&i.ratio_per_kg!=null?(Math.round(i.ratio_per_kg*kg*100)/100):'null')+')">'+esc(i.name)+' ↗</a>'):esc(i.name)
    const per=i.ratio_per_kg!=null?_kFmtQty(i.ratio_per_kg):'–'
    const tot=(scaled&&i.ratio_per_kg!=null)?_kFmtQty(i.ratio_per_kg*kg):'–'
    rows+='<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px"><span style="flex:1;min-width:0">'+nm+'</span><span class="muted" style="min-width:64px;text-align:right">'+per+'</span><b style="min-width:70px;text-align:right">'+tot+'</b></div>'
  })
  const steps=[...(r.method||[]),...(r.cook_notes||[])]
  const stepsHtml=steps.length?steps.map(x=>'<div style="font-size:13px;margin-top:4px">'+esc(x)+'</div>').join(''):'<p class="muted" style="font-size:13px">No written method on this tab.</p>'
  const equip=(r.equipment||[]).length?'<p class="muted" style="font-size:12px;margin:8px 0 0">Equipment: '+r.equipment.map(esc).join(' · ')+'</p>':''
  const prep=r.prep_type==='bulk_prep'?'<span class="pill" style="background:rgba(59,130,246,.18);color:#93c5fd">bulk prep · made in advance</span>':'<span class="pill off">day-of</span>'
  kitchenCloseRecipe()
  const m=document.createElement('div'); m.id='kitchenRecipeModal'
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;overflow-y:auto;padding:20px 12px'
  m.innerHTML='<div class="card" style="max-width:560px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="margin:0">'+esc(r.name)+'</h2><button class="ghost sm" onclick="kitchenCloseRecipe()">✕ Close</button></div>'
    +'<div style="margin:6px 0 2px">'+prep+(scaled?' <span class="pill" style="background:rgba(249,115,22,.18);color:#fdba74">today: '+_kFmtQty(kg)+'</span>':'')+'</div>'
    +'<div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;font-size:11px;color:var(--muted)"><span style="flex:1">INGREDIENT</span><span style="min-width:64px;text-align:right">PER KG</span><span style="min-width:70px;text-align:right">'+(scaled?'TODAY':'QTY')+'</span></div>'
    +rows
    +'<h2 style="font-size:15px;margin:14px 0 2px">Method</h2>'+stepsHtml+equip
    +'<p class="muted" style="font-size:11px;margin:12px 0 0">Source: '+esc(r.source_file||r.book)+' · tab “'+esc(r.tab)+'”</p>'
    +'</div>'
  m.onclick=function(e){ if(e.target===m)kitchenCloseRecipe() }
  document.body.appendChild(m)
}
