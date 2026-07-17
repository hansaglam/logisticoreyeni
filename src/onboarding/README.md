# Onboarding (planlanıyor)

Eski **spotlight tutorial** sistemi devre dışı bırakıldı (`ENABLE_SPOTLIGHT_TUTORIAL = false`).

## Neden?

- Tab bar ve ekran düzeni güncellemelerinden sonra spotlight hedefleri ve overlay akışı bozuldu.
- Karartma, fallback target uyarıları ve ölçüm hataları oyun deneyimini olumsuz etkiliyordu.

## Şu an aktif olan

- **Başlangıç Görevleri** (`MissionsScreen`, Dashboard'daki "Sıradaki Hamle" kartı) — görev tabanlı ilerleme korunuyor.
- Sözleşme, teslimat, piyasa ve filo oyun mantığı değişmedi.

## Sonraki adım

Yeni onboarding **görev tabanlı** olacak:

1. İlk işini başlat
2. İlk teslimat
3. Piyasayı keşfet
4. İlk ticaret
5. Kâra geç

Spotlight overlay yerine Görevler ekranı + dashboard kartları + hafif ipuçları düşünülüyor.

## Tekrar açmak (geliştirme)

`src/tutorial/featureFlags.ts` içinde:

```ts
export const ENABLE_SPOTLIGHT_TUTORIAL = true;
```

Ardından hedef ID’lerini güncel tab bar ve ekran yapısına göre güncelle.
