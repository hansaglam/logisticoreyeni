# ADR 0005 — MapData update strategy

**Status:** PROPOSED  
**Date:** 2026-09-15  

## Context

`MAP_DATA_SCHEMA_VERSION` vs `MAP_DATA_RELEASE_VERSION` (Step 1). Release version remains **null** until an approved package exists. App OTA is disabled.

## Decision (provisional)

Ship schema-compatible packages with **hash + atomic activate + rollback**. Country packs may update independently of app binary **when** download is enabled; core world may ship in-app for the first release.

Schema bumps that break clients require a **compatibility range** on the package; incompatible packages never activate.

## Constraint

MapData updates **must not** mutate player money, unlocks, or ownership.
