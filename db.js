/* DB: thin data-access layer. Wrap Supabase table queries in named functions so a
   schema change touches ONE file, not every module. Adopt incrementally — as you edit
   a module, replace inline sb.from(...) calls with the db.* equivalent.
   Loaded after core.js, so it uses the global `sb` client. */

const db = {
  // ---- catalog / products ----
  catalog:        () => sb.from('sim_task_catalog').select('*').eq('active',true).order('sort_order'),
  products:       () => sb.from('sim_products').select('*').eq('active',true).order('sort_order').order('name'),
  addProduct:     (name, sort_order) => sb.from('sim_products').insert({ name, sort_order }).select().single(),

  // ---- task logs ----
  myActiveLogs:   (userId)  => sb.from('sim_task_logs').select('*').eq('user_id', userId).in('status',['in_progress','paused']).order('start_time',{ascending:false}),
  staffActiveLogs:(staffId) => sb.from('sim_task_logs').select('*').eq('staff_id', staffId).in('status',['in_progress','paused']).order('start_time',{ascending:false}),
  todayLogs:      (date)    => sb.from('sim_task_logs').select('*').eq('log_date', date).order('start_time',{ascending:false}),
  logsBetween:    (from,to) => sb.from('sim_task_logs').select('*').gte('log_date',from).lte('log_date',to).eq('status','completed').order('finish_time',{ascending:false}),
  insertLog:      (row)       => sb.from('sim_task_logs').insert(row).select().single(),
  updateLog:      (id, patch) => sb.from('sim_task_logs').update(patch).eq('id', id),
  deleteLog:      (id)        => sb.from('sim_task_logs').delete().eq('id', id),

  // ---- people ----
  profiles: () => sb.from('sim_profiles').select('id,full_name,email'),
  staff:    () => sb.from('sim_staff').select('id,full_name'),

  // ---- packing ----
  packRuns: (shiftId) => sb.from('sim_pack_runs').select('*').eq('shift_id', shiftId).order('sort_order'),

  // ---- units (batch/unit traceability) ----
  unitByCode:      (code) => sb.from('sim_units').select('*').eq('code', code.trim()).maybeSingle(),
  unitsByCodes:    (codes) => sb.from('sim_units').select('*').in('code', codes),
  unitsByIds:      (ids) => sb.from('sim_units').select('*').in('id', ids),
  createUnit:      (row) => sb.from('sim_units').insert(row).select().single(),
  createUnits:     (rows) => sb.from('sim_units').insert(rows).select(),
  updateUnit:      (id, patch) => sb.from('sim_units').update(patch).eq('id', id),
  recentUnits:     (limit) => sb.from('sim_units').select('*').order('created_at',{ascending:false}).limit(limit||40),

  addGenealogy:    (rows) => sb.from('sim_unit_genealogy').insert(rows).select(),
  genealogyParentsOf: (unitId) => sb.from('sim_unit_genealogy').select('*').eq('child_unit_id', unitId),
  genealogyChildrenOf:(unitId) => sb.from('sim_unit_genealogy').select('*').eq('parent_unit_id', unitId),

  addRunMembers:   (rows) => sb.from('sim_unit_log_members').insert(rows).select(),
  runMembersOfUnit:(unitId) => sb.from('sim_unit_log_members').select('*, sim_task_logs(*)').eq('unit_id', unitId).order('added_at',{ascending:false}),
  runMembersOfLog: (logId) => sb.from('sim_unit_log_members').select('*, sim_units(*)').eq('log_id', logId).order('added_at',{ascending:false}),
  activeBatchLogs: () => sb.from('sim_task_logs').select('*').eq('is_batch', true).in('status',['in_progress','paused']).order('start_time',{ascending:false}),
  ccpChecksForLogs:(logIds) => sb.from('sim_ccp_checks').select('*').in('log_id', logIds).order('checked_at',{ascending:false}),

  // ---- realtime: one callback for a set of tables ----
  onChanges: (channelName, tables, cb) => {
    let ch = sb.channel(channelName)
    tables.forEach(t => { ch = ch.on('postgres_changes', { event:'*', schema:'public', table:t }, cb) })
    return ch.subscribe()
  }
}
