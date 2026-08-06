/**
 * Generate LogistiCore production icon + splash assets from company emblem.
 * Run: npx tsx scripts/generate-branding-assets.ts
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const EMBLEM_SOURCE = resolve(ROOT, 'assets/dashboard/company-emblem-gold.png');
const BRANDING_DIR = resolve(ROOT, 'assets/branding');
const ANDROID_RES = resolve(ROOT, 'android/app/src/main/res');

const BRAND_BG = '#020712';
const ICON_SIZE = 1024;
const SAFE_ZONE_RATIO = 0.66;

const LAUNCHER_SIZES: Record<string, number> = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const SPLASH_LOGO_WIDTHS: Record<string, number> = {
  'drawable-mdpi': 288,
  'drawable-hdpi': 432,
  'drawable-xhdpi': 576,
  'drawable-xxhdpi': 864,
  'drawable-xxxhdpi': 1152,
};

async function buildEmblem(maxSize: number): Promise<Buffer> {
  const emblemMeta = await sharp(EMBLEM_SOURCE).metadata();
  const sourceWidth = emblemMeta.width ?? maxSize;
  const sourceHeight = emblemMeta.height ?? maxSize;
  const scale = maxSize / Math.max(sourceWidth, sourceHeight);
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);
  return sharp(EMBLEM_SOURCE)
    .resize(targetWidth, targetHeight, { fit: 'inside' })
    .png()
    .toBuffer();
}

async function compositeOnBrandCanvas(emblemMaxSize: number, canvasSize: number): Promise<Buffer> {
  const emblem = await buildEmblem(emblemMaxSize);
  const emblemMeta = await sharp(emblem).metadata();
  const left = Math.floor((canvasSize - (emblemMeta.width ?? canvasSize)) / 2);
  const top = Math.floor((canvasSize - (emblemMeta.height ?? canvasSize)) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: emblem, left, top }])
    .png()
    .toBuffer();
}

async function writeFile(path: string, data: Buffer): Promise<void> {
  mkdirSync(resolve(path, '..'), { recursive: true });
  await sharp(data).toFile(path);
}

async function main(): Promise<void> {
  if (!existsSync(EMBLEM_SOURCE)) {
    throw new Error(`Missing emblem source: ${EMBLEM_SOURCE}`);
  }

  mkdirSync(BRANDING_DIR, { recursive: true });

  const emblemSafeSize = Math.round(ICON_SIZE * SAFE_ZONE_RATIO);
  const icon = await compositeOnBrandCanvas(emblemSafeSize, ICON_SIZE);
  const adaptiveForeground = await compositeOnBrandCanvas(emblemSafeSize, ICON_SIZE);
  const splashIcon = await compositeOnBrandCanvas(Math.round(512 * SAFE_ZONE_RATIO), 512);

  await writeFile(resolve(BRANDING_DIR, 'icon.png'), icon);
  await writeFile(resolve(BRANDING_DIR, 'adaptive-icon-foreground.png'), adaptiveForeground);
  await writeFile(resolve(BRANDING_DIR, 'splash-icon.png'), splashIcon);

  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const launcher = await compositeOnBrandCanvas(Math.round(size * SAFE_ZONE_RATIO), size);
    const dir = resolve(ANDROID_RES, folder);
    mkdirSync(dir, { recursive: true });
    await sharp(launcher).webp({ quality: 95 }).toFile(resolve(dir, 'ic_launcher.webp'));
    await sharp(launcher).webp({ quality: 95 }).toFile(resolve(dir, 'ic_launcher_round.webp'));
    await sharp(launcher).webp({ quality: 95 }).toFile(resolve(dir, 'ic_launcher_foreground.webp'));
  }

  for (const [folder, width] of Object.entries(SPLASH_LOGO_WIDTHS)) {
    const splashLogo = await compositeOnBrandCanvas(Math.round(width * SAFE_ZONE_RATIO), width);
    const dir = resolve(ANDROID_RES, folder);
    mkdirSync(dir, { recursive: true });
    await sharp(splashLogo).png().toFile(resolve(dir, 'splashscreen_logo.png'));
  }

  console.log('[generate-branding-assets] PASS', {
    brandBackground: BRAND_BG,
    iconSize: ICON_SIZE,
    safeZoneRatio: SAFE_ZONE_RATIO,
    source: 'assets/dashboard/company-emblem-gold.png',
    outputs: [
      'assets/branding/icon.png',
      'assets/branding/adaptive-icon-foreground.png',
      'assets/branding/splash-icon.png',
      'android/app/src/main/res/mipmap-*/ic_launcher*.webp',
      'android/app/src/main/res/drawable-*/splashscreen_logo.png',
    ],
  });
}

void main().catch((error) => {
  console.error('[generate-branding-assets] FAILED', error);
  process.exitCode = 1;
});
