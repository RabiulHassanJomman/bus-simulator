# Dhaka Bus Simulator — project handoff & plan

**Start a new chat with:** *"Read `docs/HANDOFF.md` and `README.md`, then continue with the next step
in the plan."* This file is the single source of truth for what was asked, what exists, what's
broken, and what's next. Keep it updated at the end of every phase (status table, issues, next step).

Last updated: 2026-10-27, after commit `37217f3` (Phases 1–5 done + mobile/traffic fixes).

---

## 1. Current status

| Phase | Scope | Status | Commit |
|---|---|---|---|
| 1 | Scaffold, OSM pipeline (core bbox), static PixiJS render, pan/zoom | ✅ done | `5d53115` |
| 2 | Full Dhaka bbox, 3-level LOD streaming, flyovers/MRT, labels, minimap, map search | ✅ done | `51d3c67`, `51477d5` |
| 3 | Bus physics, camera, collisions, flyover levels, controls (kb/gamepad/touch), sound | ✅ done | `e918efa` |
| 4 | Road graph, router, AI traffic, signals + traffic police, pedestrians, fines | ✅ done | `3fb5939` |
| 5 | Real routes + stops, passengers, fares, satisfaction, HUD, menus, career save | ✅ done | `8d6b744` |
| — | Mobile play (tilt steering, wheel, landscape layout), x-ray under flyovers, labels beside roads, smarter AI | ✅ done, **needs user check on a real phone** | `37217f3` |
| 6 | Progression, garage, fuel, events, weather, day/night, save system | ⏭ **next** | — |
| 7 | Assets pass (real sprites/audio), polish, full Bangla UI, mobile polish, credits | ⏳ | — |
| 8 | README/ASSETS/ROUTES complete, production build verified, Netlify deploy | ⏳ (netlify.toml exists) | — |

Tests: **36 passing** (`npm test`): pipeline/landmarks/flyovers, physics, router, traffic, routes/fares, tilt.

### User-reported issues (after Phase 5)

| # | Issue | Status |
|---|---|---|
| 1 | Can't see around the bus under the MRT line / flyovers → crashes | Addressed in `37217f3`: `src/render/XrayFilter.ts` fades the upper layer in a circle around the bus when under/approaching overhead structures, plus the bus outline ("ghost"). **Verify on device.** |
| 2 | Mobile steering not natural, can't hard-turn | Addressed in `37217f3`: continuous wheel (full lock at 90° rotation), hold-to-turn ◀ ▶ buttons, mode switch button (🛞 / ⇆ / 📱). **Verify on device.** |
| 3 | Road names drawn on the road hide it | Addressed in `37217f3`: labels placed beside the road (`src/render/Labels.ts`). **Verify.** |
| 4 | Accelerometer (tilt) steering on phone | Addressed in `37217f3`: device-orientation tilt steering, tap wheel to re-centre; `tests/tilt.test.ts`. iOS needs a permission prompt (user gesture). **Verify on Android + iOS.** |

If the user reports these still feel wrong, fix them **before** starting Phase 6.

---

## 2. How to run, test, verify

```bash
npm install
npm run dev                # http://localhost:5173 ; phone on same Wi-Fi: npx vite --host → http://<LAN-IP>:5173
npm test                   # vitest, 36 tests
npm run build              # tsc --noEmit && vite build
npm run data:build         # full pipeline (~2 min, ~3 GB RAM): fetch → extract → chunk → graph → routes
node --import tsx tools/build.ts --graph-only    # rebuild just the road graph
node --import tsx tools/build.ts --routes-only   # rebuild just routes.json + docs/ROUTES.md
npx tsx tools/validate.ts  # counts, PNG renders, landmark + flyover checks
npx tsx tools/route-preview.ts   # draws routes over data/work/full/map-full.png
```

URL options: `#lat,lon[,zoom]` spawn point · `?free` skip menu · `?debug` F3 overlay on ·
`?quality=low|med|high`.

**Headless visual checks** (no human needed): `npx tsx tools/screenshot.ts <url> <outDir> "<lat,lon,zoom>|action|action" ...`
Actions: `key:e`, `hold:w:3000`, `type:text`, `wait:ms`, `eval:<js>` (prints result; wrapped in a block).
`MOBILE=1` emulates a 390×844 phone. `CHROME_ARGS="--enable-gpu --ignore-gpu-blocklist --use-angle=gl"`
uses the real GPU (otherwise SwiftShader, where FPS numbers are meaningless).
`window.__game` exposes `{app, world, cam, bus, sim, run, menu, career, clock, collision, bench()}`;
`__game.bench(20)` returns GPU-synchronised per-stage frame times.

### Gotchas learned the hard way
- **Restart `vite` after `data:build`**: Vite caches public file sizes at startup and serves
  truncated chunks → "Failed to fetch" in workers.
- Never `pkill -f <pattern>` with a pattern that appears in your own shell command (kills the shell).
  Kill the dev server with `kill $(lsof -t -i:5173)`.
- `page.evaluate(fn)` from tsx scripts breaks (esbuild injects `__name`); pass JS **strings**.
- Dev machine GPU is an AMD Radeon HD 6450 (2011): fill-rate bound. `med` ≈ 13–17 ms/frame, `high` 18–28 ms.
- The Bangladesh PBF lives in `data/raw/` (gitignored, 356 MB); `data/work/` holds intermediate NDJSON.
- Processed data in `public/data/` (~40 MB) **is committed** so the repo deploys without the pipeline.
  Each rebuild adds ~40 MB to git history — only commit data when the format/content really changes.

---

## 3. Architecture (where things live)

```
tools/                       data pipeline (Node/TS, run with tsx)
  lib/pbf.ts                 own OSM PBF decoder (no osmium/GDAL on the machine)
  extract.ts                 PBF → data/work/<bbox>/features.ndjson (+routes.json, restrictions.json from OSM)
  lib/classify.ts            OSM tags → AreaKind/LineKind/PointKind; elevated-building rule
  chunk.ts                   features → public/data/lod{0,1,2}/X_Y.dbc (gzip) + index.json + places.json
  graph.ts                   → public/data/graph.dgz (68.5k nodes / 88.9k edges, 1.4 MB)
  routes.config.ts, routes.ts  → public/data/routes.json + docs/ROUTES.md (5 routes, both directions)
  validate.ts, landmarks.ts  landmark/flyover position checks + PNG renders
  screenshot.ts              puppeteer-core headless checks (system Chrome)
src/shared/                  code used by pipeline AND game
  geo.ts (projection: local equirect @ 23.80N 90.41E, 1 unit = 1 m, +y south), format.ts (DBC1 chunk
  container + generic section codec), graph.ts (graph decode), kinds.ts, style.ts (road widths), routes.ts (fares)
src/world/                   chunk streaming: World.ts (LOD pick + load/unload, pinned LOD0 around bus),
                             chunkWorker.ts + buildChunk.ts (tessellation in Web Workers), WorkerPool.ts
src/render/                  shaders.ts (vertex-colour + shadow-extrude), geometry.ts (stroke/dash),
                             Labels.ts, BusSprite.ts, TrafficArt.ts (baked textures), TrafficView.ts,
                             RouteView.ts, XrayFilter.ts, palette.ts
src/game/                    BusPhysics.ts (pure), Bus.ts (levels/damage/fines/snap), CollisionWorld.ts (SAT),
                             Router.ts (A*), Rules.ts (red light/wrong way), Clock.ts, Input.ts, Settings.ts, Camera.ts
src/game/traffic/            Traffic.ts (IDM + weaving), Signals.ts (controllers + police), Pedestrians.ts, types.ts
src/game/career/             RouteRun.ts (passengers/fares/satisfaction, pure), Career.ts (localStorage)
src/audio/                   AudioEngine.ts (WebAudio synth), Announcer.ts (speechSynthesis conductor)
src/ui/                      Hud.ts, RunHud.ts, Menu.ts, MapView.ts (minimap + fullscreen map/search), DebugOverlay.ts
src/main.ts                  boot + game loop + mode state machine (menu / free / run, pause)
```

Render layers per chunk: `ground` (landuse→water→paths→casing→fill→markings→rail, one mesh),
`shadow` (one AlphaFilter pass), `upper` (buildings→flyovers→MRT). Entities: `world.entities`
(between shadow and upper), `world.entitiesElevated` (above upper), `world.top` (bus ghost outline).

Key facts: 835k buildings, 41k road ways, 258 junction controllers (93 OSM signals clustered + 218
police junctions), 6272 searchable names, 45/56 route stops matched to OSM bus stops. Fares: ৳2.45/km,
min ৳10, students half (min ৳5). Bangladesh drives on the LEFT (doors on the left, kerb = left).

---

## 4. Decisions & assumptions (also in README)

- OSM PBF decoded in TypeScript (no osmium/ogr2ogr available; Overpass returned 406).
- Water drawn above parks (lakes sit inside park polygons).
- Untagged building heights: deterministic 9–24 m from OSM id.
- MRT (`railway=subway|light_rail`, not tunnel) treated as elevated; pillars every 30 m, track pairs merged.
- Elevated buildings (no ground collision): `min_level`/`building:min_level` ≥ 1, `min_height` ≥ 2.5,
  `layer` ≥ 3, or `layer` ≥ 2 on station/transport buildings (layer=1 alone is common and ignored).
- Medians of dual carriageways aren't obstacles (OSM gap between one-way ways is drivable).
- OSM has 3 incomplete Dhaka bus relations → routes defined manually in `tools/routes.config.ts`.
- Traffic only simulated within ~330 m of the bus (no statistical flow model beyond).
- Collisions only fined when the bus was moving (AI ramming a parked bus isn't the player's fault).
- Game clock: 1 real s = 1 game minute, start Sunday 08:30.

---

## 5. Plan for the remaining phases

### Phase 6 — progression, garage, events, weather, day/night, saves (≈1–1.5 h)
1. **Save system**: extend `Career.ts` to `version: 2` with migration from v1: money, reputation,
   owned buses, selected bus, upgrades per bus, fuel level, bus damage, unlocked routes, settings,
   stats, daily/weekly challenge state. Autosave on run end + every 60 s; export/import JSON in settings.
2. **Garage** (new `src/ui/Garage.ts`): buy buses — local non-AC (start), local AC (higher fares ×1.3,
   satisfaction bonus), **BRTC double-decker** (`BUSES.doubleDecker` exists in BusPhysics; needs a sprite
   variant in `BusSprite.ts`: two-tone red with upper-deck windows), Metro-style city bus. Upgrades:
   engine (torque ×1.1/1.2), brakes (brakeDecel), suspension (comfort: reduces satisfaction penalty for
   harsh accel), horn (unlock horn styles from `HORN_STYLES`), paint (liveries from `LIVERIES`).
   Repairs: damage → cost; damage > 70% reduces top speed/comfort.
3. **Fuel/CNG**: tank level drains with throttle×distance; fuel stations from OSM (`PointKind.Fuel`
   points are already in LOD0 chunks: `built.points` kind 6). Stop at a station with engine idle →
   refuel for money. Low-fuel warning; empty → coast/limp mode. Show stations on the minimap.
4. **Day/night**: drive from `Clock.hour`. Tint the world (ColorMatrix filter or uniform on the colour
   shader), sun direction/length for shadows via `setSun()` in `shaders.ts`, headlight cones (additive
   sprites in front of bus + AI), tail lights, streetlights from `PointKind.StreetLamp` points, lit
   windows (random roof dots). Azaan audio cue at prayer times (Phase 7 sample).
5. **Weather**: rain mode (particle streaks in screen space, darker palette, wet-road sheen, reduced grip
   in BusPhysics: grip ×0.7, brakeDecel ×0.8), puddles/waterlogging zones at Motijheel, Mirpur,
   Jatrabari (slow-down areas with spray); toggle in settings + random by game day.
6. **Random events** (new `src/game/Events.ts`, ~1 per few game hours near the player's route):
   procession/rally blocking a road (edges closed in Router + crowd sprites), accident ahead (wrecked
   cars + police, lane closed), VIP movement road closure (police line, wait 60–120 s),
   hartal day (very low density, rare vehicles), breakdown ahead (stalled bus). Eid exodus special
   (huge density toward Gabtoli/Sayedabad/Sadarghat). Toast + minimap marker.
7. **Challenges**: daily/weekly missions (e.g. "Deliver 60 passengers on Gabtoli–Sayedabad with ≥80%
   satisfaction", "No fines on Airport Road") seeded by date; local leaderboard (best runs per route).
8. **Free roam teleport by search** already exists (M map); add "start a route from here" shortcut.
9. Tests: save migration, fuel consumption, event road closures respected by Router, day/night density.

### Phase 7 — assets, audio, polish, localisation, mobile, credits (≈1–2 h)
1. Try downloading CC0 assets (Kenney.nl top-down vehicles/city/UI, OpenGameArt, freesound CC0 only).
   If network/licence blocks it, keep the procedural art but improve it (rim light, more detail, dents).
   Recolour/tint with sharp/@napi-rs/canvas into Dhaka liveries. **Record every asset in
   `docs/ASSETS.md`** (name, URL, licence, author) and in an in-game Credits screen.
2. Audio samples: engine loop (pitch by rpm), multiple horns, brake squeal, doors, passenger chatter,
   rain, city ambience (hawkers, rickshaw bells), azaan at prayer times, conductor calls.
3. Full Bangla UI pass (every string through a small i18n table instead of inline `t(en, bn)`).
4. Settings screen: quality, audio volumes, control remap (keyboard), steering mode, language.
5. Tutorial: first ~3 minutes on Mirpur 10–Farmgate teaching drive/brake, stop box, doors, fares.
6. Mobile polish from user feedback; performance pass on phone (lower DPR, quality auto-detect).

### Phase 8 — docs, build, deploy (≈20–30 min)
1. README: setup/run/deploy, controls, architecture, perf numbers, build size, first-load size.
2. ASSETS.md, ROUTES.md complete; credits screen matches.
3. `npm run build` verified; measure `dist/` size and first-load (target < 10 MB; currently ~1.5 MB +
   graph 1.4 MB + routes). Netlify: `netlify.toml` exists (publish `dist`, headers for `/data/*`).
   Deploying needs the user's Netlify account (or Vercel; the Vercel MCP needs authorisation).

---

## 6. Original project specification (verbatim, as given by the user)

# TASK: Build "Dhaka Bus Simulator", a 2D top-down bus driving game on the real map of Dhaka

You are building a browser-based 2D bus simulator where the world is the real Dhaka city, generated from real map data, not a fictional or approximated map. Work autonomously and in phases. After each phase, run the game, verify it works, and commit. Do not move on with broken output.

## 0. Ground rules
- Language/stack: TypeScript + Vite. Renderer: PixiJS v8 (WebGL, handles thousands of sprites). Physics/logic: custom (simple arcade vehicle model); no heavy physics engine unless needed. Pathfinding/graph: write it yourself or use a small library.
- Deployable as a static site (Netlify-friendly). No backend required at runtime. All map data is preprocessed at build time into static chunk files under /public/data.
- Keep a clear structure: /tools (data pipeline scripts, Node/TS or Python), /src (game), /public/assets, /public/data, /docs/ASSETS.md (every downloaded asset: source URL, license, author).
- Commit after every phase with a meaningful message.
- If something is ambiguous, make the best decision, note it in README.md, and keep going.

## 1. Real map data pipeline (the core of this project)
Goal: every real road, building, water body, landmark, flyover, and bus stop in Dhaka, in the game.

1. Data source: OpenStreetMap.
   - Download the Bangladesh extract from Geofabrik (https://download.geofabrik.de/asia/bangladesh.html), then clip to a Dhaka bounding box using osmium or ogr2ogr (fallback: Overpass API in tiled queries with delays and retries to respect rate limits).
   - Bounding box: roughly lat 23.65 to 23.95, lon 90.30 to 90.52 (covers Uttara to Demra/Jatrabari, Savar side to Purbachal approach). Make the bbox configurable. Start development on a smaller core box (Mirpur to Motijheel) for fast iteration, then scale up.
2. Extract and preprocess layers:
   - Roads: highway=motorway/trunk/primary/secondary/tertiary/residential/service/living_street/pedestrian/footway. Keep name, name:bn, oneway, lanes, maxspeed, bridge, tunnel, layer, surface.
   - Flyovers/elevated expressway: bridge=yes + layer>0. Render at correct z-order above ground roads, with shadows. Include Mohakhali Flyover, Kuril Flyover, Moghbazar-Mouchak Flyover, Dhaka Elevated Expressway, Jatrabari Flyover, Malibagh, Banani, etc. Verify each exists in the data.
   - Buildings (building=*): polygons with height/levels when available. Render as top-down footprints with subtle roof color variation and a drop shadow for depth. Tall buildings get a bigger offset shadow.
   - Water: natural=water, waterway=*, riverbank (Buriganga, Turag, Balu, Hatirjheel, Dhanmondi Lake, Gulshan Lake, Banani Lake, Begunbari Khal, canals).
   - Parks/landuse: leisure=park, landuse=residential/commercial/industrial/forest/cemetery, Ramna Park, Suhrawardy Udyan, Botanical Garden, Dhaka University campus, Cantonment, Hazrat Shahjalal Airport.
   - Railway: Kamalapur, Airport, Tejgaon, Banani railway stations and tracks, with level crossings.
   - Metro Rail MRT Line 6 (Uttara North to Motijheel): elevated viaduct above Begum Rokeya Sarani, Mirpur Road, Farmgate, Karwan Bazar, Shahbag and Dhaka University, with station buildings and pillars. Pillars are obstacles in the median.
   - POIs/landmarks: amenity/shop/tourism/historic with names; mosques, hospitals, markets (New Market, Gulistan, Karwan Bazar, Gawsia), universities, malls (Jamuna Future Park, Bashundhara City), Shaheed Minar, National Parliament, Ahsan Manzil, Lalbagh Fort, Star Mosque, Sadarghat launch terminal, Gabtoli/Mohakhali/Sayedabad terminals.
   - Traffic signals, crossings, roundabouts (Shahbag, Gulistan, Shapla Chattar/Motijheel, Mohakhali etc.), bus stops (highway=bus_stop, public_transport=platform), and turn restrictions.
   - Bus routes: OSM relations route=bus. Extract real Dhaka routes (e.g. Bikalpa, Turag, Raida, Victor Classic, Projapoti, Anabil, Welcome, Mirpur-Motijheel, Uttara-Sadarghat, Gabtoli-Gulistan-Sayedabad etc. where tagged). If OSM bus relations are sparse, use ways + stop names to build routes semi-manually and document it in /docs/ROUTES.md. Include BRTC double-decker as a bus variant.
3. Projection: use Web Mercator or a local equirectangular projection centered on Dhaka; 1 world unit = 1 meter. All geometry in meters so physics speeds are real (a bus at 40 km/h = 11.1 m/s).
4. Output format: split the world into chunks (e.g. 512m x 512m tiles). Per chunk: compact binary or JSON (gzip) containing pre-simplified, pre-triangulated geometry for each layer. Build a spatial index file. Use Douglas-Peucker simplification with zoom-dependent LOD. Also produce a routable road graph (nodes/edges with lane count, speed, direction, signals) for traffic AI and navigation.
5. Pipeline must be reproducible: `npm run data:build` regenerates everything from the raw download. Cache raw downloads (gitignored), commit only processed output if size is reasonable (otherwise provide a download script).
6. Validation script: print counts per layer, a test render of the full map to a PNG, and check that known landmarks exist at the right coordinates (Shahbag intersection, Farmgate, Mohakhali bus terminal, Shapla Chattar, Kamalapur Station, Uttara Sector 3, Mirpur 10).

## 2. Rendering
- Top-down 2D camera following the bus with smooth lerp, zoom (scroll or +/-), and optional rotate-with-heading mode (toggle).
- Stream chunks around the camera; unload far ones. Cull everything off-screen. Target 60 fps on a mid-range laptop with the whole city loaded.
- Layers (bottom to top): landuse, water, parks, ground roads (casing + fill + lane markings + median), railway, buildings (with shadows), road signage/markings, vehicles, pedestrians, bridges/flyovers (with shadows on lower layers), elevated MRT, labels, HUD.
- Roads: proper widths from lane count and highway class, dashed center lines, zebra crossings, stop lines, road names rendered along the road at higher zoom (Bangla + English toggle, with a Bangla font such as Noto Sans Bengali).
- Day/night cycle with headlights, streetlights, lit shop windows, tail lights. Rain with puddles/waterlogging at known flood-prone spots (Motijheel, Mirpur, Jatrabari) as an optional weather mode.
- Minimap (real map, with route line and bus marker) and a fullscreen map overlay.

## 3. Assets: download real assets, avoid crude placeholder vector art
- Download free, properly licensed assets where possible: Kenney.nl (CC0 top-down vehicles, city, roads, UI), OpenGameArt.org, itch.io free asset packs, Wikimedia Commons (only for textures/photos that allow reuse), freesound.org (CC0 only) for audio, Google Fonts for typography.
- Needed: top-down bus sprites (several liveries; the Dhaka local bus look with colorful dented bodies, plus a BRTC double-decker and a Metro-style bus), CNG auto-rickshaws (green), rickshaws (colorful), private cars, taxis (yellow), trucks, pickups, motorcycles, ambulances, police vehicles, pedestrians (with sarees, panjabis, school uniforms), street vendors, trees, billboards, bus stop shelters, signals, traffic cones, barricades.
- If a suitable asset can't be downloaded (network restrictions, license), generate a high-quality sprite procedurally with proper shading, rim lighting and detail, never flat crude shapes. Use image tools (sharp, canvas, Python PIL) to recolor/tint downloaded sprites into a Dhaka-style livery set.
- Record every asset in /docs/ASSETS.md (name, source URL, license, author). Only use assets whose license allows redistribution. Include required attributions in the in-game credits screen.
- Audio: engine loop (pitch by RPM), horn (Dhaka horn culture: multiple horn styles; pressing H spams), brake squeal, door open/close, passenger chatter, rain, ambient city (hawkers, azaan at prayer times, rickshaw bells), conductor shouting stop names.

## 4. Gameplay
Core loop: pick a real route, drive the bus along it, stop at real bus stops, let passengers on/off, collect fares, avoid crashes and fines, finish the route before time runs out.

Bus physics (arcade-realistic):
- Bicycle-model steering, mass, acceleration curve, braking, handbrake, gears (auto), turning radius appropriate for a ~12 m bus (double-decker ~10.5 m but taller), body overhang, and sideswipes.
- Collisions with buildings, pillars, medians, vehicles, pedestrians with damage model, dents on the sprite, and fines/penalty.
- Controls: WASD/arrows, Space handbrake, H horn, E open doors, L lights, R reset-to-road (with penalty), M map, Tab route info. Also support gamepad and touch controls (on-screen steering wheel + pedals) for mobile.

Dhaka traffic (the star of the game):
- AI vehicles that follow the real road graph with lane discipline weak on purpose: rickshaws and CNGs weave, buses cut in and stop in the middle of the road, motorcycles filter between cars, pedestrians jaywalk, vendors on footpaths. Use a believable but fun density that varies by time of day (morning/evening rush, Friday morning empty roads, Eid exodus special event).
- Traffic signals with real cycle logic where tagged, traffic police at major intersections (waving override), occasional broken signals, jam hot spots (Farmgate, Mohakhali, Gulistan, Jatrabari, Shahbag) that grow and clear dynamically.
- Rickshaw-free zones and one-way streets respected by the router; wrong-way behavior flagged to player as a fine.
- Random events: procession/rally blocking road, accident ahead, waterlogging, VIP movement road closure, hartal-style empty roads, breakdown ahead.

Passengers and fares:
- Each real bus stop spawns waiting passengers with destinations along the route. Boarding time, crowding (standing/hanging passengers at rush hour, with a satisfaction penalty for too-crowded buses), ladies' seat rules, student half-fare, the conductor system (automatic collection), and fare table by distance (approximate real Dhaka local bus fares per km; document assumptions).
- Passenger satisfaction meter (smoothness, speed, stopping accurately at the stop, crowding, no harsh braking, doors only open when stopped).
- Missing a stop or skipping passengers costs reputation.

Progression and economy:
- Start with a basic local bus and a short route (e.g. Mirpur 10 to Farmgate). Earn money to unlock longer routes (Uttara to Sadarghat, Gabtoli to Sayedabad, Airport Road to Motijheel), better buses (AC, double-decker), upgrades (engine, suspension, horn, paint, brakes), and fuel/CNG management with fueling stations from OSM (amenity=fuel).
- Daily/weekly challenge missions, leaderboard (local storage; optional backend later), career mode and free-roam mode (drive anywhere with no passengers; teleport to any named place via search).
- Place search: type any road/area name (Bangla or English) to jump the camera there in free-roam.

## 5. UI/UX
- Clean HUD: speedometer, fuel, damage, passengers on board, next stop with distance and ETA, money, satisfaction, time of day, current road name, minimap.
- Bangla/English language toggle for the whole UI and for in-game stop-name announcements.
- Start screen, route selection map, garage, settings (graphics quality, audio, controls remap), pause, credits.
- Tutorial: first 3 minutes teaching controls, stopping accurately, doors, and fares.

## 6. Performance and quality
- Web Workers for chunk decoding and traffic AI where possible. Object pooling for vehicles/pedestrians. Only simulate AI in a radius around the player; lower-LOD simulation (statistical flow) beyond that.
- Quality presets (low/med/high) controlling traffic density, shadows, and particle effects.
- Add basic automated tests for the data pipeline (landmark checks), the router (route A to B finds a path), and physics (bus stops within a given distance from a given speed).
- Add an in-game debug overlay (F3): fps, chunk count, entity count, coordinates (lat/lon), road id.

## 7. Phased plan (follow in order; stop to verify at each end)
Phase 1: Project scaffold + data pipeline for a small core bbox (Farmgate to Shahbag to Motijheel) + static render of roads/buildings/water in PixiJS with pan/zoom.
Phase 2: Full Dhaka bbox, chunk streaming, LOD, performance pass, flyovers/MRT layers, labels, minimap.
Phase 3: Bus physics and camera, collisions, controls, sound basics.
Phase 4: Road graph routing, AI traffic, traffic signals, pedestrians.
Phase 5: Real bus routes, stops, passengers, fares, HUD, satisfaction.
Phase 6: Progression, garage, events, weather, day/night, save system.
Phase 7: Assets pass (replace any placeholders with downloaded/recolored sprites), audio, polish, Bangla localization, mobile controls, credits.
Phase 8: README with setup/run/deploy instructions, ASSETS.md and ROUTES.md complete, production build verified, Netlify deploy config.

## 8. Definition of done
- `npm run data:build && npm run dev` runs the game; the whole of Dhaka is explorable in free-roam with correct road shapes, names, flyovers, water, and buildings (spot-check against OpenStreetMap).
- At least 5 real playable bus routes with real stops.
- Traffic feels chaotic but playable at 60 fps.
- All assets documented with licenses; no broken links or missing sprites.
- Production build size and load time reported in README (use lazy chunk loading so first load is under ~10 MB).

Start now with Phase 1. Before coding, briefly state your plan for the data pipeline and the chunk format, then implement. Report progress per phase in 3 to 5 lines, and ask me only if truly blocked.

---

## 7. Spec items not yet covered (checklist for Phases 6–8)

- [ ] Day/night, headlights/tail lights visible, streetlights, lit windows
- [ ] Rain + waterlogging spots (Motijheel, Mirpur, Jatrabari)
- [ ] Garage, bus purchase (AC, BRTC double-decker, Metro-style), upgrades, paint, repairs
- [ ] Fuel/CNG + OSM fuel stations
- [ ] Random events (procession, accident, waterlogging, VIP closure, hartal, breakdown, Eid exodus)
- [ ] Daily/weekly challenges, local leaderboard
- [ ] Settings (quality, audio, control remap), credits screen, tutorial
- [ ] Real downloaded sprites/audio (or documented procedural fallback) in ASSETS.md
- [ ] Passenger chatter, azaan, hawkers, rain audio
- [ ] Full Bangla localisation of every UI string
- [ ] Traffic AI in a Web Worker (currently main thread, ~2.5 ms/frame) — optional
- [ ] Statistical flow beyond the simulation radius — optional
- [ ] Medians as obstacles — optional (data limitation, documented)
- [ ] Deploy (needs the user's Netlify/Vercel account)
