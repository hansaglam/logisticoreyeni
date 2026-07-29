# Production Global Economy Checklist

## Ön koşullar

- [ ] Firebase CLI doğru Google hesabıyla oturum açmış.
- [ ] Aktif proje `logisticore-53ab4` olarak doğrulanmış.
- [ ] Functions için Blaze billing planı etkin.
- [ ] Cloud Functions, Cloud Scheduler, Eventarc ve Artifact Registry API'leri etkin.
- [ ] Functions runtime Node.js 20.
- [ ] `ECONOMY_CONFIG_VERSION=1`; client desteklenen sürüm ile aynı.
- [ ] Production ve emulator service-account anahtarı repository'ye eklenmemiş.

## Zorunlu doğrulamalar

- [ ] `npm run firebase:emulators:test`
- [ ] `npm run typecheck`
- [ ] `npm --prefix backend run typecheck`
- [ ] `npx expo export --platform android`
- [ ] Aynı epoch concurrent worker testi tek snapshot oluşturuyor.
- [ ] Partial failure snapshot/history/current dokümanı bırakmıyor.
- [ ] Normal authenticated client global market dokümanlarına yazamıyor.
- [ ] Unauthenticated global market okuması reddediliyor.
- [ ] Owner cloud save ve alarm erişimi korunuyor.

## Deployment sırası

```bash
firebase use logisticore-53ab4
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

## Deployment sonrası

- [ ] `generateGlobalEconomy` schedule'ı `0,30 * * * *` / UTC görünüyor.
- [ ] `globalEconomy/current` içinde `epoch`, `configVersion`,
      `snapshotVersion`, `serverTimeMs` ve `snapshot` var.
- [ ] `globalEconomySnapshots/{epoch_configVersion}` yalnız bir doküman.
- [ ] İlgili epoch için beklenen city/product history kayıtları var.
- [ ] Cloud Logging'de `[global-economy-worker]` structured log görülüyor.
- [ ] 30 günden eski ayrıntılı history retention ile temizleniyor.
- [ ] Authenticated production cihazında piyasa okunuyor.
- [ ] Snapshot geçici olarak yoksa client local canonical veri yazmıyor ve
      fiyat-kritik işlemleri engelliyor.

## Rollback

Functions sürümünü rollback etmek snapshot/history belgelerini geriye dönük
yeniden üretmez. Formül değişecekse önce client desteği yayınlanır, sonra
`ECONOMY_CONFIG_VERSION` artırılarak worker deploy edilir. Eski history
değiştirilmez.
