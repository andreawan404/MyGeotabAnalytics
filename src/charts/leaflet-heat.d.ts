// Minimal ambient typing for the leaflet.heat plugin — @types/leaflet doesn't
// cover it. Augments the 'leaflet' module so `L.heatLayer(...)` type-checks.
//
// The `import` below is required, not decorative: without a top-level
// import/export this file is a script, not a module, and `declare module
// 'leaflet' {...}` would replace @types/leaflet's real exports instead of
// merging with them.
import 'leaflet';

declare module 'leaflet' {
  interface HeatLayerOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  function heatLayer(
    latlngs: Array<[number, number] | [number, number, number]>,
    options?: HeatLayerOptions
  ): Layer;
}

declare module 'leaflet.heat';
