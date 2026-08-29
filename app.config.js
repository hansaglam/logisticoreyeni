/**
 * Expo app config — build profile env + EXPO_PUBLIC_* runtime extra.
 *
 * Profile selection (explicit, no fragile overwrite chain):
 *   LOGISTICORE_BUILD_PROFILE=internal|production
 *   Reads `.env` (shared secrets) then `.env.internal` or `.env.production` overrides.
 * EXPO_PUBLIC_* varsa onu kullanır; yoksa src/config/firebase.public.json
 * (client-side public Firebase web/iOS config) Xcode archive için fallback'tir.
 *
 * Store release: LOGISTICORE_BUILD_PROFILE=production npm run validate:store-production
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const appJson = require('./app.json');
const publicFirebase = require('./src/config/firebase.public.json');

function readFirebaseExtraValue(envKey, publicKey) {
  const fromEnv =
    typeof process.env[envKey] === 'string' ? process.env[envKey].trim() : '';
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  const fromPublic = publicFirebase?.[publicKey];
  return typeof fromPublic === 'string' ? fromPublic : '';
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function applyEnvVars(vars, { override = false } = {}) {
  for (const [key, value] of Object.entries(vars)) {
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const root = __dirname;
applyEnvVars(parseEnvFile(path.join(root, '.env')));
const buildProfile = process.env.LOGISTICORE_BUILD_PROFILE?.trim().toLowerCase() || 'internal';
applyEnvVars(parseEnvFile(path.join(root, `.env.${buildProfile}`)), { override: true });
process.env.LOGISTICORE_BUILD_PROFILE = buildProfile;

function readGitCommit() {
  const fromEnv =
    typeof process.env.EXPO_PUBLIC_GIT_COMMIT === 'string'
      ? process.env.EXPO_PUBLIC_GIT_COMMIT.trim()
      : '';
  if (fromEnv.length > 0) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

module.exports = () => {
  const expo = appJson.expo ?? {};
  const existingPlugins = Array.isArray(expo.plugins) ? expo.plugins : [];

  return {
    ...expo,
    androidNavigationBar: {
      visible: 'immersive',
      barStyle: 'light-content',
      backgroundColor: '#020712',
      ...(expo.androidNavigationBar ?? {}),
    },
    android: {
      ...(expo.android ?? {}),
      package: 'com.ethemsincar.logisticore',
      googleServicesFile: './google-services.json',
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.MANAGE_EXTERNAL_STORAGE',
      ],
    },
    ios: {
      ...(expo.ios ?? {}),
      bundleIdentifier: 'com.ethemsincar.logisticore',
      googleServicesFile: './GoogleService-Info.plist',
      usesAppleSignIn: true,
      supportsTablet: false,
      infoPlist: {
        ...(expo.ios?.infoPlist ?? {}),
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
        },
      },
    },
    plugins: [
      ...existingPlugins,
      'expo-asset',
      'expo-font',
      'expo-build-properties',
      './plugins/withGoogleSignInModularHeaders.js',
      './plugins/withIosModularHeaders',
      [
        'expo-navigation-bar',
        {
          visibility: 'hidden',
          behavior: 'overlay-swipe',
          position: 'absolute',
          backgroundColor: '#020712',
        },
      ],
      'expo-apple-authentication',
      // Native Google Sign-In — Expo Go'da çalışmayabilir; development build gerekir.
      // iosUrlScheme: GoogleService-Info.plist REVERSED_CLIENT_ID değeri.
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: 'com.googleusercontent.apps.363783837598-tvbeuhmirctkrpdam51lsqm5uj8nac3l',
        },
      ],
      // AdMob — Expo Go desteklemez; development build / EAS gerekir.
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: 'ca-app-pub-8214453687597896~5560651696',
          iosAppId: 'ca-app-pub-8214453687597896~4247570027',
        },
      ],
    ],
      extra: {
      ...(expo.extra ?? {}),
      buildProfile,
      buildFingerprint: {
        gitCommit: readGitCommit(),
        buildTimestamp: new Date().toISOString(),
        buildProfile,
        appVersion: expo.version ?? null,
        versionCode: expo.android?.versionCode ?? null,
        runtimeVersion: null,
        updateChannel: null,
        expoUpdatesEnabled: false,
        mapMarkerRevision: 'chevron-circle-v2',
      },
      firebase: {
        apiKey: readFirebaseExtraValue('EXPO_PUBLIC_FIREBASE_API_KEY', 'apiKey'),
        authDomain: readFirebaseExtraValue('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'authDomain'),
        projectId: readFirebaseExtraValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'projectId'),
        storageBucket: readFirebaseExtraValue(
          'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
          'storageBucket',
        ),
        messagingSenderId: readFirebaseExtraValue(
          'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
          'messagingSenderId',
        ),
        appId: readFirebaseExtraValue('EXPO_PUBLIC_FIREBASE_APP_ID', 'appId'),
      },
      google: {
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
      },
      ads: {
        mode: process.env.EXPO_PUBLIC_ADS_MODE ?? '',
        enabled: process.env.EXPO_PUBLIC_ADS_ENABLED ?? '',
        useTestIds: process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS ?? '',
      },
      features: {
        vehicleMarketplaceEnabled:
          process.env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED ?? '',
        leaderboardEnabled: process.env.EXPO_PUBLIC_LEADERBOARD_ENABLED ?? '',
        marketAlarmsEnabled: process.env.EXPO_PUBLIC_MARKET_ALARMS_ENABLED ?? '',
        backendDiagnosticsEnabled:
          process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED ?? '',
        enableTestMoneySync: process.env.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC ?? '',
      },
      firebaseFunctionsRegion: 'us-central1',
    },
  };
};
