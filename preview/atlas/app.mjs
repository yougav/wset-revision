// Wine Atlas zoom prototype: the design-review decisions (09-design-review-plan.md) in one working map.
//   1 the sheet starts as the bar · 2 a selected place's notes sit under its title · 3 no "WSET" in the app's text
//   5 no "Next door" row · 6 surrounding places (round 1: your level in your region, plus other regions whole)
//   7 taps never change the sheet's height
//   8 wider tint steps · 9 zooming and panning move the focus · 10 picking from the list shows where the place is
import * as maplibregl from './vendor/maplibre-gl.mjs'
import { PMTiles, Protocol } from './vendor/pmtiles.mjs'
import { buildAtlasStyle, lockNorthUp, PALETTES } from './atlas-style.mjs'
import { FAMILY, nodeColour, drillLayers, drillLabelLayers, resolveImages, veilFor } from './layers.mjs'

const BASE = document.baseURI.replace(/[^/]*([?#].*)?$/, '')
const url = p => BASE + p
const $ = s => document.querySelector(s)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const store = { get(k, d) { try { const v = localStorage.getItem('wa-proto-' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('wa-proto-' + k, JSON.stringify(v)) } catch {} } }

// ---- settings (item 9's dials) ----
const S = Object.assign({ timing: 'pause', enter: 60, exit: 50, depth: 'region', minpx: 56, starFirst: true, readout: false },
  store.get('settings', {}))
const FADE = 0.6 // zoom levels a place takes to fade in once it's big enough to read
const saveSettings = () => store.set('settings', S)

// ---- data: the map files are read whole, so the page doesn't depend on HTTP range requests ----
class WholeFile {
  constructor(u) { this.u = u; this.p = null }
  getKey() { return this.u }
  async getBytes(offset, length) {
    this.p ||= fetch(this.u).then(r => { if (!r.ok) throw new Error(`${r.status} ${this.u}`); return r.arrayBuffer() })
    const b = await this.p
    return { data: b.slice(offset, offset + length) }
  }
}
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)
// the map files are published with a .wasm name because an artifact only serves a fixed set of file types;
// they are ordinary PMTiles archives, read whole (see WholeFile above)
for (const f of ['basemap', 'relief', 'fr-hier']) protocol.add(new PMTiles(new WholeFile(url(`data/${f}.wasm`))))
maplibregl.setWorkerUrl(url('vendor/maplibre-gl-worker.mjs'))

const tree = await (await fetch(url('data/fr-hierarchy.json'))).json()
const N = tree.nodes
const regionsFp = (await (await fetch(url('data/footprints/regions.geojson'))).json()).features
// concept v2: what the course says about each place, organised the way the exam asks it (built by build_v2.py)
const SL = await (await fetch(url('data/study-v2.json'))).json()
const SP = SL.places, CH = SL.chapters, LENS = SL.lens
const statusOf = id => SP[id]?.status?.s ?? 'nq'
// Inside WSET Revision the map is a same-site frame: progress, reading, quizzes and Study belong to the app (D41-D45)
const BR = (() => { try { return window.parent !== window ? window.parent.__wsetBridge || null : null } catch (e) { return null } })()
if (BR) {
  document.documentElement.classList.add('embed')
  const q0 = SL.questions; SL.questions = new Proxy(q0, { get: (t, k) => t[k] || BR.question(k) || undefined })
}
const EXAM = new Set(Object.keys(SP).filter(id => SP[id].exam.length))
let mode = 'regions'   // 'regions' | 'progress' | 'lens'
let lensCh = null      // the chapter (grape) the lens shows
const PROG = { light: { secure: '#8E2C48', partly: '#C77F98', shaky: '#E3B3C1', none: '#DDD6CB', nq: '#F3EFE8' },
  dark: { secure: '#E0909F', partly: '#A4536F', shaky: '#6A3A4B', none: '#3A3733', nq: '#24221F' } }
function progExpr() {
  const c = PROG[scheme], groups = { secure: [], partly: [], shaky: [], none: [] }
  for (const id of Object.keys(SP)) { const st = statusOf(id); if (groups[st]) groups[st].push(id) }
  const e = ['match', ['get', 'id']]
  for (const [k, ids] of Object.entries(groups)) if (ids.length) e.push(ids, c[k])
  e.push(c.nq); return e
}

// ---- theme: follows the page (the viewer's setting), switchable from the panel ----
const themeOf = () => { const t = document.documentElement.dataset.theme
  return t === 'dark' || t === 'light' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') }
let scheme = themeOf()

function styleFor(sc) {
  const P = PALETTES[sc]
  const style = buildAtlasStyle(sc, { basemap: 'pmtiles://' + url('data/basemap.wasm'), relief: 'pmtiles://' + url('data/relief.wasm'),
    pdo: 'pmtiles://' + url('data/fr-hier.wasm'), glyphs: url('glyphs/{fontstack}/{range}.pbf') })
  style.layers = style.layers.filter(l => l.source !== 'pdo'); delete style.sources.pdo
  style.sources.hier = { type: 'vector', url: 'pmtiles://' + url('data/fr-hier.wasm') }
  style.sources.veil = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
  const at = style.layers.findIndex(l => l.id === 'river-labels')
  style.layers.splice(at, 0, ...drillLayers(sc, P.sea))
  style.layers.push(...drillLabelLayers(sc, P.halo, P.placeLabel))
  // v2: the exam's places, pinned wherever they sit below the level you are on
  style.layers.push(
    { id: 'exam-pin', type: 'circle', source: 'hier', 'source-layer': 'hier_labels', filter: ['==', ['get', 'id'], '__none__'],
      paint: { 'circle-radius': 5.5, 'circle-color': P.pdoFill, 'circle-stroke-color': sc === 'dark' ? '#141311' : '#FFFFFF', 'circle-stroke-width': 2 } },
    { id: 'exam-pin-label', type: 'symbol', source: 'hier', 'source-layer': 'hier_labels', filter: ['==', ['get', 'id'], '__none__'],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5, 'text-anchor': 'left', 'text-offset': [0.85, 0],
        'text-max-width': 9, 'symbol-sort-key': 0, 'text-optional': true },
      paint: { 'text-color': P.placeLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.6 } })
  return style
}

// ---- tree helpers ----
const isTop = id => id === 'fr'
const hasKids = id => (N[id]?.children || []).some(k => !N[k].unmapped)
function visibleChildren(id) {
  let n = N[id]
  while (n && n.collapse && n.children?.length === 1 && N[n.children[0]].children?.length) n = N[n.children[0]]
  return n ? n.children || [] : []
}
function upOf(id) { // parent, skipping collapsed single-child levels
  let p = N[id]?.parent
  while (p && N[p].collapse && N[p].parent) p = N[p].parent
  return p || 'fr'
}
const siblingsOf = id => isTop(id) ? [] : visibleChildren(upOf(id)).filter(k => k !== id && !N[k].unmapped)
function path(id) { const out = []; for (let n = N[id]; n; n = N[n.parent]) out.unshift(n.name); return out }
const isChampagneVillage = n => n.kind === 'cru' && n.id.startsWith('fr-champagne-')
function kindLabel(n) {
  if (n.kind === 'country') return 'Country'
  if (n.kind === 'region') return 'Region'
  if (n.kind === 'subregion') return 'Sub-region'
  if (n.igp) return 'IGP'
  if (n.kind === 'appellation') return 'Appellation'
  const rank = n.cru === 'grand cru' ? 'Grand cru' : n.cru === 'premier cru' ? 'Premier cru' : ''
  if (isChampagneVillage(n)) return rank ? `${rank} village` : 'Village'
  return rank || 'Grand cru'
}
const displayName = n => n.name + (n.igp ? ' (IGP)' : '')

// ---- map ----
const map = new maplibregl.Map({ container: 'map', style: styleFor(scheme), center: [2.4, 46.6], zoom: 4.6,
  attributionControl: false, fadeDuration: 0, dragRotate: false, pitchWithRotate: false,
  // glyph folders are published without spaces ("Noto Sans Medium" -> noto-sans-medium)
  transformRequest: (u, type) => type === 'Glyphs'
    ? { url: u.replace(/glyphs\/([^/]+)\//, (m, f) => 'glyphs/' + decodeURIComponent(f).toLowerCase().replace(/ /g, '-') + '/').replace(/\.pbf$/, '.wasm') } : undefined })
resolveImages(map, () => scheme)
lockNorthUp(map)
window.__map = map

// ---- state ----
let focus = 'fr', select = null
let kids = [], ctx = []
let programmatic = false // camera moves the app makes itself: gesture rules don't run and the sheet doesn't drop
const SHEET = { bar: 0, half: 0, full: 0 }
let detent = 'bar' // item 1: the sheet starts as the bar

// open map area: below the top controls, above the sheet.
// At full height the sheet covers the map, so the rect would invert and the camera would have nowhere to aim
// (a place tapped in the list then landed under the sheet). Never let it get smaller than a usable band.
function openRect() {
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight
  const top = 112
  return { left: 12, right: W - 12, top, bottom: Math.max(H - sheetHeight() - 16 - safeB, top + 160) }
}
/** Padding for fitBounds: keeps a place inside the open area with room to breathe. */
const pad = () => {
  const r = openRect(), H = map.getContainer().clientHeight
  const bottom = Math.min(H - r.bottom + 24, H - r.top - 120) // never ask for more than the map can give
  return { top: r.top + 12, bottom, left: 28, right: 28 }
}
function screenBox(b) {
  const a = map.project([b[0], b[3]]), c = map.project([b[2], b[1]])
  return { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) }
}
/** How much of the open map a place fills (0-1), from its bounding box. */
function fill(id) {
  const b = N[id]?.bbox; if (!b) return 0
  const s = screenBox(b), r = openRect()
  return Math.max((s.x1 - s.x0) / (r.right - r.left), (s.y1 - s.y0) / (r.bottom - r.top))
}
const centre = () => { const r = openRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2] }
const around = ([x, y], d) => [[x - d, y - d], [x + d, y + d]]
const onScreen = id => { const b = N[id]?.bbox; if (!b) return true
  const s = screenBox(b), r = openRect()
  return s.x1 > r.left && s.x0 < r.right && s.y1 > r.top && s.y0 < r.bottom }

/** Round 3: places inside the one you're in are drawn only once they're big enough to read, so a region with
 *  twenty small appellations doesn't arrive all at once. The places the exam names are drawn from the start.
 *  A place's span on screen doubles with each zoom level, so the zoom it appears at can be worked out from any zoom. */
const ALWAYS = -10 // an "open zoom" far below any real one: drawn at every zoom
let openZ = {}, grandZ = {} // id -> the zoom it starts to fade in at
function openZoomFor(ids, minPx) {
  const z = map.getZoom(), out = {}
  for (const id of ids) {
    const b = N[id]?.bbox
    if (!b || minPx <= 0 || (S.starFirst && N[id].key)) { out[id] = ALWAYS; continue }
    const s = screenBox(b), span = Math.max(s.x1 - s.x0, s.y1 - s.y0)
    out[id] = span > 0 ? Math.max(0, z + Math.log2(minPx / span)) : ALWAYS
  }
  return out
}
/** Opacity 0 -> 1 across FADE zoom levels above each place's own opening zoom.
 *  MapLibre only allows ['zoom'] as the input of a top-level interpolate, so the ramp is sampled at fixed stops
 *  and each stop's value is worked out per feature. */
const fadeExpr = (table, { extra = [], times = 1 } = {}) => {
  const pairs = Object.entries(table).map(([id, z]) => [id, extra.includes(id) ? ALWAYS : z])
  const real = pairs.map(p => p[1]).filter(z => z > 0)
  if (!pairs.length || !real.length) return times
  const open = ['match', ['get', 'id'], ...pairs.flat(), ALWAYS]
  const at = k => ['*', ['min', 1, ['max', 0, ['/', ['-', k, open], FADE]]], times]
  const z0 = Math.floor(Math.min(...real)), z1 = Math.ceil(Math.max(...real) + FADE)
  const stops = []
  for (let z = z0; z <= z1 + 1e-9; z += FADE / 2) { const k = +z.toFixed(3); stops.push(k, at(k)) }
  return ['interpolate', ['linear'], ['zoom'], ...stops]
}
/** A place too small to read as a shape is drawn as a dot with its name, which is what the tiles' `dotz` already does
 *  below ~8 px. While the size rule holds a shape back, its dot stays on, so nothing ever disappears —
 *  a place is simply a dot until it is big enough to be a shape. */
const dotExpr = table => {
  const pairs = Object.entries(table)
  const open = pairs.length ? ['match', ['get', 'id'], ...pairs.flat(), ALWAYS] : ALWAYS
  const stops = []
  for (let z = 3; z <= 14.5 + 1e-9; z += 0.5) {
    const k = +z.toFixed(1)
    stops.push(k, ['max', ['case', ['>', ['get', 'dotz'], k], 1, 0],
      ['-', 1, ['min', 1, ['max', 0, ['/', ['-', k, open], FADE]]]]])
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops]
}
/** Is this place drawn solidly enough to step into? (A dot is still tappable.) */
const shown = id => map.getZoom() >= (openZ[id] ?? ALWAYS) + FADE / 2 || id === select

/** How far a pinch can take you in (feedback, round 1): regions only, regions and their sub-regions, or every level.
 *  Zooming out always steps you up, whatever this is set to, and a tap always goes deeper. */
function canEnterByZoom(id) {
  const n = N[id]; if (!n || isTop(id)) return false
  if (S.depth === 'all') return true
  if (n.kind === 'region') return true
  return S.depth === 'subregion' && N[n.parent]?.kind === 'region'
}
const regionOf = id => { let n = N[id]; while (n && n.parent && n.kind !== 'region') n = N[n.parent]; return n?.kind === 'region' ? n.id : null }

/** What stays visible around the focus: your own level inside your region, the tiers above it, and the other
 *  regions as whole shapes (never their insides). */
function contextFor(f) {
  if (isTop(f)) return []
  const out = []
  for (let a = f; a && !isTop(a) && N[a].kind !== 'region'; a = upOf(a)) out.push(...siblingsOf(a))
  const home = regionOf(f)
  out.push(...N.fr.children.filter(r => r !== home && !N[r].unmapped))
  return [...new Set(out)]
}

/** How many of the focus's children would be drawn as shapes when the focus itself fits the screen.
 *  A place's size on screen doubles with each zoom level, so this doesn't depend on where the camera is now. */
function drawnAtFraming() {
  const f = fill(focus); if (!f) return kids.length
  const zFit = map.getZoom() - Math.log2(f)
  return kids.filter(k => (openZ[k] ?? ALWAYS) <= zFit).length
}
function applyFocus() {
  kids = visibleChildren(focus)
  const top = isTop(focus)
  const kidF = ['in', ['get', 'id'], ['literal', kids]]
  const noneF = ['==', ['get', 'id'], '__none__']
  // The fade is for region overviews, where twenty small appellations arrive at once. Deeper in you have chosen to be
  // there and the small places are the point (a Champagne terroir's villages, the Côte de Beaune's), so all are drawn.
  const fadeHere = !top && N[focus].kind === 'region'
  openZ = fadeHere ? openZoomFor(kids, S.minpx) : {}
  // Thin a region only when there is both something to look at and a real crowd to thin. Otherwise the mixed strengths
  // read as a glitch: in Alsace every place is a grand cru a few hundred metres across and nothing would be drawn,
  // and in Burgundy it would hold back the Côte de Nuits and Côte de Beaune while Chablis stayed solid.
  if (fadeHere) {
    const big = drawnAtFraming()
    if (big < 3 || kids.length - big < 6) openZ = {}
  }
  grandZ = Object.keys(openZ).length ? openZoomFor(kids.flatMap(k => N[k].children || []), S.minpx * 0.8) : {}
  map.setFilter('drill-kids', top ? noneF : ['all', kidF])
  map.setFilter('drill-kids-line', ['all', kidF, ['!', ['to-boolean', ['get', 'igp']]]])
  map.setFilter('drill-kids-igp-line', top ? noneF : ['all', kidF, ['to-boolean', ['get', 'igp']]])
  map.setFilter('drill-kids-dot', top ? noneF : kidF)
  map.setFilter('drill-grand', ['in', ['get', 'id'], ['literal', kids.flatMap(k => N[k].children || [])]])
  map.setFilter('drill-focus-line', ['==', ['get', 'id'], top ? '__none__' : focus])
  map.setFilter('drill-focus-fill', top ? kidF : ['==', ['get', 'id'], focus])
  map.setPaintProperty('drill-focus-fill', 'fill-opacity', top ? 0.62 : kids.some(k => !N[k].unmapped) ? 0.14 : 0.5)
  map.setFilter('drill-labels', top ? noneF : kidF)
  map.setFilter('drill-region-labels', top ? kidF : noneF)
  applySelect()
  applyContext()
  applyMode()
  map.getSource('veil').setData(top ? veilFor([]) : veilFor(regionsFp))
}
function applySelect() {
  const sel = ['==', ['get', 'id'], select || '__none__']
  map.setFilter('drill-selected', isTop(focus) ? ['==', ['get', 'id'], '__none__'] : sel)
  const extra = select ? [select] : [] // a place picked from the list is always drawn, however small
  map.setPaintProperty('drill-kids', 'fill-opacity', fadeExpr(openZ, { extra,
    times: ['case', ['to-boolean', ['get', 'igp']], 0.35, select ? ['case', ['==', ['get', 'id'], select], 0.95, 0.7] : 0.92] }))
  map.setPaintProperty('drill-kids-line', 'line-opacity', fadeExpr(openZ, { extra }))
  map.setPaintProperty('drill-kids-igp-line', 'line-opacity', fadeExpr(openZ, { extra, times: 0.8 }))
  map.setPaintProperty('drill-grand', 'line-opacity', fadeExpr(grandZ, { times: 0.5 }))
  // the dot carries the place while its shape is held back, so the name stays put throughout and never fades on its own
  const dots = dotExpr(Object.fromEntries(Object.entries(openZ).map(([id, z]) => [id, extra.includes(id) ? ALWAYS : z])))
  map.setPaintProperty('drill-kids-dot', 'circle-opacity', dots)
  map.setPaintProperty('drill-kids-dot', 'circle-stroke-opacity', dots)
  const P = PALETTES[scheme]
  map.setPaintProperty('drill-labels', 'text-color', ['case', sel, scheme === 'dark' ? '#1B1012' : '#FFFFFF', P.placeLabel])
  map.setPaintProperty('drill-labels', 'text-halo-color', ['case', sel, ['match', ['get', 'family'], ...FAMILY[scheme].flatMap((c, i) => [i, c]), '#888'], P.halo])
}
function applyContext() {
  ctx = contextFor(focus)
  const f = ['in', ['get', 'id'], ['literal', ctx]]
  for (const l of ['drill-context', 'drill-context-line', 'drill-context-labels']) map.setFilter(l, f)
}

const descOf = id => { const out = [], st = [...(N[id]?.children || [])]; while (st.length) { const k = st.pop(); out.push(k); st.push(...(N[k].children || [])) } return out }
const ancOf = id => { const out = []; for (let p = N[id]?.parent; p; p = N[p].parent) out.push(p); return out }
/** The exam places to pin: inside the focus (lens: the lens's places anywhere), less those already drawn as its children. */
function pinIds() {
  if (mode === 'lens') return (LENS[lensCh] || []).filter(id => N[id].kind !== 'region' && !kids.includes(id))
  if (isTop(focus)) return []
  return descOf(focus).filter(id => EXAM.has(id) && !kids.includes(id) && N[id].kind !== 'region')
}
function applyMode() {
  const P = PALETTES[scheme], F = FAMILY[scheme]
  const fam = ['match', ['get', 'family'], ...F.flatMap((c, i) => [i, c]), '#888']
  const top = isTop(focus)
  const fresh = drillLayers(scheme, P.sea)
  for (const id of ['drill-kids', 'drill-kids-dot', 'drill-context', 'drill-selected', 'drill-focus-fill']) {
    const l = fresh.find(x => x.id === id), prop = id === 'drill-kids-dot' ? 'circle-color' : 'fill-color'
    map.setPaintProperty(id, prop, l.paint[prop])
  }
  if (top) map.setPaintProperty('drill-focus-fill', 'fill-opacity', 0.62)
  if (mode === 'progress') {
    const pe = progExpr()
    for (const id of ['drill-kids', 'drill-context', 'drill-selected']) map.setPaintProperty(id, 'fill-color', pe)
    map.setPaintProperty('drill-kids-dot', 'circle-color', pe)
    if (top) { map.setPaintProperty('drill-focus-fill', 'fill-color', pe); map.setPaintProperty('drill-focus-fill', 'fill-opacity', 0.9) }
  }
  if (mode === 'lens') {
    // places that hold the lens's GIs keep their colour; everything else steps back
    const lit = new Set((LENS[lensCh] || []).flatMap(id => [id, ...ancOf(id)]))
    const dim = ['case', ['in', ['get', 'id'], ['literal', [...lit]]], 1, 0.18]
    map.setPaintProperty('drill-kids', 'fill-opacity', ['*', 0.92, dim])
    if (top) map.setPaintProperty('drill-focus-fill', 'fill-opacity', ['*', 0.7, dim])
    map.setPaintProperty('drill-context', 'fill-opacity', ['*', 0.7, dim])
  } else applySelectOpacity?.()
  const pins = pinIds(), pe = mode === 'progress' ? progExpr() : P.pdoFill
  const pf = ['in', ['get', 'id'], ['literal', pins]]
  map.setFilter('exam-pin', pins.length ? pf : ['==', ['get', 'id'], '__none__'])
  map.setFilter('exam-pin-label', pins.length ? pf : ['==', ['get', 'id'], '__none__'])
  map.setPaintProperty('exam-pin', 'circle-color', pe)
  drawLegend()
}
let applySelectOpacity = null
function drawLegend() {
  const lg = $('#legend')
  lg.hidden = tab !== 'atlas' || mode === 'regions'
  if (mode === 'progress') lg.innerHTML = `<b>My progress</b>${['secure', 'partly', 'shaky', 'none'].map(k => `<span><i class="lg" style="background:${PROG[scheme][k]}"></i>${STATUS_TXT[k]}</span>`).join('')}<span><i class="lg nq"></i>No questions yet</span>`
  if (mode === 'lens') lg.innerHTML = `<b>${esc(CH[lensCh])}</b><span>${(LENS[lensCh] || []).length} key places in France</span><button class="lg-x" type="button" data-lens-off>Clear</button>`
}

// ---- camera helpers ----
function camera(move, after) { // a camera move the app makes itself
  programmatic = true
  let done = false
  const end = () => { if (done) return; done = true; programmatic = false; after?.() }
  map.once('moveend', end)
  setTimeout(end, 1600) // safety net if no move happens
  move()
}
function glideTo(bbox, opts = {}) {
  camera(() => map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: pad(), duration: reduceMotion ? 0 : 750, maxZoom: 14, ...opts }),
    () => { applyContext(); renderUI() })
}
/** Enter a place (tap on the map, a chip, Back): it becomes the focus and the map glides to it. The sheet keeps its height. */
function goTo(id, sel = null) {
  if (detent === 'full') setDetent('half') // the map is hidden at full height, so there is nothing to glide into (item 10's rule)
  focus = id; select = sel
  applyFocus(); renderUI(); announce(N[sel || id])
  if (N[id].bbox) glideTo(N[id].bbox)
}
/** item 10: pick a place from the list, or tap an end place, and make sure it can be seen. */
function reveal(id, { pulseIt = true } = {}) {
  const n = N[id]; if (!n?.bbox) return
  if (detent === 'full') setDetent('half')
  const s = screenBox(n.bbox), r = openRect(), m = 12
  const size = Math.max(s.x1 - s.x0, s.y1 - s.y0)
  const want = Math.max(40, S.minpx) // big enough to see, and big enough to be drawn (round 3)
  const inView = s.x0 >= r.left + m && s.x1 <= r.right - m && s.y0 >= r.top + m && s.y1 <= r.bottom - m
  const done = () => { if (pulseIt) pulse(id) }
  if (inView && size >= want) { done(); return }
  const cam = map.cameraForBounds([[n.bbox[0], n.bbox[1]], [n.bbox[2], n.bbox[3]]], { padding: pad(), maxZoom: 14 })
  let zoom = map.getZoom()
  if (size < want) zoom = Math.max(zoom, cam.zoom - 1.3) // zoom in until it's easy to see
  if (size > Math.min(r.right - r.left, r.bottom - r.top)) zoom = cam.zoom // too big for the open map: fit it
  camera(() => map.easeTo({ center: cam.center, zoom, duration: reduceMotion ? 0 : 650 }), () => { applyContext(); done() })
}
let pulseRaf = 0
function pulse(id) {
  cancelAnimationFrame(pulseRaf)
  const f = ['==', ['get', 'id'], id]
  map.setFilter('drill-pulse', f); map.setFilter('drill-pulse-dot', f)
  const t0 = performance.now(), dur = reduceMotion ? 1 : 1000
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3)
    map.setPaintProperty('drill-pulse', 'line-width', reduceMotion ? 3 : 2 + 8 * e)
    map.setPaintProperty('drill-pulse', 'line-opacity', reduceMotion ? 0.9 : 0.9 * (1 - e))
    map.setPaintProperty('drill-pulse-dot', 'circle-radius', 6 + 18 * e)
    map.setPaintProperty('drill-pulse-dot', 'circle-stroke-opacity', 0.9 * (1 - e))
    if (t < 1) pulseRaf = requestAnimationFrame(step)
  }
  pulseRaf = requestAnimationFrame(step)
}

// ---- item 9: zooming and panning move the focus ----
// Round 3 (feedback): regions differ in size by 13x, so "fills 60% of the screen" happens at a different zoom for each
// one, and panning across at one zoom could open the South West while Bordeaux stayed shut. So: **panning never takes
// you deeper.** A pan moves you sideways at the level you're already on; only zooming (or a tap) changes the level.
let evalTimer = 0, lastLive = 0, gestureZoom = null
const zoomedThisGesture = () => gestureZoom === null || Math.abs(map.getZoom() - gestureZoom) > 0.03
let evals = 0
function evaluate() {
  if (programmatic) return
  evals++
  const before = focus
  const c = centre()
  const zoomed = zoomedThisGesture()
  // up: the focus has shrunk below the "step out" size. A firm pinch out carries you up several levels at once.
  if (zoomed && !isTop(focus) && fill(focus) < S.exit / 100) {
    let up = focus
    while (!isTop(up) && fill(up) < S.exit / 100) up = upOf(up)
    setFocus(up); return cascade(before)
  }
  // sideways: the centre has left the focus and sits on a place beside it. This keeps the level, so panning may do it.
  if (!isTop(focus)) {
    const inFocus = map.queryRenderedFeatures(around(c, 3), { layers: ['drill-focus-fill'] }).some(h => h.properties.id === focus)
    if (!inFocus) {
      const anc = new Set(); for (let a = N[focus].parent; a; a = N[a].parent) anc.add(a)
      // no size test here: a sideways move keeps the level, so the place under the middle wins whatever its size.
      // (testing the size meant that at one zoom you could move into the South West but not into Bordeaux.)
      const hit = map.queryRenderedFeatures(around(c, 6), { layers: ['drill-context'] }).map(h => h.properties.id)
        .find(id => id && !isTop(id) && !anc.has(id) && id !== focus)
      if (hit) { setFocus(hit); return cascade(before) }
      // panned right away from where you were, with nothing beside it: come up until you can see where you are
      if (!zoomed && !onScreen(focus)) {
        let up = focus
        while (!isTop(up) && !onScreen(up)) up = upOf(up)
        if (up !== focus) { setFocus(up); return cascade(before) }
      }
    }
  }
  // down: only a zoom (or a tap) goes deeper, and only into a place that is drawn and fills most of the screen
  if (zoomed) {
    const layers = isTop(focus) ? ['drill-focus-fill'] : ['drill-kids', 'drill-kids-dot']
    const kid = map.queryRenderedFeatures(around(c, 4), { layers }).map(h => h.properties.id)
      .find(id => kids.includes(id) && (isTop(focus) || shown(id)))
    if (kid && hasKids(kid) && canEnterByZoom(kid) && fill(kid) >= S.enter / 100) { setFocus(kid); return cascade(before) }
  }
  applyContext() // same focus: just refresh the surrounding places for the new zoom
  readout()
}
function setFocus(id) {
  focus = id
  if (select && !visibleChildren(focus).includes(select)) select = null
  applyFocus(); renderUI(); announce(N[focus])
}
function cascade(from) { // after a change, check again once the map has drawn the new level (e.g. a fast zoom through two levels)
  readout(from)
  map.once('idle', () => { if (S.timing !== 'release' || !gesture) evaluate() })
}
let gesture = false
map.on('movestart', e => {
  // every move the app makes itself sets `programmatic`, so anything else is the viewer's own gesture.
  // (a wheel zoom carries no originalEvent, so testing for one used to miss it entirely)
  if (programmatic) return
  gesture = true
  gestureZoom = map.getZoom() // a gesture that doesn't change this is a pan, and a pan never goes deeper
  if (detent !== 'bar') setDetent('bar') // D28: moving the map yourself drops the sheet to the bar
})
map.on('move', e => {
  if (programmatic || !gesture) return
  if (S.timing === 'live') { const now = performance.now(); if (now - lastLive > 140) { lastLive = now; evaluate() } }
  else if (S.timing === 'pause') { clearTimeout(evalTimer); evalTimer = setTimeout(evaluate, 200) }
  readout()
})
map.on('moveend', () => {
  if (programmatic) return
  if (gesture) { clearTimeout(evalTimer); evaluate() }
  gesture = false
})

// ---- taps on the map (item 7: never change the sheet's height) ----
map.on('click', e => {
  const b = around([e.point.x, e.point.y], 12)
  const layers = isTop(focus) ? ['drill-focus-fill'] : ['drill-kids', 'drill-kids-dot']
  const kid = map.queryRenderedFeatures(b, { layers }).map(h => h.properties.id).find(id => kids.includes(id))
  if (kid) {
    if (hasKids(kid)) goTo(kid)
    else { select = kid; applySelect(); renderUI(); announce(N[kid]); reveal(kid) }
    return
  }
  const side = map.queryRenderedFeatures(b, { layers: ['drill-context'] }).map(h => h.properties.id).find(id => ctx.includes(id))
  if (side) {
    if (hasKids(side)) goTo(side)
    else { focus = upOf(side); select = side; applyFocus(); renderUI(); announce(N[side]); reveal(side) }
    return
  }
  if (select) { select = null; applySelect(); renderUI() }
})

// ---- sheet ----
let safeB = 0
function measure() {
  const H = window.innerHeight
  safeB = parseFloat(getComputedStyle($('#safe-probe')).paddingBottom) || 0
  SHEET.bar = 78; SHEET.half = Math.round(H * 0.58); SHEET.full = H - 104 - safeB
}
const TABH = 64
const sheetHeight = () => SHEET[detent] + (detent === 'bar' ? TABH + 10 : 0)
function setDetent(d, { camera = false } = {}) {
  detent = d
  const el = $('#sheet'); el.style.height = SHEET[d] + 'px'; el.dataset.detent = d
  $('#tabs').classList.toggle('away', d !== 'bar' && tab === 'atlas')
  $('#sheet-body').inert = d === 'bar'
  $('#sheet-head').setAttribute('aria-expanded', d === 'bar' ? 'false' : 'true')
  if (camera && N[focus].bbox) glideTo(N[focus].bbox, { duration: 0 })
}
function initSheet() {
  measure(); setDetent('bar')
  const head = $('#sheet-head'), el = $('#sheet')
  let startY = 0, startH = 0, moved = false, lastY = 0, lastT = 0, v = 0
  head.addEventListener('pointerdown', e => {
    startY = lastY = e.clientY; startH = el.offsetHeight; moved = false; lastT = performance.now(); v = 0
    head.setPointerCapture(e.pointerId); el.classList.add('dragging')
  })
  head.addEventListener('pointermove', e => {
    if (!head.hasPointerCapture(e.pointerId)) return
    const dy = e.clientY - startY
    if (Math.abs(dy) > 6) moved = true
    const now = performance.now(); v = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now
    if (moved) el.style.height = Math.max(SHEET.bar, Math.min(SHEET.full, startH - dy)) + 'px'
  })
  head.addEventListener('pointerup', e => {
    el.classList.remove('dragging')
    if (!moved) { setDetent(detent === 'bar' ? 'half' : detent === 'half' ? 'full' : 'half'); return }
    const h = el.offsetHeight - v * 180 // a flick carries on in its direction
    const order = ['bar', 'half', 'full']
    setDetent(order.reduce((a, d) => Math.abs(SHEET[d] - h) < Math.abs(SHEET[a] - h) ? d : a, 'bar'))
  })
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetent(detent === 'bar' ? 'half' : 'bar') } })
  addEventListener('resize', () => { measure(); setDetent(detent) })
}

// ---- sheet content ----
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const star = n => n.key ? '<span class="star" aria-label="key place">★</span>' : ''
const note = t => t ? `<p class="note">${esc(t)}</p>` : ''
function chip(k) {
  const n = N[k], on = k === select
  const col = mode === 'progress' ? PROG[scheme][statusOf(k)] : (on ? FAMILY[scheme][n.family] : nodeColour(scheme, n))
  const sw = n.unmapped ? `<i class="sw empty"></i>` : `<i class="sw" style="background:${col}${mode === 'progress' && statusOf(k) === 'nq' ? ';box-shadow:inset 0 0 0 1.2px var(--wa-label-3)' : ''}"></i>`
  return `<button class="chip${on ? ' on' : ''}" data-id="${k}" type="button">${sw}<span>${esc(displayName(n))}</span>${star(n)}${hasKids(k) ? '<span class="more" aria-hidden="true">›</span>' : ''}</button>`
}
function groups(ks) {
  if (!ks.some(k => N[k].cru)) return [['', ks]]
  return [['Grands crus', ks.filter(k => N[k].cru === 'grand cru')], ['Premiers crus', ks.filter(k => N[k].cru === 'premier cru')],
    ['Other villages', ks.filter(k => !N[k].cru)]].filter(g => g[1].length)
}
function ownNotes(n) { // item 2: the selected place's own notes, straight under its title
  const also = (n.also || []).filter(a => !a.umbrella)
  const partOf = (n.also || []).filter(a => a.umbrella).map(a => a.name)
  return [
    n.unmapped ? note(n.note || 'Not yet mapped.') : note(n.note),
    also.length ? `<p class="note">Same area: ${also.map(a => esc(a.name) + (a.note ? ` (${esc(a.note)})` : '')).join(', ')}</p>` : '',
    partOf.length ? note(`Part of the ${partOf.join(', ')} appellation`) : '',
    n.shape_note ? note(n.shape_note) : '',
  ].join('')
}
function focusNotes(n) {
  const wide = (n.region_wide || []).map(w => esc(w.name) + (w.igp ? ' (IGP)' : '') + (w.key ? ' ★' : '')).join(', ')
  const others = isTop(n.id) && n.other_areas?.length
    ? `Hatched grey: other French wine areas, outside the ten study regions (${n.other_areas.map(o => o.name).join(', ')}).` : ''
  return [
    wide ? `<p class="note">Covers the whole region: ${wide}</p>` : '',
    note(n.grouping_note),
    n.climats ? note(`Climats (listed by INAO, not mapped separately): ${n.climats.join(', ')}`) : '',
    n.unmapped ? '' : note(n.note),
    n.hectares ? note(`About ${n.hectares.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ha of vines (Union des Maisons de Champagne)`) : '',
    n.kind === 'region' && n.shape_note ? note(n.shape_note) : '',
    note(others),
    kids.some(k => N[k].unmapped) ? note('Outlined swatch: not yet mapped.') : '',
  ].join('')
}
let lastShown = null
function renderUI() {
  const f = N[focus], s = select ? N[select] : null, shown = s || f
  if (shown.id !== lastShown) { lastShown = shown.id; requestAnimationFrame(() => { $('#sheet-body').scrollTop = 0 }) }
  const crumbs = path(shown.id).slice(0, -1)
  const inside = kids.length
  const st = statusOf(shown.id)
  const meta = isTop(shown.id) ? `${EXAM.size} key places` : SP[shown.id]?.status?.n ? STATUS_TXT[st] : kindLabel(shown)
  $('#eyebrow').textContent = crumbs.join(' · ') || 'Wine Atlas'
  $('#title').innerHTML = `${esc(displayName(shown))}${star(shown)}`
  $('#meta').innerHTML = (SP[shown.id]?.status?.n ? `<i class="sdot ${st}"></i>` : '') + esc(meta)
  $('#sheet-head').setAttribute('aria-label', `${displayName(shown)}, ${meta}. ${detent === 'bar' ? 'Show details' : 'Change sheet height'}`)
  const back = $('#back')
  back.hidden = isTop(focus)
  back.querySelector('span').textContent = isTop(focus) ? '' : N[upOf(focus)].name
  const list = groups(kids).map(([h, ks]) => `${h ? `<h3 class="group">${h}</h3>` : ''}<div class="chips">${ks.map(chip).join('')}</div>`).join('')
  $('#sheet-body').innerHTML = sheetFor(shown.id, s, f, list)
  readout()
}
$('#sheet-body').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return
  const id = b.dataset.id, n = N[id]
  if (hasKids(id)) { goTo(id); return }
  select = id; applySelect(); renderUI(); announce(n)
  if (!n.unmapped) reveal(id)
})
$('#back').addEventListener('click', () => { const up = upOf(focus); goTo(up) })

// ---- screen reader: the sheet may stay closed, so say where you are ----
function announce(n) { if (n) $('#live').textContent = `${displayName(n)}, ${kindLabel(n)}` }

// ---- settings panel and readout ----
function readout(from) {
  const el = $('#readout'); el.hidden = !S.readout
  if (!S.readout) return
  const fz = isTop(focus) ? '' : ` · fills ${Math.round(fill(focus) * 100)}%`
  const mode = { region: 'regions', subregion: 'regions + sub-regions', all: 'every level' }[S.depth]
  const drawn = isTop(focus) ? '' : ` · ${kids.filter(shown).length}/${kids.length} drawn`
  el.textContent = `${N[focus].name}${fz}${drawn} · pinch in: ${mode} · in at ${S.enter}% · out below ${S.exit}% · zoom ${map.getZoom().toFixed(1)}` +
    (from && from !== focus ? `  (from ${N[from].name})` : '')
}
function initPanel() {
  const p = $('#panel')
  $('#tune').addEventListener('click', () => { p.hidden = !p.hidden; $('#tune').setAttribute('aria-expanded', String(!p.hidden)) })
  $('#panel-close').addEventListener('click', () => { p.hidden = true; $('#tune').setAttribute('aria-expanded', 'false') })
  for (const r of document.querySelectorAll('input[name="timing"]')) {
    r.checked = r.value === S.timing
    r.addEventListener('change', () => { S.timing = r.value; saveSettings() })
  }
  for (const r of document.querySelectorAll('input[name="depth"]')) {
    r.checked = r.value === S.depth
    r.addEventListener('change', () => { S.depth = r.value; saveSettings(); applyContext(); readout() })
  }
  const bind = (id, key, out) => { const i = $(id); i.value = S[key]; $(out).textContent = S[key] + '%'
    i.addEventListener('input', () => { S[key] = +i.value; $(out).textContent = S[key] + '%'
      if (S.exit > S.enter - 10) { if (key === 'enter') S.exit = S.enter - 10; else S.enter = S.exit + 10
        $('#enter').value = S.enter; $('#exit').value = S.exit; $('#enter-v').textContent = S.enter + '%'; $('#exit-v').textContent = S.exit + '%' }
      saveSettings(); readout() }) }
  bind('#enter', 'enter', '#enter-v'); bind('#exit', 'exit', '#exit-v')
  const mp = $('#minpx'), mpv = $('#minpx-v')
  const showMin = () => { mpv.textContent = S.minpx ? S.minpx + ' px' : 'off' }
  mp.value = S.minpx; showMin()
  mp.addEventListener('input', () => { S.minpx = +mp.value; showMin(); saveSettings(); applyFocus(); readout() })
  const sf = $('#star-first'); sf.checked = S.starFirst
  sf.addEventListener('change', () => { S.starFirst = sf.checked; saveSettings(); applyFocus(); readout() })
  const ro = $('#show-readout'); ro.checked = S.readout
  ro.addEventListener('change', () => { S.readout = ro.checked; saveSettings(); readout() })
  $('#reset').addEventListener('click', () => {
    Object.assign(S, { timing: 'pause', enter: 60, exit: 50, depth: 'region', minpx: 56, starFirst: true })
    saveSettings(); initPanelValues(); applyFocus() })
  const initPanelValues = () => { for (const r of document.querySelectorAll('input[name="timing"], input[name="depth"]')) r.checked = r.value === S[r.name]
    $('#enter').value = S.enter; $('#exit').value = S.exit; $('#enter-v').textContent = S.enter + '%'; $('#exit-v').textContent = S.exit + '%'
    mp.value = S.minpx; showMin(); sf.checked = S.starFirst }
  $('#theme').addEventListener('click', () => {
    const next = scheme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next; restyle()
  })
}
function restyle() {
  const next = themeOf(); if (next === scheme) return
  scheme = next
  map.setStyle(styleFor(scheme))
  map.once('styledata', () => { applyFocus(); renderUI() })
}
new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyle)


// ================= concept v2: the study layer, organised the way the exam asks =================
let tab = 'atlas'
const STATUS_TXT = { secure: 'Secure', partly: 'Learning', shaky: 'Shaky', none: 'Not tried yet', nq: 'No questions yet' }
const FACET = [['why', 'Why it tastes that way'], ['style', 'Style notes'], ['label', 'Label and quality'], ['making', 'Winemaking'], ['other', 'Other notes']]
const profTab = {}
const north = id => -(N[id]?.bbox?.[3] ?? 0)
const srcOf = f => [f.ch ? `Ch ${f.ch}` : null, f.topic, (f.src || '').replace(/^L[23] /, '')].filter(Boolean).join(' · ')
const grapesOf = id => [...new Map((SP[id]?.exam || []).map(e => [e.ch, e])).values()]

function statLine(id) {
  const st = SP[id]?.status
  if (!st || !st.n) return ''
  const bits = [st.asked ? `You've tried ${st.asked} of ${st.n} practice questions` : `${st.n} practice questions, none tried yet`]
  if (st.miss) bits.push(`${st.miss} to revisit`)
  if (st.mast) bits.push(`${st.mast} secure`)
  return `<p class="statline">${bits.join(' · ')}</p>`
}
function examLine(id) {
  const g = grapesOf(id), n = N[id]
  if (DECKS[id]) return g.length ? `<div class="course compact">${g.map(e => `<button class="chip lens-chip" type="button" data-lens="${e.ch}" aria-label="Follow ${esc(e.grape)} on the map"><span>★ ${esc(e.grape)}</span><small>Ch ${e.ch}</small></button>`).join('')}</div>` : ''
  const head = g.length
    ? `<h3 class="group">Known for</h3><div class="course">${g.map(e => `<button class="chip lens-chip" type="button" data-lens="${e.ch}" aria-label="Follow ${esc(e.grape)} on the map"><span>★ ${esc(e.grape)}</span><small>Ch ${e.ch}</small></button>`).join('')}</div>`
    : ''
  return head + statLine(id)
}
function examPlacesList(id) {
  const ids = (SP[id]?.examPlaces || []).slice().sort((a, b) => north(a) - north(b))
  if (!ids.length) return ''
  return `<h3 class="group">Key places · ${ids.length}<span class="hint-r">north to south</span></h3><div class="rows">${ids.map(k =>
    `<button class="prow" type="button" data-go="${k}"><i class="sdot ${statusOf(k)}" aria-label="${STATUS_TXT[statusOf(k)]}"></i><span class="pn">${esc(N[k].name)}</span><span class="pg">${grapesOf(k).map(e => esc(e.grape)).join(', ')}</span><span class="chev-r" aria-hidden="true">›</span></button>`).join('')}</div>`
}
const LV = { low: 1, light: 1, lighter: null, 'medium(-)': 2, medium: 3, 'medium(+)': 4, high: 5, full: 5, 'very high': 5, pronounced: 5 }
function scale(text) {
  const t = String(text).toLowerCase().replace(/\s*\(\s*([+-])\s*\)/g, '($1)')
  const m = t.match(/^(very high|low|light|medium\([+-]\)|medium|high|full)(?:\s+to\s+(very high|low|light|medium\([+-]\)|medium|high|full))?$/)
  if (!m) return ''
  const a = LV[m[1]], b = m[2] ? LV[m[2]] : a, lo = Math.min(a, b), hi = Math.max(a, b)
  return `<span class="scale" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i >= lo && i <= hi ? 'on' : ''}"></i>`).join('')}</span>`
}
const COLNAME = { 'Climate': 'Climate', 'Body': 'Body', 'Acidity': 'Acidity', 'Tannin': 'Tannin', 'Key flavours': 'Flavours', 'Oak / making': 'Making', 'Quality / note': 'Quality' }
function profileBlock(id) {
  const ps = SP[id]?.profiles || []
  const byCh = [...new Set(ps.map(p => p.ch))]
  if (!byCh.length) {
    // regional grapes have no comparison table: show the card's own style line for the exam grape instead
    const ex = new Set(grapesOf(id).map(e => e.ch))
    const line = (SP[id]?.facts || []).find(f => f.level === 'L2' && f.facet === 'style' && ex.has(f.ch)) || (SP[id]?.facts || []).find(f => f.level === 'L2' && f.facet === 'style')
    if (!line) return ''
    return `<h3 class="group">Style</h3><div class="prof"><p class="prof-line">${esc(line.text)}</p><p class="src">${esc(srcOf(line))}</p></div>`
  }
  const cur = byCh.includes(profTab[id]) ? profTab[id] : byCh[0]
  const seg = byCh.length > 1 ? `<div class="seg2" role="tablist">${byCh.map(c => `<button type="button" role="tab" aria-selected="${c === cur}" data-ptab="${id}|${c}">${esc(CH[c])}</button>`).join('')}</div>` : ''
  const cards = ps.filter(p => p.ch === cur).map(p => `<div class="prof">
    <div class="prof-h"><b>${esc(p.label)}</b><span>${byCh.length > 1 ? '' : esc(CH[p.ch]) + ' · '}Ch ${p.ch}</span></div>
    ${p.via ? `<p class="via">From the ${esc(p.via)} row: the table has no row of its own for ${esc(N[id].name)}.</p>` : ''}
    <dl>${p.cols.map((c, i) => p.vals[i] ? `<div><dt>${esc(COLNAME[c] || c)}</dt><dd>${['Body', 'Acidity', 'Tannin'].includes(c) ? scale(p.vals[i]) : ''}<span>${esc(p.vals[i])}</span></dd></div>` : '').join('')}</dl>
    <p class="src">Your Ch ${p.ch} comparison table</p></div>`).join('')
  return `<h3 class="group">Style profile</h3>${seg}${cards}`
}
function factsBlock(id) {
  const fs = (SP[id]?.facts || []).filter(f => f.level === 'L2')
  if (!fs.length) return ''
  return FACET.map(([k, title]) => {
    const g = fs.filter(f => f.facet === k); if (!g.length) return ''
    return `<h3 class="group">${title}</h3><ul class="lines">${g.map(f => `<li>${esc(f.text)}<span class="src">${esc(srcOf(f))}</span></li>`).join('')}</ul>`
  }).join('')
}
function stretchBlock(id) {
  const fs = (SP[id]?.facts || []).filter(f => f.level === 'L3')
  if (!fs.length) return ''
  const name = Object.fromEntries(FACET)
  return `<details class="fold"><summary><span class="l3">L3 stretch</span>Level 3 depth · ${fs.length}</summary><ul class="lines">${fs.map(f =>
    `<li><span class="ftag">${esc(name[f.facet] || '')}</span>${esc(f.text)}<span class="src">${esc(srcOf(f))}</span></li>`).join('')}</ul></details>`
}
function mentionsBlock(id) {
  const ms = SP[id]?.mentions || []
  if (!ms.length) return ''
  return `<details class="fold"><summary>Passing mentions in other cards · ${ms.length}</summary><ul class="lines quietl">${ms.map(f =>
    `<li>${esc(f.text)}<span class="src">${esc(srcOf(f))}</span></li>`).join('')}</ul></details>`
}
function gapsBlock(id) {
  const g = SP[id]?.gaps || []
  return g.length ? `<h3 class="group">Open gaps</h3>${g.map(x => `<p class="gap">${esc(x)}</p>`).join('')}` : ''
}
function quizBar(id) {
  const q = (SP[id]?.qids || []).length
  if (!q) return ''
  return `<div class="qdock"><button class="qbtn" type="button" data-quiz="${id}">Quiz me on ${esc(N[id].name)} · ${Math.min(q, 10)}</button></div>`
}
/** Progress across France's key places: counts, and the places worth revisiting. Shown in the sheet, not painted on the map. */
function progressBlock() {
  const ids = [...EXAM], by = k => ids.filter(id => statusOf(id) === k)
  const revisit = by('shaky').sort((a, b) => north(a) - north(b))
  return `<h3 class="group">Your progress</h3><div class="progsum">${['secure', 'partly', 'shaky', 'none'].map(k => `<span><i class="sdot ${k}"></i><b>${by(k).length}</b>${STATUS_TXT[k].toLowerCase()}</span>`).join('')}</div>
    ${revisit.length ? `<p class="sub2">Worth revisiting</p><div class="rows">${revisit.map(k => `<button class="prow" type="button" data-go="${k}"><i class="sdot shaky" aria-label="Shaky"></i><span class="pn">${esc(N[k].name)}</span><span class="pg">${grapesOf(k).map(e => esc(e.grape)).join(', ')}</span><span class="chev-r" aria-hidden="true">›</span></button>`).join('')}</div>` : ''}`
}
function franceHub() {
  const regs = N.fr.children.filter(r => !N[r].unmapped)
  const lensChips = Object.keys(LENS).map(Number).sort((a, b) => a - b).map(c => `<button class="chip lens-chip" type="button" data-lens="${c}"><span>${esc(CH[c])}</span></button>`).join('')
  return `<p class="statline">${EXAM.size} key places across France's wine regions. Open a region, or follow a grape across the map.</p>
    ${progressBlock()}
    <h3 class="group">Follow a grape</h3><div class="course">${lensChips}</div>
    <h3 class="group">Regions</h3><div class="rows">${regs.map(r => {
      const ex = (SP[r]?.examPlaces || []).length + (SP[r]?.exam.length ? 1 : 0)
      return `<button class="prow" type="button" data-go="${r}"><i class="sdot ${statusOf(r)}" aria-label="${STATUS_TXT[statusOf(r)]}"></i><span class="pn">${esc(N[r].name)}</span><span class="pg">${ex ? `${ex} key place${ex > 1 ? 's' : ''}` : 'Level 3 only'}</span><span class="chev-r" aria-hidden="true">›</span></button>` }).join('')}</div>`
}
// The Atlas is the geographical view: what a place is, where it sits, how you're doing, and the way into Study.
// The reading itself lives in Study.
const TOPKEY = {}
for (const [ch, ts] of Object.entries(SL.topics || {})) for (const t of ts) TOPKEY[ch + '|' + t.name] = t.key
function studyLinks(id) {
  for (let x = id; x && x !== 'fr'; x = N[x]?.parent) { // a village with no notes of its own borrows its region's links
    const m = new Map()
    for (const f of SP[x]?.facts || []) {
      if (f.level !== 'L2' || !f.ch) continue
      const k = TOPKEY[f.ch + '|' + f.topic]; if (!k) continue
      m.set(f.ch + '|' + k, (m.get(f.ch + '|' + k) || 0) + 1)
    }
    if (!m.size) continue
    const ex = new Set(grapesOf(x).map(e => e.ch))
    const rows = [...m].map(([key, n]) => { const [ch, k] = key.split('|'); return { ch: +ch, k, n, name: SL.topics[ch].find(t => t.key === k).name } })
      .sort((a, b) => (ex.has(b.ch) - ex.has(a.ch)) || b.n - a.n).slice(0, 4)
    return { via: x === id ? null : x, rows }
  }
  return { via: null, rows: [] }
}
const PLACE_NAMES = new Set(Object.values(N).map(n => n.name))
/** A topic's name read on its own, outside its chapter: "France" in the Chardonnay chapter becomes "Chardonnay in France". */
function topicTitle(ch, name, grape) {
  const g = grape || CH[ch]
  if (name === 'The grape') return `${g}, the grape`
  if (name === 'Regions') return `Where ${g} grows`
  if (name === 'Outside France') return `${g} outside France`
  if (/^Spec:/.test(name)) return `${g}: places and label terms`
  if (name === 'France' || PLACE_NAMES.has(name)) return `${g} in ${name}`
  return name
}
const topicName = name => /^Spec:/.test(name) ? 'Places and label terms' : name
const lessonsFor = (ch, key) => Object.keys(DECKS).filter(d => (DECKS[d].topics || []).includes(ch + '|' + key))
/** Where to study this place: links into Study topics, each with its read tick. The lessons themselves live in Study (D46, 2 Nov). */
function studyBlock(id) {
  const { via, rows } = studyLinks(id)
  if (!rows.length) return ''
  const gr = Object.fromEntries(grapesOf(via || id).map(e => [e.ch, e.grape]))
  const read = r => BR ? BR.isRead(r.ch, r.k) : readTopics.has(r.ch + '|' + r.k)
  const lesson = r => lessonsFor(r.ch, r.k).length > 0
  return `<h3 class="group">Study it</h3>${via ? `<p class="note">Covered with ${esc(N[via].name)}.</p>` : ''}<div class="rows">${rows.map(r =>
    `<button class="trow" type="button" data-study="${r.ch}|${r.k}"><span class="tt"><span class="pn">${esc(topicTitle(r.ch, r.name, gr[r.ch]))}</span>${lesson(r) ? '<small>Short lesson</small>' : ''}</span><span class="rdk">${read(r) ? '✓ Read' : ''}</span><span class="chev-r" aria-hidden="true">›</span></button>`).join('')}</div>`
}
function knownFor(id) {
  const g = grapesOf(id)
  return g.length ? `<div class="course compact">${g.map(e => `<button class="chip lens-chip" type="button" data-lens="${e.ch}" aria-label="Follow ${esc(e.grape)} on the map"><span>★ ${esc(e.grape)}</span></button>`).join('')}</div>` : ''
}
function styleMini(id) {
  const seen = new Set(), ps = (SP[id]?.profiles || []).filter(p => !seen.has(p.ch) && seen.add(p.ch)).slice(0, 2)
  return ps.map(p => { const sc = scales(id, p.ch); return sc ? `<div class="mini"><p class="mini-h">${esc(CH[p.ch])} <span>· ${esc(p.label)}</span>${p.via ? ` <span>· from the ${esc(p.via)} row</span>` : ''}</p>${sc}</div>` : '' }).join('')
}
function sheetFor(id, s, f, list) {
  if (isTop(id)) return franceHub() + focusNotes(f)
  const n = N[id], area = n.kind === 'region' || n.kind === 'subregion', q = (SP[id]?.qids || []).length
  return [
    s ? ownNotes(s) : '',
    knownFor(id),
    DECKS[id]?.lead ? `<p class="lead">${esc(DECKS[id].lead)}</p>` : '',
    styleMini(id),
    statLine(id),
    studyBlock(id),
    area ? examPlacesList(id) : '',
    kids.length ? `<details class="fold"${area && !SP[id]?.examPlaces?.length ? ' open' : ''}><summary>${s ? 'Also in ' + esc(f.name) : 'All places in ' + esc(f.name)} · ${kids.length}</summary>${list}</details>` : '',
    focusNotes(f),
    q ? `<button class="btn2 qlink" type="button" data-quiz="${id}">Practise ${esc(n.name)}</button>` : '',
  ].join('')
}


// ---- lessons: the cards rewritten for reading, shown full screen one at a time (draft until Gavin ticks them) ----
const DECKS = SL.decks || {}, SRC = SL.srcLabels || {}, QS = SL.qstate || {}
const checked = new Set(BR ? BR.checked() : []), readIds = new Set(), lastCheck = {}
/** A lesson counts as read when its Study topics are read (shared with the app's own reading record). */
const lessonRead = id => BR ? (DECKS[id]?.topics || []).some(t => { const [c, k] = t.split('|'); return BR.isRead(c, k) }) : lessonRead(id)
/** Recompute every place's status from the app's live answers (same rules as build_v2.py's status()). */
function applyProgress() {
  if (!BR) return
  const Q = BR.progress()
  for (const k of Object.keys(QS)) delete QS[k]
  for (const [q, p] of Object.entries(Q)) QS[q] = { last: p.last }
  for (const p of Object.values(SP)) {
    const qids = (p.qids || []).filter(q => BR.question(q)?.level === 'L2')
    if (!qids.length) { p.status = { s: 'nq', n: 0, asked: 0 }; continue }
    const asked = qids.filter(q => Q[q])
    if (!asked.length) { p.status = { s: 'none', n: qids.length, asked: 0 }; continue }
    const miss = asked.filter(q => Q[q].last < 1).length, mast = qids.filter(q => Q[q]?.mastered).length
    p.status = { s: miss ? 'shaky' : mast === qids.length ? 'secure' : 'partly', n: qids.length, asked: asked.length, miss, mast }
  }
}
const KIND = { glance: 'At a glance', wine: 'The wine', why: 'Why', label: 'On the label', banks: 'The two banks', stretch: 'Level 3 stretch', check: 'Check yourself' }
const minutes = n => Math.max(1, Math.round(n * 20 / 60))
function lessonEntry(id) {
  const d = DECKS[id], n = d.cards.length
  return `<p class="lead">${esc(d.lead)}</p>${statLine(id)}
    <button class="qbtn lesson-btn" type="button" data-lesson="${id}">${lessonRead(id) ? 'Read again' : 'Start lesson'}<small>${n} cards · about ${minutes(n)} min${lessonRead(id) ? ' · ✓ read' : ''}</small></button>`
}
/** The check question rotates: last-time misses first, then ones never answered, then the rest; never the same one twice running. */
const deckQids = id => DECKS[id].topics && !N[id] ? [...new Set(DECKS[id].topics.flatMap(t => { const [ch, k] = t.split('|'); return (SL.topics[ch].find(x => x.key === k) || {}).qids || [] }))] : (SP[id]?.qids || [])
const readTopics = new Set()
function pickCheck(id) {
  const all = deckQids(id).filter(q => SL.questions[q] && q !== lastCheck[id])
  const pick = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null
  const q = pick(all.filter(q => QS[q] && QS[q].last < 1)) || pick(all.filter(q => !QS[q])) || pick(all) || lastCheck[id]
  lastCheck[id] = q; return q
}
const cap1 = t => t.charAt(0).toUpperCase() + t.slice(1)
// "Ch 6 · Burgundy · book p. 52-53" -> "Ch 6, p. 52-53"; one entry per chapter
const shortSrc = ids => [...new Set(ids.map(s => { const x = SRC[s] || s; const ch = (x.match(/Ch \d+/) || [''])[0]; const pg = (x.match(/(L3 )?book p\. [\d-]+/) || [''])[0].replace('book ', ''); return [ch, pg].filter(Boolean).join(', ') || x }))].join(' · ')
let LS = null // the open lesson: { id, i, qid, pick }
function scales(id, ch) {
  const p = (SP[id]?.profiles || []).find(x => x.ch === ch); if (!p) return ''
  const rows = ['Body', 'Acidity', 'Tannin'].map(k => { const i = p.cols.indexOf(k); return i >= 0 && p.vals[i] && scale(p.vals[i]) ? `<div class="drow"><span>${k}</span>${scale(p.vals[i])}<em>${esc(p.vals[i])}</em></div>` : '' }).join('')
  return rows ? `<div class="dscales">${rows}</div>` : ''
}
function slide(c, i) {
  const paras = (c.body || []).map(t => `<p>${esc(t)}</p>`).join('')
  let inner
  if (c.type === 'why') inner = `<div class="why1"><p class="wl">Because</p><p class="wc">${esc(c.pair.cause)}</p><p class="so">so</p><p class="we">${esc(c.pair.effect)}</p></div>`
  else if (c.type === 'banks') inner = ['left', 'right'].map(k => `<div class="bank"><b>${esc(c[k].head)}</b><p>${esc(c[k].body)}</p></div>`).join('')
  else if (c.type === 'wine') inner = paras + scales(LS.id, c.profile)
  else if (c.type === 'check') {
    const q = SL.questions[LS.qid], pk = LS.pick
    inner = `<p class="cq">${esc(q.stem)}</p>${Object.entries(q.options).map(([k, t]) => {
      const cls = !pk ? '' : k === q.answer ? 'ok' : k === pk ? 'bad' : 'dim'
      return `<button class="dopt ${cls}" type="button" data-lpick="${k}" ${pk ? 'disabled' : ''}><span>${pk && k === q.answer ? '✓' : pk && k === pk ? '✕' : k.toUpperCase()}</span>${esc(t)}</button>` }).join('')}
      ${pk ? `<p class="dfb ${pk === q.answer ? 'ok' : 'bad'}">${pk === q.answer ? 'Right.' : 'Not quite.'} ${esc(cap1(String(q.notes?.[q.answer] || '').replace(/^(correct|no)\s*[:.\-–]\s*/i, '')))}</p>` : ''}`
  } else inner = paras
  const src = (c.sources || []).length ? `<p class="lsrc">From your cards: ${esc(shortSrc(c.sources))}</p>` : ''
  return `<section class="slide sl-${c.type}" aria-label="${KIND[c.type]}, card ${i + 1}"><p class="lkind">${KIND[c.type]}</p>${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${inner}${src}</section>`
}
function openLesson(id, from) {
  const place = !!N[id]
  if (place && (tab !== 'atlas' || BR) && focus !== id) { if (tab !== 'atlas') showTab('atlas'); goTo(hasKids(id) ? id : upOf(id)) }
  LS = { id, i: 0, qid: pickCheck(id), pick: null, from }
  if (BR) BR.lesson(true)
  const v = $('#lessonv'); v.hidden = false; v.classList.toggle('nomap', !place); drawLesson()
  if (!place) return
  // the map stays visible above the lesson: frame the place in that strip
  const b = N[id].bbox, H = map.getContainer().clientHeight
  if (b) camera(() => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 76, bottom: H - 214 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0), left: 30, right: 30 }, duration: reduceMotion ? 0 : 600, maxZoom: 12 }))
}
function drawLesson() {
  const d = DECKS[LS.id], n = d.cards.length, last = LS.i === n - 1
  const v = $('#lessonv')
  v.innerHTML = `<div class="lhead"><button class="x" type="button" data-lclose aria-label="Close lesson">✕</button>
      <div class="lprog">${d.cards.map((_, k) => `<i class="${k <= LS.i ? 'on' : ''}"></i>`).join('')}</div><span class="qcount">${LS.i + 1}/${n}</span></div>
    <p class="lplace">${esc(d.title || N[LS.id].name)}</p>
    <div class="ltrack" tabindex="0">${d.cards.map((c, i) => slide(c, i)).join('')}</div>
    <div class="lfoot">${LS.i > 0 ? '<button class="btn3" type="button" data-lprev>Back</button>' : '<span></span>'}
      ${last ? (LS.pick ? `<button class="btn3 primary" type="button" data-ldone>${lessonRead(LS.id) ? 'Done' : 'Mark as read'}</button>` : '<span class="lhint">Choose an answer</span>')
             : '<button class="btn3 primary" type="button" data-lnext>Next</button>'}</div>
    <p class="ldraft">${checked.has(LS.id) ? '✓ You checked this lesson.' : 'Draft, rewritten from your cards.'} <button type="button" data-lcheck>${checked.has(LS.id) ? 'Undo' : 'Looks right'}</button></p>`
  const tr = v.querySelector('.ltrack'); tr.scrollLeft = LS.i * tr.clientWidth
  tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); if (i !== LS.i) { LS.i = i; drawLessonChrome() } })
}
function drawLessonChrome() { // update progress and buttons without rebuilding the slides (keeps the swipe smooth)
  const d = DECKS[LS.id], n = d.cards.length, last = LS.i === n - 1, v = $('#lessonv')
  v.querySelectorAll('.lprog i').forEach((e, k) => e.classList.toggle('on', k <= LS.i))
  v.querySelector('.qcount').textContent = `${LS.i + 1}/${n}`
  v.querySelector('.lfoot').innerHTML = `${LS.i > 0 ? '<button class="btn3" type="button" data-lprev>Back</button>' : '<span></span>'}
    ${last ? (LS.pick ? `<button class="btn3 primary" type="button" data-ldone>${lessonRead(LS.id) ? 'Done' : 'Mark as read'}</button>` : '<span class="lhint">Choose an answer</span>') : '<button class="btn3 primary" type="button" data-lnext>Next</button>'}`
}
const goSlide = i => { const tr = $('#lessonv .ltrack'); tr.scrollTo({ left: i * tr.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' }) }
function closeLesson() {
  const { id, from } = LS; $('#lessonv').hidden = true; LS = null
  if (BR) BR.lesson(false)
  if (BR && from) { BR.back(from === 'study' ? '' : from); return }
  if (from === 'study') { showTab('study'); return }
  renderUI(); if (N[id]?.bbox) glideTo(N[id].bbox)
}
$('#lessonv').addEventListener('click', e => {
  const t = e.target
  if (t.closest('[data-lclose]')) { closeLesson(); return }
  if (t.closest('[data-lnext]')) { goSlide(LS.i + 1); return }
  if (t.closest('[data-lprev]')) { goSlide(LS.i - 1); return }
  const p = t.closest('[data-lpick]'); if (p && !LS.pick) { LS.pick = p.dataset.lpick; drawLesson(); return }
  if (t.closest('[data-ldone]')) { readIds.add(LS.id); for (const k of DECKS[LS.id].topics || []) readTopics.add(k); if (BR) BR.markRead(DECKS[LS.id].topics || []); closeLesson(); return }
  if (t.closest('[data-lcheck]')) { checked.has(LS.id) ? checked.delete(LS.id) : checked.add(LS.id); if (BR) BR.setChecked([...checked]); const i = LS.i; drawLesson(); LS.i = i; return }
})
addEventListener('keydown', e => { if (!LS) return; if (e.key === 'ArrowRight') goSlide(Math.min(LS.i + 1, DECKS[LS.id].cards.length - 1)); if (e.key === 'ArrowLeft') goSlide(Math.max(LS.i - 1, 0)); if (e.key === 'Escape') closeLesson() })
function notesFold(id) {
  const body = profileBlock(id) + factsBlock(id)
  return body ? `<details class="fold"><summary>Your card notes, as written</summary>${body}</details>` : ''
}
window.__openLesson = openLesson; window.__goSlide = goSlide

// ---- sheet interactions ----
$('#sheet-body').addEventListener('click', e => {
  const t = e.target
  const ls = t.closest('[data-lesson]'); if (ls) { e.stopPropagation(); openLesson(ls.dataset.lesson); return }
  const q = t.closest('[data-quiz]'); if (q) { e.stopPropagation(); if (BR) quizInApp(q.dataset.quiz); else startQuiz(q.dataset.quiz); return }
  const sl = t.closest('[data-study]'); if (sl) { e.stopPropagation(); const [ch, k] = sl.dataset.study.split('|'); if (BR) { const id = select || focus; BR.openTopic(ch, k, { id, name: N[id].name }); return } ST = { ch: +ch, open: k, from: select || focus }; showTab('study'); return }
  const g = t.closest('[data-go]'); if (g) { e.stopPropagation(); openPlace(g.dataset.go, { keepHeight: true }); return }
  const l = t.closest('[data-lens]'); if (l) { e.stopPropagation(); setLens(+l.dataset.lens); return }
  const p = t.closest('[data-ptab]'); if (p) { e.stopPropagation(); const [id, c] = p.dataset.ptab.split('|'); profTab[id] = +c; renderUI(); return }
}, true)

// ---- lenses ----
function setLens(ch) {
  mode = 'lens'; lensCh = ch
  $('#layers').setAttribute('aria-pressed', 'true')
  closeMenu()
  setDetent('bar') // first, so the camera frames France for the low sheet
  if (!isTop(focus)) goTo('fr'); else { applyFocus(); renderUI(); glideTo(N.fr.bbox) }
}
function setMode(m) { mode = m; lensCh = null; $('#layers').setAttribute('aria-pressed', String(m !== 'regions')); applyFocus(); renderUI(); drawMenu() }
function drawMenu() {
  const chs = Object.keys(LENS).map(Number).sort((a, b) => a - b)
  // The map keeps its region colours: progress lives in the sheet and lists, never in the map's fill (Gavin, 2 Nov)
  $('#lensmenu').innerHTML = `<p class="mh">Follow a grape</p>
    <div class="course">${chs.map(c => `<button class="chip lens-chip${mode === 'lens' && lensCh === c ? ' on' : ''}" type="button" data-lensm="${c}"><span>${esc(CH[c])}</span></button>`).join('')}</div>
    ${mode === 'lens' ? '<button class="btn2" type="button" data-mode="regions">Show all regions again</button>' : ''}`
}
function closeMenu() { $('#lensmenu').hidden = true; $('#layers').setAttribute('aria-expanded', 'false') }
$('#layers').addEventListener('click', () => { const m = $('#lensmenu'); drawMenu(); m.hidden = !m.hidden; $('#layers').setAttribute('aria-expanded', String(!m.hidden)) })
$('#lensmenu').addEventListener('click', e => {
  const m = e.target.closest('[data-mode]'); if (m) { setMode(m.dataset.mode); return }
  const l = e.target.closest('[data-lensm]'); if (l) setLens(+l.dataset.lensm)
})
$('#legend').addEventListener('click', e => { if (e.target.closest('[data-lens-off]')) setMode('regions') })
map.on('click', e => { // pins first: a tap on an exam pin opens that place
  const hit = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['exam-pin', 'exam-pin-label'] })[0]
  if (hit) { e.preventDefault(); openPlace(hit.properties.id, { keepHeight: true }) }
})

// ---- quiz (concept: answers are not saved) ----
let QZ = null
function startQuiz(id, qids, label) {
  const all = (qids || SP[id]?.qids || []).filter(q => SL.questions[q]), missed = new Set(SL.missed)
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const ids = [...shuffle(all.filter(q => missed.has(q))), ...shuffle(all.filter(q => !missed.has(q)))] // missed ones first
  QZ = { label: label || N[id].name, ids: ids.slice(0, 10), i: 0, pick: null, score: 0 }
  $('#quizv').hidden = false; drawQuiz()
}
function drawQuiz() {
  const v = $('#quizv'), done = QZ.i >= QZ.ids.length
  const bar = `<div class="vh"><button class="x" type="button" data-qx aria-label="Close">✕</button><div class="qprog">${QZ.ids.map((_, k) => `<i class="${k < QZ.i || (k === QZ.i && QZ.pick) ? 'done' : ''}"></i>`).join('')}</div><span class="qcount">${Math.min(QZ.i + 1, QZ.ids.length)}/${QZ.ids.length}</span></div>`
  if (done) {
    v.innerHTML = bar + `<div class="score"><div class="big">${QZ.score}/${QZ.ids.length}</div><p class="proto">${esc(QZ.label)}</p></div>
      <p class="proto">Concept only: these answers aren't saved. In the build they go to History and sync like any quiz, and the map recolours.</p>
      <div class="pin"><button class="qbtn" type="button" data-qx>Back to the map</button></div>`
    return
  }
  const q = SL.questions[QZ.ids[QZ.i]], pk = QZ.pick, right = pk === q.answer
  const clean = t => { const x = String(t || '').replace(/^(correct|no|not quite|yes)\s*[:.\-–]\s*/i, ''); return x.charAt(0).toUpperCase() + x.slice(1) }
  const opts = Object.entries(q.options).map(([k, t]) => {
    const cls = !pk ? '' : k === q.answer ? 'ok' : k === pk ? 'bad' : 'dim'
    return `<button class="opt ${cls}" type="button" data-opt="${k}" ${pk ? 'disabled' : ''}><span class="lt">${pk && k === q.answer ? '✓' : pk && k === pk ? '✕' : k.toUpperCase()}</span><span>${esc(t)}</span></button>`
  }).join('')
  const fb = pk ? `<div class="fb"><h3 class="${right ? 'ok' : 'bad'}">${right ? '✓ Correct' : '✕ Not quite'}</h3><p>${esc(clean(q.notes?.[right ? pk : q.answer]))}</p>${!right && q.notes?.[pk] ? `<p class="proto">Your answer: ${esc(clean(q.notes[pk]))}</p>` : ''}</div>` : ''
  v.innerHTML = bar + `<p class="qeye">${esc(QZ.label)} · Ch ${q.ch} ${esc(CH[q.ch] || '')} · ${esc(q.lo || '')}${q.level === 'L3' ? ' · L3 stretch' : ''}</p>
    <p class="qstem">${esc(q.stem)}</p>${opts}${fb}${pk ? `<div style="height:70px"></div><div class="pin"><button class="qbtn" type="button" data-qnext>Continue</button></div>` : ''}`
  if (pk) v.querySelector('.fb').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
}
$('#quizv').addEventListener('click', e => {
  if (e.target.closest('[data-qx]')) { $('#quizv').hidden = true; QZ = null; return }
  const o = e.target.closest('[data-opt]')
  if (o && !QZ.pick) { QZ.pick = o.dataset.opt; if (QZ.pick === SL.questions[QZ.ids[QZ.i]].answer) QZ.score++; drawQuiz(); return }
  if (e.target.closest('[data-qnext]')) { QZ.i++; QZ.pick = null; drawQuiz(); $('#quizv').scrollTop = 0 }
})

// ---- Study tab (stand-in for WSET Revision's Study tab: chapters -> topics. Lessons where they exist, your notes otherwise) ----
let ST = { ch: null, open: null, from: null }
const cleanRef = t => t.replace(/\s*\((?:Chapter \d+, )?(?:L[23] )?book p\. [\d-]+\)/g, '').replace(/\s*\(p\. [\d-]+\)/g, '')
function inline(x) {
  let h = esc(cleanRef(x)).replace(/\s*-&gt;\s*/g, ' → ').replace(/\s=\s/g, ' → ')
  const m = h.match(/^([^:;.,]{2,42}):\s+(.*)$/) // "Oregon: northerly latitude…" -> bold lead term
  return m ? `<b>${m[1]}</b> ${m[2]}` : h
}
/** Your card notes, laid out for reading: bold lead terms, ladders for "A -> B -> C", sub-heads for "X:" lines. */
function notesHtml(ids) {
  return ids.map(id => {
    const c = SL.cards[id]; if (!c) return ''
    const out = c.body.split('\n').map(x => x.trim()).filter(Boolean).map(x => {
      x = x.replace(/^[-•]\s*/, '')
      if (x.split('->').length >= 3) return `<ol class="ladder">${x.split('->').map(p => `<li>${inline(p.trim())}</li>`).join('')}</ol>`
      if (/:$/.test(x)) return `<p class="nh">${esc(cleanRef(x).replace(/[,:]\s*$/, '').replace(/,\s*lowest to highest$/, ''))}</p>`
      return `<p class="np">${inline(x)}</p>`
    }).join('')
    const pg = (c.src || '').match(/p\. [\d-]+/)
    return `<div class="notes">${out}${pg ? `<p class="nsrc">From your cards, ${pg[0]}</p>` : ''}</div>`
  }).join('')
}
function specHtml(ch) {
  return `<div class="notes">${(SL.spec[ch] || []).map(g => g.r.map(([k, v]) => `<p class="nh">${esc(k === 'Label terms' ? 'Label terms' : k)}</p><div class="pchips plain">${v.split(' · ').map(x => `<span>${esc(x)}</span>`).join('')}</div>`).join('')).join('')}</div>`
}
function onTheMap(ch) {
  const fr = (LENS[ch] || []).slice().sort((a, b) => north(a) - north(b))
  if (!fr.length) return ''
  return `<section class="mapcard"><div class="mc-h"><b>On the map</b><button type="button" data-lensv="${ch}">Follow ${esc(CH[ch])} ›</button></div>
    <div class="pchips">${fr.map(k => `<button type="button" data-place="${k}"><i class="sdot ${statusOf(k)}"></i>${esc(N[k].name)}</button>`).join('')}</div></section>`
}
function topicCard(ch, t) {
  const ls = lessonsFor(ch, t.key), open = ST.open === t.key, read = readTopics.has(ch + '|' + t.key)
  const notes = t.spec ? specHtml(ch) : notesHtml(t.cards)
  const body = ls.length
    ? ls.map(d => `<p class="lead">${esc(DECKS[d].lead)}</p><button class="qbtn lesson-btn" type="button" data-slesson="${d}">${lessonRead(d) ? 'Read again' : 'Read'}${N[d] ? ` about ${esc(N[d].name)}` : ''}<small>${DECKS[d].cards.length} short cards · about ${minutes(DECKS[d].cards.length)} min${N[d] ? ' · with the map' : ''}${lessonRead(d) ? ' · ✓ read' : ''}</small></button>`).join('') +
      `<details class="fold"><summary>Your notes, as written</summary>${notes}</details>`
    : `<details class="fold tnotes"${open ? ' open' : ''}><summary>Read the notes</summary>${notes}</details>`
  const q = (t.qids || []).length
  return `<section class="tcard${open ? ' hl' : ''}" id="tp-${t.key}"><div class="tc-h"><h3>${esc(topicName(t.name))}</h3>${read ? '<span class="rd">✓ Read</span>' : ''}</div>${body}
    <div class="tc-f">${q ? `<button type="button" data-tquiz="${t.key}">Practise this</button>` : '<span></span>'}<button type="button" data-tread="${t.key}">${read ? 'Mark as unread' : 'Mark as read'}</button></div></section>`
}
function drawStudy() {
  const v = $('#studyv')
  if (!ST.ch) {
    const grp = (t, a, b) => `<h3 class="group">${t}</h3><div class="rows">${Array.from({ length: b - a + 1 }, (_, i) => a + i).map(c => `<button class="trow" type="button" data-ch="${c}"><span class="pn"><span class="chno">${c}</span>${esc(CH[c])}</span><span class="pg">${(LENS[c] || []).length ? `${LENS[c].length} on the map` : ''}</span><span class="chev-r">›</span></button>`).join('')}</div>`
    v.innerHTML = `<div class="vh"><h2>Study</h2></div>${grp('Foundations', 1, 5)}${grp('Grapes', 6, 23)}${grp('Sparkling and fortified', 24, 25)}<p class="proto">Prototype: a simplified Study tab, to show how it links with the map.</p>`
    v.scrollTop = 0; return
  }
  const ch = ST.ch, ts = SL.topics[ch] || [], nr = ts.filter(t => readTopics.has(ch + '|' + t.key)).length
  v.innerHTML = `<div class="vh chap">${ST.from ? `<button class="backlink" type="button" data-back>‹ ${esc(N[ST.from].name)} on the map</button>` : `<button class="backlink" type="button" data-chs>‹ All chapters</button>`}
      <p class="eyebrow">Chapter ${ch}</p><h2 class="serif">${esc(CH[ch])}</h2><p class="chsub">${nr} of ${ts.length} topics read</p></div>
    ${onTheMap(ch)}${ts.map(t => topicCard(ch, t)).join('')}`
  requestAnimationFrame(() => { const el = ST.open && document.getElementById('tp-' + ST.open); el ? el.scrollIntoView({ block: 'start' }) : (v.scrollTop = 0) })
}
$('#studyv').addEventListener('click', e => {
  const t = e.target
  const b = t.closest('[data-place]'); if (b) { showTab('atlas'); openPlace(b.dataset.place); return }
  const l = t.closest('[data-lensv]'); if (l) { showTab('atlas'); setLens(+l.dataset.lensv); return }
  const c = t.closest('[data-ch]'); if (c) { ST = { ch: +c.dataset.ch, open: null, from: null }; drawStudy(); return }
  const sl = t.closest('[data-slesson]'); if (sl) { ST.open = sl.closest('.tcard')?.id.slice(3) || ST.open; openLesson(sl.dataset.slesson, 'study'); return }
  const tq = t.closest('[data-tquiz]'); if (tq) { const tp = SL.topics[ST.ch].find(x => x.key === tq.dataset.tquiz); startQuiz(null, tp.qids, `${CH[ST.ch]} · ${topicName(tp.name)}`); return }
  const tr = t.closest('[data-tread]'); if (tr) { const k = ST.ch + '|' + tr.dataset.tread; readTopics.has(k) ? readTopics.delete(k) : readTopics.add(k); ST.open = tr.dataset.tread; drawStudy(); return }
  if (t.closest('[data-back]')) { const id = ST.from; ST.from = null; showTab('atlas'); openPlace(id, { keepHeight: true }); return }
  if (t.closest('[data-chs]')) { ST = { ch: null, open: null, from: null }; drawStudy() }
})
window.__study = (ch, open) => { ST = { ch, open, from: null }; showTab('study') }
function openPlace(id, { keepHeight = false } = {}) {
  if (hasKids(id)) goTo(id)
  else { goTo(upOf(id), id); setTimeout(() => reveal(id), 800) }
  if (!keepHeight || detent === 'bar') setDetent('half')
}

// ---- tabs ----
function showTab(t, ch) {
  tab = t
  for (const b of document.querySelectorAll('#tabs button')) b.dataset.tab === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
  $('#studyv').hidden = t !== 'study'
  const o = $('#otherv'); o.hidden = !['home', 'practise', 'history'].includes(t)
  if (!o.hidden) o.innerHTML = `<div class="vh"><h2>${t[0].toUpperCase() + t.slice(1)}</h2></div><p class="proto">Unchanged from today's WSET Revision. In the concept only Study (the new map links) and Atlas are live.</p><p class="proto">Planned: Home gets a small "Your France" tile showing your progress, which opens the Atlas.</p>`
  if (t === 'study') { if (ch) ST = { ch, open: null, from: null }; drawStudy() }
  if (t === 'atlas') { $('#tabs').classList.toggle('away', detent !== 'bar'); map.resize() } else { $('#tabs').classList.remove('away'); closeMenu() }
  drawLegend()
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab) })
window.__showTab = showTab; window.__openPlace = openPlace; window.__startQuiz = startQuiz
window.__setMode = m => setMode(m); window.__setLens = setLens

// ---- start: France, sheet as the bar (item 1) ----
initSheet(); initPanel()
map.once('load', () => {
  applyFocus(); renderUI()
  const b = N.fr.bbox
  camera(() => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), duration: 0 }))
  document.body.classList.add('ready')
  map.once('idle', () => { window.__idle = true })
})
window.__N = N
/** Quiz this place in the app itself, so the answers are saved and synced: misses first, then the rest, ten at most. */
function quizInApp(id) {
  const all = (SP[id]?.qids || []).filter(q => BR.question(q)), sh = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])
  const miss = all.filter(q => QS[q] && QS[q].last < 1)
  BR.quiz([...sh(miss), ...sh(all.filter(q => !miss.includes(q)))].slice(0, 10), N[id].name, { id, name: N[id].name })
}
if (BR) {
  window.__atlas = {
    openPlace: id => { closeMenu(); openPlace(id) },
    setLens: ch => setLens(ch),
    refresh: () => { applyProgress(); applyFocus(); renderUI() },
  }
  applyProgress()
  map.once('load', () => BR.ready())
}
window.__state = () => ({ focus, select, detent, depth: S.depth, ctx: ctx.length, kids: kids.length,
  fill: isTop(focus) ? 1 : +fill(focus).toFixed(2), zoom: +map.getZoom().toFixed(2) })
window.__evaluate = evaluate
window.__setDepth = d => { S.depth = d; saveSettings(); applyContext(); readout() }
window.__goTo = goTo
window.__ctx = () => ctx.slice()
window.__fill = fill
window.__shown = shown
window.__kids = () => kids.slice()
window.__openZ = () => openZ
window.__gest = () => ({ gesture, gestureZoom, evals })
