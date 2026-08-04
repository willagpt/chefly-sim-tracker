/* WHOLESALE: Simmer production planning + tracking (separate lane from the D2C
   cook queue). One meal per week in up to three variants (Standard/Large/Lean).
   Views: Plan (per-variant targets -> pre-prep build plan), Stock (pre-production
   ledger: frozen salsa/beans, chilled brisket/chicken...), Pack day (two teams,
   lots of 750 portions + per-lot ingredient usage), Setup (meals on/off, BOM,
   component stages/batches — manager only).
   Data: sim_ws_meals / sim_ws_variants / sim_ws_components / sim_ws_bom /
   sim_ws_weeks / sim_ws_week_lines / sim_ws_stock_moves / sim_ws_pack_lots /
   sim_ws_lot_usage. */

let wsMeals=[], wsVariants=[], wsComps=[], wsBom=[], wsWeekStart=null, wsWeek=null, wsLines=[]
let wsOnHand={}, wsMoves=[], wsLots=[], wsUsage=[], wsView='plan', wsChannel=null, wsOpenLot=null, wsPackVar=null

const WS_STAGES=[
  ['build_ahead_frozen','Build ahead — freeze','Cook, pack & freeze to build stock (salsa, beans)'],
  ['build_ahead_chilled','Build ahead — cook & chill','Cook & chill ahead (brisket, chicken)'],
  ['day_before','Day before','Can be started the day before (barley)'],
  ['day_of','On the day','Made fresh on pack day'],
]
function wsStageLbl(s){const r=WS_STAGES.find(x=>x[0]===s);return r?r[1]:s}
function wsIsoLocal(dt){const y=dt.getFullYear(),m=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');return y+'-'+m+'-'+d}
function wsMondayOf(d){const dt=new Date(d+'T00:00:00');const off=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-off);return wsIsoLocal(dt)}
function wsAddDays(iso,n){const dt=new Date(iso+'T00:00:00');dt.setDate(dt.getDate()+n);return wsIsoLocal(dt)}
function wsKg(n){if(n==null||isNaN(n))return '—';const v=Math.round(Number(n)*10)/10;return v.toLocaleString('en-GB',{maximumFractionDigits:1})}
function wsInt(n){return n==null?'—':Number(n).toLocaleString('en-GB')}
function wsCanPlan(){return isManagerUp()}
/* Team station lock: 'A' or 'B' when this login is a pack-line tablet account
   (sim_profiles.ws_team, non-managers only) — else null. */
function wsMyTeam(){return (typeof wsStation==='function'&&wsStation())?profile.ws_team:null}
function wsLotMine(l){const my=wsMyTeam();return !my||((l.team||'A')===my)}
function wsVariantOf(id){return wsVariants.find(v=>v.id===id)}
function wsMealOf(id){return wsMeals.find(m=>m.id===id)}
function wsCompOf(id){return wsComps.find(c=>c.id===id)}
function wsVarLabel(v){const m=wsMealOf(v.meal_id);return (m?m.name:'?')+' — '+v.name}

window.loadWholesale=async function(){
  const box=$('wsBody'); if(!box)return
  if(!$('wsWeek').value) $('wsWeek').value=wsMondayOf(wsIsoLocal(new Date()))
  wsWeekStart=wsMondayOf($('wsWeek').value); $('wsWeek').value=wsWeekStart
  if(!wsCanPlan() && wsView!=='pack') wsView='pack'
  const [m,v,c,b]=await Promise.all([
    sb.from('sim_ws_meals').select('*').order('sort_order'),
    sb.from('sim_ws_variants').select('*').order('sort_order'),
    sb.from('sim_ws_components').select('*').order('sort_order'),
    sb.from('sim_ws_bom').select('*'),
  ])
  wsMeals=m.data||[]; wsVariants=v.data||[]; wsComps=c.data||[]; wsBom=b.data||[]
  const {data:wk}=await sb.from('sim_ws_weeks').select('*').eq('week_start',wsWeekStart).maybeSingle()
  wsWeek=wk||null
  if(wsWeek){const {data:ln}=await sb.from('sim_ws_week_lines').select('*').eq('week_id',wsWeek.id); wsLines=ln||[]}
  else wsLines=[]
  const {data:mv}=await sb.from('sim_ws_stock_moves').select('*').order('created_at',{ascending:false}).limit(400)
  wsMoves=mv||[]
  const {data:all}=await sb.from('sim_ws_stock_moves').select('component_id,qty_kg')
  wsOnHand={}; (all||[]).forEach(r=>{wsOnHand[r.component_id]=(wsOnHand[r.component_id]||0)+Number(r.qty_kg||0)})
  if(wsWeek){
    const {data:lots}=await sb.from('sim_ws_pack_lots').select('*').eq('week_id',wsWeek.id).order('lot_no'); wsLots=lots||[]
    if(wsLots.length){const {data:us}=await sb.from('sim_ws_lot_usage').select('*').in('lot_id',wsLots.map(l=>l.id)); wsUsage=us||[]} else wsUsage=[]
  } else {wsLots=[]; wsUsage=[]}
  renderWs()
  subscribeWs()
}
function subscribeWs(){
  if(wsChannel) return
  // Never let a realtime-subscription failure break the screen (or, on team
  // station logins, abort the login itself) — live refresh is a bonus, not core.
  // NOTE: db.js is not included by index.html, so the `db` helper may not
  // exist; subscribe through the Supabase client directly when it doesn't.
  try{
    const tables=['sim_ws_week_lines','sim_ws_stock_moves','sim_ws_pack_lots','sim_ws_lot_usage']
    const onChange=()=>{ const t=$('wsTab'); if(t&&!t.classList.contains('hidden')) loadWholesale() }
    if(typeof db!=='undefined' && db && db.onChanges){
      wsChannel=db.onChanges('ws-live',tables,onChange)
    } else {
      let ch=sb.channel('ws-live')
      tables.forEach(t=>{ ch=ch.on('postgres_changes',{event:'*',schema:'public',table:t},onChange) })
      wsChannel=ch.subscribe()
    }
  }catch(e){ console.error('Wholesale live-sync unavailable:',e) }
}
window.wsPrevWeek=function(){$('wsWeek').value=wsAddDays(wsWeekStart,-7);loadWholesale()}
window.wsNextWeek=function(){$('wsWeek').value=wsAddDays(wsWeekStart,7);loadWholesale()}
window.setWsView=function(v){wsView=v;renderWs()}

async function wsEnsureWeek(){
  if(wsWeek) return wsWeek.id
  const {data,error}=await sb.from('sim_ws_weeks').insert({week_start:wsWeekStart,created_by:me?me.id:null}).select().single()
  if(error){alert(error.message);return null}
  wsWeek=data; return data.id
}

/* ---- requirements maths (shared by Plan + Pack) ---- */
function wsNeeds(){
  // component_id -> need_kg across this week's lines (active variants only)
  const need={}
  wsLines.forEach(ln=>{
    const v=wsVariantOf(ln.variant_id); if(!v||!v.active) return
    const meal=wsMealOf(v.meal_id); if(!meal||!meal.active) return
    const qty=Number(ln.target_qty)||0; if(!qty) return
    wsBom.filter(b=>b.variant_id===v.id).forEach(b=>{
      need[b.component_id]=(need[b.component_id]||0)+qty*Number(b.grams)/1000
    })
  })
  return need
}
function wsTotalTarget(){return wsLines.reduce((s,l)=>{const v=wsVariantOf(l.variant_id);const m=v&&wsMealOf(v.meal_id);return s+((v&&v.active&&m&&m.active)?(Number(l.target_qty)||0):0)},0)}

/* ================= PLAN VIEW ================= */
window.wsSetTarget=async function(variantId,val){
  if(!wsCanPlan())return
  const qty=val===''?0:Math.max(0,Math.round(Number(val)||0))
  const id=await wsEnsureWeek(); if(!id)return
  const ex=wsLines.find(l=>l.variant_id===variantId)
  if(ex) await sb.from('sim_ws_week_lines').update({target_qty:qty}).eq('id',ex.id)
  else await sb.from('sim_ws_week_lines').insert({week_id:id,variant_id:variantId,target_qty:qty})
  await loadWholesale()
}
window.wsQuickBuild=async function(compId){
  const c=wsCompOf(compId); if(!c)return
  const kg=prompt('Log a build of '+c.name+' — kg made:'); if(kg===null)return
  const n=Number(kg); if(!n||n<=0){alert('Enter the kg made, e.g. 200');return}
  const lot=prompt('Batch / lot code (optional):')||null
  const {error}=await sb.from('sim_ws_stock_moves').insert({component_id:compId,qty_kg:n,kind:'build',lot_code:lot,week_id:wsWeek?wsWeek.id:null})
  if(error){alert(error.message);return}
  await loadWholesale()
}
function wsTargetsCard(){
  const activeMeals=wsMeals.filter(m=>m.active)
  if(!activeMeals.length) return '<div class="card"><p class="muted">No active meals. Turn a meal on in Setup.</p></div>'
  let h='<div class="card"><h2 style="margin:0 0 4px">This week’s order</h2><p class="muted" style="margin:0 0 10px;font-size:13px">Enter the confirmed quantities per size. Leave 0 for sizes you’re not running. Totals drive the build plan below.</p>'
  activeMeals.forEach(m=>{
    const vars=wsVariants.filter(v=>v.meal_id===m.id&&v.active)
    const mealTotal=vars.reduce((s,v)=>{const ln=wsLines.find(l=>l.variant_id===v.id);return s+(ln?Number(ln.target_qty)||0:0)},0)
    h+=`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>${esc(m.name)}</b><span style="font-size:12px;color:var(--muted)">${mealTotal?wsInt(mealTotal)+' meals':''}</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">`
    vars.forEach(v=>{
      const ln=wsLines.find(l=>l.variant_id===v.id)
      const qty=ln?Number(ln.target_qty)||0:0
      h+=`<div style="flex:1;min-width:120px"><label style="font-size:12px">${esc(v.name)}${v.portion_g?' · '+Number(v.portion_g)+' g':''}</label>
        <input type="number" inputmode="numeric" min="0" step="1" value="${qty||''}" placeholder="0" ${wsCanPlan()?'':'disabled'} onchange="wsSetTarget('${v.id}',this.value)" /></div>`
    })
    h+='</div></div>'
  })
  h+='</div>'
  return h
}
function wsPlanTable(){
  const need=wsNeeds()
  const ids=Object.keys(need)
  if(!ids.length) return '<div class="card"><p class="muted">Enter this week’s quantities above to see the build plan.</p></div>'
  let h=''
  WS_STAGES.forEach(([key,label,hint])=>{
    const rows=wsComps.filter(c=>c.active&&c.kind!=='raw'&&c.stage===key&&need[c.id]).sort((a,b)=>a.sort_order-b.sort_order)
    if(!rows.length)return
    const buildAhead=key!=='day_of'
    h+=`<div class="card" style="padding:0;overflow:hidden">
      <div style="padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <b style="font-size:14px">${label}</b><span style="font-size:12px;color:var(--muted)">${hint}</span>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>${['Component','Need','In stock','Still to make','Batches','Raw needed',''].map((t,i)=>`<th style="text-align:${i===0?'left':'right'};padding:7px 10px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap">${t}</th>`).join('')}</tr>`
    rows.forEach(c=>{
      const req=need[c.id]||0
      const stock=Math.max(0,wsOnHand[c.id]||0)
      const toMake=Math.max(0,req-stock)
      const batches=(c.batch_kg&&toMake>0)?Math.ceil(toMake/Number(c.batch_kg)):null
      const raw=c.raw_factor?req*Number(c.raw_factor):null
      const pct=req>0?Math.min(100,Math.round(stock/req*100)):0
      const col=pct>=100?'var(--green)':(pct>=60?'var(--amber)':'var(--red)')
      const cell=(t,al,style)=>`<td style="text-align:${al||'right'};padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;${style||''}">${t}</td>`
      h+='<tr>'+
        cell(`<b>${esc(c.name)}</b>${c.kind==='bought'?' <span style="font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px">bought in</span>':''}${buildAhead?`<div style="height:4px;background:var(--panel2);border-radius:2px;margin-top:5px;max-width:180px"><div style="height:4px;width:${pct}%;background:${col};border-radius:2px"></div></div>`:''}`,'left')+
        cell('<b>'+wsKg(req)+' kg</b>')+
        cell(buildAhead?(wsKg(stock)+' kg'):'<span style="color:var(--muted)">—</span>')+
        cell(buildAhead?('<b style="color:'+(toMake>0?'var(--amber)':'var(--green)')+'">'+(toMake>0?wsKg(toMake)+' kg':'✓ covered')+'</b>'):('<b>'+wsKg(req)+' kg</b>'))+
        cell(batches!=null?(batches+' × '+wsKg(c.batch_kg)+' kg'):(c.batch_kg?'<span style="color:var(--muted)">—</span>':'<span style="color:var(--muted)">n/a</span>'))+
        cell(raw!=null?(wsKg(raw)+' kg raw'):'<span style="color:var(--muted)">—</span>')+
        cell(c.kind==='prep'?`<button class="ghost sm" style="padding:2px 8px" onclick="wsQuickBuild('${c.id}')">＋ Log build</button>`:'')
      +'</tr>'
    })
    h+='</table></div></div>'
  })
  // raw-material stock lines (e.g. frozen peppers)
  const raws=wsComps.filter(c=>c.active&&c.kind==='raw')
  if(raws.length){
    h+='<div class="card"><h2 style="margin:0 0 6px">Raw stock to hold</h2>'
    raws.forEach(c=>{
      h+=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
        <div><b>${esc(c.name)}</b><div style="font-size:12px;color:var(--muted)">${esc(c.prep_note||'')}</div></div>
        <div style="white-space:nowrap"><b>${wsKg(wsOnHand[c.id]||0)} kg</b> <button class="ghost sm" style="padding:2px 8px" onclick="wsQuickBuild('${c.id}')">＋</button></div>
      </div>`
    })
    h+='</div>'
  }
  return h
}

/* ================= STOCK VIEW ================= */
window.wsAddMove=async function(){
  const compId=$('wsMvComp').value; if(!compId){msg($('wsMsg'),'Pick a component.',false);return}
  const kg=Number($('wsMvKg').value); if(!kg){msg($('wsMsg'),'Enter the kg.',false);return}
  const row={component_id:compId,kind:$('wsMvKind').value,qty_kg:kg,lot_code:$('wsMvLot').value.trim()||null,note:$('wsMvNote').value.trim()||null,move_date:$('wsMvDate').value||wsIsoLocal(new Date()),week_id:wsWeek?wsWeek.id:null}
  const {error}=await sb.from('sim_ws_stock_moves').insert(row)
  if(error){msg($('wsMsg'),error.message,false);return}
  $('wsMvKg').value='';$('wsMvLot').value='';$('wsMvNote').value='';clearMsg($('wsMsg'))
  await loadWholesale()
}
window.wsDelMove=async function(id){
  if(!confirm('Delete this stock movement?'))return
  const {error}=await sb.from('sim_ws_stock_moves').delete().eq('id',id)
  if(error){alert(error.message);return}
  await loadWholesale()
}
function wsStockView(){
  const need=wsNeeds()
  const opts=wsComps.filter(c=>c.active&&c.kind!=='bought').map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')
  let h=`<div class="card"><h2 style="margin:0 0 6px">Log stock movement</h2>
    <p class="muted" style="margin:0 0 10px;font-size:13px">Build = made & stored ahead. Use = taken out for production. Waste = thrown. Adjust = count correction (can be + or −).</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="min-width:180px;flex:1"><label>Component</label><select id="wsMvComp">${opts}</select></div>
      <div><label>Type</label><select id="wsMvKind" style="max-width:110px"><option value="build">Build ＋</option><option value="use">Use −</option><option value="waste">Waste −</option><option value="adjust">Adjust ±</option></select></div>
      <div><label>Kg</label><input id="wsMvKg" type="number" inputmode="decimal" step="0.1" style="max-width:90px" placeholder="kg" /></div>
      <div><label>Lot code</label><input id="wsMvLot" style="max-width:120px" placeholder="optional" /></div>
      <div><label>Date</label><input id="wsMvDate" type="date" value="${wsIsoLocal(new Date())}" style="max-width:150px" /></div>
      <div style="flex:1;min-width:140px"><label>Note</label><input id="wsMvNote" placeholder="optional" /></div>
      <button class="green" onclick="wsAddMove()">Save</button>
    </div><div id="wsMsg" class="msg"></div></div>`
  // on-hand summary
  const withStock=wsComps.filter(c=>c.kind!=='bought'&&((wsOnHand[c.id]||0)!==0||need[c.id]))
  h+='<div class="card"><h2 style="margin:0 0 6px">Stock on hand</h2>'
  if(!withStock.length) h+='<p class="muted">Nothing logged yet.</p>'
  else{
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    h+=`<tr>${['Component','Stage','Storage','On hand','Need this week','Cover'].map((t,i)=>`<th style="text-align:${i===0?'left':'right'};padding:6px 10px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--line)">${t}</th>`).join('')}</tr>`
    withStock.forEach(c=>{
      const oh=wsOnHand[c.id]||0, req=need[c.id]||0
      const pct=req>0?Math.round(oh/req*100):null
      const col=pct==null?'var(--muted)':(pct>=100?'var(--green)':(pct>=60?'var(--amber)':'var(--red)'))
      h+=`<tr><td style="padding:6px 10px;border-bottom:1px solid var(--line)"><b>${esc(c.name)}</b></td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);white-space:nowrap">${esc(wsStageLbl(c.stage))}</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)">${esc(c.storage||'—')}</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)"><b>${wsKg(oh)} kg</b></td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">${req?wsKg(req)+' kg':'—'}</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);font-weight:700;color:${col}">${pct==null?'—':pct+'%'}</td></tr>`
    })
    h+='</table></div>'
  }
  h+='</div>'
  // recent moves
  h+='<div class="card"><h2 style="margin:0 0 6px">Recent movements</h2>'
  if(!wsMoves.length) h+='<p class="muted">No movements yet.</p>'
  else{
    wsMoves.slice(0,60).forEach(mv=>{
      const c=wsCompOf(mv.component_id)
      const sign=Number(mv.qty_kg)>=0?'＋':'−'
      const col=Number(mv.qty_kg)>=0?'var(--green)':'var(--red)'
      h+=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">
        <div><b>${esc(c?c.name:'?')}</b> <span style="font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px">${esc(mv.kind)}</span>
          <div style="font-size:12px;color:var(--muted)">${meta([esc(mv.move_date),mv.lot_code?('lot '+esc(mv.lot_code)):'',esc(mv.note||'')])}</div></div>
        <div style="white-space:nowrap"><b style="color:${col}">${sign} ${wsKg(Math.abs(Number(mv.qty_kg)))} kg</b>
        ${wsCanPlan()?` <a class="link" style="font-size:13px" onclick="wsDelMove('${mv.id}')" title="Delete">✕</a>`:''}</div>
      </div>`
    })
  }
  h+='</div>'
  return h
}

/* ================= PACK DAY VIEW ================= */
window.wsGenLots=async function(variantId){
  if(wsMyTeam())return // team stations never generate/regenerate lots
  const ln=wsLines.find(l=>l.variant_id===variantId); if(!ln||!ln.target_qty){alert('Set this variant’s target on the Plan view first.');return}
  const existing=wsLots.filter(l=>l.variant_id===variantId)
  if(existing.length && !confirm('Lots already exist for this size. Regenerate from the target? Untouched lots are replaced; started/done lots are kept.'))return
  const keep=existing.filter(l=>l.status!=='pending')
  const del=existing.filter(l=>l.status==='pending')
  for(const l of del) await sb.from('sim_ws_pack_lots').delete().eq('id',l.id)
  const already=keep.reduce((s,l)=>s+(l.packed_qty!=null?l.packed_qty:l.lot_size),0)
  const remaining=Math.max(0,Number(ln.target_qty)-already)
  const n=Math.ceil(remaining/750)
  const rows=[]
  let startNo=keep.length?Math.max(...keep.map(l=>l.lot_no)):0
  for(let i=0;i<n;i++){
    const size=(i===n-1)?(remaining-750*(n-1)):750
    rows.push({week_id:wsWeek.id,variant_id:variantId,lot_no:startNo+i+1,lot_size:size,team:(startNo+i)%2===0?'A':'B'})
  }
  if(rows.length){const {error}=await sb.from('sim_ws_pack_lots').insert(rows); if(error){alert(error.message);return}}
  await loadWholesale()
}
window.wsLotStart=async function(id){
  const l0=wsLots.find(x=>x.id===id); if(l0&&!wsLotMine(l0))return
  const {error}=await sb.from('sim_ws_pack_lots').update({status:'in_progress',started_at:new Date().toISOString()}).eq('id',id)
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsLotFinish=async function(id){
  const l=wsLots.find(x=>x.id===id); if(!l||!wsLotMine(l))return
  const q=prompt('Portions packed in this lot:', String(l.lot_size))
  if(q===null)return
  const n=Math.round(Number(q)); if(!n||n<0){alert('Enter the portions packed.');return}
  const {error}=await sb.from('sim_ws_pack_lots').update({status:'done',finished_at:new Date().toISOString(),packed_qty:n}).eq('id',id)
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsLotReopen=async function(id){
  const l0=wsLots.find(x=>x.id===id); if(l0&&!wsLotMine(l0))return
  if(!confirm('Reopen this lot?'))return
  await sb.from('sim_ws_pack_lots').update({status:'in_progress',finished_at:null,packed_qty:null}).eq('id',id)
  await loadWholesale()
}
window.wsLotTeam=async function(id,team){ if(wsMyTeam())return; await sb.from('sim_ws_pack_lots').update({team}).eq('id',id); await loadWholesale() }
window.wsToggleLot=function(id){ wsOpenLot=(wsOpenLot===id)?null:id; renderWs() }
window.wsSetPackVar=function(v){ wsPackVar=v||null; wsOpenLot=null; renderWs() }
window.wsSaveUsage=async function(lotId,compId,val){
  const l0=wsLots.find(x=>x.id===lotId); if(l0&&!wsLotMine(l0))return
  const kg=val===''?null:Number(val)
  const ex=wsUsage.find(u=>u.lot_id===lotId&&u.component_id===compId)
  if(ex) await sb.from('sim_ws_lot_usage').update({issued_kg:kg,updated_at:new Date().toISOString()}).eq('id',ex.id)
  else if(kg!=null) await sb.from('sim_ws_lot_usage').insert({lot_id:lotId,component_id:compId,issued_kg:kg})
  await loadWholesale()
}
function wsLotMins(l){
  if(l.started_at&&l.finished_at)return (new Date(l.finished_at)-new Date(l.started_at))/60000
  if(l.started_at&&l.status==='in_progress')return (Date.now()-new Date(l.started_at))/60000
  return null
}
function wsLotCard(l,v){
  const stCol=l.status==='done'?'var(--green)':(l.status==='in_progress'?'var(--amber)':'var(--line)')
  const mins=wsLotMins(l)
  const open=wsOpenLot===l.id
  const bomRows=wsBom.filter(b=>b.variant_id===v.id).map(b=>({b,c:wsCompOf(b.component_id)})).filter(x=>x.c)
  let detail=''
  if(open){
    detail='<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">Per-lot quantities ('+wsInt(l.lot_size)+' portions) — enter kg issued to the line to track usage:</div>'
    bomRows.forEach(({b,c})=>{
      const exp=Number(b.grams)*l.lot_size/1000
      const u=wsUsage.find(x=>x.lot_id===l.id&&x.component_id===c.id)
      const used=u&&u.issued_kg!=null?Number(u.issued_kg):null
      const diff=used!=null?used-exp:null
      const dCol=diff==null?'var(--muted)':(Math.abs(diff)<=exp*0.03?'var(--green)':(diff>0?'var(--red)':'var(--amber)'))
      detail+=`<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line);font-size:12px">
        <span>${esc(c.name)}</span>
        <span style="color:var(--muted);white-space:nowrap">need ${wsKg(exp)} kg</span>
        <input type="number" inputmode="decimal" step="0.1" value="${used!=null?used:''}" placeholder="issued kg" style="max-width:95px;font-size:12px;padding:3px 6px" onchange="wsSaveUsage('${l.id}','${c.id}',this.value)" />
        <span style="white-space:nowrap;color:${dCol};font-weight:700">${diff==null?'':((diff>0?'+':'')+wsKg(diff)+' kg')}</span>
      </div>`
    })
    detail+='</div>'
  }
  return `<div style="background:var(--panel2);border:1px solid ${stCol};border-radius:10px;padding:8px 10px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="cursor:pointer" onclick="wsToggleLot('${l.id}')"><b>Lot ${l.lot_no}</b> · ${wsInt(l.status==='done'&&l.packed_qty!=null?l.packed_qty:l.lot_size)} portions
        ${l.status==='done'?pill('done','done'):(l.status==='in_progress'?pill('live','packing'):pill('','pending'))}
        ${mins!=null?`<span style="font-size:11px;color:var(--muted)"> ${Math.round(mins)} min</span>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${wsMyTeam()?`<span style="font-size:12px;color:var(--muted)">Team ${esc(l.team||'A')}</span>`:`<select style="font-size:12px;padding:3px 6px;max-width:90px" onchange="wsLotTeam('${l.id}',this.value)">
          <option value="A"${l.team==='A'?' selected':''}>Team A</option><option value="B"${l.team==='B'?' selected':''}>Team B</option>
        </select>`}
        ${l.status==='pending'?`<button class="green sm" onclick="wsLotStart('${l.id}')">▶ Start</button>`:''}
        ${l.status==='in_progress'?`<button class="sm" onclick="wsLotFinish('${l.id}')">■ Finish</button>`:''}
        ${l.status==='done'?`<a class="link" style="font-size:12px" onclick="wsLotReopen('${l.id}')">reopen</a>`:''}
      </div>
    </div>${detail}</div>`
}
function wsUsageSummary(v,lots){
  const done=lots.filter(l=>l.status!=='pending')
  const rows=[]
  wsBom.filter(b=>b.variant_id===v.id).forEach(b=>{
    const c=wsCompOf(b.component_id); if(!c)return
    let exp=0,used=0,logged=0
    done.forEach(l=>{
      const u=wsUsage.find(x=>x.lot_id===l.id&&x.component_id===c.id)
      if(u&&u.issued_kg!=null){exp+=Number(b.grams)*l.lot_size/1000; used+=Number(u.issued_kg)-(Number(u.returned_kg)||0); logged++}
    })
    if(logged) rows.push({name:c.name,exp,used})
  })
  if(!rows.length) return ''
  let h='<div class="card"><h2 style="margin:0 0 6px">Usage vs recipe · '+esc(v.name)+'</h2><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
  h+=`<tr>${['Component','Should use','Issued','Diff'].map((t,i)=>`<th style="text-align:${i===0?'left':'right'};padding:6px 10px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--line)">${t}</th>`).join('')}</tr>`
  rows.forEach(r=>{
    const d=r.used-r.exp
    const pc=r.exp>0?(d/r.exp*100):0
    const col=Math.abs(pc)<=3?'var(--green)':(d>0?'var(--red)':'var(--amber)')
    h+=`<tr><td style="padding:6px 10px;border-bottom:1px solid var(--line)">${esc(r.name)}</td>
      <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">${wsKg(r.exp)} kg</td>
      <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">${wsKg(r.used)} kg</td>
      <td style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);font-weight:700;color:${col}">${(d>0?'+':'')+wsKg(d)} kg (${(pc>0?'+':'')+Math.round(pc)}%)</td></tr>`
  })
  h+='</table></div><p class="muted" style="font-size:12px;margin:8px 0 0">Over 3% above recipe = overportioning on the line.</p></div>'
  return h
}
function wsPackView(){
  const lines=wsLines.filter(l=>{const v=wsVariantOf(l.variant_id);const m=v&&wsMealOf(v.meal_id);return v&&v.active&&m&&m.active&&Number(l.target_qty)>0})
  if(!lines.length) return '<div class="card"><p class="muted">No targets set for this week yet'+(wsCanPlan()?' — enter them on the Plan view.':' — ask a manager to set the week’s plan.')+'</p></div>'
  if(wsPackVar && !lines.some(l=>l.variant_id===wsPackVar)) wsPackVar=null
  const sel=wsPackVar||lines[0].variant_id
  const tabs=lines.map(l=>{
    const v=wsVariantOf(l.variant_id)
    const on=l.variant_id===sel
    return `<span onclick="wsSetPackVar('${l.variant_id}')" style="padding:6px 12px;font-size:13px;cursor:pointer;border-radius:8px;${on?'background:var(--accent);color:#0b1220;font-weight:700':'border:1px solid var(--line);color:var(--muted)'}">${esc(v.name)} · ${wsInt(l.target_qty)}</span>`
  }).join(' ')
  const ln=lines.find(l=>l.variant_id===sel)
  const v=wsVariantOf(sel)
  const lots=wsLots.filter(l=>l.variant_id===sel)
  const packed=lots.filter(l=>l.status==='done').reduce((s,l)=>s+(l.packed_qty!=null?l.packed_qty:l.lot_size),0)
  const inProg=lots.filter(l=>l.status==='in_progress').reduce((s,l)=>s+l.lot_size,0)
  const target=Number(ln.target_qty)||0
  const pct=target?Math.min(100,Math.round(packed/target*100)):0
  let h=`<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${tabs}</div>
    <h2 style="margin:0 0 2px">${esc(wsMealOf(v.meal_id).name)} — ${esc(v.name)}</h2>
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">
      <span style="font-size:26px;font-weight:800">${wsInt(packed)} <span style="font-size:14px;color:var(--muted);font-weight:400">/ ${wsInt(target)} packed${inProg?' · '+wsInt(inProg)+' on the line':''}</span></span>
      <span style="font-weight:800;color:${pct>=100?'var(--green)':'var(--accent)'}">${pct}%</span>
    </div>
    <div style="height:10px;background:var(--panel2);border-radius:5px;margin-top:6px"><div style="height:10px;width:${pct}%;background:${pct>=100?'var(--green)':'var(--accent)'};border-radius:5px"></div></div>
    ${!lots.length?(wsMyTeam()?'<p class="muted" style="margin-top:10px;font-size:13px">No lots yet for this size — a manager generates them from the week’s target.</p>':`<div style="margin-top:10px"><button class="green" onclick="wsGenLots('${sel}')">Generate lots of 750</button><span class="muted" style="font-size:12px;margin-left:8px">${Math.ceil(target/750)} lots — trays come in boxes of 750, so one box = one lot.</span></div>`):(wsCanPlan()?`<div style="margin-top:8px"><a class="link" style="font-size:12px" onclick="wsGenLots('${sel}')">Regenerate pending lots from target</a></div>`:'')}
  </div>`
  if(lots.length){
    const my=wsMyTeam()
    const teams=my?[my,(my==='A'?'B':'A')]:['A','B']
    h+=my?'':'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">'
    teams.forEach(t=>{
      const tl=lots.filter(l=>(l.team||'A')===t)
      const tPacked=tl.filter(l=>l.status==='done').reduce((s,l)=>s+(l.packed_qty!=null?l.packed_qty:l.lot_size),0)
      if(my&&t!==my){
        // other team: compact read-only summary so the station stays focused
        const tDone=tl.filter(l=>l.status==='done').length
        const tLive=tl.filter(l=>l.status==='in_progress').length
        h+=`<div class="card" style="opacity:.75"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><h2 style="margin:0;font-size:15px">Team ${t}</h2><span style="font-size:12px;color:var(--muted)">${wsInt(tPacked)} packed · ${tDone}/${tl.length} lots done${tLive?' · '+tLive+' on the line':''}</span></div></div>`
        return
      }
      h+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">${my?'Your lots — ':''}Team ${t}</h2><span style="font-size:12px;color:var(--muted)">${wsInt(tPacked)} packed · ${tl.length} lot${tl.length===1?'':'s'}</span></div>`
      if(!tl.length) h+='<p class="muted" style="font-size:13px">No lots assigned.</p>'
      tl.forEach(l=>{h+=wsLotCard(l,v)})
      h+='</div>'
    })
    h+=my?'':'</div>'
    h+=wsUsageSummary(v,lots)
  }
  return h
}

/* ================= SETUP VIEW (manager) ================= */
window.wsToggleMeal=async function(id,on){ await sb.from('sim_ws_meals').update({active:on}).eq('id',id); await loadWholesale() }
window.wsToggleVariant=async function(id,on){ await sb.from('sim_ws_variants').update({active:on}).eq('id',id); await loadWholesale() }
window.wsSetPortion=async function(id,val){ await sb.from('sim_ws_variants').update({portion_g:val?Number(val):null}).eq('id',id); await loadWholesale() }
window.wsSetBomGrams=async function(id,val){
  if(val===''||Number(val)<=0){ if(confirm('Remove this component from the recipe?')) await sb.from('sim_ws_bom').delete().eq('id',id) }
  else await sb.from('sim_ws_bom').update({grams:Number(val)}).eq('id',id)
  await loadWholesale()
}
window.wsAddBomRow=async function(variantId){
  const sel=$('wsAddComp_'+variantId); const g=$('wsAddGrams_'+variantId)
  if(!sel.value||!Number(g.value)){alert('Pick a component and grams.');return}
  const {error}=await sb.from('sim_ws_bom').insert({variant_id:variantId,component_id:sel.value,grams:Number(g.value)})
  if(error){alert(error.message);return}
  await loadWholesale()
}
window.wsSetComp=async function(id,field,val){
  const patch={}; patch[field]=(field==='batch_kg'||field==='raw_factor')?(val===''?null:Number(val)):(val===''?null:val)
  await sb.from('sim_ws_components').update(patch).eq('id',id); await loadWholesale()
}
window.wsToggleComp=async function(id,on){ await sb.from('sim_ws_components').update({active:on}).eq('id',id); await loadWholesale() }
window.wsAddMeal=async function(){
  const name=prompt('New meal name:'); if(!name||!name.trim())return
  const {data,error}=await sb.from('sim_ws_meals').insert({name:name.trim(),sort_order:wsMeals.length+1}).select().single()
  if(error){alert(error.message);return}
  for(const [nm,i] of [['Standard',1],['Large',2],['Lean',3]]) await sb.from('sim_ws_variants').insert({meal_id:data.id,name:nm,sort_order:i})
  await loadWholesale()
}
window.wsAddComponent=async function(){
  const name=prompt('New component name:'); if(!name||!name.trim())return
  const {error}=await sb.from('sim_ws_components').insert({name:name.trim(),sort_order:wsComps.length+1})
  if(error){alert(error.message);return}
  await loadWholesale()
}
function wsToggle(on,fn){return `<span onclick="${fn}" style="cursor:pointer;font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;${on?'background:rgba(34,197,94,.2);color:#86efac':'background:var(--panel2);color:var(--muted);border:1px solid var(--line)'}">${on?'ON':'OFF'}</span>`}
function wsSetupView(){
  if(!wsCanPlan()) return '<div class="card"><p class="muted">Managers only.</p></div>'
  let h='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Meals & recipes</h2><button class="ghost sm" onclick="wsAddMeal()">＋ Add meal</button></div>'
  h+='<p class="muted" style="font-size:13px;margin:4px 0 10px">Turn meals (or single sizes) off when the menu changes — they keep their history and can be switched back on. Grams are per portion.</p></div>'
  wsMeals.forEach(m=>{
    h+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">${esc(m.name)}</h2>${wsToggle(m.active,`wsToggleMeal('${m.id}',${!m.active})`)}</div>`
    wsVariants.filter(v=>v.meal_id===m.id).forEach(v=>{
      const rows=wsBom.filter(b=>b.variant_id===v.id).map(b=>({b,c:wsCompOf(b.component_id)})).filter(x=>x.c)
      const tot=rows.reduce((s,x)=>s+Number(x.b.grams),0)
      h+=`<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b>${esc(v.name)}</b>
          <span style="font-size:12px;color:var(--muted)">portion</span><input type="number" value="${v.portion_g||''}" style="max-width:75px;font-size:12px;padding:3px 6px" onchange="wsSetPortion('${v.id}',this.value)" /><span style="font-size:12px;color:var(--muted)">g · recipe total ${wsKg(tot)} g</span>
          ${wsToggle(v.active,`wsToggleVariant('${v.id}',${!v.active})`)}
        </div>`
      rows.forEach(({b,c})=>{
        h+=`<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:3px 0;font-size:13px">
          <span>${esc(c.name)}</span>
          <span><input type="number" step="0.01" value="${Number(b.grams)}" style="max-width:85px;font-size:12px;padding:3px 6px" onchange="wsSetBomGrams('${b.id}',this.value)" /> <span style="font-size:11px;color:var(--muted)">g</span></span>
        </div>`
      })
      const compOpts='<option value="">＋ add component…</option>'+wsComps.filter(c=>c.active&&c.kind!=='raw'&&!rows.some(x=>x.c.id===c.id)).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')
      h+=`<div style="display:flex;gap:6px;margin-top:6px"><select id="wsAddComp_${v.id}" style="font-size:12px;max-width:220px">${compOpts}</select><input id="wsAddGrams_${v.id}" type="number" placeholder="g" style="max-width:70px;font-size:12px" /><button class="ghost sm" onclick="wsAddBomRow('${v.id}')">Add</button></div>`
      h+='</div>'
    })
    h+='</div>'
  })
  h+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Components</h2><button class="ghost sm" onclick="wsAddComponent()">＋ Add component</button></div>'
  h+='<p class="muted" style="font-size:13px;margin:4px 0 8px">Stage decides where each one appears in the build plan. Batch kg drives the batch count.</p>'
  wsComps.forEach(c=>{
    const stOpts=WS_STAGES.map(([k,l])=>`<option value="${k}"${c.stage===k?' selected':''}>${l}</option>`).join('')
    h+=`<div style="border-top:1px solid var(--line);padding:8px 0">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="min-width:180px;flex:1">${esc(c.name)}</b>
        <select style="font-size:12px;max-width:190px" onchange="wsSetComp('${c.id}','stage',this.value)">${stOpts}</select>
        <span style="font-size:11px;color:var(--muted)">batch</span><input type="number" step="0.1" value="${c.batch_kg||''}" placeholder="kg" style="max-width:70px;font-size:12px;padding:3px 6px" onchange="wsSetComp('${c.id}','batch_kg',this.value)" />
        <span style="font-size:11px;color:var(--muted)">store</span><input value="${esc(c.storage||'')}" style="max-width:80px;font-size:12px;padding:3px 6px" onchange="wsSetComp('${c.id}','storage',this.value)" />
        ${wsToggle(c.active,`wsToggleComp('${c.id}',${!c.active})`)}
      </div>
      ${c.prep_note?`<div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(c.prep_note)}</div>`:''}
    </div>`
  })
  h+='</div>'
  return h
}

/* ================= render ================= */
function renderWs(){
  const box=$('wsBody'); if(!box)return
  const views=wsMyTeam()?[['pack','Pack day']]:(wsCanPlan()?[['plan','Plan'],['stock','Stock'],['pack','Pack day'],['setup','Setup']]:[['pack','Pack day'],['stock','Stock']])
  if(!views.some(x=>x[0]===wsView)) wsView=views[0][0]
  const bar=views.length<2?'':'<div class="card" style="padding:10px 12px"><div style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden">'+
    views.map(([k,l],i)=>`<span onclick="setWsView('${k}')" style="padding:6px 14px;font-size:13px;cursor:pointer;${wsView===k?'background:var(--accent);color:#0b1220;font-weight:700':'color:var(--muted)'}${i?';border-left:1px solid var(--line)':''}">${l}</span>`).join('')+
    '</div></div>'
  let body=''
  if(wsView==='plan') body=wsTargetsCard()+wsPlanTable()
  else if(wsView==='stock') body=wsStockView()
  else if(wsView==='pack') body=wsPackView()
  else body=wsSetupView()
  box.innerHTML=bar+body
}
