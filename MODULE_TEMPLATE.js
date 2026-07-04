/* MODULE TEMPLATE — copy to <feature>.js, rename the functions, and register a tab.
   The contract every feature module follows: load() -> render() -> (optional) subscribe().
   Rules: escape user text with esc(); build markup with ui.js helpers (pill, photoThumbs,
   meta); read/write data through db.js. This is the shape that makes a new module a
   copy-paste-and-fill job instead of a rewrite. */

let featData = [], featChannel = null

window.loadFeature = async function () {
  const { data } = await db.profiles()          // <- swap for the real db.* query
  featData = data || []
  renderFeature()
  subscribeFeature()
}

function renderFeature () {
  const box = $('featBody'); if (!box) return
  box.innerHTML = featData.map(x => `
    <div class="task-item">
      <div><b>${esc(x.full_name)}</b> ${pill('live', 'active')}</div>
    </div>`).join('')
}

function subscribeFeature () {
  if (featChannel) return
  featChannel = db.onChanges('feat-live', ['sim_profiles'], () => loadFeature())
}

/* To wire it up:
   1) Add <script src="feature.js"></script> in index.html (after ui.js/db.js, before boot.js).
   2) Add a tab in auth.js buildTabs():  tabs.push({ k:'feat', label:'Feature' })
   3) Route it in auth.js showTab():      if (which === 'feat') loadFeature()
   4) Add the panel markup:               <div id="featTab" class="hidden"><div id="featBody"></div></div>
*/
