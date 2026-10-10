# Map V2 — Türkiye city foundation QA (Step 2C)

DEV path: Yönetim → Simülasyon Testi → Map V2 World Experience → Türkiye.

This is not production Harita. Geographic city markers only.

## DATA

- [ ] city source documented (Natural Earth 10m populated places v5.1.2; ADR 0006)
- [ ] license documented (public domain)
- [ ] no AI coordinates (source geometry copied; package hash present)
- [ ] package hash present (`contentHash` sha256)
- [ ] source provenance present (`sourceManifest.sourceHash` / version / URL)

## LEGACY MAPPING

- [ ] İzmir verified (`izmir` → `city.tur.ne.1159149371`)
- [ ] İstanbul verified (`istanbul` → `city.tur.ne.1159151579`)
- [ ] Ankara verified (`ankara` → `city.tur.ne.1159151255`)
- [ ] Bursa verified (`bursa` → `city.tur.ne.1159149373`)
- [ ] Antalya verified (`antalya` → `city.tur.ne.1159147717`)
- [ ] Adana verified (`adana` → `city.tur.ne.1159149381`)
- [ ] Diyarbakır verified (`diyarbakir` → `city.tur.ne.1159135229`)
- [ ] Trabzon verified (`trabzon` → `city.tur.ne.1159146377`)

## VISUAL

- [ ] Türkiye opens
- [ ] city points geographically plausible
- [ ] İzmir west coast
- [ ] İstanbul Bosphorus region
- [ ] Ankara central
- [ ] Bursa NW
- [ ] Antalya south coast
- [ ] Adana south
- [ ] Diyarbakır southeast
- [ ] Trabzon Black Sea coast
- [ ] no city appears outside Türkiye unexpectedly (coastal/source exceptions may sit on the shoreline; they are **not moved**)
- [ ] marker selection works
- [ ] pan/zoom works
- [ ] labels do not overwhelm
- [ ] DEV “Eski eşlemeleri göster” halo on the eight mapped cities only

### Known source exceptions (not relocated)

Natural Earth points outside `country.tur` COUNTRY_HIGH fill (coastal / admin representation):

- İstanbul (`city.tur.ne.1159151579`) — Bosphorus representation
- Sinop, Ordu — Black Sea coast
- Nusaybin — southern border

Status: `VERIFIED_SOURCE_EXCEPTION`. Coordinates remain source-backed.

## REGRESSION

- [ ] production Harita unchanged
- [ ] old gameplay city IDs unchanged
- [ ] ROUTES unchanged
- [ ] contracts unchanged
- [ ] warehouses unchanged
- [ ] no save migration
- [ ] no backend write
