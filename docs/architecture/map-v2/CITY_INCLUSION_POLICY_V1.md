/**
 * Türkiye city inclusion policy (Step 2C).
 *
 * Authoritative constants: `scripts/map-v2/city-inclusion-policy.ts`
 * Source decision: `docs/architecture/map-v2/decisions/0006-city-source-selection.md`
 *
 * ## Package membership
 *
 * Include every Natural Earth 10m populated-places feature with `ADM0_A3=TUR`.
 * That file is already a populated-place extract (not hamlets). Do not add
 * settlements from other files in this step.
 *
 * ## Presentation LOD (not gameplay importance)
 *
 * | LOD | Rule (source fields only) |
 * |---|---|
 * | CITY_LOD_COUNTRY_OVERVIEW | Admin-0 capital, or POP_MAX ≥ 500000, or mapped legacy gameplay city |
 * | CITY_LOD_REGIONAL | Admin-1 capital, or POP_MAX ≥ 150000 |
 * | CITY_LOD_LOCAL | remaining TUR rows |
 *
 * Hidden at a camera LOD ≠ deleted from the package.
 *
 * Population missing/invalid → null. Never fabricated.
 *
 * GeoCity is geography only: no unlock, warehouse, contract, economy, or route cost.
 */
