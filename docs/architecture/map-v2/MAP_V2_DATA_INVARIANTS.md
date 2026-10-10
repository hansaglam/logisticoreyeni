# Map V2 — Data integrity invariants

These are binding for later implementation. None authorize data invention in this step.

1. Gameplay IDs are never inferred from display names.
2. Geographic IDs are never used as player IDs (`ownerUid`, warehouse instance ids, etc.).
3. MapData updates cannot mutate player money or progression.
4. Missing geography never creates fictional coordinates.
5. Legacy PNG X/Y is never treated as WGS84.
6. Existing contract `originCityId` / `destinationCityId` remain valid during migration.
7. Existing warehouse ownership (`warehouse.cityId`) remains valid during migration.
8. Renderer never becomes authoritative game state.
9. Geographic datasets require provenance (`productionApproved` false until verified).
10. Real infrastructure must be distinguishable from gameplay-only infrastructure.
11. Transport mode must be explicit (`ROAD` | `RAIL` | `SEA` | `AIR`).
12. MapData **schema** version and **release** version are distinct; release stays unset until an approved package exists.
13. Player save never stores renderer pixel coordinates in the final Map V2 model.
14. World / region / country hierarchy is not encoded solely in UI widgets.
15. Missing mapping must fail closed or degrade gracefully (no silent geo fabrication).
16. Region is optional; Türkiye gameplay must not require a Europe parent.
17. `ROUTES.distanceKm` is not geographic `distanceMeters` until an explicit verified migration.
18. ISO country codes are assigned only from approved source validation at ingest — never invented in types/defaults.
