/**
 * Verify an iOS .xcarchive embeds store production ads config (not Google test mode).
 *
 * Usage:
 *   npx tsx scripts/verifyIosArchiveAdConfig.ts --archive="/path/to/LogistiCore.xcarchive"
 *   npx tsx scripts/verifyIosArchiveAdConfig.ts   # auto-picks latest LogistiCore archive
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  ADMOB_REWARDED_UNIT_IDS,
  GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS,
} from '../src/config/adMobConstants';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function fail(message: string): never {
  console.error(`[verifyIosArchiveAdConfig] FAIL: ${message}`);
  process.exit(1);
}

function findAppBundle(archivePath: string): string {
  const products = join(archivePath, 'Products', 'Applications');
  if (!existsSync(products)) {
    fail(`missing Products/Applications in ${archivePath}`);
  }
  const apps = readdirSync(products).filter((name) => name.endsWith('.app'));
  if (apps.length === 0) {
    fail(`no .app under ${products}`);
  }
  return join(products, apps[0]!);
}

function readPlistBuddy(appPath: string, key: string): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  return execSync(`/usr/libexec/PlistBuddy -c 'Print :${key}' "${join(appPath, 'Info.plist')}"`, {
    encoding: 'utf8',
  }).trim();
}

function findLatestArchive(): string | null {
  const archivesRoot = join(homedir(), 'Library', 'Developer', 'Xcode', 'Archives');
  if (!existsSync(archivesRoot)) return null;
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const day of readdirSync(archivesRoot)) {
    const dayPath = join(archivesRoot, day);
    if (!statSync(dayPath).isDirectory()) continue;
    for (const name of readdirSync(dayPath)) {
      if (!name.includes('LogistiCore') || !name.endsWith('.xcarchive')) continue;
      const path = join(dayPath, name);
      candidates.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

function parseExpoAppConfig(appPath: string): Record<string, unknown> {
  const configPath = join(appPath, 'EXConstants.bundle', 'app.config');
  if (!existsSync(configPath)) {
    fail(`missing EXConstants.bundle/app.config in ${basename(appPath)}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    fail('EXConstants.bundle/app.config is not JSON');
  }
}

function main(): void {
  const archiveArg = argValue('archive');
  const archivePath = archiveArg ? resolve(archiveArg) : findLatestArchive();
  if (!archivePath || !existsSync(archivePath)) {
    fail('provide --archive=/path/to/LogistiCore.xcarchive (none found)');
  }

  const appPath = findAppBundle(archivePath);
  const shortVersion = readPlistBuddy(appPath, 'CFBundleShortVersionString');
  const buildNumber = readPlistBuddy(appPath, 'CFBundleVersion');
  const expoConfig = parseExpoAppConfig(appPath);
  const extra = (expoConfig.extra ?? {}) as Record<string, unknown>;
  const ads = (extra.ads ?? {}) as Record<string, unknown>;
  const fingerprint = (extra.buildFingerprint ?? {}) as Record<string, unknown>;

  const buildProfile = String(extra.buildProfile ?? fingerprint.buildProfile ?? '');
  const useTestIds = String(ads.useTestIds ?? '');

  const report = {
    archivePath,
    appPath,
    CFBundleShortVersionString: shortVersion,
    CFBundleVersion: buildNumber,
    buildProfile,
    adsUseTestIds: useTestIds,
    expectedProductionIosRewarded: ADMOB_REWARDED_UNIT_IDS.ios,
    googleIosTestRewarded: GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios,
  };
  console.log(JSON.stringify(report, null, 2));

  if (buildProfile !== 'production') {
    fail(`archived Expo extra.buildProfile must be "production" (got "${buildProfile}")`);
  }
  if (useTestIds === 'true') {
    fail('archived Expo extra.ads.useTestIds must not be "true" (TEST MODE baked in)');
  }

  // Strongest available proof: Expo embedded config. JS may still contain SDK TestIds
  // string tables — that alone is not a failure.
  console.log('[verifyIosArchiveAdConfig] OK — store archive ads config is production');
}

main();
