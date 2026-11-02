// Map layers for the zoom prototype. Based on the v2.1 reference (drill-ref.mjs), with the design-review changes:
// item 6 (surrounding places at the zoom's level of detail, middle strength), item 8 (wider tint steps), item 10 (pulse).
import { TINTS, CONTEXT } from './palette.mjs'

export const FAMILY = {
  // Bordeaux, Burgundy, Beaujolais, Champagne, Alsace, Rhône, Languedoc-Roussillon, Provence, Loire, South West France
  light: ['#8E2C48', '#A8742A', '#6E519C', '#2F7C74', '#557F33', '#B0562A', '#3F5E9A', '#A5507C', '#2E86AB', '#7A7A22'],
  dark: ['#D4849A', '#D2A15A', '#A58BD0', '#6FB3AA', '#8DB86A', '#DB8B5E', '#7F9CD6', '#D48FB5', '#6BB6D6', '#C4C46A'],
}
export const tints = (scheme) => TINTS[scheme]
/** Swatch colour for a node in lists (matches the map): crus by rank, otherwise by tint. */
export const nodeColour = (scheme, node) => {
  const T = TINTS[scheme][node.family] || ['#888', '#888', '#888', '#888']
  if (node.cru === 'grand cru') return T[0]
  if (node.cru === 'premier cru') return T[1]
  return T[node.tint ?? 0]
}
const STAR = { light: '#8E2C48', dark: '#D4849A' }
const OTHER = { light: { ink: '#7D766A', line: '#8A8376', wash: '#F7F3EC' }, dark: { ink: '#A39C90', line: '#8A8479', wash: '#2A2825' } }
const SEP = { light: '#FFFFFF', dark: '#141311' }

function rgbaImage(size, paint) {
  const data = new Uint8ClampedArray(size * size * 4)
  paint((x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    const k = a + data[i + 3] / 255 * (1 - a)
    if (k <= 0) return
    data[i] = (r * a + data[i] * (data[i + 3] / 255) * (1 - a)) / k
    data[i + 1] = (g * a + data[i + 1] * (data[i + 3] / 255) * (1 - a)) / k
    data[i + 2] = (b * a + data[i + 2] * (data[i + 3] / 255) * (1 - a)) / k
    data[i + 3] = k * 255
  })
  return { width: size, height: size, data }
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

/** Star for key-place labels, drawn pixel by pixel (no canvas needed). */
function starImage(scheme, pr = 2) {
  const size = 11 * pr, r = size / 2, ri = r * 0.45, col = hexRgb(STAR[scheme])
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : r * 0.98
    return [r + rr * Math.cos(a), r + rr * Math.sin(a)]
  })
  const inside = (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c } return c }
  return rgbaImage(size, set => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let n = 0
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (inside(x + dx, y + dy)) n++
      if (n) set(x, y, col, n / 4)
    }
  })
}
/** 45° hatch for the other wine areas (tiles seamlessly). */
function hatchImage(scheme, pr = 2) {
  const s = 6 * pr, col = hexRgb(OTHER[scheme].ink), alpha = scheme === 'dark' ? 0.55 : 0.5
  return rgbaImage(s, set => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.abs(((x + y) % s) - (s - 1)) // distance to the anti-diagonal, wrapping
      const w = Math.max(0, 1 - Math.min(d, s - d) / (0.9 * pr))
      if (w > 0) set(x, y, col, alpha * w)
    }
  })
}
/** Supply the drill images on demand (MapLibre 6: only a resolver can answer the request that needs the image). */
export function resolveImages(map, getScheme) {
  map.setMissingStyleImageResolver(id => {
    if (id === 'wa-star' && !map.hasImage(id)) map.addImage(id, starImage(getScheme()), { pixelRatio: 2 })
    if (id === 'wa-hatch' && !map.hasImage(id)) map.addImage(id, hatchImage(getScheme()), { pixelRatio: 2 })
  })
}

const labelName = ['case', ['to-boolean', ['get', 'igp']], ['concat', ['get', 'name'], ' IGP'], ['get', 'name']]
const starred = ['case', ['to-boolean', ['get', 'key']], ['format', ['image', 'wa-star'], {}, ' ', {}, labelName, {}], labelName]
const none = ['==', ['get', 'id'], '__none__']

export function drillLayers(scheme, sea) {
  const F = FAMILY[scheme], T = TINTS[scheme], C = CONTEXT[scheme]
  const famColor = ['match', ['get', 'family'], ...F.flatMap((c, i) => [i, c]), '#888']
  const tintColor = ['match', ['get', 'family'], ...T.flatMap((t, i) => [i, ['match', ['get', 'cru'], 'grand cru', t[0], 'premier cru', t[1],
    ['match', ['get', 'tint'], 0, t[0], 1, t[1], 2, t[2], t[3]]]]), '#888']
  const dotOpacity = ['step', ['zoom'], ['case', ['>', ['get', 'dotz'], 3], 1, 0],
    ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap(z => [z, ['case', ['>', ['get', 'dotz'], z], 1, 0]])]
  return [
    { id: 'drill-other-wash', type: 'fill', source: 'hier', 'source-layer': 'hier_other', filter: ['==', ['get', 'kind'], 'other'],
      paint: { 'fill-color': OTHER[scheme].wash, 'fill-opacity': scheme === 'dark' ? 0.75 : 0.7 } },
    { id: 'drill-other', type: 'fill', source: 'hier', 'source-layer': 'hier_other', filter: ['==', ['get', 'kind'], 'other'],
      paint: { 'fill-pattern': 'wa-hatch' } },
    { id: 'drill-other-line', type: 'line', source: 'hier', 'source-layer': 'hier_other', filter: ['==', ['get', 'kind'], 'other'],
      paint: { 'line-color': OTHER[scheme].line, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 9, 1.3], 'line-opacity': 0.9 } },
    { id: 'drill-veil', type: 'fill', source: 'veil', paint: { 'fill-color': sea, 'fill-opacity': scheme === 'dark' ? 0.55 : 0.6 } },
    // surrounding places (item 6): the family hue washed toward the paper, a dashed edge; tappable
    { id: 'drill-context', type: 'fill', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'fill-color': ['match', ['get', 'family'], ...C.flatMap((c, i) => [i, c]), '#888'],
        // a shade under the focus's own children, so the surroundings never outweigh them
        'fill-opacity': ['case', ['to-boolean', ['get', 'igp']], 0.35, scheme === 'dark' ? 0.8 : 0.7] } },
    { id: 'drill-context-line', type: 'line', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'line-color': famColor, 'line-width': 0.9, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } },
    { id: 'drill-focus-fill', type: 'fill', source: 'hier', 'source-layer': 'hier_nodes', filter: none,
      paint: { 'fill-color': famColor, 'fill-opacity': 0.14 } },
    { id: 'drill-kids', type: 'fill', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'fill-color': tintColor, 'fill-opacity': ['case', ['to-boolean', ['get', 'igp']], 0.35, 0.92] } },
    { id: 'drill-kids-line', type: 'line', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'line-color': SEP[scheme], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 1.4] } },
    { id: 'drill-kids-igp-line', type: 'line', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'line-color': famColor, 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } },
    { id: 'drill-grand', type: 'line', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'line-color': SEP[scheme], 'line-width': 0.8, 'line-opacity': 0.5, 'line-dasharray': [2, 2] } },
    { id: 'drill-kids-dot', type: 'circle', source: 'hier', 'source-layer': 'hier_labels', filter: none,
      paint: { 'circle-color': tintColor, 'circle-radius': 4.5, 'circle-stroke-width': 1.2, 'circle-stroke-color': SEP[scheme],
        'circle-opacity': dotOpacity, 'circle-stroke-opacity': dotOpacity } },
    { id: 'drill-selected', type: 'fill', source: 'hier', 'source-layer': 'hier_display', filter: none,
      paint: { 'fill-color': famColor, 'fill-opacity': 0.95 } },
    { id: 'drill-focus-line', type: 'line', source: 'hier', 'source-layer': 'hier_nodes', filter: none,
      paint: { 'line-color': famColor, 'line-width': 2, 'line-opacity': 0.9 } },
    // item 10: a place picked from the list pulses once
    { id: 'drill-pulse', type: 'line', source: 'hier', 'source-layer': 'hier_display', filter: none,
      layout: { 'line-join': 'round' }, paint: { 'line-color': famColor, 'line-width': 0, 'line-opacity': 0 } },
    { id: 'drill-pulse-dot', type: 'circle', source: 'hier', 'source-layer': 'hier_labels', filter: none,
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': famColor, 'circle-radius': 0, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0 } },
  ]
}

export function drillLabelLayers(scheme, halo, labelInk) {
  const F = FAMILY[scheme]
  return [
    { id: 'drill-other-labels', type: 'symbol', source: 'hier', 'source-layer': 'hier_other', filter: ['==', ['get', 'kind'], 'other-label'],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11.5, 'text-max-width': 8,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom', 'center'], 'text-radial-offset': 0.6, 'text-padding': 3 },
      paint: { 'text-color': OTHER[scheme].ink, 'text-halo-color': halo, 'text-halo-width': 1.4 } },
    { id: 'drill-context-labels', type: 'symbol', source: 'hier', 'source-layer': 'hier_labels', filter: none,
      layout: { 'text-field': starred, 'text-font': ['Noto Sans Regular'], 'text-max-width': 7, 'text-size': 12,
        'symbol-sort-key': 10, 'text-variable-anchor': ['center', 'top', 'bottom'], 'text-radial-offset': 0.3, 'text-padding': 2 },
      paint: { 'text-color': labelInk, 'text-opacity': 0.7, 'text-halo-color': halo, 'text-halo-width': 1.4 } },
    { id: 'drill-labels', type: 'symbol', source: 'hier', 'source-layer': 'hier_labels', filter: none,
      layout: { 'text-field': starred, 'text-font': ['Noto Sans Medium'], 'text-max-width': 7,
        'text-size': ['case', ['==', ['get', 'kind'], 'cru'], 12, 13],
        'symbol-sort-key': ['case', ['to-boolean', ['get', 'key']], 0, ['==', ['get', 'cru'], 'grand cru'], 1, 2],
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.3, 'text-padding': 2 },
      paint: { 'text-color': labelInk, 'text-halo-color': halo, 'text-halo-width': 1.5 } },
    { id: 'drill-region-labels', type: 'symbol', source: 'hier', 'source-layer': 'hier_labels', filter: none,
      layout: { 'text-field': ['upcase', ['get', 'name']], 'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10.5, 6, 12], 'text-letter-spacing': 0.14, 'text-max-width': 8,
        'text-variable-anchor': ['center', 'left', 'right', 'bottom', 'top'], 'text-radial-offset': 0.4, 'text-padding': 3 },
      paint: { 'text-color': ['match', ['get', 'family'], ...F.flatMap((c, i) => [i, c]), '#888'], 'text-halo-color': halo, 'text-halo-width': 1.6 } },
  ]
}

/** World polygon with holes for the given footprints: everything outside them is dimmed. */
export function veilFor(features) {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
  const fs = features.filter(Boolean)
  if (!fs.length) return { type: 'FeatureCollection', features: [] }
  const holes = fs.flatMap(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => p[0].slice().reverse()))
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...holes] } }] }
}
