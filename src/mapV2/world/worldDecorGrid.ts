import { Skia, type SkPath } from '@shopify/react-native-skia';

let cached: SkPath | null = null;

/** Decorative command-center grid. Not geographic authority. */
export function getWorldDecorGridPath(): SkPath {
  if (cached) return cached;
  const path = Skia.Path.Make();
  for (let x = 0.05; x <= 0.95 + 1e-9; x += 0.1) {
    path.moveTo(x, 0.18);
    path.lineTo(x, 0.72);
  }
  for (let y = 0.2; y <= 0.7 + 1e-9; y += 0.1) {
    path.moveTo(0.04, y);
    path.lineTo(0.96, y);
  }
  cached = path;
  return path;
}
