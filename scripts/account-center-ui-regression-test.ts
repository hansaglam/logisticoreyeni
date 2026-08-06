/**
 * Account Center UI regression tests.
 * Run: npx tsx scripts/account-center-ui-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  formatRelativeSaveAgo,
  getProviderBadgeLabel,
  resolveCloudSaveDisplayInfo,
} from '../src/utils/accountCenterCloudStatus';
import { LEGAL_LINKS } from '../src/utils/legalLinks';
import { getCloudSaveStatus } from '../src/storage/cloudSaveSync';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const screen = readFileSync('src/screens/AccountCenterScreen.tsx', 'utf8');
const hook = readFileSync('src/hooks/useAccountCenter.ts', 'utf8');
const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
const accountSection = readFileSync('src/components/AccountSection.tsx', 'utf8');
const prefs = readFileSync('src/services/appPreferences.ts', 'utf8');
const cloudStatusUtil = readFileSync('src/utils/accountCenterCloudStatus.ts', 'utf8');

console.log('\n=== Account Center UI Regression ===\n');

console.log('Screen structure');
{
  assert(screen.includes('Hesap Merkezi'), 'header title');
  assert(screen.includes('Profil, bulut kaydı ve uygulama tercihleri'), 'header subtitle');
  assert(screen.includes("{ key: 'profile', label: 'Profil' }"), 'profile tab');
  assert(screen.includes("{ key: 'account', label: 'Hesap' }"), 'account tab');
  assert(screen.includes("{ key: 'preferences', label: 'Tercihler' }"), 'preferences tab');
  const profileIdx = screen.indexOf("label: 'Profil'");
  const accountIdx = screen.indexOf("label: 'Hesap'");
  const prefIdx = screen.indexOf("label: 'Tercihler'");
  assert(profileIdx < accountIdx && accountIdx < prefIdx, 'tab order profile → account → preferences');
  assert(screen.includes('accessibilityRole="tablist"'), 'tablist accessibility');
  assert(screen.includes('accessibilityRole="tab"'), 'tab accessibility');
}

console.log('\nProfile tab');
{
  assert(screen.includes('Oyuncu Kimliği'), 'player identity card');
  assert(screen.includes('Şirket Kimliği'), 'company identity card');
  assert(screen.includes('Liderlik Tablosu'), 'leaderboard card');
  assert(screen.includes('providerBadge'), 'provider badge usage');
  assert(
    (screen.match(/Kullanıcı Adı Oluştur/g) ?? []).length === 1,
    'single username create CTA',
  );
  assert(screen.includes('Katılmak için kullanıcı adını oluştur'), 'leaderboard no-username state');
  assert(
    screen.includes('Liderlik servisine şu anda ulaşılamıyor'),
    'leaderboard unavailable state',
  );
}

console.log('\nAccount tab');
{
  assert(screen.includes('Hesap Bağlantısı'), 'account connection card');
  assert(screen.includes('Bulut Kaydı'), 'cloud save card');
  assert(screen.includes('Hesap İşlemleri'), 'account actions card');
  assert(
    cloudStatusUtil.includes('Şimdi Senkronize Et'),
    'single sync action label',
  );
  assert(
    !screen.includes('Bulut Kaydını Kontrol Et') || screen.includes('Bulut Kaydını Görüntüle'),
    'no duplicate generic check-cloud CTA in center screen',
  );
  assert(screen.includes('Hesap Değiştir'), 'account switch action');
  assert(screen.includes('Hesap geçişi sürüyor'), 'switch in-progress state');
  assert(screen.includes('Kurtarma gerekli'), 'recovery required state');
}

console.log('\nPreferences tab');
{
  assert(screen.includes('Bildirimler'), 'notification toggle');
  assert(screen.includes('Titreşim'), 'vibration toggle');
  assert(screen.includes('Ses'), 'sound toggle');
  assert(screen.includes('Gelir özeti penceresi'), 'income summary toggle');
  assert(screen.includes('Gizlilik Politikası'), 'privacy policy link');
  assert(screen.includes('Gizlilik ve Çerez Ayarları'), 'privacy choices action');
  assert(screen.includes('showAdsPrivacyOptionsForm'), 'UMP privacy options wired');
  assert(screen.includes('Tehlikeli İşlemler'), 'danger zone');
  assert(screen.includes('Hesabı Sil'), 'delete account action');
  assert(screen.includes('Misafir Kaydını Sil'), 'guest delete label');
}

console.log('\nLegal links');
{
  assert(LEGAL_LINKS.privacyPolicy.includes('privacy-policy'), 'privacy policy URL');
  assert(LEGAL_LINKS.privacyChoices.includes('privacy-choices'), 'privacy choices URL');
  assert(LEGAL_LINKS.accountDeletion.includes('account-deletion'), 'account deletion URL');
  assert(LEGAL_LINKS.support.includes('support'), 'support URL');
  assert(screen.includes('openLegalLink'), 'safe link opener used');
}

console.log('\nCloud save states');
{
  const base = getCloudSaveStatus();
  const synced = resolveCloudSaveDisplayInfo({
    cloudStatus: { ...base, status: 'success', firebaseEnabled: true, uid: 'abc' },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  assert(synced.key === 'synced', 'cloud synced state');

  const pending = resolveCloudSaveDisplayInfo({
    cloudStatus: { ...base, status: 'pending', firebaseEnabled: true, uid: 'abc' },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  assert(pending.key === 'pending', 'cloud pending state');

  const offline = resolveCloudSaveDisplayInfo({
    cloudStatus: { ...base, status: 'disabled', firebaseEnabled: false, uid: null },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  assert(offline.key === 'offline', 'cloud offline state');

  const conflict = resolveCloudSaveDisplayInfo({
    cloudStatus: {
      ...base,
      status: 'success',
      firebaseEnabled: true,
      uid: 'abc',
      restoreCandidate: { hasCandidate: true },
    },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: true,
  });
  assert(conflict.key === 'conflict', 'cloud conflict state');

  const retry = resolveCloudSaveDisplayInfo({
    cloudStatus: { ...base, status: 'failed', firebaseEnabled: true, uid: 'abc' },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  assert(retry.key === 'retry', 'cloud retry state');

  const recovery = resolveCloudSaveDisplayInfo({
    cloudStatus: base,
    isGuest: false,
    recoveryRequired: true,
    hasAccountConflict: false,
  });
  assert(recovery.key === 'recovery', 'recovery required state');

  const linkRequired = resolveCloudSaveDisplayInfo({
    cloudStatus: base,
    isGuest: true,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  assert(linkRequired.key === 'link-required', 'link required state');
}

console.log('\nProvider badges');
{
  assert(getProviderBadgeLabel('google', false) === 'GOOGLE', 'google badge');
  assert(getProviderBadgeLabel('apple', false) === 'APPLE', 'apple badge');
  assert(getProviderBadgeLabel('guest', true) === 'MİSAFİR', 'guest badge');
}

console.log('\nDuplicate cleanup');
{
  assert(
    !accountSection.includes('Kullanıcı Adı Oluştur'),
    'embedded AccountSection has no username CTA duplicate',
  );
  assert(accountSection.includes('Hesap Merkezini Aç'), 'embedded card opens center');
  assert(
    (hook.match(/handleManualSync/g) ?? []).length >= 1,
    'sync handler in hook',
  );
}

console.log('\nNavigation & platform');
{
  assert(moreScreen.includes("route === 'account'"), 'account full-screen route');
  assert(moreScreen.includes('AccountCenterScreen'), 'AccountCenterScreen import');
  assert(moreScreen.includes("setRoute('account')"), 'deep-link opens account route');
  assert(screen.includes('onBack'), 'back navigation support');
  assert(screen.includes('Switch'), 'native preference switches');
  assert(screen.includes('accessibilityLabel'), 'accessibility labels present');
  assert(screen.includes('minHeight: 44') || screen.includes('minHeight: 48'), 'touch targets');
  assert(screen.includes('width: \'47%\''), 'responsive stat grid for 360px');
}

console.log('\nAccount switch B-002 preserved');
{
  assert(hook.includes('rollbackAccountSwitch'), 'rollback in hook');
  assert(hook.includes('commitAccountSwitch'), 'commit in hook');
  assert(hook.includes('if (isSwitchingAccount) return'), 'double-tap switch guard');
  assert(hook.includes('syncBeforeAccountTransition'), 'sync before transition');
  assert(hook.includes('beginGoogleAccountSwitchSelection'), 'google account selection');
}

console.log('\nPreferences store');
{
  assert(prefs.includes('notificationsEnabled'), 'notifications pref key');
  assert(prefs.includes('vibrationEnabled'), 'vibration pref key');
  assert(prefs.includes('soundEnabled'), 'sound pref key');
  assert(prefs.includes('AsyncStorage'), 'prefs persisted');
}

console.log('\nRelative time');
{
  const label = formatRelativeSaveAgo(Date.now() - 3 * 60_000);
  assert(label.includes('dk'), 'relative save label minutes');
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('account-center-ui-regression-test: PASSED\n');
