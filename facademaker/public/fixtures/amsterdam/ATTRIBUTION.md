# Amsterdam demo fixture — data sources and attribution

A frozen snapshot of one central-Amsterdam area, captured **2026-07-25**, so the
demo place loads instantly and works with no network. Regenerate with
`npm run fixture:amsterdam` (see `scripts/capture-fixture.mjs`).

**Area** — bbox `west 4.8952, south 52.3643, east 4.9130, north 52.3709`,
anchor `lat0 52.3676, lon0 4.9041` (the local-metre origin every payload is
projected against; it must not be changed independently of the data).

| File | Contents | Source |
|---|---|---|
| `buildings.json` | 1,585 building footprints | © OpenStreetMap contributors |
| `parcels.json` | 1,753 cadastral parcels | Kadaster / PDOK |
| `streets.json` | 212 streets and canals | © OpenStreetMap contributors |
| `terrain.json` | 128 × 79 elevation heightfield | AWS Terrain Tiles (Terrarium) |

## OpenStreetMap — ODbL 1.0

`buildings.json` and `streets.json` are derived from OpenStreetMap and are made
available under the **Open Database License (ODbL) v1.0**.

> © OpenStreetMap contributors — <https://www.openstreetmap.org/copyright>

Because these files are a redistributed derivative of an ODbL database, any
further redistribution must keep this attribution and stay under ODbL. The app
already credits OpenStreetMap in the place-picker UI; this file covers the
copy committed to the repository.

## Terrain — AWS Terrain Tiles

`terrain.json` is resampled from the Terrarium tiles in the AWS Open Data
`elevation-tiles-prod` bucket, which aggregates public sources (SRTM, NED,
and others). See
<https://registry.opendata.aws/terrain-tiles/> for the per-source attribution.

## Cadastral parcels — Kadaster / PDOK, CC BY 4.0

`parcels.json` is a frozen extract of the BRK Kadastrale Kaart `perceel`
collection published by Kadaster through PDOK:
<https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1?f=html>.

The data is available under **CC BY 4.0**. The published parcel geometry
indicates cadastral boundary locations; survey measurements cannot be derived
from the Kadastrale Kaart.

## Why these are committed

Overpass is a shared public service with strict rate limits; a live fetch of
this area takes 12–15 s and was repeatedly throttled during development. The
snapshot gives a demo/test place that is instant, deterministic and offline.
It is **frozen** — it will not reflect later edits to OpenStreetMap. Use
**Load place** for live data.
