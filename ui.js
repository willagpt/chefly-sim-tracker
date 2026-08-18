/* UI: shared render helpers used by every feature module.
   Loaded right after core.js, so all feature scripts (tasks, packing, manage, ...) can call these.

   THE IMPORTANT ONE IS esc(): always wrap any user-entered text
   (comments, notes, product names, dish names, people's names) before
   putting it inside a template literal that becomes innerHTML. Otherwise a
   value like <img src=x onerror=...> typed by an operator would run in a
   manager's browser. */

function esc(v){
  if(v==null) return ''
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

// A status pill. kind is one of: live | done | off | '' (plus optional inline style via 3rd arg).
function pill(kind, text, style){
  return `<span class="pill ${kind||''}"${style?` style="${style}"`:''}>${esc(text)}</span>`
}

// Join meta bits with ' · ', dropping empties. Pass already-escaped/safe fragments.
function meta(parts){ return (parts||[]).filter(Boolean).join(' · ') }

// A tappable photo thumbnail strip that opens the shared lightbox.
// paths: array of storage paths. size: px (default 54).
// Relies on photoThumbUrl()/photoViewUrl()/openLightboxEl() from core.js.
//
// The thumbnail src is the CDN-resized version (a few KB); only the lightbox
// pulls the larger one. Both used to be the full original, so a five-photo
// strip downloaded ~22 MB to draw five 54px squares -- the main reason the
// history and dashboard screens crawled on a phone.
function photoThumbs(paths, size){
  paths = paths || []
  if(!paths.length) return ''
  const s = size || 54
  const lb = paths.map(photoViewUrl).join('|')
  return '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">' +
    paths.map((p,i)=>`<img src="${photoThumbUrl(p, s*3)}" loading="lazy" data-lb="${lb}" data-i="${i}" onclick="openLightboxEl(this)" style="width:${s}px;height:${s}px;object-fit:cover;border-radius:8px;cursor:zoom-in;border:1px solid var(--line)">`).join('') +
    '</div>'
}
