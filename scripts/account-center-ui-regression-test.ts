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
const connectionTabSource = readFileSync('src/components/accountCenter/AccountConnectionTab.tsx', 'utf8');
const prefsTabSource = readFileSync('src/components/accountCenter/AccountPreferencesTab.tsx', 'utf8');
const accountCenterDir = [
  'src/components/accountCenter/AccountProfileTab.tsx',
  'src/components/accountCenter/AccountConnectionTab.tsx',
  'src/components/accountCenter/AccountPreferencesTab.tsx',
  'src/components/accountCenter/AccountSegmentedTabs.tsx',
  'src/components/accountCenter/ProfileHeroCard.tsx',
  'src/components/accountCenter/DangerZoneCard.tsx',
  'src/components/accountCenter/AccountMetric.tsx',
  'src/components/accountCenter/constants.ts',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const screenBundle = `${screen}\n${accountCenterDir}`;
const hook = readFileSync('src/hooks/useAccountCenter.ts', 'utf8');
const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
const accountSection = readFileSync('src/components/AccountSection.tsx', 'utf8');
const prefs = readFileSync('src/services/appPreferences.ts', 'utf8');
const cloudStatusUtil = readFileSync('src/utils/accountCenterCloudStatus.ts', 'utf8');

console.log('\n=== Account Center UI Regression ===\n');

console.log('Screen structure');
{
  assert(screenBundle.includes('Hesap Merkezi'), 'header title');
  assert(screenBundle.includes('Profil, hesap ve uygulama tercihleri'), 'header subtitle');
  assert(screenBundle.includes("{ key: 'profile', label: 'Profil' }"), 'profile tab');
  assert(screenBundle.includes("{ key: 'account', label: 'Hesap' }"), 'account tab');
  assert(screenBundle.includes("{ key: 'preferences', label: 'Tercihler' }"), 'preferences tab');
  const profileIdx = screenBundle.indexOf("label: 'Profil'");
  const accountIdx = screenBundle.indexOf("label: 'Hesap'");
  const prefIdx = screenBundle.indexOf("label: 'Tercihler'");
  assert(profileIdx < accountIdx && accountIdx < prefIdx, 'tab order profile → account → preferences');
  assert(screenBundle.includes('accessibilityRole="tablist"'), 'tablist accessibility');
  assert(screenBundle.includes('accessibilityRole="tab"'), 'tab accessibility');
  assert(screen.includes('scrollBottomPadding'), 'tab bar bottom padding');
  assert(screen.includes('useAccountPrivacyOptions'), 'privacy options wired');
}

console.log('\nProfile tab');
{
  assert(screenBundle.includes('Oyuncu Kimliği'), 'player identity card');
  assert(screenBundle.includes('Şirket Özeti'), 'company summary card');
  assert(screenBundle.includes('Liderlik Tablosu'), 'leaderboard row');
  assert(screenBundle.includes('providerBadge'), 'provider badge usage');
  assert(screenBundle.includes('AccountMetric'), 'compact metric grid');
  assert(screenBundle.includes('statRow'), 'inline hero stats');
  assert(screenBundle.includes('Katılmak için kullanıcı adını oluştur'), 'leaderboard no-username state');
  assert(
    screenBundle.includes('Liderlik servisine şu anda ulaşılamıyor'),
    'leaderboard unavailable state',
  );
}

console.log('\nAccount tab');
{
  assert(screenBundle.includes('Bağlı Hesap'), 'linked account card');
  assert(screenBundle.includes('Bulut Koruması'), 'cloud protection card');
  assert(screenBundle.includes('Hesap Yönetimi'), 'account management card');
  assert(screenBundle.includes('İlerlemen güvende'), 'verified cloud secure message');
  assert(
    cloudStatusUtil.includes('Şimdi Senkronize Et'),
    'canonical sync action label in cloud util',
  );
  assert(screenBundle.includes('Senkronize Et'), 'compact sync CTA label');
  assert(screenBundle.includes('Hesap Değiştir'), 'account switch action');
  assert(screenBundle.includes('Hesap geçişi sürüyor'), 'switch in-progress state');
  assert(screenBundle.includes('Kurtarma gerekli'), 'recovery required state');
  assert(screenBundle.includes('Çıkış Yap'), 'logout in account tab');
}

console.log('\nPreferences tab');
{
  assert(screenBundle.includes('Bildirimler'), 'notification toggle');
  assert(screenBundle.includes('Titreşim'), 'vibration toggle');
  assert(screenBundle.includes('Ses'), 'sound toggle');
  assert(screenBundle.includes('Gelir özeti'), 'income summary toggle');
  assert(screenBundle.includes('Gizlilik Politikası'), 'privacy policy link');
  assert(screenBundle.includes('Gizlilik ve Çerez Ayarları'), 'privacy choices action');
  assert(connectionTabSource.includes('Hesap ve Gizlilik'), 'account privacy section on account tab');
  assert(connectionTabSource.includes('Hesabı Sil'), 'delete account on account tab');
  assert(connectionTabSource.includes('Misafir Kaydını Sil'), 'guest delete label on account tab');
  assert(!prefsTabSource.includes('DangerZoneCard'), 'delete removed from hidden preferences danger zone');
}

console.log('\nLegal links');
{
  assert(LEGAL_LINKS.privacyPolicy.includes('privacy-policy'), 'privacy policy URL');
  assert(LEGAL_LINKS.privacyChoices.includes('privacy-choices'), 'privacy choices URL');
  assert(LEGAL_LINKS.accountDeletion.includes('account-deletion'), 'account deletion URL');
  assert(LEGAL_LINKS.support.includes('support'), 'support URL');
  assert(screenBundle.includes('openLegalLink') || screen.includes('openLegalLink'), 'safe link opener used');
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
  assert(screenBundle.includes('onBack'), 'back navigation support');
  assert(screenBundle.includes('Switch'), 'native preference switches');
  assert(screenBundle.includes('accessibilityLabel'), 'accessibility labels present');
  assert(screenBundle.includes('minHeight: 44') || screenBundle.includes('minHeight: 48') || screenBundle.includes('minHeight: 56') || screenBundle.includes('minHeight: 64'), 'touch targets');
  assert(screenBundle.includes('ACCOUNT_SECTION_GAP'), 'canonical section spacing');
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
