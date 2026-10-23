export const MAPBOX_STREETS_STYLE = 'mapbox://styles/mapbox/streets-v12';
export const DEFAULT_MAP_ZOOM = 16;

export const enhanceMapLabels = (map) => {
  const layers = map.getStyle()?.layers || [];

  layers
    .filter((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])
    .forEach((layer) => {
      try {
        map.setLayoutProperty(layer.id, 'text-field', [
          'coalesce',
          ['get', 'name'],
          ['get', 'name_en'],
        ]);
        map.setLayoutProperty(layer.id, 'text-size', [
          'interpolate',
          ['linear'],
          ['zoom'],
          10, 11,
          13, 13,
          16, 16,
          19, 19,
        ]);
      } catch {
        // Some vendor layers reject layout overrides; keep their style defaults.
      }
    });
};
