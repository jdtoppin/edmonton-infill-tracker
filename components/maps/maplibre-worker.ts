import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type MapLibreRuntime = Pick<typeof import("maplibre-gl"), "setWorkerUrl">;

export function configureMapLibreWorker(maplibre: MapLibreRuntime): void {
  maplibre.setWorkerUrl(mapLibreWorkerUrl);
}
