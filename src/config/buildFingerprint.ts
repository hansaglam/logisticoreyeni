/**
 * Release-build identity baked at config evaluation time (app.config.js extra).
 * Logs at startup so Internal Test binaries can be matched to a git SHA.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { APP_VERSION } from './appVersion';
import { resolveBuildProfile } from './buildProfile';

export const MAP_MARKER_REVISION = 'chevron-circle-v2';

export interface BuildFingerprint {
  appVersion: string;
  versionCode: number | null;
  buildProfile: string;
  gitCommit: string;
  gitCommitShort: string;
  buildTimestamp: string;
  runtimeVersion: string | null;
  updateChannel: string | null;
  expoUpdatesEnabled: boolean;
  mapMarkerRevision: string;
  platform: string;
}

function extraRecord(): Record<string, unknown> {
  const extra = Constants.expoConfig?.extra;
  return extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getBuildFingerprint(): BuildFingerprint {
  const extra = extraRecord();
  const fingerprint = extra.buildFingerprint;
  const baked =
    fingerprint && typeof fingerprint === 'object'
      ? (fingerprint as Record<string, unknown>)
      : {};
  const gitCommit =
    readString(baked.gitCommit) ??
    readString(process.env.EXPO_PUBLIC_GIT_COMMIT) ??
    'unknown';
  const bakedVersionCode =
    typeof baked.versionCode === 'number' ? baked.versionCode : null;
  const expoVersionCode =
    Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;
  const versionCodeRaw =
    bakedVersionCode ?? (typeof expoVersionCode === 'number' ? expoVersionCode : null);
  return {
    appVersion: readString(baked.appVersion) ?? APP_VERSION,
    versionCode: versionCodeRaw,
    buildProfile: readString(baked.buildProfile) ?? resolveBuildProfile(),
    gitCommit,
    gitCommitShort: gitCommit.slice(0, 7),
    buildTimestamp: readString(baked.buildTimestamp) ?? 'unknown',
    runtimeVersion: readString(baked.runtimeVersion),
    updateChannel: readString(baked.updateChannel),
    expoUpdatesEnabled: baked.expoUpdatesEnabled === true,
    mapMarkerRevision: readString(baked.mapMarkerRevision) ?? MAP_MARKER_REVISION,
    platform: Platform.OS,
  };
}

let fingerprintLogged = false;

export function logBuildFingerprintOnce(): void {
  if (fingerprintLogged) return;
  fingerprintLogged = true;
  console.log('[BUILD_FINGERPRINT]', getBuildFingerprint());
}
