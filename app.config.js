/**
 * Expo app config — .env içindeki EXPO_PUBLIC_* değerlerini
 * Constants.expoConfig.extra üzerinden runtime'a taşır.
 *
 * EXPO_PUBLIC_* varsa onu kullanır; yoksa src/config/firebase.public.json
 * (client-side public Firebase web/iOS config) Xcode archive için fallback'tir.
 *
 * TODO (native Google Sign-In / Apple):
 * - iOS: reversed client id URL scheme (GoogleService / OAuth iOS client)
 * - Android: SHA-1 / SHA-256 fingerprint (Firebase Console)
 * - google-services.json / GoogleService-Info.plist
 * - Expo Go'da native Google Sign-In çalışmayabilir → development build
 */

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
    },
    ios: {
      ...(expo.ios ?? {}),
      bundleIdentifier: 'com.ethemsincar.logisticore',
      googleServicesFile: './GoogleService-Info.plist',
      // Apple Sign-In entitlement (expo-apple-authentication)
      usesAppleSignIn: true,
    },
    plugins: [
      ...existingPlugins,
      'expo-asset',
      'expo-font',
      'expo-build-properties',
      './plugins/withGoogleSignInModularHeaders.js',
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
      // TODO(production-iOS): ATT + UMP consent akışı release öncesi eklenmeli.
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: 'ca-app-pub-8214453687597896~5560651696',
          iosAppId: 'ca-app-pub-8214453687597896~4247570027',
          userTrackingUsageDescription:
            'Bu tanımlayıcı size daha uygun reklamlar sunmak için kullanılır.',
        },
      ],
    ],
    extra: {
      ...(expo.extra ?? {}),
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
      },
      firebaseFunctionsRegion: 'us-central1',
    },
  };
};
