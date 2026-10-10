# Map V2 — Türkiye RAIL connectivity audit (Step 8)

**Player rail remains inactive.** TCDD is QA/reference only.

## Before → after (canonical package)

| | Before | After |
|---|---|---|
| Nodes | 18,496 | 19,228 |
| Edges | 20,160 | 21,025 |
| Components | 1,046 | 1,063 |
| Largest | 15,132 | 17,025 |
| Border-clip nodes | 91 | 1 |
| Package bytes | 31,287,433 | 32,661,064 |
| Hash | `sha256:cd95be300f6b4e75eab235e215794f6602d1ab0dca61b3851ee909c7dc0f4033` | `sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b` |

## Repair applied

Land-polygon clipping treated Marmara **water/tunnel** vertices as outside Türkiye. That split:

- Marmaray (`railway=rail` `usage=main` `tunnel=yes`)
- İstanbul–Ankara YHT/conventional ways along the İzmit gulf

**Fix:** keep vertices inside `country.tur` COUNTRY_HIGH **projected bbox** as domestic in-scope. No invented edges. No construction/disused inclusion.

## Not repaired

- Near-breaks at 50–500 m: QA candidates only, not auto-joined
- Construction MAG YHT Adana–Gaziantep: FILTER_POLICY / SOURCE_GAP
- Bursa/Antalya/Trabzon without a mainline-scale component: UNRESOLVED
- 778+ unassociated station points: metadata only (`PROVISIONAL_NEAR_EDGE` does not alter topology)

## Run

```
npx tsx scripts/map-v2/ingest-turkey-rail.ts
npx tsx scripts/map-v2/audit-turkey-rail-connectivity.ts
```
