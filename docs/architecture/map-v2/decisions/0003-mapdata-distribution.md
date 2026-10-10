# ADR 0003 — MapData package distribution

**Status:** PROPOSED  
**Date:** 2026-09-15  

## Context

World-scale vectors cannot all live in the app forever. The live game is Türkiye-only. Store updates are full binaries (`expoUpdatesEnabled: false`). Offline play matters.

## Decision (provisional)

**Hybrid:** bundled **core world** (index + simplified countries) + **on-demand country packages**, with **Türkiye country data bundled at first geographic ship** so the live game does not depend on download for the only playable country.

## Not finalized until

Package byte sizes, decode time, and store size are measured. Encoding format (ADR 0004) affects this.

## Alternatives

- All bundled — simple offline, poor global scale.  
- All downloaded — blocks first open / offline guests.  
