/**
 * Which geographic renderer the real Harita tab mounts.
 * Store and unknown release profiles stay on the legacy map.
 * Internal and development profiles use Map V2.
 *
 * This follows resolveBuildProfile / isInternalBuildProfile.
 * It does not import the build fingerprint: that module pulls React Native.
 */

import { isInternalBuildProfile } from '../config/buildProfile';

export type MapExperience = 'MAP_V2' | 'LEGACY_MAP';

export type MapExperienceInput = {
  /** Explicit LOGISTICORE_BUILD_PROFILE value, when known. */
  profile?: string | null;
  /**
   * Override for the internal/dev decision when no explicit profile is set.
   * Omit it to use isInternalBuildProfile().
   */
  internal?: boolean;
};

function normalizeProfile(profile: string | null | undefined): string {
  return (profile ?? '').trim().toLowerCase();
}

export function resolveMapExperience(input?: MapExperienceInput): MapExperience {
  const explicit = normalizeProfile(input?.profile);
  if (explicit === 'production' || explicit === 'store') return 'LEGACY_MAP';
  if (explicit === 'internal' || explicit === 'development') return 'MAP_V2';
  if (explicit) return 'LEGACY_MAP';
  if (input?.internal != null) return input.internal ? 'MAP_V2' : 'LEGACY_MAP';
  return isInternalBuildProfile() ? 'MAP_V2' : 'LEGACY_MAP';
}

export function resolveActiveMapExperience(): MapExperience {
  return resolveMapExperience({
    profile: process.env.LOGISTICORE_BUILD_PROFILE,
  });
}
