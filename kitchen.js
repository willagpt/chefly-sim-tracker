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
  html+='<button class="ghost sm" style="margin-top:8px" onclick="kitchenShowProduction()">\u{1F4CB} Production needs (components + sub-prep + raw materials)</button>'
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
  const {data:r,error}=await sb.from('sim_component_recipes').select('*, sim_component_ingredients!recipe_id(*)').eq('id',rid).maybeSingle()
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

/* ---------- PRODUCTION NEEDS (dish list → components → sub-preps → raw materials) ---------- */
window.kitchenShowProduction=async function(dateStr){
  const d=dateStr||new Date().toISOString().slice(0,10)
  const {data:r,error}=await sb.rpc('sim_production_requirements',{p_date:d})
  if(error){alert(error.message);return}
  kitchenCloseRecipe()
  const comps=(r&&r.components)||[], subs=(r&&r.sub_preps)||[], raws=(r&&r.raws)||[]
  const _sts=[...new Set(comps.map(c=>c.station))]
  const psPicker=comps.length?('<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><select id="kpsStation" style="max-width:170px;font-size:13px;padding:4px 6px"><option value="">All stations</option>'
    +_sts.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')
    +'<option value="__sub">Sub-preparations</option><option value="__bulk">Advance prep (bulk)</option></select>'
    +'<button class="ghost sm" onclick="kitchenPrintSheets(\''+d+'\',document.getElementById(\'kpsStation\').value)">\u{1F5A8} Print sheets (PDF)</button></span>'):''
  let body='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0"><span class="muted" style="font-size:13px">\u{1F4C5} Day:</span><input type="date" value="'+d+'" onchange="kitchenShowProduction(this.value)" style="max-width:170px" />'
    +'<b>'+(r?r.meals:0)+'</b><span class="muted" style="font-size:13px">meals · '+(r?r.dishes:0)+' dishes on the imported list</span>'+psPicker+'</div>'
  if(!comps.length){
    body+='<p class="muted">No dish list imported for this date yet — load it in Manage → Weekly packing orders, then come back.</p>'
  } else {
    const stations=[...new Set(comps.map(c=>c.station))]
    stations.forEach(st=>{
      const rows=comps.filter(c=>c.station===st)
      body+='<h2 style="font-size:15px;margin:14px 0 2px">'+esc(st)+'</h2>'
      rows.forEach(c=>{
        const rec=kitchenRecipes.find(x=>x.component_id===c.component_id)
        const nm=rec?'<a class="link" onclick="kitchenShowRecipe(\''+rec.id+'\','+(c.kg!=null?c.kg:'null')+')">'+esc(c.name)+' ↗</a>':esc(c.name)
        body+='<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--line);font-size:14px"><span style="flex:1;min-width:0">'+nm+'</span><b>'+(c.kg!=null?c.kg+' kg':'–')+(c.unknown_grams>0?' +?':'')+'</b></div>'
      })
    })
    if(subs.length){
      body+='<h2 style="font-size:15px;margin:16px 0 2px">Sub-preparations <span class="muted" style="font-size:12px;font-weight:400">· derived from the recipes above</span></h2>'
      subs.forEach(x=>{
        const badge=x.prep_type==='bulk_prep'?' <span class="pill" style="background:rgba(59,130,246,.18);color:#93c5fd;font-size:10px">bulk prep</span>':''
        body+='<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--line);font-size:14px"><span style="flex:1;min-width:0"><a class="link" onclick="kitchenShowRecipe(\''+x.recipe_id+'\','+x.kg+')">'+esc(x.name)+' ↗</a>'+badge+'</span><b>'+x.kg+' kg</b></div>'
      })
    }
    if(raws.length){
      body+='<h2 style="font-size:15px;margin:16px 0 2px">Raw materials <span class="muted" style="font-size:12px;font-weight:400">· everything the recipes call for, totalled</span></h2>'
      raws.forEach(x=>{
        body+='<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line);font-size:13px"><span style="flex:1;min-width:0">'+esc(x.name)+'</span><b>'+x.kg+' kg</b></div>'
      })
      body+='<p class="muted" style="font-size:11px;margin-top:8px">Covers components with an imported recipe — quantities scale from the dish list via the BOM. Components without recipes are not included in raw totals.</p>'
    }
  }
  const m=document.createElement('div'); m.id='kitchenRecipeModal'
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;overflow-y:auto;padding:20px 12px'
  m.innerHTML='<div class="card" style="max-width:640px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="margin:0">Production needs</h2><button class="ghost sm" onclick="kitchenCloseRecipe()">✕ Close</button></div>'
    +body+'</div>'
  m.onclick=function(e){ if(e.target===m)kitchenCloseRecipe() }
  document.body.appendChild(m)
}

/* ---------- PRINTABLE PRODUCTION SHEETS (A4 per component, station-grouped) ----------
   Ingredients scaled to the day's kg + method + HACCP/trace capture boxes.
   jsPDF built-in fonts are WinAnsi: no emoji/arrows in PDF text (degree sign is fine). */
function _psQty(kg){
  if(kg==null||isNaN(kg))return '-'
  if(kg<0.1)return Math.round(kg*1000)+' g'
  if(kg<1)return (Math.round(kg*100)/100)+' kg'
  return (Math.round(kg*10)/10)+' kg'
}
window.kitchenPrintSheets=async function(d,st){
  d=d||new Date().toISOString().slice(0,10)
  try{await _eodLibs()}catch(e){alert(e.message);return}
  const [rq,recQ,ingQ]=await Promise.all([
    sb.rpc('sim_production_requirements',{p_date:d}),
    sb.from('sim_component_recipes').select('id,component_id,name,tab,source_file,prep_type,method,equipment,cook_notes'),
    sb.from('sim_component_ingredients').select('recipe_id,name,ratio_per_kg,sort_order')
  ])
  if(rq.error){alert(rq.error.message);return}
  const req=rq.data||{}
  const comps=req.components||[], subs=req.sub_preps||[]
  if(!comps.length){alert('No dish list imported for '+d+' - nothing to print.');return}
  const recById={},recByComp={},ingByRec={}
  ;((recQ&&recQ.data)||[]).forEach(r=>{recById[r.id]=r; if(r.component_id)recByComp[r.component_id]=r})
  ;((ingQ&&ingQ.data)||[]).forEach(i=>{(ingByRec[i.recipe_id]=ingByRec[i.recipe_id]||[]).push(i)})
  let pages=[]
  comps.forEach(c=>{pages.push({station:c.station.toUpperCase(),name:c.name,kg:c.kg,rec:recByComp[c.component_id]||null,unknown:c.unknown_grams>0})})
  subs.forEach(x=>{const r=recById[x.recipe_id]
    pages.push({station:(r&&r.prep_type==='bulk_prep')?'ADVANCE PREP (BULK)':'SUB-PREPARATION',name:x.name,kg:x.kg,rec:r||null,unknown:false})})

  if(st){
    if(st==='__sub')pages=pages.filter(p=>p.station==='SUB-PREPARATION')
    else if(st==='__bulk')pages=pages.filter(p=>p.station==='ADVANCE PREP (BULK)')
    else pages=pages.filter(p=>p.station===String(st).toUpperCase())
    if(!pages.length){alert('Nothing to print for that selection on '+d+'.');return}
  }
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28,H=841.89,M=36
  const INK=[28,26,25],ORANGE=[232,84,29],GREY=[138,133,128],LINE=[220,215,209],SOFT=[236,232,227]
  const t=(x,y,s2,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s2),x,y)}
  const tr=(x,y,s2,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s2),x,y,{align:'right'})}
  const dateStr=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})

  const header=(p,cont)=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,58,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,58,'F')
    t(M,20,'PRODUCTION SHEET - '+p.station+(cont?' (CONTINUED)':''),8,'bold',[248,205,184])
    t(M,42,p.name.length>44?p.name.slice(0,43)+'...':p.name,17,'bold',[251,250,248])
    tr(W-M,20,dateStr,9,'normal',[201,194,187])
    tr(W-M,44,(p.kg!=null? _psQty(p.kg):'-')+(p.unknown?' +?':''),16,'bold',[251,250,248])
  }
  // fixed capture block: returns its height
  const CAP_H=178
  const capture=(y0)=>{
    const bw=(W-2*M)
    const box=(x,y,w,h,label)=>{doc.setDrawColor.apply(doc,GREY);doc.setLineWidth(.8);doc.rect(x,y,w,h);t(x+4,y+9,label,6,'bold',GREY)}
    let y=y0
    t(M,y,'PRODUCTION RECORD',8.5,'bold',ORANGE); doc.setDrawColor.apply(doc,LINE);doc.line(M,y+3,M+bw,y+3); y+=8
    const w5=bw/5
    box(M,y,w5*1.4,30,'MADE BY'); box(M+w5*1.4,y,w5*0.9,30,'START TIME'); box(M+w5*2.3,y,w5*0.9,30,'FINISH TIME'); box(M+w5*3.2,y,w5*0.9,30,'START TEMP °C'); box(M+w5*4.1,y,w5*0.9,30,'FINISH TEMP °C')
    y+=36
    t(M,y+7,'CCP COOKING - critical limit 72°C for 60 seconds',7.5,'bold',INK)
    box(M+bw-3*w5*0.9,y,w5*0.9,26,'TEMP °C'); box(M+bw-2*w5*0.9,y,w5*0.9,26,'TIME'); box(M+bw-w5*0.9,y,w5*0.9,26,'PASS Y/N')
    y+=32
    t(M,y+7,'CCP CHILLING - 5°C or less within 90 min (max 8°C; stay in chiller until 5°C)',7.5,'bold',INK)
    y+=12
    box(M,y,w5*0.9,30,'CHILL START'); box(M+w5*0.9,y,w5*0.9,30,'CHILL FINISH'); box(M+w5*1.8,y,w5*0.9,30,'FINAL TEMP °C'); box(M+w5*2.7,y,w5*1.1,30,'BATCH / TRACE CODE'); box(M+w5*3.8,y,w5*1.2,30,'CHECKED / SIGNED')
    y+=38
    doc.setDrawColor.apply(doc,LINE);doc.line(M,y+10,M+bw,y+10); t(M,y+7,'NOTES',6,'bold',GREY)
    return y+16-y0+14
  }
  const sec=(y,title)=>{t(M,y,title,8.5,'bold',ORANGE);doc.setDrawColor.apply(doc,LINE);doc.line(M,y+3,W-M,y+3);return y+13}

  pages.forEach((p,idx)=>{
    if(idx>0)doc.addPage()
    header(p,false)
    let y=76
    const ings=(p.rec&&ingByRec[p.rec.id])?[...ingByRec[p.rec.id]].sort((a,b)=>a.sort_order-b.sort_order):[]
    if(ings.length){
      doc.autoTable({startY:y,margin:{left:M,right:M},theme:'plain',
        styles:{font:'helvetica',fontSize:9,cellPadding:{top:3,bottom:3,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
        headStyles:{fontSize:6.8,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
        columnStyles:{1:{cellWidth:70,halign:'right'},2:{cellWidth:70,halign:'right',fontStyle:'bold'},3:{cellWidth:120}},
        head:[['INGREDIENT','PER KG','TODAY','LOT / TRACE CODE']],
        body:ings.map(i=>[i.name, i.ratio_per_kg!=null?_psQty(i.ratio_per_kg):'-',
          (i.ratio_per_kg!=null&&p.kg!=null)?_psQty(i.ratio_per_kg*p.kg):'-','']),
        didDrawCell:c=>{ if(c.section==='body'&&c.column.index===3){doc.setDrawColor.apply(doc,GREY);doc.setLineWidth(.5);doc.rect(c.cell.x+4,c.cell.y+3,c.cell.width-8,c.cell.height-6)} }})
      y=doc.lastAutoTable.finalY+14
    } else {
      y=sec(y,'INGREDIENTS')
      doc.setFont('helvetica','italic');doc.setFontSize(9);doc.setTextColor.apply(doc,GREY)
      doc.text(p.rec?'No ingredient lines on the source tab.':'No recipe imported for this component - quantities only.',M,y); y+=18
    }
    if(p.rec){
      const steps=[...(p.rec.method||[]),...(p.rec.cook_notes||[])]
      if(steps.length){
        y=sec(y,'METHOD')
        doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor.apply(doc,INK)
        for(const st2 of steps){
          const lines=doc.splitTextToSize(String(st2),W-2*M-10)
          if(y+lines.length*11>H-CAP_H-40){doc.addPage();header(p,true);y=76;doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor.apply(doc,INK)}
          doc.text(lines,M+4,y); y+=lines.length*11+2
        }
        y+=6
      }
      if((p.rec.equipment||[]).length){
        if(y>H-CAP_H-40){doc.addPage();header(p,true);y=76}
        t(M,y,'Equipment: '+p.rec.equipment.join('  /  '),8,'normal',GREY); y+=14
      }
    }
    if(y>H-CAP_H-24){doc.addPage();header(p,true);y=76}
    capture(Math.max(y+6,H-CAP_H-18))
    if(p.rec)t(M,H-16,'Source: '+(p.rec.source_file||'')+' - tab "'+p.rec.tab+'"',6.5,'normal',GREY)
  })
  const n=doc.getNumberOfPages()
  for(let pg=1;pg<=n;pg++){doc.setPage(pg);tr(W-M,H-16,'Chefly production sheets - '+d+' - page '+pg+' of '+n,6.5,'normal',GREY)}
  doc.save('Chefly-Production-Sheets-'+d+(st?'-'+String(st).replace(/[^A-Za-z0-9]+/g,'_'):'')+'.pdf')
}
