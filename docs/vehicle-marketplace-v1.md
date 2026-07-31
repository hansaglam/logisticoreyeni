# Vehicle Marketplace V1 — domain/backend

V1 has no user interface. All ownership and money mutations cross a callable
Cloud Functions boundary and complete in Firestore transactions.

## Authoritative state

`users/{uid}/marketplaceState/current` is the marketplace ownership boundary.
It contains canonical marketplace cash, fleet limit, sync version, vehicle
records and bounded sold-truck tombstones. Normal clients can read their own
state but cannot write it.

Existing accounts must be provisioned into this document by a trusted Admin SDK
deployment migration before marketplace actions are enabled. A client cloud
save is not accepted as proof of ownership. New gallery purchase/sale backend
actions must update this document in the same transaction as their cash/ledger
mutation.

The local/cloud game save only stores bounded cache data:

- active listing IDs (max 50)
- marketplace state version
- sold truck IDs (max 100)
- last sync time

On hydrate, `reconcileFleetWithVehicleMarketplace` applies the backend result.
Sold truck tombstones win over an older cloud save, so a sold vehicle cannot be
resurrected by restoring another device.

## Collections

- `vehicleMarketplaceListings/{listingId}` — public active listings and audit
  state for sold/cancelled/expired listings.
- `vehicleMarketplaceTransactions/{transactionId}` — immutable sale audit.
- `vehicleMarketplaceIdempotency/{uid_keyHash}` — successful callable replay
  result.
- `vehicleMarketplaceActionReceipts/{uid_transactionHash}` — prevents a
  transaction ID from being reused with another idempotency key.
- `users/{uid}/marketplaceState/current` — canonical cash/fleet/lock state.
- `users/{uid}/marketplaceHistory/{transactionId}` — private buyer/seller view.
- `users/{uid}/marketplaceLedger/{transactionId}` — private marketplace ledger.

Static catalog attributes are not copied to listing documents. Listings contain
`templateId` plus immutable dynamic sale data: condition, mileage, fuel,
upgrades, custom name, city and optional visual customization.

## Callable contracts

- `createVehicleListing`
- `cancelVehicleListing`
- `purchaseVehicleListing`
- `getVehicleMarketplaceListings`
- `getMyVehicleListings`
- `prepareVehicleMarketplaceAccountDeletion`

Mutation payloads include `transactionId` and `idempotencyKey`. Purchase and
cancel additionally require the observed listing version. Purchase requires the
quoted price. The backend uses Firebase Auth UID; seller/buyer UID values from
the payload are never trusted.

## Pricing and fees

The backend and client share the pure resale core in
`src/domain/truckResaleValuation.ts`. Backend catalog/balance inputs are
generated during `backend:build`.

Idempotency and action receipt documents carry a 30-day `expiresAt` field.
Production Firestore TTL must be enabled for that field on both collections.
If TTL is not yet enabled, the hourly `expireVehicleMarketplace` worker deletes
at most 250 expired documents from each collection per invocation.

Firestore TTL console setup:

1. Open Google Cloud Console → Firestore → Time-to-live.
2. Add policy for collection group `vehicleMarketplaceIdempotency`, field
   `expiresAt`.
3. Add policy for collection group `vehicleMarketplaceActionReceipts`, field
   `expiresAt`.
4. Wait until both policies report `Active`.
5. Keep the scheduled cleanup fallback enabled even after TTL activation.

- Listing fee: $150, charged once.
- Sale fee: 6% of gross price.
- Duration: 72 hours.
- Minimum asking price: 70% of recommended value.
- Maximum asking price: 135% of recommended value.

## Deployment checklist

1. Run the trusted marketplace-state migration for existing users.
2. Keep marketplace entry points disabled until migration counts reconcile.
3. Run `npm run firebase:emulators:test`.
4. Deploy indexes: `firebase deploy --only firestore:indexes`.
5. Deploy rules: `firebase deploy --only firestore:rules`.
6. Deploy functions: `firebase deploy --only functions`.
7. Verify a create/cancel/purchase canary account and ledger/cash equality.

Migration commands:

- `npm run marketplace:migrate:dry`
- `npm run marketplace:migrate`

Account deletion calls the trusted cleanup callable first. Active listings are
cancelled, listing display names are anonymized, private marketplace state is
removed, and global transaction audit records remain.
