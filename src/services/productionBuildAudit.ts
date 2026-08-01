/**
 * Production / internal release bootstrap audit — secret değerleri loglamaz.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  VEHICLE_MARKETPLACE_ENABLED,
  VEHICLE_MARKETPLACE_FEATURE_SOURCE,
} from '../config/backendRoadmap';
import {
  resolveCurrentUserKind,
  setBackendDiagnosticsMeta,
} from './backendDiagnostics';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAuthSafe,
  getFirestoreSafe,
  hasFirebaseConfig,
  readFirebaseConfigForAudit,
} from './firebase';
import { isGoogleSignInConfigured } from './googleAuthService';

let logged = false;

export function logProductionBuildConfigOnce(): void {
  if (logged) return;
  logged = true;

  const config = readFirebaseConfigForAudit();
  const auth = getFirebaseAuthSafe();
  const firestore = getFirestoreSafe();
  const packageName =
    Platform.OS === 'android'
      ? (Constants.expoConfig?.android?.package ?? null)
      : (Constants.expoConfig?.ios?.bundleIdentifier ?? null);

  console.info('[production-build-config]', {
    projectId: config.projectId ?? null,
    appIdPresent: Boolean(config.appId),
    apiKeyPresent: Boolean(config.apiKey),
    authDomainPresent: Boolean(config.authDomain),
    storageBucketPresent: Boolean(config.storageBucket),
    messagingSenderIdPresent: Boolean(config.messagingSenderId),
    packageName,
    functionsRegion: FIREBASE_FUNCTIONS_REGION,
    marketplaceEnabled: VEHICLE_MARKETPLACE_ENABLED,
    marketplaceSource: VEHICLE_MARKETPLACE_FEATURE_SOURCE,
    googleSignInConfigured: isGoogleSignInConfigured(),
    firebaseConfigComplete: hasFirebaseConfig(),
    authInitialized: Boolean(auth),
    firestoreInitialized: Boolean(firestore),
    authenticated: Boolean(auth?.currentUser),
    isAnonymous: auth?.currentUser?.isAnonymous ?? null,
  });

  try {
    setBackendDiagnosticsMeta({
      projectId: config.projectId ?? 'logisticore-53ab4',
      region: FIREBASE_FUNCTIONS_REGION,
      authInitialized: Boolean(auth),
      authReady: Boolean(auth),
      currentUserKind: resolveCurrentUserKind(auth?.currentUser ?? null),
    });
  } catch {
    // diagnostics optional at boot
  }
}
