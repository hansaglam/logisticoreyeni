/**
 * Development-only console helpers.
 * Production'da hiçbir çıktı üretmez.
 */

export function debugLog(enabled: boolean, label: string, payload?: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (!enabled) return;

  if (payload === undefined) {
    console.log(label);
  } else {
    console.log(label, payload);
  }
}

export function debugWarn(enabled: boolean, label: string, payload?: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (!enabled) return;

  if (payload === undefined) {
    console.warn(label);
  } else {
    console.warn(label, payload);
  }
}

/** Kalibrasyon kopyala-yapıştır satırı — payload objesi değil düz string. */
export function debugCalibrationPointLine(enabled: boolean, line: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (!enabled) return;
  console.log(line);
}
