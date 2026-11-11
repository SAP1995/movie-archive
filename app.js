'use strict';
/* Movie Archive — phone viewer. Read-only: browse, search, filter, cast, covers and photos. */
const VERSION = '1.0.1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const same = (a, b) => a === b || collator.compare(String(a), String(b)) === 0;
const splitNames = (s) => String(s || '').split(/\s*[,،]\s*/).map((x) => x.trim()).filter(Boolean);
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M13 6h8M13 11h6M13 16h4"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M9 6h9v9M18 6L7 17"/></svg>',
};

const S = { reader: null, data: null, name: '', tab: 'titles', q: '', sort: { key: 'title', dir: 1 }, filter: null, castRole: 'all', castOrder: 'name', people: null };
const emptyFilter = () => ({ genres: [], yearFrom: '', yearTo: '', rating: '', seen: 'any', wish: 'any', media: '', kind: 'any', custom: {}, quick: [] });
S.filter = emptyFilter();
const settings = () => (S.data && S.data.settings) || {};

// ---------------- images: decrypted on demand, a limited number kept ----------------
const imgCache = new Map(); const imgWaiting = new Map(); let imgBusy = 0; const imgQueue = [];
function imageUrl(ref) {
  if (!ref || !S.reader) return Promise.resolve(null);
  if (imgCache.has(ref)) { const u = imgCache.get(ref); imgCache.delete(ref); imgCache.set(ref, u); return Promise.resolve(u); }
  if (imgWaiting.has(ref)) return imgWaiting.get(ref);
  const p = new Promise((res) => { imgQueue.push([ref, res]); pump(); });
  imgWaiting.set(ref, p); return p;
}
function pump() {
  while (imgBusy < 4 && imgQueue.length) {
    const [ref, res] = imgQueue.shift(); imgBusy++;
    S.reader.image(ref).then((blob) => {
      const u = blob ? URL.createObjectURL(blob) : null;
      if (u) { imgCache.set(ref, u); if (imgCache.size > 700) { const [k, old] = imgCache.entries().next().value; imgCache.delete(k); setTimeout(() => URL.revokeObjectURL(old), 4000); } }
      res(u);
    }).catch(() => res(null)).finally(() => { imgBusy--; imgWaiting.delete(ref); pump(); });
  }
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target; io.unobserve(el);
    imageUrl(el.dataset.img).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; });
  }
}, { rootMargin: '400px 0px' });
const lazy = (root) => $$('[data-img]', root).forEach((el) => { if (el.dataset.img) io.observe(el); });

// ---------------- helpers about titles & people ----------------
function listTitle(t) {
  t = String(t || '');
  if (settings().theSuffix === false) return t;
  const m = /^the\s+(.+)$/i.exec(t.trim()); return m ? `${m[1]}, ${t.trim().slice(0, 3)}` : t;
}
function personRec(name) { return (S.data.people || {})[String(name).toLocaleLowerCase()] || null; }
function creditsOf(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.cr)) return rec.cr.map((r) => ({ type: r[0] === 't' ? 'tv' : 'movie', id: r[1], title: r[2], year: r[3] || null, roles: Array.isArray(r[4]) ? r[4] : (r[4] ? [r[4]] : []), originalTitle: r[5] || r[2] }));
  return rec.credits || [];
}
function personInMovie(m, name) {
  return (m.actors || []).some((a) => same(a.name, name)) || splitNames(m.director).some((n) => same(n, name)) || splitNames(m.scenario).some((n) => same(n, name));
}
function buildPeople() {
  const map = new Map();
  const add = (name, role, m) => {
    if (!name) return; const k = name.toLocaleLowerCase();
    let p = map.get(k); if (!p) { p = { key: k, name, roles: new Set(), movies: new Set() }; map.set(k, p); }
    p.roles.add(role); p.movies.add(m.id);
  };
  for (const m of S.data.movies) {
    for (const a of m.actors || []) add(a.name, 'actor', m);
    splitNames(m.director).forEach((n) => add(n, 'director', m));
    splitNames(m.scenario).forEach((n) => add(n, 'writer', m));
  }
  return [...map.values()];
}
function siteLinks(m) {
  const url = String(m.url || '');
  const imdb = (typeof m.imdbId === 'string' && /^tt\d+$/.test(m.imdbId) && m.imdbId) || (url.match(/\btt\d{5,10}\b/) || [])[0];
  let tmdb = null;
  if (m.tmdbId && /^\d+$/.test(String(m.tmdbId))) tmdb = `${m.tmdbType === 'tv' ? 'tv' : 'movie'}/${m.tmdbId}`;
  else { const t = url.match(/themoviedb\.org\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)/i); if (t) tmdb = `${t[1].toLowerCase()}/${t[2]}`; }
  return { imdb: imdb && `https://www.imdb.com/title/${imdb}/`, tmdb: tmdb && `https://www.themoviedb.org/${tmdb}` };
}
const stars = (r) => { const n = Math.round((Number(r) || 0) / 2); return '★'.repeat(n) + '☆'.repeat(5 - n); };
function movieForCredit(c) {
  return S.data.movies.find((m) => (m.tmdbId && String(m.tmdbId) === String(c.id) && (m.tmdbType || 'movie') === c.type))
    || S.data.movies.find((m) => (!c.year || !m.year || m.year === c.year) && [m.title, m.originalTitle].some((t) => t && (same(t, c.title) || same(t, c.originalTitle))));
}

// ---------------- filtering & sorting ----------------
function cfSet(v) { return v != null && v !== '' && v !== 'any' && !(typeof v === 'object' && !v.min && !v.max); }
// series: "2011 - 2015", or "2011 -" while still running (same as the desktop program)
function yearsText(m) {
  if (!m.year) return '';
  if (m.ongoing) return `${m.year} -`;
  if (m.yearEnd && m.yearEnd !== m.year) return `${m.year} - ${m.yearEnd}`;
  return String(m.year);
}
function filterActive() {
  const f = S.filter;
  return f.genres.length || f.yearFrom || f.yearTo || f.rating || f.seen !== 'any' || f.wish !== 'any' || f.media || f.kind !== 'any' || Object.values(f.custom).some(cfSet) || f.quick.length;
}
function matches(m) {
  const f = S.filter;
  if (S.q) {
    const hay = [m.title, m.originalTitle, m.director, m.scenario, yearsText(m), (m.actors || []).map((a) => a.name).join('\n')].join('\n').toLocaleLowerCase();
    if (!S.q.toLocaleLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.genres.length && !f.genres.some((g) => (m.genres || []).includes(g))) return false;
  if (f.yearFrom && (!m.year || m.year < Number(f.yearFrom))) return false;
  if (f.yearTo && (!m.year || m.year > Number(f.yearTo))) return false;
  if (f.rating && !(Number(m.rating) >= Number(f.rating))) return false;
  if (f.seen !== 'any' && !!m.seen !== (f.seen === 'yes')) return false;
  if (f.wish !== 'any' && !!m.watchlist !== (f.wish === 'yes')) return false;
  if (f.media && m.mediaType !== f.media) return false;
  if (f.kind !== 'any' && (m.tmdbType === 'tv' ? 'tv' : 'movie') !== f.kind) return false;
  for (const [id, want] of Object.entries(f.custom)) {
    if (!cfSet(want)) continue;
    const c = (settings().customFields || []).find((x) => x.id === id); if (!c) continue;
    const v = (m.custom || {})[id]; const has = !(v == null || v === '' || v === false);
    if (c.type === 'checkbox') { if (!!v !== (want === 'yes')) return false; continue; }
    if (typeof want === 'string') { if (want === '__empty__' ? has : !(has && same(String(v), want))) return false; continue; }
    if (!has) return false;
    const x = c.type === 'number' ? Number(v) : String(v);
    if (want.min && x < (c.type === 'number' ? Number(want.min) : want.min)) return false;
    if (want.max && x > (c.type === 'number' ? Number(want.max) : want.max)) return false;
  }
  for (const qf of f.quick) {
    if (qf.field === 'person' && !personInMovie(m, qf.value)) return false;
    if (qf.field === 'genre' && !(m.genres || []).some((g) => same(g, qf.value))) return false;
    if (qf.field === 'country' && !(m.countries || []).some((g) => same(g, qf.value))) return false;
    if (qf.field === 'year' && String(m.year || '') !== String(qf.value)) return false;
    if (qf.field === 'mediaType' && !same(m.mediaType || '', qf.value)) return false;
  }
  return true;
}
const SORTS = { title: 'Title', year: 'Year', rating: 'Rating', added: 'Date added' };
function sortKey(m, k) {
  if (k === 'year') return m.year || 0;
  if (k === 'rating') return Number(m.rating) || 0;
  if (k === 'added') return m.created || 0;
  return listTitle(m.title || m.originalTitle);
}
function visibleMovies() {
  const k = S.sort.key; const d = S.sort.dir;
  return S.data.movies.filter(matches).sort((a, b) => {
    const x = sortKey(a, k); const y = sortKey(b, k);
    const c = typeof x === 'string' ? collator.compare(x, y) : x - y;
    return (c || collator.compare(listTitle(a.title), listTitle(b.title))) * (k === 'title' ? d : -d);
  });
}

// ---------------- main list ----------------
// Show All: leaves the search and every filter, like Esc in the desktop program
function showAll() {
  S.q = ''; $('#q').value = ''; $('#qClear').hidden = true;
  if (S.tab === 'titles') S.filter = emptyFilter(); else S.castRole = 'all';
  renderMain();
}
let shown = []; let shownN = 0; const PAGE = 120;
let moreObs = null;
function renderMain() {
  $('#tools').innerHTML = ''; const list = $('#list');
  if (moreObs) moreObs.disconnect();
  $$('.pchips').forEach((x) => x.remove());
  if (S.tab === 'titles') {
    shown = visibleMovies();
    $('#tools').innerHTML = `<span class="count">${shown.length === S.data.movies.length ? `${shown.length} titles` : `${shown.length} of ${S.data.movies.length}`}</span>
      <button class="chip-btn ${filterActive() ? 'on' : ''}" id="fBtn">${ICON.filter}Filter</button>
      <label class="chip-btn">${ICON.sort}<select id="sSel">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${S.sort.key === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="chip-btn" id="sDir" title="Reverse order">${S.sort.dir > 0 ? '↑' : '↓'}</button>
      ${filterActive() || S.q ? `<button class="chip-btn" id="showAll" title="Clear search and filters">Show All</button>` : ''}`;
    if (S.filter.quick.length) {
      $('#tools').insertAdjacentHTML('afterend', `<div class="pchips">${S.filter.quick.map((q, i) => `<span class="pchip">${esc(q.label || q.value)}<button data-qx="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>`);
      $$('[data-qx]').forEach((b) => { b.onclick = () => { S.filter.quick.splice(Number(b.dataset.qx), 1); renderMain(); }; });
    }
    $('#fBtn').onclick = filterSheet;
    $('#sSel').onchange = (e) => { S.sort.key = e.target.value; S.sort.dir = 1; renderMain(); };
    $('#sDir').onclick = () => { S.sort.dir = -S.sort.dir; renderMain(); };
    if ($('#showAll')) $('#showAll').onclick = showAll;
    $('#tools').classList.toggle('tight', !!$('#showAll'));
  } else {
    S.people = S.people || buildPeople();
    const q = S.q.toLocaleLowerCase();
    shown = S.people.filter((p) => (S.castRole === 'all' || p.roles.has(S.castRole)) && (!q || p.name.toLocaleLowerCase().includes(q)));
    shown.sort(S.castOrder === 'count' ? (a, b) => b.movies.size - a.movies.size || collator.compare(a.name, b.name) : (a, b) => collator.compare(a.name, b.name));
    $('#tools').innerHTML = `<span class="count">${shown.length} people</span>
      <label class="chip-btn"><select id="cRole"><option value="all">Everyone</option><option value="actor">Actors</option><option value="director">Directors</option><option value="writer">Writers</option></select></label>
      <label class="chip-btn">${ICON.sort}<select id="cOrd"><option value="name">By name</option><option value="count">By titles</option></select></label>
      ${S.q || S.castRole !== 'all' ? `<button class="chip-btn" id="showAll" title="Clear search and filters">Show All</button>` : ''}`;
    $('#cRole').value = S.castRole; $('#cOrd').value = S.castOrder;
    $('#cRole').onchange = (e) => { S.castRole = e.target.value; renderMain(); };
    $('#cOrd').onchange = (e) => { S.castOrder = e.target.value; renderMain(); };
    if ($('#showAll')) $('#showAll').onclick = showAll;
    $('#tools').classList.toggle('tight', !!$('#showAll'));
  }
  list.innerHTML = shown.length ? '' : `<div class="empty">${S.tab === 'titles' ? (S.data.movies.length ? 'No titles match.' : 'This archive is empty.') : 'Nobody found.'}</div>`;
  shownN = 0; more();
  list.scrollTop = 0; window.scrollTo(0, 0);
}
function rowHtml(x) {
  if (S.tab === 'titles') {
    const m = x;
    return `<div class="row" data-m="${esc(m.id)}"><div class="thumb" data-img="${esc(m.cover || '')}"></div>
      <div class="row-main"><div class="row-title" dir="auto">${esc(listTitle(m.title || m.originalTitle))}</div>
      <div class="row-sub" dir="auto">${[yearsText(m), (m.genres || []).slice(0, 3).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="row-sub" dir="auto">${esc(splitNames(m.director).slice(0, 2).join(', '))}</div></div>
      <div class="row-side">${m.rating ? `<span class="rate"><small>★</small> ${Number(m.rating).toFixed(1)}</span>` : ''}<span class="flags">${m.seen ? `<span class="f-seen" title="Seen">${ICON.eye}</span>` : ''}${m.watchlist ? `<span class="f-watch" title="Wishlist">${ICON.mark}</span>` : ''}</span></div></div>`;
  }
  const p = x; const rec = personRec(p.name);
  return `<div class="row" data-p="${esc(p.name)}"><div class="thumb round" data-img="${esc((rec && rec.photo) || '')}"></div>
    <div class="row-main"><div class="row-title" dir="auto">${esc(p.name)}</div><div class="row-sub">${[...p.roles].map((r) => ({ actor: 'Actor', director: 'Director', writer: 'Writer' }[r])).join(' · ')}</div></div>
    <div class="row-side muted">${p.movies.size}</div></div>`;
}
function more() {
  const list = $('#list'); const end = Math.min(shown.length, shownN + PAGE);
  if (end <= shownN) return;
  const frag = document.createElement('div'); frag.innerHTML = shown.slice(shownN, end).map(rowHtml).join('');
  const added = [...frag.children]; added.forEach((el) => list.appendChild(el)); shownN = end;
  added.forEach(lazy);
  $('.more', list)?.remove();
  if (shownN < shown.length) {
    const s = document.createElement('div'); s.className = 'more'; list.appendChild(s);
    moreObs = new IntersectionObserver((e) => { if (e[0].isIntersecting) { moreObs.disconnect(); more(); } }, { rootMargin: '800px' });
    moreObs.observe(s);
  }
}

// ---------------- layers with the phone's back button ----------------
const stack = [];
function pushLayer(el, onClose) {
  $('#layers').appendChild(el); stack.push({ el, onClose });
  history.pushState({ layer: stack.length }, '');
}
function popLayer() { const l = stack.pop(); if (l) { l.el.remove(); if (l.onClose) l.onClose(); } }
window.addEventListener('popstate', () => { if (stack.length) popLayer(); });
const back = () => history.back();
function page(title) {
  const el = document.createElement('div'); el.className = 'layer';
  el.innerHTML = `<div class="layer-top"><button class="icon-btn" data-back aria-label="Back">${ICON.back}</button><div class="t" dir="auto">${esc(title)}</div></div><div class="body"></div>`;
  $('[data-back]', el).onclick = back;
  return el;
}
function quickFilter(field, value, label) {
  while (stack.length) { history.back(); popLayer(); }
  S.tab = 'titles'; $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'titles'));
  if (!S.filter.quick.some((q) => q.field === field && same(q.value, value))) S.filter.quick.push({ field, value, label });
  renderMain();
}

// ---------------- title page ----------------
function openMovie(id) {
  const m = S.data.movies.find((x) => x.id === id); if (!m) return;
  const el = page(m.title || m.originalTitle); const b = $('.body', el);
  const links = siteLinks(m);
  const ppl = (names, role) => names.map((n) => `<span class="tap" data-person="${esc(n)}" dir="auto">${esc(n)}</span>`).join(', ');
  const cf = (settings().customFields || []).filter((c) => { const v = (m.custom || {})[c.id]; return c.name && v != null && v !== '' && v !== false; });
  const seasons = {}; (m.episodes || []).forEach((e) => (seasons[e.season] = seasons[e.season] || []).push(e));
  b.innerHTML = `<div class="hero"><div class="cover" data-img="${esc(m.cover || '')}" data-zoom="cover"></div>
    <div><h2 dir="auto">${esc(m.title || m.originalTitle)}</h2>
    ${m.originalTitle && m.originalTitle !== m.title ? `<div class="orig" dir="auto">${esc(m.originalTitle)}</div>` : ''}
    <div class="orig">${[m.year ? `<span class="tap" data-q="year">${m.year}</span>${esc(yearsText(m).slice(String(m.year).length))}` : '', m.tmdbType === 'tv' ? 'TV series' : ''].filter(Boolean).join(' · ')}</div>
    ${m.rating ? `<div style="margin-top:8px"><span class="stars">${stars(m.rating)}</span> <span class="score">${Number(m.rating).toFixed(1)}</span> <small class="muted">${esc(m.ratingSource || 'IMDb')}</small></div>` : ''}
    <div class="badges">${m.seen ? `<span class="badge seen">${ICON.eye}Seen</span>` : '<span class="badge">Not seen</span>'}${m.watchlist ? `<span class="badge watch">${ICON.mark}Wishlist</span>` : ''}
      ${links.imdb ? `<a class="badge link" href="${esc(links.imdb)}" target="_blank" rel="noopener">IMDb ${ICON.out}</a>` : ''}${links.tmdb ? `<a class="badge link" href="${esc(links.tmdb)}" target="_blank" rel="noopener">TMDB ${ICON.out}</a>` : ''}</div></div></div>
    <div class="sec"><dl class="info">
      ${m.director ? `<dt>Director</dt><dd>${ppl(splitNames(m.director))}</dd>` : ''}
      ${m.scenario ? `<dt>Scenario</dt><dd>${ppl(splitNames(m.scenario))}</dd>` : ''}
      ${(m.genres || []).length ? `<dt>Genres</dt><dd>${m.genres.map((g) => `<span class="tap" data-qf="genre" data-v="${esc(g)}">${esc(g)}</span>`).join(', ')}</dd>` : ''}
      ${(m.countries || []).length ? `<dt>Country</dt><dd>${m.countries.map((g) => `<span class="tap" data-qf="country" data-v="${esc(g)}">${esc(g)}</span>`).join(', ')}</dd>` : ''}
      ${m.studio ? `<dt>Studio</dt><dd dir="auto">${esc(m.studio)}</dd>` : ''}
      ${m.mpaa ? `<dt>MPAA</dt><dd>${esc(m.mpaa)}</dd>` : ''}
      ${m.mediaType ? `<dt>Media Type</dt><dd><span class="tap" data-qf="mediaType" data-v="${esc(m.mediaType)}">${esc(m.mediaType)}</span></dd>` : ''}
      ${cf.map((c) => { const v = m.custom[c.id]; return `<dt dir="auto">${esc(c.name)}</dt><dd dir="auto">${c.type === 'checkbox' ? 'Yes' : esc(v)}</dd>`; }).join('')}
    </dl></div>
    ${m.description ? `<div class="sec"><h3>Description</h3><div class="desc" dir="auto">${esc(m.description)}</div></div>` : ''}
    ${(m.actors || []).length ? `<div class="sec"><h3>Actors</h3><div class="people">${m.actors.map((a) => { const r = personRec(a.name); return `<div class="person" data-person="${esc(a.name)}"><div class="ph" data-img="${esc((r && r.photo) || '')}"></div><div style="min-width:0"><b dir="auto">${esc(a.name)}</b>${a.role ? `<small dir="auto">${esc(a.role)}</small>` : ''}</div></div>`; }).join('')}</div></div>` : ''}
    ${(m.screenshots || []).length ? `<div class="sec"><h3>Screenshots (${m.screenshots.length})</h3><div class="shots">${m.screenshots.map((s, i) => `<div data-img="${esc(s)}" data-shot="${i}"></div>`).join('')}</div></div>` : ''}
    ${Object.keys(seasons).length ? `<div class="sec"><h3>Episodes</h3>${Object.keys(seasons).map(Number).sort((a, b) => a - b).map((sn) => { const eps = seasons[sn]; return `<details class="season"><summary><b>Season ${sn}</b><span class="muted">${eps.filter((e) => e.seen).length} / ${eps.length} seen</span></summary>${eps.map((e) => `<div class="ep"><span class="n">E${String(e.episode).padStart(2, '0')}</span><span class="tt" dir="auto">${esc(e.title)}<br><small class="muted">${esc(e.airDate || '')}</small></span>${e.seen ? `<span class="ok">${ICON.eye}</span>` : ''}</div>`).join('')}</details>`; }).join('')}</div>` : ''}`;
  pushLayer(el); lazy(el);
  $$('[data-person]', el).forEach((x) => { x.onclick = () => openPerson(x.dataset.person); });
  $$('[data-qf]', el).forEach((x) => { x.onclick = () => quickFilter(x.dataset.qf, x.dataset.v, x.dataset.v); });
  $$('[data-q="year"]', el).forEach((x) => { x.onclick = () => quickFilter('year', String(m.year), String(m.year)); });
  $$('[data-shot]', el).forEach((x) => { x.onclick = () => viewer(m.screenshots, Number(x.dataset.shot)); });
  const cov = $('[data-zoom]', el); if (cov && m.cover) cov.onclick = () => viewer([m.cover], 0);
}

// ---------------- person page ----------------
function openPerson(name) {
  S.people = S.people || buildPeople();
  const p = S.people.find((x) => same(x.name, name)) || { name, roles: new Set(), movies: new Set() };
  const rec = personRec(name) || {};
  const inArch = S.data.movies.filter((m) => p.movies.has(m.id)).sort((a, b) => (b.year || 0) - (a.year || 0));
  const credits = creditsOf(rec);
  const born = [rec.birthday, rec.birthplace].filter(Boolean).join(' — ');
  const el = page(name); const b = $('.body', el);
  const rolesIn = (m) => {
    const r = [];
    const a = (m.actors || []).find((x) => same(x.name, name)); if (a) r.push(a.role ? `as ${a.role}` : 'Actor');
    if (splitNames(m.director).some((n) => same(n, name))) r.push('Director');
    if (splitNames(m.scenario).some((n) => same(n, name))) r.push('Writer');
    return r.join(' · ');
  };
  b.innerHTML = `<div class="hero"><div class="pp" data-img="${esc(rec.photo || '')}" data-zoom="1"></div>
    <div><h2 dir="auto">${esc(name)}</h2><div class="orig">${[...p.roles].map((r) => ({ actor: 'Actor', director: 'Director', writer: 'Writer' }[r])).join(' · ')}</div>
    <dl class="info" style="margin-top:10px">${born ? `<dt>Born</dt><dd dir="auto">${esc(born)}</dd>` : ''}${rec.deathday ? `<dt>Died</dt><dd>${esc(rec.deathday)}</dd>` : ''}<dt>In archive</dt><dd>${inArch.length} title(s)</dd></dl></div></div>
    ${rec.bio ? `<div class="sec"><h3>Biography</h3><div class="desc" dir="auto">${esc(rec.bio)}</div></div>` : ''}
    <div class="sec"><h3>In your archive (${inArch.length})</h3>${inArch.map((m) => `<div class="row" data-m="${esc(m.id)}"><div class="thumb" data-img="${esc(m.cover || '')}"></div><div class="row-main"><div class="row-title" dir="auto">${esc(m.title || m.originalTitle)}</div><div class="row-sub">${esc(yearsText(m))}</div><div class="row-sub" dir="auto">${esc(rolesIn(m))}</div></div></div>`).join('')}</div>
    ${credits.length ? `<div class="sec"><h3>Full filmography (${credits.length})</h3><table class="filmo"><tbody>${credits.map((c) => { const mv = movieForCredit(c); return `<tr class="${mv ? 'in' : ''}" ${mv ? `data-m="${esc(mv.id)}"` : ''}><td class="y">${c.year || '—'}</td><td class="d">${mv ? '●' : ''}</td><td dir="auto">${esc(c.title)}${c.type === 'tv' ? ' <small class="muted">TV</small>' : ''}<div class="r" dir="auto">${esc((c.roles || []).join(', '))}</div></td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
  pushLayer(el); lazy(el);
  $$('[data-m]', el).forEach((x) => { x.onclick = () => openMovie(x.dataset.m); });
  const ph = $('[data-zoom]', el); if (ph && rec.photo) ph.onclick = () => viewer([rec.photo], 0);
  const show = document.createElement('button'); show.className = 'btn'; show.style.marginTop = '14px'; show.textContent = 'Show these titles in the list';
  show.onclick = () => quickFilter('person', name, name); $('.hero > div:last-child', el).appendChild(show);
}

// ---------------- image viewer (swipe left / right) ----------------
function viewer(list, i) {
  const v = document.createElement('div'); v.className = 'viewer';
  v.innerHTML = `<img alt=""><button class="icon-btn x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${list.length > 1 ? '<div class="cnt"></div>' : ''}`;
  const img = $('img', v);
  const show = () => { imageUrl(list[i]).then((u) => { if (u) img.src = u; }); if (list.length > 1) $('.cnt', v).textContent = `${i + 1} / ${list.length}`; };
  let x0 = null;
  v.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50 && list.length > 1) { i = (i + (dx < 0 ? 1 : -1) + list.length) % list.length; show(); } });
  v.addEventListener('click', (e) => { if (e.target.closest('.x') || list.length === 1) back(); else { i = (i + 1) % list.length; show(); } });
  show(); pushLayer(v);
}

// ---------------- sheets ----------------
function sheet(title, html, foot) {
  const el = document.createElement('div'); el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet"><div class="sheet-head"><span>${esc(title)}</span><button class="icon-btn" data-back aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="sheet-body">${html}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-back]')) back(); });
  pushLayer(el); return el;
}
function filterSheet() {
  const f = JSON.parse(JSON.stringify(S.filter));
  const s = settings();
  const genres = [...new Set([...(s.genres || []), ...S.data.movies.flatMap((m) => m.genres || [])])].sort(collator.compare);
  const medias = [...new Set([...(s.mediaTypes || []), ...S.data.movies.map((m) => m.mediaType).filter(Boolean)])].sort(collator.compare);
  const opt = (v, cur, l) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const cfs = (s.customFields || []).filter((c) => c.name);
  const cfHtml = cfs.map((c) => {
    const w = f.custom[c.id];
    if (c.type === 'checkbox') return `<div class="fld"><label dir="auto">${esc(c.name)}</label><select data-cf="${c.id}" data-k="sel">${opt('any', w || 'any', 'Any')}${opt('yes', w, 'Yes')}${opt('no', w, 'No')}</select></div>`;
    if (c.type === 'number' || c.type === 'date') return `<div class="fld"><label dir="auto">${esc(c.name)}</label><div class="grid2"><input type="${c.type === 'number' ? 'number' : 'date'}" data-cf="${c.id}" data-k="min" placeholder="from" value="${esc((w && w.min) || '')}"><input type="${c.type === 'number' ? 'number' : 'date'}" data-cf="${c.id}" data-k="max" placeholder="to" value="${esc((w && w.max) || '')}"></div></div>`;
    const vals = (c.type === 'list' ? [...(c.options || [])] : [...new Set(S.data.movies.map((m) => (m.custom || {})[c.id]).filter((v) => v != null && v !== '').map(String))]).sort(collator.compare).slice(0, 300);
    const sel = typeof w === 'string' ? w : 'any';
    return `<div class="fld"><label dir="auto">${esc(c.name)}</label><select data-cf="${c.id}" data-k="sel">${opt('any', sel, 'Any')}${opt('__empty__', sel, '(empty)')}${vals.map((v) => opt(v, sel, v)).join('')}</select></div>`;
  }).join('');
  const el = sheet('Filter', `
    <div class="fld"><label>Genres (any of)</label><div class="tagset">${genres.map((g) => `<button class="tag ${f.genres.includes(g) ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div></div>
    <div class="grid2"><div class="fld"><label>Year from</label><input type="number" id="fy1" inputmode="numeric" value="${esc(f.yearFrom)}"></div><div class="fld"><label>Year to</label><input type="number" id="fy2" inputmode="numeric" value="${esc(f.yearTo)}"></div></div>
    <div class="grid2"><div class="fld"><label>Min. rating</label><input type="number" id="fr" step="0.1" min="0" max="10" inputmode="decimal" value="${esc(f.rating)}"></div>
      <div class="fld"><label>Kind</label><select id="fk">${opt('any', f.kind, 'Movies & series')}${opt('movie', f.kind, 'Movies only')}${opt('tv', f.kind, 'Series only')}</select></div></div>
    <div class="grid2"><div class="fld"><label>Seen</label><select id="fs">${opt('any', f.seen, 'Any')}${opt('yes', f.seen, 'Seen')}${opt('no', f.seen, 'Not seen')}</select></div>
      <div class="fld"><label>Wishlist</label><select id="fw">${opt('any', f.wish, 'Any')}${opt('yes', f.wish, 'In wishlist')}${opt('no', f.wish, 'Not in wishlist')}</select></div></div>
    <div class="fld"><label>Media Type</label><select id="fm">${opt('', f.media, 'Any')}${medias.map((t) => opt(t, f.media, t)).join('')}</select></div>
    ${cfHtml}`, '<button class="btn" id="fClr">Clear</button><button class="btn primary" id="fOk">Show titles</button>');
  $$('[data-g]', el).forEach((t) => { t.onclick = () => t.classList.toggle('on'); });
  $('#fClr', el).onclick = () => { S.filter = emptyFilter(); back(); renderMain(); };
  $('#fOk', el).onclick = () => {
    const custom = {};
    for (const x of $$('[data-cf]', el)) {
      if (x.dataset.k === 'sel') custom[x.dataset.cf] = x.value;
      else { custom[x.dataset.cf] = typeof custom[x.dataset.cf] === 'object' ? custom[x.dataset.cf] : {}; custom[x.dataset.cf][x.dataset.k] = x.value.trim(); }
    }
    S.filter = { ...S.filter, genres: $$('.tag.on', el).map((t) => t.dataset.g), yearFrom: $('#fy1', el).value, yearTo: $('#fy2', el).value, rating: $('#fr', el).value,
      seen: $('#fs', el).value, wish: $('#fw', el).value, media: $('#fm', el).value, kind: $('#fk', el).value, custom };
    back(); renderMain();
  };
}
async function menuSheet() {
  const kept = await keptFile();
  const isKept = kept && S.file && kept.size === S.file.size && kept.name === S.keptName;
  const el = sheet('Menu', `
    ${isKept ? '<button class="menu-item" id="mForget">Remove the copy from this device</button>' : '<button class="menu-item" id="mKeep">Keep this archive on this device<br><small class="muted">Opens directly next time. Uses ' + Math.round(S.file.size / 1e6) + ' MB of storage.</small></button>'}
    <button class="menu-item" id="mOther">Open another archive</button>
    <div class="note" style="padding:12px 4px 0">Movie Archive viewer ${VERSION}. Read only — add and edit titles in the desktop program, then copy the file to the phone again.</div>`);
  if ($('#mKeep', el)) $('#mKeep', el).onclick = async () => { back(); await keepFile(S.file); };
  if ($('#mForget', el)) $('#mForget', el).onclick = async () => { back(); await forgetFile(); toast('The copy was removed from this device.'); };
  $('#mOther', el).onclick = () => { back(); location.reload(); };
}

// ---------------- keeping a copy on the phone (private app storage) ----------------
async function opfs() { try { return await navigator.storage.getDirectory(); } catch { return null; } }
async function keptFile() {
  const dir = await opfs(); if (!dir) return null;
  try { const h = await dir.getFileHandle('archive.mvx'); const f = await h.getFile(); return f.size ? f : null; } catch { return null; }
}
async function keepFile(file) {
  const dir = await opfs();
  if (!dir) { toast('This browser cannot keep files. Open the archive from the phone each time.'); return; }
  try {
    if (navigator.storage.persist) await navigator.storage.persist();
    const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.quota && est.quota - est.usage < file.size * 1.05) { toast('Not enough free space on the phone for a copy.'); return; }
    toast('Copying the archive… keep this page open.', 60000);
    const h = await dir.getFileHandle('archive.mvx', { create: true });
    const w = await h.createWritable(); await file.stream().pipeTo(w);
    localStorage.setItem('mvx-kept-name', S.name); S.keptName = file.name;
    localStorage.setItem('mvx-kept-file', file.name);
    toast('Done. The archive opens directly next time.');
    S.file = await keptFile() || S.file;
  } catch (e) { toast('Could not keep a copy: ' + (e && e.message || e)); try { await dir.removeEntry('archive.mvx'); } catch { /* nothing */ } }
}
async function forgetFile() {
  const dir = await opfs(); if (!dir) return;
  try { await dir.removeEntry('archive.mvx'); } catch { /* not there */ }
  localStorage.removeItem('mvx-kept-name'); localStorage.removeItem('mvx-kept-file');
}

// ---------------- opening ----------------
function toast(t, ms = 3500) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms); }
function show(id) { for (const s of ['start', 'loading', 'main']) $('#' + s).hidden = s !== id; }
async function openFile(file, displayName) {
  $('#startMsg').textContent = '';
  const r = new MvxReader(file);
  try { await r.header(); } catch (e) { show('start'); $('#startMsg').textContent = e.message || 'This file could not be read.'; return; }
  let pw = null;
  for (;;) {
    if (r.needsPassword) { pw = await askPassword(displayName); if (pw == null) { show('start'); return; } }
    show('loading'); $('#loadMsg').textContent = `Opening ${displayName}…`;
    try {
      await r.unlock(pw);
      const data = await r.load();
      S.reader = r; S.data = data; S.file = file; S.name = displayName.replace(/\.mvx$/i, '');
      data.movies = data.movies || []; data.people = data.people || {}; data.settings = data.settings || {};
      S.people = null; S.filter = emptyFilter(); S.q = ''; $('#q').value = '';
      S.keptName = localStorage.getItem('mvx-kept-file');
      $('#archName').textContent = S.name; show('main'); renderMain();
      return;
    } catch (e) {
      if (e.code === 'WRONG_PASSWORD' && r.needsPassword) { toast('Wrong password.'); continue; }
      show('start'); $('#startMsg').textContent = e.message || 'This file could not be read.'; return;
    }
  }
}
function askPassword(name) {
  return new Promise((resolve) => {
    let done = false;
    const el = sheet('Password', `<p class="muted" dir="auto" style="margin-top:0">${esc(name)} is protected with a password.</p><div class="fld"><input type="password" id="pw" autocomplete="current-password"></div>`, '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Open</button>');
    const finish = (v) => { if (done) return; done = true; resolve(v); back(); };
    stack[stack.length - 1].onClose = () => { if (!done) { done = true; resolve(null); } };
    $('[data-ok]', el).onclick = () => finish($('#pw', el).value);
    $('[data-cancel]', el).onclick = () => finish(null);
    $('#pw', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') finish($('#pw', el).value); });
    setTimeout(() => $('#pw', el).focus(), 150);
  });
}

// ---------------- start ----------------
async function start() {
  $('#ver').textContent = `Viewer ${VERSION}`;
  if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') {
    $('#startMsg').textContent = 'This browser is too old. Please update Chrome.'; $('#pickLabel').hidden = true; return;
  }
  $('#pick').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f, f.name); };
  const kept = await keptFile();
  if (kept) {
    const nm = localStorage.getItem('mvx-kept-name') || 'archive';
    $('#keptBox').hidden = false; $('#keptOpen').textContent = `Open ${nm}`;
    $('#keptOpen').onclick = () => openFile(kept, nm);
    $('#keptForget').onclick = async () => { await forgetFile(); $('#keptBox').hidden = true; toast('The copy was removed from this device.'); };
    openFile(kept, nm); // straight in
  }
  $('#menuBtn').onclick = menuSheet;
  let qt = null;
  $('#q').oninput = (e) => { $('#qClear').hidden = !e.target.value; clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); renderMain(); }, 180); };
  $('#qClear').onclick = () => { $('#q').value = ''; $('#qClear').hidden = true; S.q = ''; renderMain(); };
  $$('.tabs button').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderMain(); }; });
  $('#list').addEventListener('click', (e) => {
    const r = e.target.closest('.row'); if (!r) return;
    if (r.dataset.m) openMovie(r.dataset.m); else if (r.dataset.p) openPerson(r.dataset.p);
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
