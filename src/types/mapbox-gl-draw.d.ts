declare module "@mapbox/mapbox-gl-draw" {
  interface DrawOptions {
    displayControlsDefault?: boolean;
    controls?: {
      point?: boolean;
      line_string?: boolean;
      polygon?: boolean;
      trash?: boolean;
      combine_features?: boolean;
      uncombine_features?: boolean;
    };
    defaultMode?: string;
    styles?: Record<string, unknown>[];
  }

  class MapboxDraw {
    constructor(options?: DrawOptions);
    onAdd(map: unknown): HTMLElement;
    onRemove(): void;
    getAll(): GeoJSON.FeatureCollection;
    deleteAll(): this;
    set(featureCollection: GeoJSON.FeatureCollection): string[];
  }

  export default MapboxDraw;
}
