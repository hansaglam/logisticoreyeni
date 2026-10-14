import type { CameraSnapshot } from '../geo/worldCamera';

/**
 * In-memory Harita camera. Not written to the player save.
 * A different player id drops the previous session.
 */
export type MapSessionMode = 'WORLD' | 'COUNTRY' | 'CITY_DETAIL';

export type MapSessionSnapshot = {
  playerId: string | null;
  mode: MapSessionMode;
  selectedCountryId: string | null;
  focusCountryId: string | null;
  selectedCityId: string | null;
  camera: CameraSnapshot | null;
  worldCamera: CameraSnapshot | null;
  /** Live COUNTRY camera. Never copied into worldCamera. */
  countryCamera?: CameraSnapshot | null;
};

export type ScopeCameraSlots = {
  world: CameraSnapshot | null;
  country: CameraSnapshot | null;
};

/** COUNTRY samples update only the country slot. */
export function writeScopeCamera(
  slots: ScopeCameraSlots,
  scope: 'WORLD' | 'COUNTRY',
  sample: CameraSnapshot,
): ScopeCameraSlots {
  if (scope === 'COUNTRY') {
    return { world: slots.world, country: { ...sample } };
  }
  return { world: slots.world, country: slots.country };
}

/** Freeze the current WORLD camera before a country enter. */
export function captureWorldCameraForCountryEntry(
  slots: ScopeCameraSlots,
  sample: CameraSnapshot | null,
): ScopeCameraSlots {
  if (!sample) return slots;
  return { world: { ...sample }, country: slots.country };
}

let session: MapSessionSnapshot | null = null;

export function readMapSessionCamera(playerId: string | null): MapSessionSnapshot | null {
  if (!session) return null;
  if (session.playerId !== playerId) {
    session = null;
    return null;
  }
  if (session.mode === 'CITY_DETAIL') {
    return { ...session, mode: 'COUNTRY' };
  }
  return session;
}

export function writeMapSessionCamera(next: MapSessionSnapshot): void {
  session = {
    ...next,
    mode: next.mode === 'CITY_DETAIL' ? 'COUNTRY' : next.mode,
  };
}

export function clearMapSessionCamera(): void {
  session = null;
}
