# Firestore Security Rules — LogistiCore

Deploy edilebilir source of truth artık root seviyesindeki
[`firestore.rules`](firestore.rules) dosyasıdır. Index tanımları
[`firestore.indexes.json`](firestore.indexes.json) içindedir.

Politika:

- `globalEconomy/current`, `globalEconomySnapshots` ve
  `globalMarketHistory` authenticated kullanıcılar tarafından okunabilir.
- Bu global koleksiyonlara normal client yazamaz. Admin SDK kullanan trusted
  worker Firestore Rules katmanını bypass ederek yazar.
- `users/{uid}`, cloud save, meta ve market alarmı yalnız owner tarafından
  okunup yazılabilir.
- Leaderboard authenticated okunur; yalnız bağlı, anonymous olmayan hesap
  kendi entry'sini doğrulanan alan sınırlarıyla yazabilir.
- Tanımsız bütün yollar default-deny'dır.

Emulator doğrulaması:

```bash
npm run firebase:emulators:test
```

Deployment:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```
