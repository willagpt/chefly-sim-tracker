/* DEVHUB: Menu R&D Hub (Phase 1, internal only). One recipe, iterated as
   versions, ingredient lines costed live against the existing `ingredients`
   table (the priced/costed one used by order planning -- NOT sim_ingredients,
   which is just the goods-in/traceability list and carries no price).
   See docs/menu-rd-hub-prd.md for the full plan. Phase 2 (Nutritics API) and
   Phase 3 (client board) are not built yet -- nutrition is a manual paste-in
   field for now, and there is no external sharing link yet. */

let devRecipes = [], devIngredientCatalog = [], devOpenRecipe = null, devOpenVersion = null, devVersionLines = [], devOpenVersions = []

const DEV_STEPS = ['draft', 'sent_for_tasting', 'client_feedback', 'approved_locked']
const DEV_STEP_LABEL = { draft: 'Draft', sent_for_tasting: 'Sent for tasting', client_feedback: 'Client feedback', approved_locked: 'Approved & locked' }

window.loadDevHub = async function () {
  const box = $('devRecipeList'); if (box) box.innerHTML = '<p class="muted">Loading…</p>'
  const [{ data: recipes, error }, { data: ing }, { data: costs }] = await Promise.all([
    sb.from('sim_dev_recipes').select('*, sim_dev_recipe_versions!sim_dev_recipes_current_version_fk(id,version_no,status)')
      .order('updated_at', { ascending: false }),
    sb.from('ingredients').select('id,name,uom,price_per_unit').eq('is_active', true).order('name'),
    sb.from('sim_dev_recipe_version_costs').select('*')
  ])
  devIngredientCatalog = ing || []
  const dl = $('devIngList')
  if (dl) dl.innerHTML = devIngredientCatalog.map(i => `<option value="${esc(i.name)}">`).join('')
  if (error) { if (box) box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; return }
  const costByVersion = new Map((costs || []).map(c => [c.version_id, c]))
  devRecipes = (recipes || []).map(r => ({ ...r, _cost: r.sim_dev_recipe_versions ? costByVersion.get(r.sim_dev_recipe_versions.id) : null }))
  renderDevRecipeList()
  if (devOpenRecipe) openDevRecipe(devOpenRecipe.id)
}

function renderDevRecipeList () {
  const box = $('devRecipeList'); if (!box) return
  if (!devRecipes.length) {
    box.innerHTML = '<div class="dev-empty"><div class="emoji">🧑‍🍳</div><b>Nothing in development yet</b><p class="muted" style="margin:6px 0 0">Start your first dish above — cost updates live as you add ingredients.</p></div>'
    return
  }
  box.innerHTML = `<div class="dev-recipe-grid">${devRecipes.map(r => {
    const cur = r.sim_dev_recipe_versions
    const statusPill = cur ? pill(cur.status === 'approved_locked' ? 'done' : (cur.status === 'draft' ? '' : 'live'), DEV_STEP_LABEL[cur.status]) : ''
    const cost = r._cost ? `£${Number(r._cost.total_cost).toFixed(2)}` : '—'
    return `<div class="dev-recipe-card" onclick="openDevRecipe('${r.id}')">
      <div class="name">${esc(r.name)}</div>
      ${r.client_name ? `<div class="client">${esc(r.client_name)}</div>` : '<div class="muted" style="font-size:13px">Internal</div>'}
      <div class="row2">
        <span>${cur ? 'v' + cur.version_no + ' ' : 'no versions '}${statusPill}</span>
        <span class="cost">${cost}</span>
      </div>
    </div>`
  }).join('')}</div>`
}

window.createDevRecipe = async function () {
  const name = $('devNewName').value.trim(), client = $('devNewClient').value.trim(), notes = $('devNewNotes').value.trim()
  if (!name) { msg($('devNewMsg'), 'Enter a dish name.', false); return }
  const { data, error } = await sb.from('sim_dev_recipes').insert({ name, client_name: client || null, notes: notes || null }).select().single()
  if (error) { msg($('devNewMsg'), error.message, false); return }
  const { error: vErr } = await sb.rpc('sim_dev_add_version', { p_recipe_id: data.id, p_notes: 'Initial draft' })
  if (vErr) { msg($('devNewMsg'), 'Recipe created but first version failed: ' + vErr.message, false); return }
  $('devNewName').value = ''; $('devNewClient').value = ''; $('devNewNotes').value = ''
  msg($('devNewMsg'), 'Started "' + name + '".', true)
  await loadDevHub(); openDevRecipe(data.id)
}

window.openDevRecipe = async function (id) {
  const { data: recipe, error } = await sb.from('sim_dev_recipes').select('*').eq('id', id).single()
  if (error) { alert(error.message); return }
  devOpenRecipe = recipe
  const { data: versions } = await sb.from('sim_dev_recipe_versions').select('*').eq('recipe_id', id).order('version_no', { ascending: false })
  const versionId = (versions && versions[0] && versions[0].id) || null
  await renderDevDetail(recipe, versions || [], versionId)
  $('devDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

window.switchDevVersion = function (versionId) {
  renderDevDetail(devOpenRecipe, devOpenVersions, versionId)
}

function devStepper (status) {
  const curIdx = DEV_STEPS.indexOf(status)
  return `<div class="dev-stepper">${DEV_STEPS.map((s, i) => {
    let cls = ''
    if (s === 'approved_locked' && status === 'approved_locked') cls = 'locked'
    else if (i < curIdx) cls = 'past'
    else if (i === curIdx) cls = 'active'
    return `<div class="step ${cls}">${DEV_STEP_LABEL[s]}</div>`
  }).join('')}</div>`
}

async function renderDevDetail (recipe, versions, versionId) {
  const box = $('devDetail'); if (!box) return
  devOpenVersions = versions
  devOpenVersion = versions.find(v => v.id === versionId) || null
  let cost = null, lines = []
  if (versionId) {
    const [{ data: costRow }, { data: ingLines }] = await Promise.all([
      sb.from('sim_dev_recipe_version_costs').select('*').eq('version_id', versionId).maybeSingle(),
      sb.from('sim_dev_recipe_ingredients').select('*').eq('version_id', versionId).order('sort_order')
    ])
    cost = costRow
    lines = ingLines || []
  }
  devVersionLines = lines
  const locked = devOpenVersion && devOpenVersion.status === 'approved_locked'
  const totalCost = cost ? Number(cost.total_cost) : 0
  const missing = cost ? cost.lines_missing_price : 0

  const versionTabs = versions.map(v => `<span class="dev-vtab ${v.id === versionId ? 'active' : ''} ${v.status === 'approved_locked' && v.id !== versionId ? 'locked-v' : ''}" onclick="switchDevVersion('${v.id}')">v${v.version_no}</span>`).join('')

  const ingredientRows = lines.map(l => {
    const ing = devIngredientCatalog.find(i => i.id === l.ingredient_id)
    const lineCost = ing && ing.price_per_unit != null ? (l.qty * ing.price_per_unit) : null
    const pct = lineCost != null && totalCost > 0 ? Math.max(2, Math.round(lineCost / totalCost * 100)) : 0
    return `<div class="dev-ing-line">
      <div class="top">
        <div><b>${esc(ing ? ing.name : 'Unknown ingredient')}</b> <span class="muted">${l.qty} ${esc(l.uom || (ing && ing.uom) || '')}</span></div>
        <div class="amt">${lineCost != null ? '£' + lineCost.toFixed(2) : '<span style="color:#fca5a5">no price</span>'} ${locked ? '' : `<a class="link" onclick="removeDevIngredientLine('${l.id}')">✕</a>`}</div>
      </div>
      ${lineCost != null ? `<div class="dev-ing-bar"><span style="width:${pct}%"></span></div>` : ''}
    </div>`
  }).join('') || '<p class="muted">No ingredients added to this version yet.</p>'

  box.innerHTML = `
    <div class="card">
      <h2>${esc(recipe.name)} ${recipe.client_name ? `<span class="client" style="font-size:14px;margin-left:6px">${esc(recipe.client_name)}</span>` : ''}</h2>
      <div class="dev-version-tabs">${versionTabs}</div>
      ${devOpenVersion ? devStepper(devOpenVersion.status) : ''}
      ${locked ? `<div class="dev-locked-banner">🔒 Locked ${devOpenVersion.locked_at ? new Date(devOpenVersion.locked_at).toLocaleDateString('en-GB') : ''} &mdash; this version is frozen. Start a new version to keep editing.</div>` : ''}

      <div class="dev-kpis">
        <div class="dev-kpi"><div class="v">£${totalCost.toFixed(2)}</div><div class="l">Cost this version</div></div>
        <div class="dev-kpi"><div class="v">${lines.length}</div><div class="l">Ingredients</div></div>
        <div class="dev-kpi"><div class="v">${devOpenVersion && devOpenVersion.nutrition_source !== 'pending' ? '✓' : '—'}</div><div class="l">Nutrition added</div></div>
      </div>
      ${missing ? `<p class="msg show err">${missing} ingredient line${missing === 1 ? '' : 's'} have no price on file &mdash; cost above is understated.</p>` : ''}

      <h3 style="margin-top:4px">Ingredients</h3>
      ${locked ? '' : `
        <div class="row">
          <div><label for="devIngPick">Ingredient</label><input id="devIngPick" list="devIngList" placeholder="start typing an ingredient…" /></div>
          <div><label for="devIngQty">Quantity (in the ingredient's own unit)</label><input id="devIngQty" type="number" inputmode="decimal" placeholder="e.g. 0.12" /></div>
        </div>
        <button class="ghost sm" onclick="addDevIngredientLine()">Add ingredient</button>
        <div id="devIngMsg" class="msg"></div>
      `}
      <div style="margin-top:10px">${ingredientRows}</div>

      <h3 style="margin-top:18px">Nutrition <span class="muted" style="font-weight:400;font-size:12px">(manual for now — Nutritics API is Phase 2)</span></h3>
      ${locked ? '' : `
        <label for="devNutritionPaste">Paste the Nutritics summary or key values here</label>
        <textarea id="devNutritionPaste" rows="3" placeholder="e.g. Energy 480kcal, Protein 32g, Carbs 45g, Fat 18g, Salt 1.2g...">${devOpenVersion && devOpenVersion.nutrition_json ? esc(devOpenVersion.nutrition_json.raw || '') : ''}</textarea>
        <button class="ghost sm" onclick="saveDevNutrition()">Save nutrition</button>
      `}

      <h3 style="margin-top:18px">Status</h3>
      <div class="row">
        ${!locked ? `<div>
          <select id="devStatusSel">
            <option value="draft" ${devOpenVersion && devOpenVersion.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="sent_for_tasting" ${devOpenVersion && devOpenVersion.status === 'sent_for_tasting' ? 'selected' : ''}>Sent for tasting</option>
            <option value="client_feedback" ${devOpenVersion && devOpenVersion.status === 'client_feedback' ? 'selected' : ''}>Client feedback</option>
          </select>
          <button class="ghost sm" onclick="setDevVersionStatus()">Update status</button>
        </div>
        <div><button class="green" onclick="lockDevVersion()">Approve &amp; lock this version</button></div>` : ''}
      </div>

      <h3 style="margin-top:18px">Iterate</h3>
      <p class="muted" style="margin-top:-8px">Client asked for changes? Start a new version &mdash; this one stays exactly as it was.</p>
      <button class="ghost" onclick="addDevVersion()">Start new version</button>
    </div>
  `
}

window.addDevIngredientLine = async function () {
  const name = $('devIngPick').value.trim(), qty = parseFloat($('devIngQty').value)
  if (!devOpenVersion) return
  const ing = devIngredientCatalog.find(i => i.name.toLowerCase() === name.toLowerCase())
  if (!ing) { msg($('devIngMsg'), 'Pick an ingredient from the list (start typing to search).', false); return }
  if (!qty || qty <= 0) { msg($('devIngMsg'), 'Enter a quantity greater than 0.', false); return }
  const { error } = await sb.from('sim_dev_recipe_ingredients').insert({
    version_id: devOpenVersion.id, ingredient_id: ing.id, qty, uom: ing.uom,
    sort_order: devVersionLines.length
  })
  if (error) { msg($('devIngMsg'), error.message, false); return }
  $('devIngPick').value = ''; $('devIngQty').value = ''
  openDevRecipe(devOpenRecipe.id)
}

window.removeDevIngredientLine = async function (lineId) {
  const { error } = await sb.from('sim_dev_recipe_ingredients').delete().eq('id', lineId)
  if (error) { alert(error.message); return }
  openDevRecipe(devOpenRecipe.id)
}

window.saveDevNutrition = async function () {
  const raw = $('devNutritionPaste').value.trim()
  const { error } = await sb.from('sim_dev_recipe_versions')
    .update({ nutrition_json: { raw }, nutrition_source: raw ? 'manual' : 'pending' })
    .eq('id', devOpenVersion.id)
  if (error) { alert(error.message); return }
  openDevRecipe(devOpenRecipe.id)
}

window.setDevVersionStatus = async function () {
  const status = $('devStatusSel').value
  const { error } = await sb.rpc('sim_dev_set_version_status', { p_version_id: devOpenVersion.id, p_status: status })
  if (error) { alert(error.message); return }
  await loadDevHub(); openDevRecipe(devOpenRecipe.id)
}

window.lockDevVersion = async function () {
  if (!confirm('Approve and lock v' + devOpenVersion.version_no + '? It will be frozen — start a new version for any further changes.')) return
  const { error } = await sb.rpc('sim_dev_lock_version', { p_version_id: devOpenVersion.id })
  if (error) { alert(error.message); return }
  await loadDevHub(); openDevRecipe(devOpenRecipe.id)
}

window.addDevVersion = async function () {
  const notes = prompt('What changed in this new version? (e.g. "less spice, more carbs per client feedback")') || ''
  const { error } = await sb.rpc('sim_dev_add_version', { p_recipe_id: devOpenRecipe.id, p_notes: notes })
  if (error) { alert(error.message); return }
  await loadDevHub(); openDevRecipe(devOpenRecipe.id)
}
