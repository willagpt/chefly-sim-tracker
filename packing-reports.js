/* PACKING (2 of 3): end-of-day report, history view, plan order.

   Continues packing.js — same global scope, same pack* state (packShift,
   packRuns, packMembers, packBreaks…) declared there. Load order in
   index.html must be packing.js -> packing-reports.js -> packing-guides.js.
   Nothing here runs at load time; everything is called from the buttons
   rendered by renderPacking() in packing.js. */

/* ---------- END-OF-DAY REPORT (PDF download) ----------
   Page 1: management summary (KPIs, speed, changeover, sequence, skips,
   issue themes + recommendation). Page 2: full run-sheet appendix.
   Built client-side with jsPDF + autoTable (lazy-loaded from cdnjs). */
function _eodClock(t){if(!t)return '–';const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function _eodTheme(txt){
  const t=String(txt||'').toLowerCase()
  if(!t.trim())return null
  if(t.indexOf('kaja')>=0)return 'Verbal instruction (Kaja)'
  if(t.indexOf('frozen')>=0)return 'Product frozen'
  if(t.indexOf('not ready')>=0||t.indexOf('not started')>=0)return 'Not ready'
  if(t.indexOf('tomorrow')>=0)return 'Deferred to tomorrow'
  if(t.indexOf('short')>=0)return 'Ran short mid-pack'
  if(t.indexOf('rice')>=0||t.indexOf('tray')>=0||t.indexOf('meatball')>=0||t.indexOf('no ')===0)return 'Component missing'
  if(/\b(done|already|ready)\b/.test(t))return 'Already done / in stock'
  return 'Other'
}
const _EOD_RECS={
  'Product frozen':'Add a pre-shift readiness check: confirm each dish is thawed and ready before the run order is locked.',
  'Not ready':'Add a pre-shift readiness check: confirm each dish is ready before the run order is locked.',
  'Component missing':'Add a pre-shift component check (rice, trays, proteins) before the run order is locked.',
  'Verbal instruction (Kaja)':'Route every sequence change through this screen so verbal instructions are captured against the plan.',
  'Already done / in stock':'Net stock on hand off the plan before importing the dish list.',
  'Ran short mid-pack':'Pause and flag shortages instead of closing dishes under-supplied.',
  'Deferred to tomorrow':'Carry deferred dishes into the next import so they are not lost.',
  'Other':'Review the notes with the team leader at the morning huddle.'
}
function _eodScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('Could not load '+src+' — check the internet connection.'));document.head.appendChild(s)})}
async function _eodLibs(){
  if(!(window.jspdf&&window.jspdf.jsPDF)) await _eodScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  if(!(window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)) await _eodScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
}
function _eodCompute(){
  const done=packRuns.filter(r=>r.status==='done')
  const skipped=packRuns.filter(r=>r.status==='skipped')
  const open=packRuns.filter(r=>r.status==='pending'||r.status==='packing')
  const plannedMeals=packRuns.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const packedMeals=done.reduce((s,r)=>s+(r.qty_packed!=null?Number(r.qty_packed):(Number(r.planned_qty)||0)),0)
  const skippedMeals=skipped.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const plannedSorted=[...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))
  const plannedRank={}; plannedSorted.forEach((r,i)=>{plannedRank[r.id]=i+1})
  const packedOrder=done.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq)
  const rows=packedOrder.length?packedOrder:done
  const starts=done.map(r=>r.start_time).filter(Boolean).sort()
  const fins=done.map(r=>r.finish_time).filter(Boolean).sort()
  const dayStart=starts[0]||null, dayEnd=fins.length?fins[fins.length-1]:null
  const elapsedMin=(dayStart&&dayEnd)?Math.max(1,(new Date(dayEnd)-new Date(dayStart))/60000):null
  const throughput=elapsedMin?(packedMeals/(elapsedMin/60)):null
  rows.forEach((r,i)=>{
    const q=(r.qty_packed!=null?Number(r.qty_packed):Number(r.planned_qty))
    r._rate=(r.total_minutes&&r.total_minutes>0&&q!=null)?(q/(r.total_minutes/60)):null
    r._excl=null
    if(r.total_minutes!=null&&r.total_minutes<1)r._excl='mistimed'
    else if(r._rate!=null&&r._rate>packTarget*1.8)r._excl='mistimed'
    else if(i===0&&r.total_minutes!=null&&r.total_minutes>60)r._excl='incl. start-up'
  })
  const clean=rows.filter(r=>!r._excl&&r._rate!=null)
  const cleanQty=clean.reduce((s,r)=>s+(r.qty_packed!=null?Number(r.qty_packed):Number(r.planned_qty)||0),0)
  const cleanMin=clean.reduce((s,r)=>s+Number(r.total_minutes),0)
  const avgRate=cleanMin>0?(cleanQty/(cleanMin/60)):null
  const hit=clean.filter(r=>r._rate>=packTarget).length
  const srt=[...clean].sort((a,b)=>b._rate-a._rate)
  const cos=rows.filter(r=>r.changeover_mins!=null)
  const coTotal=cos.reduce((s,r)=>s+Number(r.changeover_mins),0)
  const coAvg=cos.length?coTotal/cos.length:null
  const coOver=cos.filter(r=>Number(r.changeover_mins)>PACK_CO_TARGET).sort((a,b)=>b.changeover_mins-a.changeover_mins)
  const moved=packedOrder.filter((r,i)=>plannedRank[r.id]!=null&&plannedRank[r.id]!==(i+1))
  const themes={}; let kajaMentions=0
  const addTheme=(txt,r,isSkip)=>{
    const th=_eodTheme(txt); if(!th)return
    if(String(txt).toLowerCase().indexOf('kaja')>=0)kajaMentions++
    if(!themes[th])themes[th]={n:0,meals:0,skips:0}
    themes[th].n++; if(isSkip){themes[th].skips++;themes[th].meals+=(Number(r.planned_qty)||0)}
  }
  done.forEach(r=>{addTheme(r.out_of_sequence_reason,r,false); if(r.notes&&_eodTheme(r.notes)!==_eodTheme(r.out_of_sequence_reason))addTheme(r.notes,r,false)})
  skipped.forEach(r=>{addTheme(r.notes,r,true)})
  const themeList=Object.keys(themes).map(k=>({k,...themes[k]})).sort((a,b)=>b.n-a.n)
  const dominant=themeList.length?themeList[0].k:null
  const skipGroups={}
  skipped.forEach(r=>{const th=_eodTheme(r.notes)||'No reason logged'; if(!skipGroups[th])skipGroups[th]={n:0,meals:0}; skipGroups[th].n++; skipGroups[th].meals+=(Number(r.planned_qty)||0)})
  const crew=new Set(Object.values(packAssignments).map(a=>a.member_id).filter(Boolean)).size
  const supAsg=packPositions.filter(p=>/supervisor/i.test(p.label)).map(p=>packAssignments[p.id]).find(Boolean)
  const supervisor=supAsg?packMemberName(supAsg.member_id):null
  const doneBreaks=packBreaks.filter(b=>b.started_at&&b.ended_at)
  const brkSpan=doneBreaks.length?(_eodClock(doneBreaks.map(b=>b.started_at).sort()[0])+'–'+_eodClock(doneBreaks.map(b=>b.ended_at).sort().slice(-1)[0])):null
  return {done,skipped,open,plannedMeals,packedMeals,skippedMeals,plannedRank,rows,dayStart,dayEnd,elapsedMin,throughput,
    clean,avgRate,hit,srt,cos,coTotal,coAvg,coOver,moved,themeList,dominant,kajaMentions,
    mistimed:rows.filter(r=>r._excl==='mistimed'),startup:rows.filter(r=>r._excl==='incl. start-up'),
    skipGroups,crew,supervisor,doneBreaks,brkSpan}
}
window.packEodReport=async function(){
  if(!packShift||!packRuns.length){alert('No dishes for today yet — nothing to report.');return}
  if(!packRuns.some(r=>r.status==='done')){alert('No finished dishes yet — the report needs at least one packed dish.');return}
  try{await _eodLibs()}catch(e){alert(e.message);return}
  const S=_eodCompute()
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28, H=841.89, M=34
  const INK=[28,26,25], ORANGE=[232,84,29], GREY=[138,133,128], LINE=[220,215,209], SOFT=[236,232,227]
  const t=(x,y,s,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y)}
  const tr=(x,y,s,size,style,col)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);doc.text(String(s),x,y,{align:'right'})}
  const sec=(x,y,w,title)=>{t(x,y,title,9,'bold',ORANGE);doc.setDrawColor.apply(doc,LINE);doc.setLineWidth(.8);doc.line(x,y+3.5,x+w,y+3.5);return y+15}
  const para=(x,y,w,s,size,style,col,lh)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor.apply(doc,col||INK);const L=doc.splitTextToSize(String(s),w);doc.text(L,x,y);return y+L.length*(lh||size*1.35)}
  const mini=(x,y,w,head,body,widths)=>{doc.autoTable({startY:y,margin:{left:x},tableWidth:w,theme:'plain',
    styles:{font:'helvetica',fontSize:7.6,cellPadding:{top:1.8,bottom:1.8,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.6,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:widths,head:[head],body});return doc.lastAutoTable.finalY+8}
  const header=(sub)=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,54,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,54,'F')
    t(M,24,'PACKING — END OF DAY',15,'bold',[251,250,248])
    doc.setCharSpace&&doc.setCharSpace(0)
    const dateStr=new Date(packShift.shift_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    t(M,40,dateStr+(S.supervisor?'  ·  Supervisor: '+S.supervisor:'')+(S.crew?'  ·  Crew of '+S.crew:''),9,'normal',[201,194,187])
    tr(W-M,24,'SHIFT '+_eodClock(S.dayStart)+' – '+_eodClock(S.dayEnd),10,'bold',[251,250,248])
    if(S.elapsedMin)tr(W-M,40,Math.floor(S.elapsedMin/60)+'h '+String(Math.round(S.elapsedMin%60)).padStart(2,'0')+'m elapsed',9,'normal',[201,194,187])
    if(sub)t(M,54+14,sub,8,'bolditalic',GREY)
  }
  const footer=(p,n)=>{
    doc.setDrawColor.apply(doc,LINE);doc.line(M,H-30,W-M,H-30)
    t(M,H-20,'Target '+packTarget+' meals/hr · Changeover target '+PACK_CO_TARGET+' min'+(S.brkSpan?' · Breaks staggered '+S.brkSpan+' ('+S.doneBreaks.length+' taken)':'')+' · Generated '+new Date().toLocaleString('en-GB'),7,'normal',GREY)
    tr(W-M,H-20,'Chefly SIM Tracker · page '+p+' of '+n,7,'normal',GREY)
  }

  /* ---- PAGE 1 : SUMMARY ---- */
  header(S.open.length?(packViewDate?('NOTE — '+S.open.length+' dish(es) were never finished on this day.'):('INTERIM — '+S.open.length+' dish(es) still open; re-run at end of day.')):null)
  let y=S.open.length?86:78
  // KPI band
  const pct=S.plannedMeals?Math.round(S.packedMeals/S.plannedMeals*100):0
  doc.setFillColor(255,255,255);doc.setDrawColor.apply(doc,LINE);doc.rect(M,y,W-2*M,58,'FD')
  t(M+14,y+34,S.packedMeals.toLocaleString(),28,'bold',INK)
  const bw=doc.getTextWidth(S.packedMeals.toLocaleString())
  t(M+14+bw+6,y+34,'/ '+S.plannedMeals.toLocaleString()+'  ('+pct+'%)',12,'normal',GREY)
  t(M+14,y+48,'MEALS PACKED VS PLANNED',6.8,'bold',GREY)
  const ks=[[S.done.length+' / '+packRuns.length,'DISHES',S.skipped.length+' skipped · '+S.skippedMeals+' meals'],
    [(S.avgRate!=null?Math.round(S.avgRate):'–')+' / '+packTarget,'PACK RATE MEALS/HR',S.hit+' of '+S.clean.length+' dishes hit target'],
    [(S.throughput!=null?Math.round(S.throughput):'–')+'/hr','DAY THROUGHPUT','incl. changeovers + gaps'],
    [(S.coAvg!=null?S.coAvg.toFixed(1)+'m':'–'),'AVG CHANGEOVER',S.coOver.length+' over '+PACK_CO_TARGET+'m · '+Math.round(S.coTotal)+'m total']]
  const kx0=M+218, kw=(W-M-kx0)/4
  ks.forEach((k,i)=>{const kx=kx0+i*kw
    doc.setDrawColor.apply(doc,SOFT);doc.line(kx,y+8,kx,y+50)
    t(kx+8,y+24,k[0],12,'bold',INK);t(kx+8,y+35,k[1],6.4,'bold',GREY)
    doc.setFontSize(6.8);doc.setTextColor.apply(doc,GREY);doc.setFont('helvetica','normal')
    doc.text(doc.splitTextToSize(k[2],kw-12),kx+8,y+44)})
  y+=74
  const colw=(W-2*M-22)/2, L=M, R=M+colw+22
  // LEFT: speed
  let yL=sec(L,y,colw,'SPEED')
  yL=para(L,yL,colw,'Average '+(S.avgRate!=null?Math.round(S.avgRate):'–')+' meals/hr — '+(S.avgRate!=null?Math.round((packTarget-S.avgRate)/packTarget*100)+'% below the '+packTarget+' target.':''),8.4,'bold')+2
  const fastest=S.srt.slice(0,3).map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Math.round(r._rate)+'/hr'])
  const slowest=S.srt.slice(-3).reverse().map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Math.round(r._rate)+'/hr'])
  yL=mini(L,yL,colw,['','FASTEST',''],fastest,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right',fontStyle:'bold'}})
  yL=mini(L,yL,colw,['','SLOWEST',''],slowest,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right'}})
  // LEFT: changeover
  yL=sec(L,yL+2,colw,'CHANGEOVER')
  yL=para(L,yL,colw,(S.coAvg!=null?S.coAvg.toFixed(1):'–')+' min average vs '+PACK_CO_TARGET+'-min target · '+Math.round(S.coTotal)+' min lost in total.',8.4,'bold')+2
  const coRows=S.coOver.slice(0,4).map(r=>['#'+(r.sku||'–'),r.dish_name.length>34?r.dish_name.slice(0,33)+'…':r.dish_name,Number(r.changeover_mins).toFixed(1)+'m'])
  if(coRows.length)yL=mini(L,yL,colw,['','LONGEST CHANGEOVERS',''],coRows,{0:{cellWidth:26,fontStyle:'bold'},2:{cellWidth:36,halign:'right',fontStyle:'bold'}})
  if(S.coOver.length>4)yL=para(L,yL,colw,'+ '+(S.coOver.length-4)+' more over target.',7.4,'normal',GREY)+2
  // RIGHT: sequence
  let yR=sec(R,y,colw,'SEQUENCE VS PLAN')
  yR=para(R,yR,colw,S.moved.length+' of '+S.done.length+' dishes packed out of plan order.',8.4,'bold')+2
  const seqMix=S.themeList.filter(x=>x.k!=='Other').slice(0,4).map(x=>x.n+'× '+x.k).join(' · ')
  if(seqMix)yR=para(R,yR,colw,seqMix,7.8,'normal',GREY)+4
  // RIGHT: skipped
  yR=sec(R,yR,colw,'SKIPPED — '+S.skipped.length+' DISHES · '+S.skippedMeals+' MEALS')
  const sg=Object.keys(S.skipGroups).map(k=>[k,S.skipGroups[k].n+' dishes',S.skipGroups[k].meals+' meals']).sort((a,b)=>parseInt(b[2])-parseInt(a[2]))
  if(sg.length)yR=mini(R,yR,colw,['REASON','',''],sg,{1:{cellWidth:44,halign:'right'},2:{cellWidth:44,halign:'right',fontStyle:'bold'}})
  // RIGHT: data quality
  if(S.mistimed.length||S.startup.length){
    yR=sec(R,yR+2,colw,'DATA QUALITY')
    if(S.mistimed.length)yR=para(R,yR,colw,S.mistimed.map(r=>'#'+r.sku).join(', ')+' mistimed (impossible rate) — excluded from speed stats. Check start/stop discipline.',7.6,'normal',GREY)+2
    if(S.startup.length)yR=para(R,yR,colw,S.startup.map(r=>'#'+r.sku).join(', ')+' includes line start-up — excluded from the rate average.',7.6,'normal',GREY)+2
  }
  // BOTTOM: issues
  let yB=Math.max(yL,yR)+8
  yB=sec(M,yB,W-2*M,'ISSUES — WHAT DROVE THE DAY OFF PLAN')
  const th=S.themeList.map(x=>[x.k,String(x.n),x.skips?(x.skips+' skipped · '+x.meals+' meals'):''])
  if(th.length){yB=mini(M,yB,(W-2*M)/2-10,['THEME','N','IMPACT'],th,{1:{cellWidth:22,halign:'right',fontStyle:'bold'},2:{cellWidth:80}})}
  else yB=para(M,yB,W-2*M,'No disruptions logged — clean day.',8.4,'normal')+4
  const ax=M+(W-2*M)/2+10, aw=(W-2*M)/2-10
  // analysis text sits to the right of the theme table
  let yAn=(th.length?doc.lastAutoTable.settings.startY+8:yB)
  if(S.kajaMentions)yAn=para(ax,yAn+2,aw,S.kajaMentions+' notes reference an instruction from Kaja — the sequence was changed verbally, off-plan.',7.8,'bold')+3
  const readiness=(S.themeList.find(x=>x.k==='Product frozen')||{n:0}).n+(S.themeList.find(x=>x.k==='Not ready')||{n:0}).n+(S.themeList.find(x=>x.k==='Component missing')||{n:0}).n
  if(readiness)yAn=para(ax,yAn,aw,readiness+' disruptions were product not ready to pack (frozen, missing components, not made) — upstream readiness, not line speed.',7.8,'normal')+3
  const already=(S.themeList.find(x=>x.k==='Already done / in stock')||{n:0}).n
  if(already)yAn=para(ax,yAn,aw,already+' dishes were found already packed — stock on hand never made it into the plan.',7.8,'normal',GREY)+3
  // recommendation — readiness themes act as one group when together they outweigh the top single theme
  const readinessN=['Product frozen','Not ready','Component missing'].reduce((s,k)=>{const x=S.themeList.find(t=>t.k===k);return s+(x?x.n:0)},0)
  let rec=S.dominant?_EOD_RECS[S.dominant]:'Clean day — no disruptions logged.'
  if(S.dominant&&readinessN>=(S.themeList[0]?S.themeList[0].n:0))rec='Add a pre-shift readiness check — thaw, components and stock confirmed per dish before the run order is locked ('+readinessN+' disruptions were product not ready to pack).'
  const recY=Math.max(yB,yAn)+6
  doc.setFont('helvetica','bold');doc.setFontSize(9.2)
  const recLines=doc.splitTextToSize(rec,W-2*M-20)
  const recH=22+recLines.length*12
  doc.setFillColor.apply(doc,ORANGE);doc.rect(M,recY,W-2*M,recH,'F')
  t(M+10,recY+13,'RECOMMENDATION',6.6,'bold',[248,205,184])
  doc.setFont('helvetica','bold');doc.setFontSize(9.2);doc.setTextColor(255,255,255)
  doc.text(recLines,M+10,recY+26)

  /* ---- PAGE 2+ : RUN SHEET APPENDIX ---- */
  doc.addPage()
  header('APPENDIX — full run sheet, actual pack order')
  const contHeader=d=>{if(d.pageNumber>1)header('APPENDIX — continued')}
  const body=S.rows.map((r,i)=>{
    const mvd=S.plannedRank[r.id]!=null&&S.plannedRank[r.id]!==(i+1)?('  (plan #'+S.plannedRank[r.id]+')'):''
    const note=[r.out_of_sequence_reason?('moved: '+r.out_of_sequence_reason):null,r.notes].filter(Boolean).join(' — ')
    return [i+1,_eodClock(r.start_time),r.sku||'–',r.dish_name+mvd,
      r.qty_packed!=null?r.qty_packed:(r.planned_qty!=null?r.planned_qty:'–'),
      r.total_minutes!=null?Number(r.total_minutes).toFixed(1):'–',
      r.changeover_mins!=null?Number(r.changeover_mins).toFixed(1):(i===0?'—':'–'),
      r._excl?('excl. '+r._excl):(r._rate!=null?Math.round(r._rate):'–'),'',note]
  })
  doc.autoTable({startY:86,margin:{left:M,right:M,top:86,bottom:40},didDrawPage:contHeader,theme:'plain',
    styles:{font:'helvetica',fontSize:7.2,cellPadding:{top:1.6,bottom:1.6,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.4,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:{0:{cellWidth:16,halign:'right'},1:{cellWidth:26,halign:'right'},2:{cellWidth:22,fontStyle:'bold'},3:{cellWidth:150},4:{cellWidth:28,halign:'right'},5:{cellWidth:24,halign:'right'},6:{cellWidth:22,halign:'right'},7:{cellWidth:30,halign:'right'},8:{cellWidth:56},9:{textColor:GREY,fontSize:6.6}},
    head:[['#','START','SKU','DISH','QTY','MIN','CO','RATE','VS '+packTarget,'NOTES']],
    body,
    didParseCell:d=>{
      if(d.section!=='body')return
      const r=S.rows[d.row.index]; if(!r)return
      if(d.column.index===6&&r.changeover_mins!=null&&Number(r.changeover_mins)>PACK_CO_TARGET){d.cell.styles.fontStyle='bold';d.cell.styles.fillColor=[247,232,224]}
      if(d.column.index===7&&r._excl){d.cell.styles.textColor=GREY;d.cell.styles.fontStyle='italic';d.cell.styles.fontSize=6.4}
      if(d.column.index===7&&!r._excl&&r._rate!=null&&r._rate>=packTarget){d.cell.styles.fontStyle='bold'}
    },
    didDrawCell:d=>{
      if(d.section!=='body'||d.column.index!==8)return
      const r=S.rows[d.row.index]
      if(!r||r._excl||r._rate==null)return
      const maxw=d.cell.width-8, frac=Math.min(1,r._rate/(packTarget*1.5))
      doc.setFillColor.apply(doc,(r._rate>=packTarget?ORANGE:[201,194,187]))
      doc.rect(d.cell.x+4,d.cell.y+d.cell.height/2-2.5,Math.max(1.5,frac*maxw),5,'F')
      const tx=d.cell.x+4+(1/1.5)*maxw
      doc.setDrawColor.apply(doc,INK);doc.setLineWidth(.8);doc.line(tx,d.cell.y+d.cell.height/2-4,tx,d.cell.y+d.cell.height/2+4)
    }})
  let y2=doc.lastAutoTable.finalY+10
  if(S.skipped.length){
    const needed=(S.skipped.length+2)*11+24
    if(y2+needed>H-40){doc.addPage();header('APPENDIX — continued');y2=86}
    y2=sec(M,y2,W-2*M,'SKIPPED')
    doc.autoTable({startY:y2,margin:{left:M,right:M,top:86,bottom:40},didDrawPage:contHeader,theme:'plain',
      styles:{font:'helvetica',fontSize:7.2,cellPadding:{top:1.6,bottom:1.6,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
      headStyles:{fontSize:6.4,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
      columnStyles:{0:{cellWidth:22,fontStyle:'bold'},1:{cellWidth:200},2:{cellWidth:28,halign:'right'},3:{textColor:GREY}},
      head:[['SKU','DISH','QTY','REASON']],
      body:S.skipped.map(r=>[r.sku||'–',r.dish_name,r.planned_qty!=null?r.planned_qty:'–',r.notes||'–'])})
  }
  const nPages=doc.getNumberOfPages()
  for(let p=1;p<=nPages;p++){doc.setPage(p);footer(p,nPages)}
  doc.save('Chefly-Packing-EOD-'+packShift.shift_date+'.pdf')
}

/* ---------- PACKING HISTORY (view a previous day, read-only) ---------- */
function packHistoryPicker(){
  if(!(typeof isManagerUp==='function'&&isManagerUp())) return ''
  const today=new Date().toISOString().slice(0,10)
  const v=packViewDate||today
  return `<div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:13px">📅 View / prep day:</span><input type="date" value="${esc(v)}" onchange="packViewHistory(this.value)" style="max-width:180px" />${packViewDate?`<a class="link" style="font-size:13px" onclick="packViewHistory('')">← Back to today</a>`:''}</div>`
}
window.packViewHistory=async function(d){
  const today=new Date().toISOString().slice(0,10)
  packViewDate=(d&&d!==today)?d:null
  await loadPacking()
}
function packHistRow(r){
  return `<div class="task-item" style="align-items:center;gap:10px"><div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${esc(r.sku||'–')}</div></div><b style="flex:1;min-width:0;font-size:14px">${esc(r.dish_name)}</b><span class="muted" style="font-size:12px">${r.planned_qty??'–'} planned</span>${r.notes?`<span style="color:#fcd34d;font-size:12px">📝 ${esc(r.notes)}</span>`:''}</div>`
}

/* ---------- PLAN ORDER (view + printable PDF) ----------
   The planned sequence lives on each run row (planned_seq, set at import).
   Works for today and for any history day loaded via the date picker. */
function _packPlanSorted(){return [...packRuns].sort((a,b)=>((a.planned_seq!=null?a.planned_seq:a.sort_order)-(b.planned_seq!=null?b.planned_seq:b.sort_order)))}
function _packPackedPos(){const m={};packRuns.filter(r=>r.pack_seq!=null).sort((a,b)=>a.pack_seq-b.pack_seq).forEach((r,i)=>{m[r.id]=i+1});return m}
window.packTogglePlan=function(){packShowPlan=!packShowPlan;renderPacking()}
function packPlanList(){
  const plan=_packPlanSorted(), packedPos=_packPackedPos()
  const meals=plan.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  let h=`<p class="muted" style="margin:14px 0 4px">Plan order — the sequence as imported/planned for this day · <b style="color:var(--txt)">${plan.length}</b> dishes · <b style="color:var(--txt)">${meals}</b> meals.</p>`
  plan.forEach((r,i)=>{
    let st='<span class="pill off">pending</span>'
    if(r.status==='done')st=`<span class="pill done">done${packedPos[r.id]?' · packed #'+packedPos[r.id]:''}</span>`
    else if(r.status==='skipped')st='<span class="pill" style="background:rgba(245,158,11,.18);color:#fcd34d">skipped</span>'
    else if(r.status==='packing')st='<span class="pill live">● packing</span>'
    h+=`<div class="task-item" style="align-items:center;gap:10px"><b style="min-width:26px">#${i+1}</b><div style="flex:0 0 auto;text-align:center;min-width:34px"><div style="font-size:10px;color:var(--muted)">SKU</div><div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${esc(r.sku||'–')}</div></div><b style="flex:1;min-width:0;font-size:14px">${esc(r.dish_name)}</b><span class="muted" style="font-size:12px">${r.planned_qty??'–'}</span>${st}</div>`
  })
  return h
}
window.packPlanReport=async function(){
  if(!packShift||!packRuns.length){alert('No dishes loaded for this day — nothing to print.');return}
  try{await _eodLibs()}catch(e){alert(e.message);return}
  const {jsPDF}=window.jspdf
  const doc=new jsPDF({unit:'pt',format:'a4'})
  const W=595.28, H=841.89, M=34
  const INK=[28,26,25], ORANGE=[232,84,29], GREY=[138,133,128], LINE=[220,215,209], SOFT=[236,232,227]
  const plan=_packPlanSorted(), packedPos=_packPackedPos()
  const meals=plan.reduce((s,r)=>s+(Number(r.planned_qty)||0),0)
  const started=plan.some(r=>r.status!=='pending')
  const header=()=>{
    doc.setFillColor.apply(doc,INK);doc.rect(0,0,W,54,'F')
    doc.setFillColor.apply(doc,ORANGE);doc.rect(0,0,6,54,'F')
    doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(251,250,248);doc.text('PACKING — PLAN ORDER',M,24)
    const dateStr=new Date(packShift.shift_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(201,194,187);doc.text(dateStr,M,40)
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(251,250,248);doc.text(plan.length+' dishes · '+meals.toLocaleString()+' meals',W-M,24,{align:'right'})
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(201,194,187);doc.text('Target '+packTarget+'/hr',W-M,40,{align:'right'})
  }
  header()
  const body=plan.map((r,i)=>{
    let st=''
    if(r.status==='done')st='done'+(packedPos[r.id]?' (packed #'+packedPos[r.id]+')':'')
    else if(r.status==='skipped')st='skipped'
    else if(r.status==='packing')st='packing now'
    return [i+1,r.sku||'–',r.dish_name,r.planned_qty!=null?r.planned_qty:'–',started?st:'','']
  })
  doc.autoTable({startY:76,margin:{left:M,right:M,top:76,bottom:36},theme:'plain',
    didDrawPage:d=>{if(d.pageNumber>1)header()},
    styles:{font:'helvetica',fontSize:8.6,cellPadding:{top:3.2,bottom:3.2,left:2,right:2},textColor:INK,lineColor:SOFT,lineWidth:{bottom:.5}},
    headStyles:{fontSize:6.8,fontStyle:'bold',textColor:GREY,lineColor:INK,lineWidth:{bottom:1}},
    columnStyles:{0:{cellWidth:24,halign:'right',fontStyle:'bold'},1:{cellWidth:30,fontStyle:'bold'},3:{cellWidth:34,halign:'right',fontStyle:'bold'},4:{cellWidth:86,textColor:GREY},5:{cellWidth:34}},
    head:[['#','SKU','DISH','QTY',started?'STATUS':'','DONE']],
    body,
    didDrawCell:d=>{ if(d.section==='body'&&d.column.index===5){doc.setDrawColor.apply(doc,GREY);doc.setLineWidth(.8);doc.rect(d.cell.x+d.cell.width/2-4.5,d.cell.y+d.cell.height/2-4.5,9,9)} }
  })
  const n=doc.getNumberOfPages()
  for(let p=1;p<=n;p++){doc.setPage(p)
    doc.setDrawColor.apply(doc,LINE);doc.line(M,H-28,W-M,H-28)
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor.apply(doc,GREY)
    doc.text('Planned run order · generated '+new Date().toLocaleString('en-GB'),M,H-18)
    doc.text('Chefly SIM Tracker · page '+p+' of '+n,W-M,H-18,{align:'right'})}
  doc.save('Chefly-Packing-Plan-'+packShift.shift_date+'.pdf')
}
