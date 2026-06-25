/* BOOT: runs last, after every other script has defined its functions.
   Decides the first screen and resumes an existing session. */

;(async()=>{
  try{ const {data:needs}=await sb.rpc('sim_needs_bootstrap'); if(needs){ setAuthView('bootstrap') } else { setAuthView('login') } }
  catch(e){ setAuthView('login') }
  const {data}=await sb.auth.getSession()
  if(data.session){ me=data.session.user; await afterAuth() }
})()
sb.auth.onAuthStateChange((event)=>{ if(event==='SIGNED_OUT'){ me=null } })
