/**
 * Expo app config — .env içindeki EXPO_PUBLIC_* değerlerini
 * Constants.expoConfig.extra üzerinden runtime'a taşır.
 *
 * Gerçek secret/value hardcode edilmez; sadece process.env okunur.
 * Expo CLI app.config değerlendirmesinden önce .env yükler.
 *
 * TODO (native Google Sign-In / Apple):
 * - iOS: reversed client id URL scheme (GoogleService / OAuth iOS client)
 * - Android: SHA-1 / SHA-256 fingerprint (Firebase Console)
 * - google-services.json / GoogleService-Info.plist
 * - Expo Go'da native Google Sign-In çalışmayabilir → development build
 */

const appJson = require('./app.json');

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
        apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
        storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
      },
      google: {
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
      },
      ads: {
        mode: process.env.EXPO_PUBLIC_ADS_MODE ?? '',
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
