# Assets and data sources

Every third-party asset shipped with the game is listed here with its source, license and author.
Only assets whose license allows redistribution are used. In-game credits mirror this file.

## Map data

| Asset | Source | License | Author |
|---|---|---|---|
| Dhaka roads, buildings, water, landuse, POIs, bus stops, routes | OpenStreetMap via Geofabrik Bangladesh extract — https://download.geofabrik.de/asia/bangladesh.html | ODbL 1.0 (attribution: "© OpenStreetMap contributors") | OpenStreetMap contributors |

Processed chunks in `public/data/` are a Derived Database of OpenStreetMap and remain under ODbL.

## Graphics

Phase 1 renders everything from map geometry (no sprite assets yet). Sprites are added in later phases.

## Audio

None yet.

## Fonts

| Asset | Source | License | Author |
|---|---|---|---|
| Noto Sans | Google Fonts — https://fonts.google.com/noto/specimen/Noto+Sans | SIL Open Font License 1.1 | Google / Noto project |
| Noto Sans Bengali | Google Fonts — https://fonts.google.com/noto/specimen/Noto+Sans+Bengali | SIL Open Font License 1.1 | Google / Noto project |

Fonts are loaded from the Google Fonts CDN at runtime (not redistributed in the repo).
