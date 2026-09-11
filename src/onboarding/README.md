# Onboarding

Eski **spotlight / AppTutorial / MarketTutorial** sistemleri tamamen kaldırıldı
(`src/tutorial/`, `src/components/tutorial/`, ilgili hook ve store dosyaları silindi).

## Neden?

- Tab bar ve ekran düzeni güncellemelerinden sonra spotlight hedefleri ve overlay akışı bozuldu.
- Karartma, fallback target uyarıları ve ölçüm hataları oyun deneyimini olumsuz etkiliyordu.

## Şu an aktif olan

- **Contextual Guide** (`src/contextualGuide/`) — ekran içi, bloklamayan kartlar.
- **Yardım & Rehber** (`HelpGuideScreen` + `HelpGuideButton`) — manuel içerik ve Getting Started tekrarı.
- **Başlangıç Görevleri** (`MissionsScreen`, Dashboard'daki "Sıradaki Hamle" kartı) — görev tabanlı ilerleme korunuyor.
- Sözleşme, teslimat, piyasa ve filo oyun mantığı değişmedi.

## Eski kayıtlar

Eski save dosyalarındaki `spotlightTutorial`, `marketTutorialCompleted`,
`marketTutorialVersion` ve `tutorialProgress` alanları artık yazılmıyor. Yüklemede yalnızca
`hasLegacyTutorialActivityFromRawSave` (bkz. `src/contextualGuide/legacyTutorialSaveSignals.ts`)
tarafından "bu oyuncu eski rehberi görmüş mü?" sinyali için okunur, sonra atılır.
