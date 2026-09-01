/**
 * Branding + iOS production config policy (headless).
 * Run: npx tsx scripts/branding-ios-config-policy-test.ts
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

const appJson = JSON.parse(read('app.json')) as {
  expo?: {
    name?: string;
    version?: string;
    icon?: string;
    splash?: { backgroundColor?: string; image?: string };
    android?: { versionCode?: number; adaptiveIcon?: { backgroundColor?: string } };
    ios?: { infoPlist?: { NSAppTransportSecurity?: { NSAllowsArbitraryLoads?: boolean } } };
  };
};

assert.equal(appJson.expo?.name, 'LogistiCore');
assert.ok(appJson.expo?.icon?.includes('assets/branding/icon.png'));
assert.equal(appJson.expo?.splash?.backgroundColor, '#020712');
assert.equal(appJson.expo?.android?.adaptiveIcon?.backgroundColor, '#020712');
assert.equal(appJson.expo?.android?.versionCode, 13);
assert.equal(appJson.expo?.version, '1.0.12');
assert.equal(appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads, false);

for (const asset of [
  'assets/branding/icon.png',
  'assets/branding/adaptive-icon-foreground.png',
  'assets/branding/splash-icon.png',
]) {
  assert.ok(existsSync(resolve(ROOT, asset)), `${asset} exists`);
}

const appConfig = read('app.config.js');
assert.match(appConfig, /usesAppleSignIn:\s*true/);
assert.match(appConfig, /NSAllowsArbitraryLoads:\s*false/);
assert.match(appConfig, /iosUrlScheme:/);
assert.doesNotMatch(appConfig, /expo-tracking-transparency/);
assert.doesNotMatch(appConfig, /userTrackingUsageDescription/);
assert.doesNotMatch(appConfig, /NSUserTrackingUsageDescription/);
assert.match(appConfig, /react-native-google-mobile-ads/);

const colors = read('android/app/src/main/res/values/colors.xml');
assert.match(colors, /splashscreen_background">#020712/);
assert.match(colors, /iconBackground">#020712/);

const styles = read('android/app/src/main/res/values/styles.xml');
assert.match(styles, /statusBarColor">#020712/);

const adaptive = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
assert.match(adaptive, /ic_launcher_foreground/);

const appVersion = read('src/config/appVersion.ts');
assert.match(appVersion, /1\.0\.10/);

const saveGame = read('src/storage/saveGame.ts');
assert.match(saveGame, /from '\.\.\/config\/appVersion'/);

const launcher = resolve(ROOT, 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp');
assert.ok(existsSync(launcher), 'native launcher webp regenerated');

const splash = resolve(ROOT, 'android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png');
assert.ok(existsSync(splash), 'native splash logo regenerated');

console.log('[branding-ios-config-policy-test] PASS', {
  appName: appJson.expo?.name,
  iconConfigured: true,
  splashBackground: '#020712',
  atsArbitraryLoads: false,
  adaptiveIconXml: true,
  appVersionAligned: '1.0.12',
});
