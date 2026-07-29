# LogistiCore

Mobil lojistik yönetim oyunu. Uygulama Expo/React Native, online dünya
piyasası Firebase Cloud Functions ve Firestore kullanır.

## Global ekonomi backend

Canonical piyasa production client tarafından üretilmez. Scheduled worker:

- `backend/src/index.ts` — 30 dakikalık schedule
- `backend/src/globalEconomyWorker.ts` — Firestore transaction/idempotency
- `backend/src/globalEconomyGenerator.ts` — saf canonical snapshot üretimi
- `backend/scripts/syncCanonicalInputs.ts` — client katalog/config sözleşmesini build öncesi senkronlar

### Yerel doğrulama

```bash
npm install
npm --prefix backend install
npm run firebase:emulators:test
npm run typecheck
npm --prefix backend run typecheck
npx expo export --platform android
```

Emulator testi worker concurrency/retry/rollback, rules erişimleri, history
sorgusu, config mismatch ve stale-cache davranışını kapsar.

### Deployment

Önce [production checklist](docs/production-global-economy-checklist.md)
tamamlanmalıdır.

```bash
firebase use logisticore-53ab4
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

Gerçek deploy işlemi proje owner/deployer yetkisi, Blaze planı ve gerekli
Google Cloud API'lerinin etkin olmasını gerektirir.
