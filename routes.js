/* ROUTES: multi-step recipe routings (per-product ordered steps + yields).
   Manage-tab editor + explodeRoute() used by the plan's auto-scheduler. */
let routesData=[]

async function loadRoutes(){
  if(!isAdmin()) return
  const box=$('routeList'); if(!box) return
  const {data:rs,error}=await sb.from('sim_routes').select('*').eq('active',true).order('name')
  if(error){box.innerHTML='<p class="muted">'+esc(error.message)+'</p>';return}
  const routes=rs||[]; let steps=[]
  if(routes.length){ const {data:st}=await sb.from('sim_route_steps').select('*').in('route_id',routes.map(r=>r.id)).order('step_no'); steps=st||[] }
  routesData=routes.map(r=>Object.assign({},r,{steps:steps.filter(s=>s.route_id===r.id)}))
  renderRoutes()
}
function stepTaskOptions(){return '<option value="">Add step: pick task…</option>'+catalog.map(t=>`<option value="${t.id}">${esc(t.name)}${t.is_batch?' 🔥':''}</option>`).join('')}
function renderRoutes(){
  const box=$('routeList'); if(!box) return
  if(!routesData.length){box.innerHTML='<p class="muted">No recipes yet. Create one above (e.g. “Brisket”), then add its steps in order.</p>';return}
  box.innerHTML=routesData.map(r=>{
    const steps=r.steps.map((s,i)=>{
      const t=catalog.find(c=>c.id===s.catalog_id)
      return `<div style="display:grid;grid-template-columns:20px 1fr auto auto auto 22px;gap:6px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--line)">
        <span class="muted" style="font-size:12px">${i+1}</span>
        <b style="font-size:13px">${esc(s.task_name||(t&&t.name)||'?')}${t&&t.is_batch?' <span class="muted" style="font-size:11px">batch</span>':''}</b>
        <span style="font-size:12px;color:var(--muted)"><input type="number" value="${s.yield_pct==null?100:s.yield_pct}" onchange="setStepYield('${s.id}',this.value)" style="width:52px;font-size:12px;padding:2px 4px" />% yield</span>
        <a class="link" style="font-size:15px${i===0?';opacity:.3;pointer-events:none':''}" onclick="moveRouteStep('${s.id}',-1)" title="Up">↑</a>
        <a class="link" style="font-size:15px${i===r.steps.length-1?';opacity:.3;pointer-events:none':''}" onclick="moveRouteStep('${s.id}',1)" title="Down">↓</a>
        <a class="link" style="font-size:13px;text-align:center" onclick="delRouteStep('${s.id}')" title="Remove">✕</a>
      </div>`
    }).join('') || '<p class="muted" style="font-size:12px;padding:4px">No steps yet.</p>'
    return `<div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel2)">
        <b>${esc(r.name)} <span class="muted" style="font-size:12px">(${esc(r.uom||'kg')})</span></b>
        <a class="link" style="font-size:13px" onclick="delRoute('${r.id}')">Remove recipe</a>
      </div>
      <div style="padding:4px 10px">${steps}</div>
      <div style="display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--line)">
        <select id="rs_${r.id}" style="flex:1">${stepTaskOptions()}</select>
        <button class="ghost sm" onclick="addRouteStep('${r.id}')">Add step</button>
      </div>
    </div>`
  }).join('')
}
window.addRoute=async function(){
  const name=$('rtName').value.trim(); if(!name){msg($('rtMsg'),'Enter a recipe name.',false);return}
  const uom=($('rtUom').value||'kg').trim()||'kg'
  const {error}=await sb.from('sim_routes').insert({name,uom})
  if(error){msg($('rtMsg'),error.message,false);return}
  $('rtName').value=''; msg($('rtMsg'),'Recipe added — now add its steps in order.',true); loadRoutes()
}
window.delRoute=async function(id){ if(!confirm('Remove this recipe and its steps?'))return; await sb.from('sim_routes').update({active:false}).eq('id',id); loadRoutes() }
window.addRouteStep=async function(routeId){
  const sel=$('rs_'+routeId); const catId=sel?sel.value:''; if(!catId){msg($('rtMsg'),'Pick a task to add as a step.',false);return}
  const t=catalog.find(c=>c.id===catId); if(!t)return
  const r=routesData.find(x=>x.id===routeId); const nextNo=(r&&r.steps.length?Math.max(...r.steps.map(s=>s.step_no)):0)+1
  const {error}=await sb.from('sim_route_steps').insert({route_id:routeId,step_no:nextNo,catalog_id:catId,task_name:t.name,yield_pct:100})
  if(error){msg($('rtMsg'),error.message,false);return}
  loadRoutes()
}
window.delRouteStep=async function(id){ await sb.from('sim_route_steps').delete().eq('id',id); loadRoutes() }
window.setStepYield=async function(id,val){ const y=(val===''||isNaN(Number(val)))?100:Number(val); await sb.from('sim_route_steps').update({yield_pct:y}).eq('id',id) }
window.moveRouteStep=async function(id,dir){
  let route=null, idx=-1
  routesData.forEach(r=>{const k=r.steps.findIndex(s=>s.id===id); if(k>=0){route=r;idx=k}})
  if(!route)return; const j=idx+dir; if(j<0||j>=route.steps.length)return
  const a=route.steps[idx], b=route.steps[j]
  await sb.from('sim_route_steps').update({step_no:b.step_no}).eq('id',a.id)
  await sb.from('sim_route_steps').update({step_no:a.step_no}).eq('id',b.id)
  loadRoutes()
}
/* explode a route into per-step INPUT quantities via yields, backward from finished qty */
function explodeRoute(route, finishedQty){
  const steps=(route.steps||[]).slice().sort((a,b)=>a.step_no-b.step_no)
  const n=steps.length; if(!n) return {steps:[], raw:null}
  const q=(finishedQty==null||isNaN(Number(finishedQty)))?null:Number(finishedQty)
  if(q==null){ return {steps:steps.map(s=>({catalog_id:s.catalog_id,task_name:s.task_name,step_no:s.step_no,qty:null})), raw:null} }
  const out=new Array(n), inp=new Array(n)
  out[n-1]=q
  for(let i=n-1;i>=0;i--){ const y=(Number(steps[i].yield_pct)||100)/100; inp[i]= y>0? out[i]/y : out[i]; if(i>0) out[i-1]=inp[i] }
  return {steps:steps.map((s,i)=>({catalog_id:s.catalog_id,task_name:s.task_name,step_no:s.step_no,qty:Math.round(inp[i])})), raw:Math.round(inp[0])}
}
