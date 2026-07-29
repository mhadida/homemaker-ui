# Utrecht demo fixture — data sources and attribution

A frozen snapshot of the Smakkelaarsveld / Hoog Catharijne area beside Utrecht
Centraal, captured **2026-07-28**, so the second demo place loads instantly and
works without a network connection. Regenerate with `npm run fixture:utrecht`.

**Area** — bbox `west 5.1035, south 52.0915, east 5.1135, north 52.0962`,
anchor `lat0 52.09385, lon0 5.1085`. The frame covers the user-marked site
between the rail approaches, Weerdsingel Westzijde, Catharijnesingel, and
TivoliVredenburg, with a small amount of surrounding street context.

| File | Contents | Source |
|---|---|---|
| `buildings.json` | 637 building footprints | © OpenStreetMap contributors |
| `parcels.json` | 577 cadastral parcels | Kadaster / PDOK |
| `streets.json` | 125 streets and canals | © OpenStreetMap contributors |
| `terrain.json` | 128 × 99 elevation heightfield | AWS Terrain Tiles (Terrarium) |

## OpenStreetMap — ODbL 1.0

`buildings.json` and `streets.json` are derived from OpenStreetMap and are made
available under the **Open Database License (ODbL) v1.0**.

> © OpenStreetMap contributors — <https://www.openstreetmap.org/copyright>

Any further redistribution must retain this attribution and comply with ODbL.
The snapshot is frozen and will not reflect later OpenStreetMap edits; use
**Load place** for live data.

## Terrain — AWS Terrain Tiles

`terrain.json` is resampled from Terrarium tiles in the AWS Open Data
`elevation-tiles-prod` bucket, which aggregates public elevation sources
including SRTM and NED. Source details and attribution:
<https://registry.opendata.aws/terrain-tiles/>.

## Cadastral parcels — Kadaster / PDOK, CC BY 4.0

`parcels.json` is a frozen extract of the BRK Kadastrale Kaart `perceel`
collection published by Kadaster through PDOK:
<https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1?f=html>.

The data is available under **CC BY 4.0**. The published parcel geometry
indicates cadastral boundary locations; survey measurements cannot be derived
from the Kadastrale Kaart.
