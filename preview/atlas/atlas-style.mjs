// Reference style for the Wine Atlas basemap v1 (docs/specs/atlas-basemap-v1.md).
// Framework-agnostic: returns a MapLibre style object for 'light' or 'dark'.
// Claude Code: adapt this into src/map (tokens → src/ui/tokens.css), don't treat it as final design.

export const PALETTES = {
  light: {
    sea: '#DCE5E8',
    land: ['#F4EFE6', '#EDE7DA', '#F1ECE1', '#E9E3D5', '#F3EEE7', '#EEE8DC', '#E7E1D2'], // MAPCOLOR7 1-7
    coast: '#B9C7CC',
    border: '#8F8676',
    river: '#9DBBC9',
    riverWine: '#5F93AB',
    lake: '#DCE5E8',
    reliefOpacity: 0.38,
    countryLabel: '#7A7062',
    placeLabel: '#3B362F',
    placeDot: '#3B362F',
    rangeLabel: '#978B7A',
    waterLabel: '#4E7E95',
    halo: 'rgba(250,247,241,0.9)',
    pdoFill: '#8E2C48',
    pdoFillOpacity: 0.1,
    pdoLine: '#8E2C48',
    pdoLabel: '#6E1F37',
    mastery: ['#E4DFD7', '#E8C9D1', '#D195A8', '#AE5674', '#8E2C48'], // = --wa-mastery-0…4
  },
  dark: {
    sea: '#0E171C',
    land: ['#1F1E1B', '#23221F', '#1C1B19', '#262421', '#211F1C', '#1D1C1A', '#282623'],
    coast: '#2A3A42',
    border: '#6A6358',
    river: '#2C4C5B',
    riverWine: '#4F86A1',
    lake: '#0E171C',
    reliefOpacity: 0.4,
    countryLabel: '#A69D8F',
    placeLabel: '#E8E0D2',
    placeDot: '#E8E0D2',
    rangeLabel: '#8A8173',
    waterLabel: '#7FA9BD',
    halo: 'rgba(20,19,17,0.85)',
    pdoFill: '#D4849A',
    pdoFillOpacity: 0.12,
    pdoLine: '#D4849A',
    pdoLabel: '#F0B3C8',
    mastery: ['#2B2926', '#4A2F38', '#7C3E55', '#B35A7A', '#D4849A'],
  },
}

const REG = ['Noto Sans Regular']
const MED = ['Noto Sans Medium']
const ITA = ['Noto Sans Italic']

/**
 * @param {'light'|'dark'} scheme
 * @param {{basemap:string, relief:string, pdo:string, glyphs:string}} urls  e.g. 'pmtiles://…/basemap.pmtiles'
 * @param {{mastery?: boolean}} [opts]  mastery: colour PDOs by feature-state `mastery` (0–4) instead of the plain wine tint
 */
export function buildAtlasStyle(scheme, urls, opts = {}) {
  const c = PALETTES[scheme]
  const areaOpacity = opts.mastery ? 0 : 1
  const tint = ['match', ['get', 'tint'], 1, c.land[0], 2, c.land[1], 3, c.land[2], 4, c.land[3], 5, c.land[4], 6, c.land[5], c.land[6]]
  return {
    version: 8,
    glyphs: urls.glyphs,
    sources: {
      base: { type: 'vector', url: urls.basemap },
      relief: { type: 'raster', url: urls.relief, tileSize: 256 },
      pdo: { type: 'vector', url: urls.pdo, promoteId: { pdo: 'pdo_id' } }, // feature-state highlight by PDO id
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': c.sea } },
      { id: 'land', type: 'fill', source: 'base', 'source-layer': 'countries', paint: { 'fill-color': tint } },
      { id: 'relief', type: 'raster', source: 'relief', paint: {
        // The relief data is coarse (~3.7 km/pixel): fade it out before it turns into blurry blobs.
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, c.reliefOpacity, 8, 0], 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      { id: 'coast', type: 'line', source: 'base', 'source-layer': 'countries', paint: { 'line-color': c.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 8, 1] } },
      { id: 'lakes', type: 'fill', source: 'base', 'source-layer': 'lakes', paint: { 'fill-color': c.lake } },
      { id: 'rivers', type: 'line', source: 'base', 'source-layer': 'rivers', filter: ['!', ['get', 'wine']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 6, 0.8, 10, 1.6] } },
      { id: 'rivers-wine', type: 'line', source: 'base', 'source-layer': 'rivers', filter: ['get', 'wine'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.riverWine, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 1.4, 10, 2.6] } },
      { id: 'borders', type: 'line', source: 'base', 'source-layer': 'borders',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': c.border, 'line-opacity': 0.8,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 0.9, 10, 1.4],
          'line-dasharray': ['case', ['==', ['get', 'kind'], 'disputed'], ['literal', [3, 2]], ['literal', [1, 0]]] } },
      // Where vines may be grown (all PDOs dissolved): always a light tint, strongest at country scale.
      { id: 'pdo-area', type: 'fill', source: 'pdo', 'source-layer': 'pdo_area',
        paint: { 'fill-color': c.pdoFill, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, c.pdoFillOpacity * 2.2 * areaOpacity, 8, c.pdoFillOpacity * 1.2 * areaOpacity, 11, c.pdoFillOpacity * 0.8 * areaOpacity] } },
      // Mastery overlay: set feature-state { mastery: 0-4 } per PDO id. Unset = not shown.
      { id: 'pdo-mastery', type: 'fill', source: 'pdo', 'source-layer': 'pdo', layout: { visibility: opts.mastery ? 'visible' : 'none' },
        paint: { 'fill-color': ['match', ['coalesce', ['feature-state', 'mastery'], -1], 0, c.mastery[0], 1, c.mastery[1], 2, c.mastery[2], 3, c.mastery[3], 4, c.mastery[4], 'rgba(0,0,0,0)'],
          'fill-opacity': 0.9 } },
      { id: 'pdo-area-line', type: 'line', source: 'pdo', 'source-layer': 'pdo_area', maxzoom: 8,
        paint: { 'line-color': c.pdoLine, 'line-width': 0.6, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 7, 0.5, 8, 0] } },
      // Individual PDOs: no fill unless selected (feature-state), so nested appellations don't stack up.
      { id: 'pdo-fill', type: 'fill', source: 'pdo', 'source-layer': 'pdo',
        paint: { 'fill-color': c.pdoFill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.35, 0] } },
      { id: 'pdo-line', type: 'line', source: 'pdo', 'source-layer': 'pdo', minzoom: 7, filter: ['==', ['get', 'dup_of'], ''],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': c.pdoLine, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 7.5, 0.45, 11, 0.75],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 11, 1.1] } },
      { id: 'river-labels', type: 'symbol', source: 'base', 'source-layer': 'rivers', minzoom: 5, filter: ['get', 'wine'],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ITA, 'text-size': 11,
          'text-letter-spacing': 0.05, 'symbol-spacing': 400 },
        paint: { 'text-color': c.waterLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
      { id: 'range-labels', type: 'symbol', source: 'base', 'source-layer': 'ranges',
        layout: { 'text-field': ['get', 'name'], 'text-font': ITA, 'text-transform': 'uppercase',
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 12], 'text-letter-spacing': 0.25, 'text-max-width': 8 },
        paint: { 'text-color': c.rangeLabel, 'text-halo-color': c.halo, 'text-halo-width': 1 } },
      ...[['xl', ['>', ['get', 'area_km2'], 2500], 8.5], ['l', ['all', ['<=', ['get', 'area_km2'], 2500], ['>', ['get', 'area_km2'], 600]], 10],
          ['m', ['<=', ['get', 'area_km2'], 600], 24]].map(([size, sizeFilter, maxzoom]) => ({
        id: `pdo-labels-${size}`, type: 'symbol', source: 'pdo', 'source-layer': 'pdo_labels', minzoom: 5, maxzoom,
        filter: ['all', ['==', ['get', 'dup_of'], ''], sizeFilter],
        layout: { 'text-field': ['get', 'name'], 'text-font': MED, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13],
          'text-max-width': 7, 'symbol-sort-key': ['-', 0, ['get', 'area_km2']] },
        paint: { 'text-color': c.pdoLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } })),
      { id: 'place-dots', type: 'circle', source: 'base', 'source-layer': 'places',
        paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'capital'], 3, 2.2], 'circle-color': c.placeDot,
          'circle-stroke-color': c.halo, 'circle-stroke-width': 1 } },
      { id: 'place-labels', type: 'symbol', source: 'base', 'source-layer': 'places',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['case', ['==', ['get', 'kind'], 'capital'], ['literal', MED], ['literal', REG]],
          'text-size': ['case', ['==', ['get', 'kind'], 'capital'], 13, 12],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.5, 'text-justify': 'auto' },
        paint: { 'text-color': c.placeLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
      { id: 'country-labels', type: 'symbol', source: 'base', 'source-layer': 'country_labels',
        layout: { 'text-field': ['get', 'name'], 'text-font': MED, 'text-transform': 'uppercase',
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14], 'text-letter-spacing': 0.18, 'text-max-width': 7 },
        paint: { 'text-color': c.countryLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
    ],
  }
}

/** North-up lock (decision): call after creating the map. */
export function lockNorthUp(map) {
  map.dragRotate.disable()
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()
  map.touchPitch.disable()
  map.setMaxPitch(0)
}
