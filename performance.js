/* PERFORMANCE: balanced scoring + team / person / task / daily / time-of-day views + printable review. */

let perfView='team', perfBaseLogs=[], perfPeriodLogs=[], perfNames={}, perfTaskMedian={}, perfWasteMedian={}, perfTaskLabels={}, perfData=[]
const MIN_TASK_LOGS=3, MIN_PERSON_LOGS=5
const W_THRU=0.40, W_QUAL=0.35, W_REL=0.25

function median(arr){const a=arr.filter(x=>x!=null&&!isNaN(x)).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function perHead(l){const uph=l.units_per_hour!=null?Number(l.units_per_hour):((l.units&&l.total_minutes)?Number(l.units)/(Number(l.total_minutes)/60):null);if(uph==null||isNaN(uph))return null;return uph/Math.max(1,Number(l.staff_count)||1)}
function taskKey(l){return l.catalog_id||('name:'+l.task_name)}
function wastePct(l){if(l.waste_kg==null||!l.units||Number(l.units)<=0)return null;return Number(l.waste_kg)/Number(l.units)}
function personKey(l){return l.user_id?('u:'+l.user_id):(l.staff_id?('s:'+l.staff_id):'u:unknown')}
const idxColor=v=>v==null?'':(v>=1.05?'vs-good':(v<0.95?'vs-bad':''))
function idxText(v){if(v==null)return '–';const pct=Math.round((v-1)*100);return v.toFixed(2)+'× ('+(pct>0?'+':'')+pct+'%)'}
function idxCell(v){return `<span class="${idxColor(v)}">${idxText(v)}</span>`}

window.initPerf=async function(){
  if(!$('pFrom').value){const t=new Date();const day=(t.getDay()+6)%7;const mon=new Date(t);mon.setDate(t.getDate()-day);$('pFrom').value=mon.toISOString().slice(0,10)}
  if(!$('pTo').value)$('pTo').value=new Date().toISOString().slice(0,10)
  await loadPerf()
}
window.setPerfView=function(v){
  perfView=v
  ;['team','person','task','daily','time'].forEach(k=>$('pv_'+k).classList.toggle('active',k===v))
  $('pPersonPick').classList.toggle('hidden',v!=='person')
  $('pTaskPick').classList.toggle('hidden',v!=='task')
  renderPerf()
}
window.loadPerf=async function(){
  if(!isManagerUp()) return
  const from=$('pFrom').value, to=$('pTo').value
  $('perfBody').innerHTML='<p class="muted">Crunching numbers…</p>'
  const baseFrom=new Date(Date.now()-180*864e5).toISOString().slice(0,10)
  const {data:logs,error}=await sb.from('sim_task_logs').select('*').gte('log_date',baseFrom).eq('status','completed')
  if(error){$('perfBody').innerHTML='<p class="muted">'+error.message+'</p>';return}
  const {data:profs}=await sb.from('sim_profiles').select('id,full_name,email')
  const {data:staffs}=await sb.from('sim_staff').select('id,full_name')
  perfNames={}
  ;(profs||[]).forEach(p=>perfNames['u:'+p.id]=p.full_name||p.email)
  ;(staffs||[]).forEach(s=>perfNames['s:'+s.id]=s.full_name)
  perfBaseLogs=(logs||[]).filter(l=>Number(l.total_minutes)>=0.5)
  perfPeriodLogs=perfBaseLogs.filter(l=>l.log_date>=from && l.log_date<=to)
  computeBaselines(); computePerf(); populatePerfPickers(); renderPerf()
}
function computeBaselines(){
  perfTaskMedian={}; perfWasteMedian={}; perfTaskLabels={}
  const byTask={}, byWaste={}
  perfBaseLogs.forEach(l=>{
    const k=taskKey(l); perfTaskLabels[k]=l.task_name
    const ph=perHead(l); if(ph!=null)(byTask[k]=byTask[k]||[]).push(ph)
    const wp=wastePct(l); if(wp!=null)(byWaste[k]=byWaste[k]||[]).push(wp)
  })
  Object.keys(byTask).forEach(k=>perfTaskMedian[k]=median(byTask[k]))
  Object.keys(byWaste).forEach(k=>perfWasteMedian[k]=median(byWaste[k]))
}
function computePerf(){
  const people={}
  perfPeriodLogs.forEach(l=>{const pk=personKey(l);(people[pk]=people[pk]||[]).push(l)})
  const rows=[]
  Object.keys(people).forEach(pk=>{
    const logs=people[pk]
    const tasks={}; logs.forEach(l=>{const tk=taskKey(l);(tasks[tk]=tasks[tk]||[]).push(l)})
    let hours=0, kg=0, wasteKg=0
    logs.forEach(l=>{hours+=(Number(l.total_minutes)||0)/60; kg+=Number(l.units)||0; wasteKg+=Number(l.waste_kg)||0})
    let twSum=0, tw=0; const taskBreak=[]
    Object.keys(tasks).forEach(tk=>{
      const tl=tasks[tk]
      const idxs=tl.map(l=>{const ph=perHead(l);const base=perfTaskMedian[tk];return (ph!=null&&base)?ph/base:null}).filter(x=>x!=null)
      const med=median(idxs)
      const th=tl.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)
      if(med!=null){twSum+=med*th; tw+=th}
      taskBreak.push({task:tl[0].task_name,n:tl.length,index:med,hours:th,enough:idxs.length>=MIN_TASK_LOGS,rate:median(tl.map(perHead)),wastePct:median(tl.map(wastePct))})
    })
    taskBreak.sort((a,b)=>b.hours-a.hours)
    const thru=tw>0?twSum/tw:null
    let qSum=0,qN=0
    logs.forEach(l=>{const wp=wastePct(l);const base=perfWasteMedian[taskKey(l)];if(wp!=null&&base!=null){const qi=base>0?(wp>0?base/wp:1.5):1.0;qSum+=Math.min(1.5,qi);qN++}})
    const qual=qN>0?qSum/qN:null
    rows.push({pk,name:perfNames[pk]||'Unknown',hours,kg,wasteKg,n:logs.length,thru,qual,taskBreak,wastePctOverall:kg>0?wasteKg/kg:null})
  })
  const medHours=median(rows.map(r=>r.hours))||1
  rows.forEach(r=>{ r.rel=Math.max(0.5,Math.min(1.5, medHours>0? r.hours/medHours : 1)) })
  rows.forEach(r=>{
    const t=r.thru!=null?r.thru:1.0, q=r.qual!=null?r.qual:1.0, rel=r.rel!=null?r.rel:1.0
    r.composite=W_THRU*t+W_QUAL*q+W_REL*rel
    r.enough=r.n>=MIN_PERSON_LOGS
  })
  rows.sort((a,b)=>(b.enough-a.enough)||(b.composite-a.composite))
  rows.forEach((r,i)=>r.rank=i+1)
  perfData=rows
}
function populatePerfPickers(){
  const ps=$('pPerson'); const curP=ps.value
  ps.innerHTML=perfData.map(r=>`<option value="${r.pk}">${r.name}</option>`).join('')
  if(curP&&perfData.some(r=>r.pk===curP))ps.value=curP
  const taskKeys=[...new Set(perfPeriodLogs.map(taskKey))]
  const ts=$('pTask'); const curT=ts.value
  ts.innerHTML=taskKeys.map(k=>`<option value="${k}">${perfTaskLabels[k]||k}</option>`).join('')
  if(curT&&taskKeys.includes(curT))ts.value=curT
}
function renderPerf(){
  if(perfView==='person') return renderPerfPerson()
  if(perfView==='task') return renderPerfTask()
  if(perfView==='daily') return renderPerfDaily()
  if(perfView==='time') return renderPerfTime()
  return renderPerfTeam()
}
function perfRangeLabel(){return $('pFrom').value+' → '+$('pTo').value}
function renderPerfTeam(){
  const box=$('perfBody')
  if(!perfData.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const totKg=perfData.reduce((s,r)=>s+r.kg,0), totHours=perfData.reduce((s,r)=>s+r.hours,0), totWaste=perfData.reduce((s,r)=>s+r.wasteKg,0), totN=perfData.reduce((s,r)=>s+r.n,0)
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<h2>Team · ${perfRangeLabel()}</h2>
    <div class="stat-grid"><div class="stat"><div class="n">${totN}</div><div class="l">Tasks</div></div><div class="stat"><div class="n">${Math.round(totKg)}</div><div class="l">Kg (line total)</div></div><div class="stat"><div class="n">${totHours.toFixed(1)}</div><div class="l">Hours</div></div></div>
    <p class="muted">Waste: ${totWaste.toFixed(1)} kg (${totKg>0?(100*totWaste/totKg).toFixed(1):'0'}% of output). Ranked by balanced score (40% speed · 35% waste/quality · 25% reliability). 1.00× = team average for that job.</p>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>#</th><th ${th}>Name</th><th ${th}>Overall</th><th ${th}>Speed</th><th ${th}>Quality</th><th ${th}>Reliability</th><th ${th}>Hours</th><th ${th}>Tasks</th></tr></thead><tbody>`
  perfData.forEach(r=>{
    const dim=r.enough?'':'opacity:.55'
    const flag=r.enough?'':' <span class="pill off">needs data</span>'
    html+=`<tr style="${dim}"><td ${td}>${r.rank}</td><td ${td}><a class="link" onclick="openPerson('${r.pk}')">${r.name}</a>${flag}</td><td ${td}><b>${idxText(r.composite)}</b></td><td ${td}>${idxCell(r.thru)}</td><td ${td}>${r.qual==null?'<span class="muted">n/a</span>':idxCell(r.qual)}</td><td ${td}>${idxCell(r.rel)}</td><td ${td}>${r.hours.toFixed(1)}</td><td ${td}>${r.n}</td></tr>`
  })
  html+='</tbody></table></div><p class="muted" style="margin-top:10px">"Quality" = waste vs the team norm for each job (higher is less waste); n/a means that person\'s jobs don\'t track waste. "needs data" = fewer than '+MIN_PERSON_LOGS+' logged tasks, so the score isn\'t reliable yet.</p>'
  box.innerHTML=html
}
window.openPerson=function(pk){ $('pPerson').value=pk; setPerfView('person') }
function renderPerfPerson(){
  const box=$('perfBody')
  if(!perfData.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const pk=$('pPerson').value||perfData[0].pk
  const r=perfData.find(x=>x.pk===pk); if(!r){box.innerHTML='<p class="muted">No data for this person in range.</p>';return}
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">${r.name}</h2><button class="ghost sm" onclick="printReview()">🖨 Print review sheet</button></div>
    <p class="muted">${perfRangeLabel()} · rank #${r.rank} of ${perfData.length}${r.enough?'':' · ⚠ limited data'}</p>
    <div class="stat-grid"><div class="stat"><div class="n ${idxColor(r.composite)}">${r.composite.toFixed(2)}×</div><div class="l">Overall</div></div><div class="stat"><div class="n ${idxColor(r.thru)}">${r.thru==null?'–':r.thru.toFixed(2)+'×'}</div><div class="l">Speed</div></div><div class="stat"><div class="n ${idxColor(r.qual)}">${r.qual==null?'n/a':r.qual.toFixed(2)+'×'}</div><div class="l">Quality</div></div></div>
    <p class="muted">${r.n} tasks · ${r.hours.toFixed(1)} hours · ${Math.round(r.kg)} kg · ${r.wasteKg.toFixed(1)} kg waste${r.wastePctOverall!=null?' ('+(100*r.wastePctOverall).toFixed(1)+'%)':''} · reliability ${r.rel.toFixed(2)}×</p>
    <h2 style="margin-top:18px">By task</h2><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>Task</th><th ${th}>Logs</th><th ${th}>Rate /head</th><th ${th}>vs team</th><th ${th}>Waste</th><th ${th}>Hours</th></tr></thead><tbody>`
  r.taskBreak.forEach(t=>{
    const flag=t.enough?'':' <span class="pill off">low n</span>'
    html+=`<tr><td ${td}>${t.task}${flag}</td><td ${td}>${t.n}</td><td ${td}>${t.rate!=null?t.rate.toFixed(1)+' kg/hr':'–'}</td><td ${td}>${idxCell(t.index)}</td><td ${td}>${t.wastePct!=null?(100*t.wastePct).toFixed(1)+'%':'–'}</td><td ${td}>${t.hours.toFixed(1)}</td></tr>`
  })
  html+='</tbody></table></div>'
  box.innerHTML=html
}
function renderPerfTask(){
  const box=$('perfBody')
  const tk=$('pTask').value
  if(!tk){box.innerHTML='<p class="muted">No tasks in this range.</p>';return}
  const label=perfTaskLabels[tk]||tk, base=perfTaskMedian[tk]
  const byPerson={}
  perfPeriodLogs.filter(l=>taskKey(l)===tk).forEach(l=>{const pk=personKey(l);(byPerson[pk]=byPerson[pk]||[]).push(l)})
  const rows=Object.keys(byPerson).map(pk=>{
    const logs=byPerson[pk]
    const rate=median(logs.map(perHead))
    const idx=(rate!=null&&base)?rate/base:null
    return {name:perfNames[pk]||'Unknown',n:logs.length,rate,idx,wastePct:median(logs.map(wastePct)),hours:logs.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)}
  }).sort((a,b)=>(b.idx==null?-1:b.idx)-(a.idx==null?-1:a.idx))
  const th='style="text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap"'
  const td='style="padding:8px;border-bottom:1px solid var(--line);white-space:nowrap"'
  let html=`<h2>${label} · ${perfRangeLabel()}</h2><p class="muted">Team median: ${base!=null?base.toFixed(1)+' kg/hr per head':'–'}. Per-person rate splits team jobs by headcount.</p>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    <th ${th}>#</th><th ${th}>Name</th><th ${th}>Logs</th><th ${th}>Rate /head</th><th ${th}>vs team</th><th ${th}>Waste</th><th ${th}>Hours</th></tr></thead><tbody>`
  rows.forEach((r,i)=>{html+=`<tr><td ${td}>${i+1}</td><td ${td}>${r.name}</td><td ${td}>${r.n}</td><td ${td}>${r.rate!=null?r.rate.toFixed(1)+' kg/hr':'–'}</td><td ${td}>${idxCell(r.idx)}</td><td ${td}>${r.wastePct!=null?(100*r.wastePct).toFixed(1)+'%':'–'}</td><td ${td}>${r.hours.toFixed(1)}</td></tr>`})
  html+='</tbody></table></div>'
  box.innerHTML=html
}
function renderPerfDaily(){
  const box=$('perfBody')
  if(!perfPeriodLogs.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const byDay={}
  perfPeriodLogs.forEach(l=>{(byDay[l.log_date]=byDay[l.log_date]||[]).push(l)})
  const days=Object.keys(byDay).sort().reverse()
  const grandKg=perfPeriodLogs.reduce((s,l)=>s+(Number(l.units)||0),0)
  let html=`<h2>Daily totals · ${perfRangeLabel()}</h2><p class="muted">Total kilograms prepped each day, broken down by task. ${days.length} day${days.length===1?'':'s'} · ${Math.round(grandKg)} kg overall.</p>`
  const td='style="padding:6px 8px;border-bottom:1px solid var(--line)"'
  days.forEach(d=>{
    const logs=byDay[d]
    const dayKg=logs.reduce((s,l)=>s+(Number(l.units)||0),0)
    const dayHours=logs.reduce((s,l)=>s+(Number(l.total_minutes)||0)/60,0)
    const dayWaste=logs.reduce((s,l)=>s+(Number(l.waste_kg)||0),0)
    const byTask={}
    logs.forEach(l=>{const k=l.task_name;(byTask[k]=byTask[k]||{kg:0,n:0});byTask[k].kg+=Number(l.units)||0;byTask[k].n++})
    const rows=Object.keys(byTask).sort((a,b)=>byTask[b].kg-byTask[a].kg)
    html+=`<div class="card" style="background:var(--panel2);margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
        <b style="font-size:16px">${d}</b>
        <span><b style="font-size:22px;color:var(--accent)">${Math.round(dayKg)} kg</b> <span class="muted">· ${logs.length} tasks · ${dayHours.toFixed(1)} h${dayWaste?' · '+dayWaste.toFixed(1)+' kg waste':''}</span></span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px"><tbody>`
    rows.forEach(t=>{html+=`<tr><td ${td}>${t}</td><td ${td} style="text-align:right;font-weight:700">${Math.round(byTask[t].kg)} kg</td><td ${td} style="text-align:right;color:var(--muted);width:48px">${byTask[t].n}×</td></tr>`})
    html+=`</tbody></table></div>`
  })
  box.innerHTML=html
}
function renderPerfTime(){
  const box=$('perfBody')
  if(!perfPeriodLogs.length){box.innerHTML='<p class="muted">No completed tasks in this range.</p>';return}
  const buckets={}
  perfPeriodLogs.forEach(l=>{
    const t=l.finish_time||l.start_time; if(!t)return
    const h=new Date(t).getHours()
    const b=buckets[h]=buckets[h]||{kg:0,n:0,idxSum:0,idxN:0}
    b.kg+=Number(l.units)||0; b.n++
    const ph=perHead(l), base=perfTaskMedian[taskKey(l)]
    if(ph!=null&&base){b.idxSum+=ph/base; b.idxN++}
  })
  const hours=Object.keys(buckets).map(Number).sort((a,b)=>a-b)
  const maxKg=Math.max(1,...hours.map(h=>buckets[h].kg))
  let mS=0,mN=0,aS=0,aN=0
  hours.forEach(h=>{const b=buckets[h];if(b.idxN){if(h<12){mS+=b.idxSum;mN+=b.idxN}else{aS+=b.idxSum;aN+=b.idxN}}})
  const mAvg=mN?mS/mN:null, aAvg=aN?aS/aN:null
  let trend=''
  if(mAvg!=null&&aAvg!=null){
    const dir=aAvg>mAvg+0.03?'speeds up':(aAvg<mAvg-0.03?'slows down':'holds steady')
    trend=` Pace ${dir} over the day — morning ${mAvg.toFixed(2)}× vs afternoon ${aAvg.toFixed(2)}×.`
  }
  let html=`<h2>Through the day · ${perfRangeLabel()}</h2><p class="muted">Output (bar) and pace by hour of day, across the selected range. Pace = per-head rate vs each task's team norm; 1.00× = normal.${trend}</p><div style="margin-top:6px">`
  hours.forEach(h=>{
    const b=buckets[h]
    const pace=b.idxN?b.idxSum/b.idxN:null
    const w=Math.round(b.kg/maxKg*100)
    html+=`<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span><b>${String(h).padStart(2,'0')}:00</b> <span class="muted">${b.n} task${b.n===1?'':'s'}</span></span><span>${Math.round(b.kg)} kg · pace <span class="${idxColor(pace)}">${pace==null?'–':pace.toFixed(2)+'×'}</span></span></div>
      <div style="height:10px;background:var(--panel2);border-radius:6px;margin-top:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:var(--accent)"></div></div>
    </div>`
  })
  html+='</div><p class="muted" style="margin-top:6px">Hours combine every day in the range, so a wider range shows the typical daily shape. For one day, set From and To to the same date.</p>'
  box.innerHTML=html
}
window.printReview=function(){
  const pk=$('pPerson').value||(perfData[0]&&perfData[0].pk); if(!pk)return
  const r=perfData.find(x=>x.pk===pk); if(!r)return
  const cell='style="padding:6px 10px;border-bottom:1px solid #ccc;text-align:left"'
  const head='style="padding:6px 10px;border-bottom:2px solid #333;text-align:left"'
  let rowsHtml=''
  r.taskBreak.forEach(t=>{rowsHtml+=`<tr><td ${cell}>${t.task}${t.enough?'':' (low data)'}</td><td ${cell}>${t.n}</td><td ${cell}>${t.rate!=null?t.rate.toFixed(1)+' kg/hr':'–'}</td><td ${cell}>${t.index!=null?t.index.toFixed(2)+'×':'–'}</td><td ${cell}>${t.wastePct!=null?(100*t.wastePct).toFixed(1)+'%':'–'}</td><td ${cell}>${t.hours.toFixed(1)}</td></tr>`})
  $('printArea').innerHTML=`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:0 auto;padding:24px">
      <div style="display:flex;justify-content:space-between;border-bottom:3px solid #f97316;padding-bottom:10px;margin-bottom:16px">
        <div><div style="font-size:22px;font-weight:800">Performance Review</div><div style="color:#555">Willa Ltd · Chefly</div></div>
        <div style="text-align:right;color:#555;font-size:13px">Period: ${perfRangeLabel()}<br>Generated: ${new Date().toLocaleDateString()}</div>
      </div>
      <div style="font-size:18px;font-weight:700;margin-bottom:4px">${r.name}</div>
      <div style="color:#555;margin-bottom:16px">Rank #${r.rank} of ${perfData.length}${r.enough?'':' — limited data, treat as indicative only'}</div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
        <tr><td ${head}>Overall score</td><td ${head}>Speed</td><td ${head}>Quality (waste)</td><td ${head}>Reliability</td></tr>
        <tr><td ${cell}><b>${r.composite.toFixed(2)}×</b></td><td ${cell}>${r.thru==null?'–':r.thru.toFixed(2)+'×'}</td><td ${cell}>${r.qual==null?'n/a':r.qual.toFixed(2)+'×'}</td><td ${cell}>${r.rel.toFixed(2)}×</td></tr>
      </table>
      <div style="color:#555;margin-bottom:6px">1.00× = team average for the same job. ${r.n} tasks · ${r.hours.toFixed(1)} hours · ${Math.round(r.kg)} kg produced · ${r.wasteKg.toFixed(1)} kg waste${r.wastePctOverall!=null?' ('+(100*r.wastePctOverall).toFixed(1)+'%)':''}.</div>
      <div style="font-weight:700;margin:16px 0 6px">By task</div>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr><td ${head}>Task</td><td ${head}>Logs</td><td ${head}>Rate /head</td><td ${head}>vs team</td><td ${head}>Waste</td><td ${head}>Hours</td></tr>
        ${rowsHtml}
      </table>
      <div style="margin-top:24px;color:#555;font-size:13px">Scores compare this person to the team's own median on each task, so different jobs are judged fairly. Speed on shared jobs is split by headcount. Use alongside context (changeovers, training, role) — not in isolation.</div>
      <div style="margin-top:28px;border-top:1px solid #ccc;padding-top:14px">
        <div style="margin-bottom:18px">Manager notes:</div>
        <div style="border-bottom:1px solid #999;height:22px;margin-bottom:14px"></div>
        <div style="border-bottom:1px solid #999;height:22px;margin-bottom:14px"></div>
        <div style="display:flex;justify-content:space-between;margin-top:24px"><div>Reviewer: __________________</div><div>Employee: __________________</div><div>Date: __________</div></div>
      </div>
    </div>`
  window.print()
}
