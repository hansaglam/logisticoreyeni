# Map V2 — City progression foundation

DEV / Map V2 country experience only. **Production `MapScreen` is unchanged.** This step does **not** activate live city locking.

## Rollout modes

| Mode | Default | Behavior |
|---|---|---|
| `LEGACY_ALL_UNLOCKED` | **yes** | All 8 LEGACY-STABLE Türkiye cities are playable (`STARTER` home + `UNLOCKED` rest). Existing saves keep the current all-open country. |
| `MAP_V2_PROGRESSION_PREVIEW` | DEV only | `DEV_PREVIEW_ONLY` fixture paints a subset locked for visual QA. Does not write saves. |
| `MAP_V2_PROGRESSION_ACTIVE` | **never default** | Architecture path: derive availability from AND requirements, then force-open cities that already have warehouses / trucks / active deliveries. Not exposed in player UI. |

Default constant: `MAP_V2_CITY_PROGRESSION_DEFAULT_MODE = LEGACY_ALL_UNLOCKED`.

These modes are **not** the MapData renderer flags in `MAP_V2_ROLLOUT_MODES.md` (`LEGACY_ONLY`, `MAP_V2_SHADOW`, …).

## Availability states

`STARTER` | `UNLOCKED` | `LOCKED` | `NOT_AVAILABLE`

- Playable (City Detail allowed): `STARTER`, `UNLOCKED`
- `LOCKED` remains visible on map and Şehirler list
- `NOT_AVAILABLE` reserved for IDs outside the 8 LEGACY-STABLE cities

Starter city = `player.homeCityId` when it is one of the 8 IDs; otherwise existing fallback `DEFAULT_TRUCK_CITY_ID` (`izmir`).

## Requirement model (AND)

Supported because live player state already has them:

| Type | Source |
|---|---|
| `PLAYER_LEVEL` | `player.level` (XP level, not warehouse `getCityUnlockLevel`) |
| `REPUTATION` | `player.reputation` (0–100 in current `Player`) |
| `CASH` | `player.money` |
| `WAREHOUSE_IN_CITY` | owned `player.warehouses[].cityId` |
| `CITY_UNLOCKED` | already-open cities in displayPriority order |

Deferred (no current city-progression contract):

- `MILESTONE`
- `COMPANY_LEVEL` as a separate type (`player.companyLevel` exists but is not wired here)
- nested OR trees
- `levelConfig.warehouseUnlocks` / `getCityUnlockLevel` — those are **warehouse opening** rules, not city availability

V1: all listed requirements must pass (AND). Preview numbers are `PROVISIONAL_DEV_ONLY`.

## Policy structure

`CityUnlockPolicy` lives in `src/mapV2/gameplay/cityProgression.ts` + `cityProgression.preview.fixture.ts`.

Not stored on GeoCity, Skia canvas, or City Detail. Canvas only receives `availabilityByGeoCityId` visual tokens.

## Compatibility / existing saves

- No persistent unlock fields
- No Firestore schema change
- No automatic user migration
- Missing save unlock data → derive from rollout mode (legacy = all open)

## Asset ownership safety

If a future activation (`MAP_V2_PROGRESSION_ACTIVE`) would lock a city where the player already has:

- a warehouse
- an owned/located truck
- an active delivery (`preparing` / `on_route` / `paused`) origin or destination

that city is forced `UNLOCKED` so existing operations cannot become illegal.

`MAP_V2_PROGRESSION_PREVIEW` **does not** apply this override (visual testing may lock cities that have assets).

`LEGACY_ALL_UNLOCKED` never locks the 8 cities, so warehouse / truck / delivery states stay valid.

## Contract generation dependency

Existing contracts may reference any of the 8 cities. This step **does not** filter contract generation.

Before real activation, contract generation must become availability-aware in a **separate** step. Do not invalidate in-flight deliveries.

## Economy

Unlock CTA is architected (`Şehri Aç`) but **disabled** (`Yakında`). No money, reputation, or level mutation. No save write.

Final unlock prices are **not** set.

## DEV preview policy

`buildTurkeyCityProgressionPreviewPolicies`:

- starter = home city
- next two catalog cities `UNLOCKED`
- remainder `LOCKED` with provisional AND requirements

Entry:

- Simülasyon Testi → **Map V2 City Progression Preview** (`__DEV__`)
- In-country `__DEV__` chip toggles preview vs legacy

## Future activation dependencies

1. Product balancing (not this pass)
2. Persist or cloud unlock contract (explicitly deferred)
3. Contract generation availability filter
4. Warehouse-opening vs city-unlock rule reconciliation
5. Migration for owned assets in locked cities (ACTIVE already sketches force-open)
6. Player-facing ROAD still out of scope
