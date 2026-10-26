# Dhaka Bus Simulator

A browser-based 2D top-down bus driving game set on the **real map of Dhaka**, generated from
OpenStreetMap data at build time. TypeScript + Vite + PixiJS v8 (WebGL), deployable as a static site.

> Status: **Phase 2** — the whole of Dhaka (Uttara → Jatrabari, Savar side → Purbachal) streamed
> with 3 levels of detail, flyovers/expressway and MRT Line 6 with stations, Bangla/English labels,
> minimap and a fullscreen map with place search. Driving starts in Phase 3.

## Quick start

```bash
npm install
npm run data:build      # optional: processed data is committed; this regenerates it from OSM
npm run dev             # http://localhost:5173
```

`data:build` downloads the Bangladesh OSM extract (~360 MB, cached in `data/raw/`) and takes ~1.5 min
for all of Dhaka (needs ~3 GB RAM).

Controls (map viewer): drag or WASD/arrows to pan, mouse wheel or `+`/`-` to zoom, `Q`/`E` to rotate,
`M` fullscreen map + place search (click to jump), `B` Bangla/English labels, `N` labels on/off,
`F3` debug overlay. Jump anywhere with a URL hash: `http://localhost:5173/#23.7577,90.3897,2`
(lat, lon, zoom in px/m). Graphics quality: `?quality=low|med|high` (default `med`, remembered).

### Data scripts

| Command | What it does |
|---|---|
| `npm run data:fetch` | Download/resume `data/raw/bangladesh-latest.osm.pbf` from Geofabrik |
| `npm run data:build` | fetch → extract → chunk. `DHAKA_BBOX=core\|mid\|full` or `"minLat,minLon,maxLat,maxLon"`; `--force` re-extracts |
| `npm run data:validate` | Feature counts, PNG renders (`docs/img/`, full-res in `data/work/`), landmark + flyover position checks |
| `npm test` | Unit tests (geometry, format) + landmark and flyover checks against built data |

![All of Dhaka rendered from the generated chunks](docs/img/map-full.png)

## Data pipeline

```
Geofabrik PBF ──► tools/extract.ts ──► data/work/<bbox>/features.ndjson ──► tools/chunk.ts ──► public/data/
 (cached, raw)     own PBF decoder       projected metres, classified          clip, simplify,     index.json
                   1–3 passes            + routes.json, restrictions.json      triangulate, gzip   lod0/X_Y.dbc
```

* **Decoder**: `tools/lib/pbf.ts` is a small dependency-free OSM PBF reader (zlib blobs, dense
  nodes, ways, relations). No osmium/GDAL needed; ~50M nodes decode in a few seconds.
* **Extract**: pass 1 keeps nodes inside the bbox + 1.3 km margin, ways touching them, and the
  relations we use (multipolygons, `route=bus`, turn restrictions). Pass 2/3 fetch multipolygon
  member ways and area nodes outside the margin so rivers and large campuses stay closed.
* **Projection**: local equirectangular centred on 23.80°N 90.41°E; **1 unit = 1 metre**, +y = south.
* **Levels of detail**: LOD0 512 m tiles (everything), LOD1 2 km tiles (buildings ≥ 300 m²,
  residential roads and up, 2–3 m simplification), LOD2 8 km tiles (secondary roads and up, rivers,
  large landuse; also feeds the minimap). The game picks the LOD from zoom with hysteresis and keeps
  the coarser tiles on screen until the finer ones covering the view have loaded.
* **Chunks**: 512 m tiles at LOD0. Polygons are clipped per tile (Sutherland–Hodgman) and pre-triangulated
  (earcut); buildings go to the tile of their centroid; lines are clipped with a 24 m overlap and carry
  their running distance so dashed markings stay continuous across tiles. Douglas–Peucker
  simplification (0.25–0.8 m). Coordinates are Int16 decimetres relative to the tile origin.
* **Format** (`src/shared/format.ts`): `"DBC1" | u32 jsonLen | JSON header | 8-byte aligned typed
  arrays`, gzip-compressed, served as `.dbc` (neutral extension, so no server adds
  `Content-Encoding`); the client inflates with `DecompressionStream`.

## Rendering

* Chunks stream in around the camera via a Web Worker pool, which fetches, inflates and tessellates
  them (round-joined road strokes, lane markings, zebra crossings, rails/sleepers, MRT viaduct).
* Each chunk contributes three meshes drawn with a custom per-vertex-colour shader:
  **ground** (landuse → water → footpaths → road casing → road fill → markings → railway),
  **shadow** and **upper** (buildings → flyovers → MRT viaduct and stations). Merging the sub-layers
  per chunk is safe because tiles overlap by the line margin and each tile contains every line piece
  inside it, so a tile drawn over its neighbour reproduces its own ordering. Vehicles go between
  shadow and upper; vehicles on flyovers go above upper.
* Shadows are extruded in the vertex shader from a per-vertex height (`uSun` uniform), so day/night
  sun angles cost nothing. All shadows are composited in one `AlphaFilter` pass so overlaps
  don't double-darken.
* Labels are screen-space `Text` (Noto Sans + Noto Sans Bengali), placed greedily by priority with
  collision boxes: road names along their longest straight run (kept upright), flyovers highlighted,
  places by rank and zoom, metro stations and landmarks.

## Performance

Measured with an in-page benchmark (`__game.bench()`, GPU-synchronised) at 1280×800 on a
deliberately weak GPU (AMD Radeon HD 6450, 2011), Shahbag at zoom 0.5 px/m (48 chunks, 0.87M vertices):

| Preset | MSAA | Shadows | Max resolution | Frame time |
|---|---|---|---|---|
| low | off | off | 1× | 10–13 ms |
| med (default) | off | on | 1.5× | 13–17 ms |
| high | 4× | on | 2× | 18–28 ms |

World update and label placement together take < 1 ms; rendering is fill-rate bound on this GPU, so a
mid-range laptop GPU should hold 60 fps on `high`.

**Size**: processed data is 40 MB in total (LOD0 30 MB, LOD1 3.5 MB, LOD2 0.27 MB, search index 0.5 MB),
loaded lazily. First load is ~1.5 MB: app JS ~170 KB gz, `index.json` 44 KB, LOD2 for the minimap
0.27 MB, and the ~35 LOD0 tiles in view (median tile 6 KB, dense centre up to ~33 KB).

## Decisions & assumptions

* **No osmium/ogr2ogr on the build machine**, and Overpass returned 406/limits, so the PBF is decoded
  in TypeScript.
* **Water draws above parks** (the spec lists landuse, water, parks). Dhaka's lakes (Dhanmondi,
  Ramna, Gulshan) sit inside park polygons and would otherwise be hidden.
* **Untagged building heights**: OSM rarely has `height`/`building:levels` in Dhaka, so untagged
  buildings get a deterministic pseudo-random height of 9–24 m (typical 3–7 storeys) derived from the
  OSM id. Tagged values are always used when present.
* **Dual carriageways**: one-way secondary-and-above roads without `lanes` get ~62% of the class width,
  since they are usually one half of a divided road.
* **MRT**: `railway=subway|light_rail` that isn't tagged as a tunnel is treated as elevated (layer 2).
  Stations are drawn as a 190 × 24 m roofed box over the viaduct at each station node within 60 m of it.
* **Processed data is committed** (40 MB) so the repo deploys without the 360 MB download.
  Regenerate with `npm run data:build`.
* **OSM bus route relations are sparse** in Dhaka (only a handful are tagged); Phase 5 will build
  routes from road ways + named stops (see `docs/ROUTES.md`).
* Validation reference coordinates for Shapla Chattar and Mohakhali Bus Terminal were corrected to
  their published positions, which OSM matches within 76 m and 23 m respectively.

## License

Code: MIT. Map data: © OpenStreetMap contributors, ODbL 1.0 (see `docs/ASSETS.md`).
