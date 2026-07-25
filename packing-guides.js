/* PACKING (3 of 3): packing guide cards, dish-list staging, line prep sheet.

   Continues packing.js — same global scope, same pack* state. Load order in
   index.html must be packing.js -> packing-reports.js -> packing-guides.js.
   Nothing here runs at load time. jsPDF WinAnsi: keep PDF text ASCII-ish. */

/* ---------- PACKING GUIDE CARDS (print + laminate) ----------
   One A4 page per dish: numbered components, portion weight, storage location.
   Big type for the line and for training new packers. Modes: the day's planned
   pack order, or the full A-Z set. Locations live on sim_components
   (manager-editable in the modal). jsPDF WinAnsi: keep PDF text ASCII-ish. */
let _pgComps=[], _pgBom=[], _pgNames={}, _pgLocs=[]
async function _pgLoad(){
  const [c,b,ni,lo]=await Promise.all([
    sb.from('sim_components').select('id,name,storage_location,active'),
    sb.from('sim_dish_bom').select('id,sku,component_id,grams'),
    sb.from('sim_pack_dish_import').select('sku,dish_name,imported_at').order('imported_at',{ascending:false}),
    sb.from('sim_storage_locations').select('id,name').order('sort_order').order('name')
  ])
  if(c.error)throw new Error(c.error.message)
  if(b.error)throw new Error(b.error.message)
  _pgComps=c.data||[]; _pgBom=b.data||[]
  _pgNames={}; ((ni&&ni.data)||[]).forEach(r=>{ if(!(r.sku in _pgNames)) _pgNames[r.sku]=r.dish_name })
  _pgLocs=(lo&&lo.data)||[]
}
function _pgUsedComps(){
  const used=new Set(_pgBom.map(x=>x.component_id))
  return _pgComps.filter(c=>used.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name))
}
function _pgLocNames(){
  const s=new Set()
  _pgLocs.forEach(l=>{const v=(l.name||'').trim(); if(v)s.add(v)})
  _pgComps.forEach(c=>{const v=(c.storage_location||'').trim(); if(v)s.add(v)})
  return [...s].sort((a,b)=>a.localeCompare(b))
}
function _pgLocChipsHTML(){
  if(!_pgLocs.length)return '<span class="muted" style="font-size:13px">No locations defined yet - add your fridges/freezers/stores once and every dropdown below will offer them.</span>'
  return _pgLocs.map(l=>'<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(249,115,22,.15);color:var(--accent);border-radius:14px;padding:3px 10px;font-size:13px;font-weight:600">'+esc(l.name)
    +'<a class="link" style="font-size:12px;cursor:pointer" onclick="packGuidesDelLoc(\''+l.id+'\')" title="Remove from list">✕</a></span>').join(' ')
}
function _pgLocSelect(c){
  const cur=(c.storage_location||'').trim()
  let o='<option value="">- none -</option>'
  _pgLocNames().forEach(l=>{o+='<option value="'+esc(l)+'"'+(l===cur?' selected':'')+'>'+esc(l)+'</option>'})
  o+='<option value="__new">+ New location…</option>'
  return '<select style="width:180px;flex:0 0 auto" onchange="packGuidesSetLoc(\''+c.id+'\',this)">'+o+'</select>'
}
function _pgLocListHTML(){
  let h=''
  _pgUsedComps().forEach(c=>{
    const unset=((c.storage_location||'').trim())?'0':'1'
    h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.15)">'
      +'<input type="checkbox" class="pgSel" data-cid="'+c.id+'" data-unset="'+unset+'" onchange="_pgBulkCount()" style="width:18px;height:18px;flex:0 0 auto;margin:0">'
      +'<div style="flex:1;min-width:0;font-size:13px">'+esc(c.name)+'</div>'+_pgLocSelect(c)+'</div>'
  })
  return h
}
function _pgBulkOptions(){
  let o='<option value="">- pick location -</option>'
  _pgLocNames().forEach(l=>{o+='<option value="'+esc(l)+'">'+esc(l)+'</option>'})
  o+='<option value="__new">+ New location…</option>'
  return o
}
function _pgBulkBarHTML(){
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">'
    +'<select id="pgBulkLoc" style="width:170px;flex:0 0 auto">'+_pgBulkOptions()+'</select>'
    +'<button class="ghost sm" id="pgBulkBtn" onclick="packGuidesBulkApply()">Apply to ticked (0)</button>'
    +'<span style="font-size:12px" class="muted">tick: <a class="link" onclick="packGuidesSel(\'all\')">all</a> · <a class="link" onclick="packGuidesSel(\'unset\')">unset only</a> · <a class="link" onclick="packGuidesSel(\'none\')">none</a></span>'
    +'</div>'
}
window._pgBulkCount=function(){
  const n=document.querySelectorAll('#pgLocList .pgSel:checked').length
  const b=document.getElementById('pgBulkBtn'); if(b)b.textContent='Apply to ticked ('+n+')'
}
window.packGuidesSel=function(mode){
  document.querySelectorAll('#pgLocList .pgSel').forEach(cb=>{
    if(mode==='all')cb.checked=true
    else if(mode==='none')cb.checked=false
    else cb.checked=(cb.dataset.unset==='1')
  })
  _pgBulkCount()
}
window.packGuidesBulkApply=async function(){
  const ids=[...document.querySelectorAll('#pgLocList .pgSel:checked')].map(cb=>cb.dataset.cid)
  if(!ids.length){alert('Tick at least one component first (or use the links to tick all / unset only).');return}
  const selEl=document.getElementById('pgBulkLoc')
  let v=selEl?selEl.value:''
  if(v==='__new'){
    v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
    if(!v)return
    const ins=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
    if(!ins.error&&ins.data&&!_pgLocs.some(l=>l.id===ins.data.id))_pgLocs.push(ins.data)
  }
  if(!v){alert('Pick a location to apply.');return}
  const {error}=await sb.from('sim_components').update({storage_location:v}).in('id',ids)
  if(error){alert(error.message);return}
  _pgComps.forEach(c=>{ if(ids.indexOf(c.id)>=0)c.storage_location=v })
  _pgRefreshLocs()
}
function _pgMissingWeights(){
  const compById={}; _pgComps.forEach(c=>{compById[c.id]=c})
  return _pgBom.filter(b=>b.grams==null||Number(b.grams)===0)
    .map(b=>({id:b.id,sku:b.sku,comp:(compById[b.component_id]||{}).name||'(unknown)',dish:_pgNames[b.sku]||('SKU '+b.sku)}))
    .sort((a,b)=>a.dish.localeCompare(b.dish))
}
function _pgWeightListHTML(){
  let h=''
  _pgMissingWeights().forEach(w=>{
    h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.15)">'
      +'<div style="flex:1;min-width:0;font-size:13px"><b>'+esc(w.comp)+'</b><div class="muted" style="font-size:11px">'+esc(w.dish)+' (SKU '+esc(w.sku)+')</div></div>'
      +'<input type="number" inputmode="numeric" placeholder="g" style="width:80px;flex:0 0 auto;text-align:right" onchange="packGuidesSetGrams(\''+w.id+'\',this)"> <span class="muted" style="font-size:12px">g</span></div>'
  })
  return h
}
function _pgRefreshLocs(){
  const ch=document.getElementById('pgLocChips'); if(ch)ch.innerHTML=_pgLocChipsHTML()
  const bl=document.getElementById('pgBulkLoc'); if(bl){const cur=bl.value;bl.innerHTML=_pgBulkOptions();bl.value=cur}
  const el=document.getElementById('pgLocList'); if(el){el.innerHTML=_pgLocListHTML();_pgBulkCount()}
  const n=document.getElementById('pgLocMsg')
  if(n){const comps=_pgUsedComps(),missing=comps.filter(c=>!(c.storage_location||'').trim()).length
    n.textContent=missing? missing+' of '+comps.length+' components have no location yet - they print as "-" until set.' : 'All '+comps.length+' components have a location.'}
  const wl=document.getElementById('pgWeightList'), wm=document.getElementById('pgWeightMsg'), ws=document.getElementById('pgWeightSec')
  if(wl){const mw=_pgMissingWeights()
    if(ws)ws.style.display=mw.length?'':'none'
    wl.innerHTML=_pgWeightListHTML()
    if(wm)wm.textContent=mw.length?(mw.length+' dish line'+(mw.length>1?'s have':' has')+' no portion weight - they print as CHECK until set. Type the grams and it saves.'):''}
}
window.packGuidesClose=function(){const m=document.getElementById('packGuidesModal');if(m)m.remove()}
window.packGuides=async function(){
  try{await _pgLoad()}catch(e){alert(e.message);return}
  const d=(packShift&&packShift.shift_date)||new Date().toISOString().slice(0,10)
  let body='<p class="muted" style="margin-top:-4px">One A4 card per dish - what goes in, the weight, and where to find it. Print, laminate, clip to the line. Reprint after any menu change.</p>'
  body+='<label style="display:block;margin:10px 0 6px"><input type="radio" name="pgMode" value="day" checked> Day pack order &nbsp;<input id="pgDate" type="date" value="'+d+'" style="width:auto;display:inline-block"></label>'
  body+='<label style="display:block;margin:0 0 12px"><input type="radio" name="pgMode" value="all"> Full set A-Z (every dish on file)</label>'
  body+='<button class="green" onclick="packGuidesPDF()">🖨 Generate PDF</button> <button class="ghost" onclick="packPrepSheetPDF()">🧺 Line prep sheet (PDF)</button>'
  body+='<p class="muted" style="margin:6px 0 0;font-size:12px">Line prep sheet = dish by dish in pack order: the exact amounts to stage on the line before each dish starts, plus whole-day totals per walk-in on the last page.</p>'
  if(isManagerUp()){
    body+='<h3 style="margin:18px 0 2px">Storage locations</h3>'
    body+='<div id="pgLocChips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 8px"></div>'
    body+='<button class="ghost sm" onclick="packGuidesAddLoc()" style="margin:0 0 10px">+ Add location</button>'
    body+='<p class="muted" id="pgLocMsg" style="margin:0 0 8px"></p>'
    body+=_pgBulkBarHTML()
    body+='<div id="pgLocList" style="max-height:300px;overflow-y:auto;border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:2px 10px"></div>'
    body+='<div id="pgWeightSec"><h3 style="margin:18px 0 2px">Missing weights</h3>'
      +'<p class="muted" id="pgWeightMsg" style="margin:0 0 8px"></p>'
      +'<div id="pgWeightList" style="border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:2px 10px"></div></div>'
  }
  const m=document.createElement('div'); m.id='packGuidesModal'
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;overflow-y:auto;padding:20px 12px'
  m.innerHTML='<div class="card" style="max-width:640px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="margin:0">Packing guides</h2><button class="ghost sm" onclick="packGuidesClose()">✕ Close</button></div>'
    +body+'</div>'
  m.onclick=function(e){ if(e.target===m)packGuidesClose() }
  document.body.appendChild(m)
  _pgRefreshLocs()
}
window.packGuidesAddLoc=async function(){
  const v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
  if(!v)return
  const {data,error}=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
  if(error){alert(error.message);return}
  if(data&&!_pgLocs.some(l=>l.id===data.id))_pgLocs.push(data)
  _pgRefreshLocs()
}
window.packGuidesDelLoc=async function(id){
  const l=_pgLocs.find(x=>x.id===id); if(!l)return
  if(!confirm('Remove "'+l.name+'" from the location list? Components already set to it keep their value.'))return
  const {error}=await sb.from('sim_storage_locations').delete().eq('id',id)
  if(error){alert(error.message);return}
  _pgLocs=_pgLocs.filter(x=>x.id!==id)
  _pgRefreshLocs()
}
window.packGuidesSetLoc=async function(id,sel){
  let v=sel.value
  if(v==='__new'){
    v=(prompt('New location name (e.g. Walk-in 1 - shelf 2):')||'').trim()
    if(!v){const c=_pgComps.find(x=>x.id===id);sel.value=(c&&c.storage_location)||'';return}
    const ins=await sb.from('sim_storage_locations').upsert({name:v},{onConflict:'name'}).select().single()
    if(!ins.error&&ins.data&&!_pgLocs.some(l=>l.id===ins.data.id))_pgLocs.push(ins.data)
  }
  const {error}=await sb.from('sim_components').update({storage_location:v||null}).eq('id',id)
  if(error){alert(error.message);_pgRefreshLocs();return}
  const c=_pgComps.find(x=>x.id===id); if(c)c.storage_location=v||null
  _pgRefreshLocs()
}
window.packGuidesSetGrams=async function(bomId,inp){
  const t=String(inp.value).trim()
  if(t===''){return}
  const n=Number(t)
  if(isNaN(n)||n<=0){alert('Enter the portion weight in grams (a number above 0).');inp.value='';return}
  const {error}=await sb.from('sim_dish_bom').update({grams:n}).eq('id',bomId)
  if(error){alert(error.message);return}
  const b=_pgBom.find(x=>x.id===bomId); if(b)b.grams=n
  _pgRefreshLocs()
}
window.packGuidesPDF=async function(){
  const mode=(document.querySelector('input[name="pgMode"]:checked')||{}).value||'day'
  const d=($('pgDate')&&$('pgDate').value)||new Date().toISOString().slice(0,10)
  try{await _eodLibs()}catch(e){alert(e.message);return}
  try{await _pgLoad()}catch(e){alert(e.message);return}
  const compById={}; _pgComps.forEach(c=>{compById[c.id]=c})
  const bySku={}; _pgBom.forEach(b=>{(bySku[b.sku]=bySku[b.sku]||[]).push(b)})
  const pageFor=(sku,dish,q,seq)=>{
    const comps=(bySku[sku]||[]).map(b=>{const c=compById[b.component_id]||{}
      return {name:c.name||'(unknown component)',grams:b.grams!=null?Number(b.grams):null,loc:(c.storage_location||'').trim()||null}})
    comps.sort((a,b)=>(b.grams||0)-(a.grams||0))
    return {sku:sku,dish:dish||('SKU '+sku),qty:q,seq:seq,comps:comps}
  }
  let pages=[], label=''
  if(mode==='day'){
    const sh=await sb.from('sim_pack_shifts').select('id,shift_date').eq('shift_date',d).maybeSingle()
    if(sh.error){alert(sh.error.message);return}
    let runs=[]
    if(sh.data){
      const rr=await sb.from('sim_pack_runs').select('sku,dish_name,planned_qty,sort_order,planned_seq,status').eq('shift_id',sh.data.id)
      if(rr.error){alert(rr.error.message);return}
      runs=(rr.data||[]).filter(r=>r.status!=='skipped')
        .sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
    }
    if(!runs.length){alert('No dish list loaded for '+d+' - import the day first, or print the full set.');return}
    pages=runs.map((r,i)=>pageFor(r.sku,r.dish_name,r.planned_qty!=null?Number(r.planned_qty):null,i+1))
    label=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  } else {
    pages=Object.keys(bySku).map(sku=>pageFor(sku,_pgNames[sku]||null,null,null)).sort((a,b)=>a.dish.localeCompare(b.dish))
    if(!pages.length){alert('No dish components on file yet.');return}
    label='FULL SET - ALL DISHES'
  }
  const doc=_packGuidesRender(pages,label)
  doc.save(mode==='day'?('Chefly-Packing-Guides-'+d+'.pdf'):'Chefly-Packing-Guides-Full-Set.pdf')
  packGuidesClose()
}
window._packGuidesRender=function(pages,dateLabel){
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28,H=841.89,M=40
  const INK=[28,26,25],ORANGE=[232,84,29],GREY=[138,133,128],LINE=[220,215,209]
  const t=(x,y,s,size,style,col,opt)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y,opt)}
  const fmtG=g=> g>=1000 ? (Math.round(g/10)/100)+' kg' : Math.round(g)+' g'
  pages.forEach((p,pi)=>{
    if(pi>0)doc.addPage()
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,96,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,96,'F')
    t(M,24,'PACKING GUIDE',9,'bold',[248,205,184])
    t(W-M,24,dateLabel,9,'normal',[201,194,187],{align:'right'})
    t(W-M,48,'SKU',8,'bold',[201,194,187],{align:'right'})
    t(W-M,82,p.sku||'-',30,'bold',[251,250,248],{align:'right'})
    const maxw=W-2*M-90
    let size=30,lines=[]
    for(const s2 of [30,26,22,18,15]){size=s2;doc.setFont('helvetica','bold');doc.setFontSize(s2);lines=doc.splitTextToSize(p.dish,maxw);if(lines.length<=2)break}
    if(lines.length>2)lines=lines.slice(0,2)
    let ny=lines.length===2?56:68
    lines.forEach(l=>{t(M,ny,l,size,'bold',[251,250,248]);ny+=size*1.08})
    let y=96
    if(p.qty!=null){
      doc.setFillColor(250,238,230);doc.rect(0,96,W,26,'F')
      t(M,113,'#'+p.seq+" IN TODAY'S ORDER",10,'bold',ORANGE)
      t(W-M,113,p.qty+' MEALS',12,'bold',INK,{align:'right'})
      y=122
    }
    const footTop=H-100
    if(!p.comps.length){
      t(M,y+60,'No components on file for this dish yet.',16,'bold',ORANGE)
      t(M,y+84,'Add its components in the app and reprint this card.',11,'normal',GREY)
    } else {
      const n=p.comps.length
      const rowH=Math.min(100,(footTop-y-14)/n)
      const s=Math.min(1,rowH/92)
      let ry=y+10
      p.comps.forEach((c,ci)=>{
        const cy=ry+rowH/2
        doc.setFillColor.apply(doc,ORANGE);doc.circle(M+14,cy,13*s,'F')
        t(M+14,cy+4.5*s,String(ci+1),13*s+2,'bold',[255,255,255],{align:'center'})
        const nx=M+40, nmaxw=W-2*M-190
        let ns=23*s,nlines=[]
        for(const q of [23,19,16,13]){ns=q*s;doc.setFont('helvetica','bold');doc.setFontSize(ns);nlines=doc.splitTextToSize(c.name,nmaxw);if(nlines.length<=2)break}
        if(nlines.length>2)nlines=nlines.slice(0,2)
        let nyy=nlines.length===2?cy-16*s:cy-3*s
        nlines.forEach(l=>{t(nx,nyy,l,ns,'bold',INK);nyy+=ns*1.05})
        const locY=nlines.length===2?cy+27*s:cy+20*s
        const loc=c.loc?c.loc.toUpperCase():null
        t(nx,locY,'WHERE:',10*s,'bold',GREY)
        t(nx+48*s,locY,loc||'-  (no location set yet)',loc?(14*s):(10*s),'bold',loc?ORANGE:GREY)
        if(c.grams!=null&&c.grams>0) t(W-M,cy+11*s,fmtG(c.grams),34*s,'bold',INK,{align:'right'})
        else t(W-M,cy+7*s,'CHECK',20*s,'bold',ORANGE,{align:'right'})
        doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(M,ry+rowH,W-M,ry+rowH)
        ry+=rowH
      })
      const known=p.comps.filter(c=>c.grams!=null&&c.grams>0)
      const tot=known.reduce((a,c)=>a+Number(c.grams),0)
      const miss=known.length<p.comps.length
      t(M,footTop+34,'TOTAL PLATE WEIGHT',12,'bold',GREY)
      t(W-M,footTop+38,fmtG(tot)+(miss?' + ?':''),26,'bold',INK,{align:'right'})
      if(miss)t(M,footTop+52,'? = a component has no weight on file - confirm before packing.',9,'normal',GREY)
    }
    doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(M,H-30,W-M,H-30)
    t(M,H-18,'Reprint after any menu change - generated '+new Date().toLocaleString('en-GB'),7.5,'normal',GREY)
    t(W-M,H-18,'Chefly SIM Tracker - card '+(pi+1)+' of '+pages.length,7.5,'normal',GREY,{align:'right'})
  })
  return doc
}

// ---- stage a dish list for the viewed day, right on the Packing screen ----
window.packStageImport=async function(){
  const el=$('pkStage'), mel=$('pkStageMsg')
  const raw=(el&&el.value||'').trim()
  if(!raw){msg(mel,'Paste the Google Sheet link or the dish rows first.',false);return}
  const d=(packShift&&packShift.shift_date)||packViewDate||new Date().toISOString().slice(0,10)
  let text=raw
  if(_PO_URL_RE.test(raw)&&raw.split(/\s/).length===1){
    msg(mel,'Fetching the Google Sheet…',true)
    try{await _poXlsxLib()}catch(e){msg(mel,e.message,false);return}
    let wb=null
    try{
      const r=await fetch('https://docs.google.com/spreadsheets/d/'+raw.match(_PO_URL_RE)[1]+'/export?format=xlsx')
      if(!r.ok)throw new Error('export blocked')
      wb=XLSX.read(await r.arrayBuffer(),{type:'array'})
    }catch(e1){
      try{
        const r2=await fetch('https://docs.google.com/spreadsheets/d/'+raw.match(_PO_URL_RE)[1]+'/gviz/tq?tqx=out:csv&sheet='+encodeURIComponent('All Dishes'))
        const t2=await r2.text()
        if(!r2.ok||t2.trim().startsWith('<'))throw new Error('gviz blocked')
        wb=XLSX.read(t2,{type:'string'})
        wb.SheetNames[0]='All Dishes'; wb.Sheets['All Dishes']=wb.Sheets[Object.keys(wb.Sheets)[0]]
      }catch(e2){msg(mel,'Could not open that Google Sheet. Set Share to "Anyone with the link → Viewer" and try again.',false);return}
    }
    text=_poSheetToText(wb).text
  }
  const rows=_parsePackOrders(text)
  if(!rows.length){msg(mel,'No dish rows found — check the link or the pasted rows.',false);return}
  const meals=rows.reduce((s,r)=>s+r.qty,0)
  const lbl=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}).toUpperCase()
  if(!confirm('Stage and load this list for:\n\n'+lbl+'\n\n'+rows.length+' dishes, '+meals+' meals. It replaces any staged list for that date.\n\nCorrect?'))return
  const {error}=await sb.rpc('sim_import_pack_dishes',{p_date:d,p_rows:rows})
  if(error){msg(mel,error.message,false);return}
  await packImportDishes()
}

/* ---------- LINE PREP SHEET (fridge pull list, PDF) ----------
   For the prep/runner role: dish-by-dish IN PACK ORDER first (stage each dish's
   amounts on the line before it starts), then the day's totals grouped by
   storage location as a reference for bulk pulls, on the last pages.
   total = per-meal grams x planned meals. Missing weights print as CHECK. */
window.packPrepSheetPDF=async function(){
  const d=($('pgDate')&&$('pgDate').value)||(packShift&&packShift.shift_date)||new Date().toISOString().slice(0,10)
  try{await _eodLibs()}catch(e){alert(e.message);return}
  try{await _pgLoad()}catch(e){alert(e.message);return}
  const sh=await sb.from('sim_pack_shifts').select('id,shift_date').eq('shift_date',d).maybeSingle()
  if(sh.error){alert(sh.error.message);return}
  let runs=[]
  if(sh.data){
    const rr=await sb.from('sim_pack_runs').select('sku,dish_name,planned_qty,sort_order,planned_seq,status').eq('shift_id',sh.data.id)
    if(rr.error){alert(rr.error.message);return}
    runs=(rr.data||[]).filter(r=>r.status!=='skipped')
      .sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
  }
  if(!runs.length){alert('No dish list loaded for '+d+' - load the day first.');return}
  const compById={}; _pgComps.forEach(c=>{compById[c.id]=c})
  const bySku={}; _pgBom.forEach(b=>{(bySku[b.sku]=bySku[b.sku]||[]).push(b)})
  const fmtKg=g=> g>=1000 ? ((Math.round(g/100)/10)+' kg') : (Math.round(g)+' g')
  // per-dish rows + day totals per component
  const dishBlocks=[], totals={}
  runs.forEach((r,i)=>{
    const lines=(bySku[r.sku]||[]).map(b=>{
      const c=compById[b.component_id]||{}
      const per=b.grams!=null?Number(b.grams):null
      const tot=(per!=null&&r.planned_qty!=null)?per*Number(r.planned_qty):null
      const loc=(c.storage_location||'').trim()||null
      const key=(c.name||'?')+'||'+(loc||'-')
      if(tot!=null){ if(!totals[key])totals[key]={name:c.name||'(unknown)',loc:loc,g:0,check:false}; totals[key].g+=tot }
      else { if(!totals[key])totals[key]={name:c.name||'(unknown)',loc:loc,g:0,check:false}; totals[key].check=true }
      return {name:c.name||'(unknown component)',loc:loc,per:per,tot:tot}
    }).sort((a,b)=>(b.per||0)-(a.per||0))
    dishBlocks.push({seq:i+1,sku:r.sku,dish:r.dish_name,qty:r.planned_qty,lines:lines})
  })
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28,H=841.89,M=34
  const INK=[28,26,25],ORANGE=[232,84,29],GREY=[138,133,128],LINE=[220,215,209],SOFT=[236,232,227]
  const dayLbl=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  const header=(sub)=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,54,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,54,'F')
    doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(251,250,248);doc.text('LINE PREP - FRIDGE PULL LIST',M,24)
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(201,194,187);doc.text(dayLbl+(sub?('  -  '+sub):''),M,40)
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(251,250,248);doc.text(runs.length+' dishes',W-M,24,{align:'right'})
  }
  // ---- PAGE 1+: per-dish setup, IN PACK ORDER (the prep person works dish by dish) ----
  header('IN PACK ORDER - stage this on the line BEFORE each start')
  let y2=76
  dishBlocks.forEach(bk=>{
    const need=30+bk.lines.length*16+18
    if(y2+need>H-40){doc.addPage();header('PER DISH - continued');y2=76}
    doc.setFillColor(250,238,230);doc.rect(M,y2-4,W-2*M,22,'F')
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor.apply(doc,INK)
    doc.text('#'+bk.seq+'  SKU '+(bk.sku||'-')+'  '+bk.dish,M+6,y2+11)
    doc.setTextColor.apply(doc,ORANGE)
    doc.text((bk.qty!=null?bk.qty+' MEALS':''),W-M-6,y2+11,{align:'right'})
    y2+=26
    if(!bk.lines.length){
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor.apply(doc,GREY)
      doc.text('No components on file - check with the lead.',M+6,y2+4); y2+=20
    } else bk.lines.forEach(l=>{
      doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.setTextColor.apply(doc,INK)
      doc.text(l.name,M+14,y2+4)
      doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor.apply(doc,GREY)
      doc.text((l.loc?l.loc:'-')+(l.per!=null?('   -   '+l.per+' g each'):''),M+250,y2+4)
      doc.setFont('helvetica','bold');doc.setFontSize(11)
      if(l.tot!=null){doc.setTextColor.apply(doc,INK);doc.text(fmtKg(l.tot),W-M-6,y2+4,{align:'right'})}
      else {doc.setTextColor.apply(doc,ORANGE);doc.text('CHECK',W-M-6,y2+4,{align:'right'})}
      doc.setDrawColor.apply(doc,SOFT);doc.setLineWidth(.5);doc.line(M+14,y2+8,W-M,y2+8)
      y2+=16
    })
    y2+=8
  })
  // ---- LAST PAGES: day totals grouped by location (reference for bulk pulls) ----
  doc.addPage()
  header('REFERENCE - whole-day totals, one trip per location')
  const byLoc={}
  Object.values(totals).forEach(t=>{const k=t.loc||'(no location set)';(byLoc[k]=byLoc[k]||[]).push(t)})
  let y=76
  Object.keys(byLoc).sort().forEach(loc=>{
    const rows=byLoc[loc].sort((a,b)=>b.g-a.g).map(t=>[t.name, t.g>0?fmtKg(t.g):'', t.check?'+ CHECK (a weight is missing)':''])
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor.apply(doc,ORANGE)
    if(y>H-90){doc.addPage();header('REFERENCE TOTALS - continued');y=76}
    doc.text(loc.toUpperCase(),M,y)
    doc.setDrawColor.apply(doc,LINE);doc.line(M,y+3,W-M,y+3)
    doc.autoTable({startY:y+8,margin:{left:M,right:M,top:76,bottom:36},theme:'plain',
      styles:{font:'helvetica',fontSize:9.5,cellPadding:{top:2.6,bottom:2.6,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
      columnStyles:{1:{cellWidth:70,halign:'right',fontStyle:'bold',fontSize:11},2:{cellWidth:150,textColor:ORANGE,fontSize:8}},
      body:rows,
      didDrawPage:dd=>{if(dd.pageNumber>1)header('REFERENCE TOTALS - continued')}})
    y=doc.lastAutoTable.finalY+18
  })
  const n=doc.getNumberOfPages()
  for(let p=1;p<=n;p++){doc.setPage(p)
    doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(M,H-28,W-M,H-28)
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor.apply(doc,GREY)
    doc.text('total = grams per meal x planned meals - pull a little extra to cover spillage - generated '+new Date().toLocaleString('en-GB'),M,H-18)
    doc.text('Chefly SIM Tracker - page '+p+' of '+n,W-M,H-18,{align:'right'})}
  doc.save('Chefly-Line-Prep-'+d+'.pdf')
}
