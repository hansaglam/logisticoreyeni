// expo-navigation-bar native module requires a development build.
// Run: npx expo install expo-navigation-bar
// Then: npx expo run:android

import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState, Platform } from 'react-native';

const NAV_BAR_COLOR = '#020712';

type NavigationBarModule = {
  setBehaviorAsync?: (behavior: string) => Promise<void>;
  setBackgroundColorAsync?: (color: string) => Promise<void>;
  setVisibilityAsync?: (visibility: string) => Promise<void>;
  setHidden?: (hidden: boolean) => Promise<void>;
};

type EdgeToEdgeModule = {
  isEdgeToEdge?: () => boolean;
};

let NavigationBar: NavigationBarModule | null = null;
let missingModuleWarned = false;
let edgeToEdgeChecked = false;
let edgeToEdgeEnabled = false;

function warnMissingModule(): void {
  if (missingModuleWarned) return;
  missingModuleWarned = true;
  console.warn(
    '[system-bars] ExpoNavigationBar native module missing — run: npx expo run:android',
  );
}

function isAndroidEdgeToEdgeEnabled(): boolean {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (edgeToEdgeChecked) {
    return edgeToEdgeEnabled;
  }

  edgeToEdgeChecked = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const edgeModule = require('react-native-is-edge-to-edge') as EdgeToEdgeModule;
    edgeToEdgeEnabled = edgeModule.isEdgeToEdge?.() === true;
  } catch {
    // Project gradle.properties enables edge-to-edge; Android 15+ defaults to edge-to-edge.
    edgeToEdgeEnabled = Number(Platform.Version) >= 35;
  }

  return edgeToEdgeEnabled;
}

function getNavigationBarModule(): NavigationBarModule | null {
  if (Platform.OS !== 'android') return null;
  if (NavigationBar) return NavigationBar;

  // Native modül yokken require('expo-navigation-bar') LogBox ERROR üretir.
  // Önce optional native check — Expo Go / eski build için güvenli fallback.
  const native = requireOptionalNativeModule('ExpoNavigationBar');
  if (!native) {
    warnMissingModule();
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NavigationBar = require('expo-navigation-bar') as NavigationBarModule;
    return NavigationBar;
  } catch {
    warnMissingModule();
    return null;
  }
}

export async function enableImmersiveGameMode(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (__DEV__ && process.env.EXPO_PUBLIC_SHOW_ANDROID_NAV === '1') return;

  const navBar = getNavigationBarModule();
  if (!navBar) {
    return;
  }

  try {
    const edgeToEdge = isAndroidEdgeToEdgeEnabled();

    // Edge-to-edge aktifken behavior/background API'leri desteklenmiyor; plugin config yeterli.
    if (!edgeToEdge && typeof navBar.setBehaviorAsync === 'function') {
      await navBar.setBehaviorAsync('overlay-swipe');
    }

    if (!edgeToEdge && typeof navBar.setBackgroundColorAsync === 'function') {
      await navBar.setBackgroundColorAsync(NAV_BAR_COLOR);
    }

    if (typeof navBar.setVisibilityAsync === 'function') {
      await navBar.setVisibilityAsync('hidden');
    }

    if (typeof navBar.setHidden === 'function') {
      await navBar.setHidden(true);
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[system-bars] failed to enable immersive mode', error);
    }
  }
}

export function subscribeImmersiveModeRefresh(): () => void {
  if (Platform.OS !== 'android') return () => {};

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      setTimeout(() => {
        void enableImmersiveGameMode();
      }, 250);
    }
  });

  return () => subscription.remove();
}
