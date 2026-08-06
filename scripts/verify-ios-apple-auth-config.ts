/**
 * iOS Apple Sign-In pre-flight config verification.
 * Run: tsx scripts/verify-ios-apple-auth-config.ts
 *
 * Archive entitlement check:
 *   IOS_ARCHIVE_APP_PATH="/path/to/LogistiCore.app" tsx scripts/verify-ios-apple-auth-config.ts
 *
 * If IOS_ARCHIVE_APP_PATH is unset, the latest LogistiCore.xcarchive under
 * ~/Library/Developer/Xcode/Archives is used. Missing Sign in with Apple
 * entitlement fails the script.
 *
 * Manual archive entitlement dump:
 *   codesign -d --entitlements :- "<PATH_TO_ARCHIVED_APP>"
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const EXPECTED_BUNDLE_ID = 'com.ethemsincar.logisticore';
const EXPECTED_PROJECT_ID = 'logisticore-53ab4';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readPlistString(plist: string, key: string): string | null {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
  return match?.[1] ?? null;
}

function findLatestLogistiCoreArchiveApp(): string | null {
  const archivesRoot = path.join(os.homedir(), 'Library/Developer/Xcode/Archives');
  if (!fs.existsSync(archivesRoot)) {
    return null;
  }

  const candidates: Array<{ appPath: string; mtime: number }> = [];
  for (const day of fs.readdirSync(archivesRoot)) {
    const dayPath = path.join(archivesRoot, day);
    if (!fs.statSync(dayPath).isDirectory()) {
      continue;
    }
    for (const archiveName of fs.readdirSync(dayPath)) {
      if (!archiveName.includes('LogistiCore') || !archiveName.endsWith('.xcarchive')) {
        continue;
      }
      const appPath = path.join(dayPath, archiveName, 'Products/Applications/LogistiCore.app');
      if (!fs.existsSync(appPath)) {
        continue;
      }
      candidates.push({ appPath, mtime: fs.statSync(appPath).mtimeMs });
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.appPath ?? null;
}

function verifyArchiveEntitlements(appPath: string): void {
  console.log(`  • archive app: ${appPath}`);
  try {
    const output = execFileSync('codesign', ['-d', '--entitlements', ':-', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const hasKey = output.includes('com.apple.developer.applesignin');
    const hasDefault =
      /com\.apple\.developer\.applesignin<\/key>\s*<array>\s*<string>Default<\/string>/s.test(
        output,
      ) || (hasKey && output.includes('<string>Default</string>'));
    assert(hasKey, 'archive entitlements include Sign in with Apple');
    assert(hasDefault, 'archive entitlements include Default');
    if (!hasKey || !hasDefault) {
      console.error(
        '  ✗ Release archive preflight failed — com.apple.developer.applesignin = Default missing',
      );
    }
  } catch (error) {
    failed += 1;
    console.error(
      '  ✗ archive codesign entitlement dump failed',
      error instanceof Error ? error.message : error,
    );
  }
}

function run(): void {
  console.log('\nverify-ios-apple-auth-config\n');

  assert(fileExists('app.json'), 'app.json exists');
  assert(fileExists('app.config.js'), 'app.config.js exists');
  assert(fileExists('ios/LogistiCore/LogistiCore.entitlements'), 'entitlements source exists');
  assert(fileExists('GoogleService-Info.plist'), 'root GoogleService-Info.plist exists');
  assert(
    fileExists('ios/LogistiCore/GoogleService-Info.plist'),
    'iOS target GoogleService-Info.plist exists',
  );
  assert(fileExists('ios/LogistiCore.xcodeproj/project.pbxproj'), 'Xcode project exists');

  const appJson = read('app.json');
  const appConfig = read('app.config.js');
  const entitlements = read('ios/LogistiCore/LogistiCore.entitlements');
  const pbxproj = read('ios/LogistiCore.xcodeproj/project.pbxproj');
  const rootPlist = read('GoogleService-Info.plist');
  const iosPlist = read('ios/LogistiCore/GoogleService-Info.plist');

  assert(
    appJson.includes(`"bundleIdentifier": "${EXPECTED_BUNDLE_ID}"`),
    'app.json bundleIdentifier',
  );
  assert(
    appConfig.includes(`bundleIdentifier: '${EXPECTED_BUNDLE_ID}'`),
    'app.config.js bundleIdentifier',
  );
  assert(appConfig.includes('usesAppleSignIn: true'), 'usesAppleSignIn true');
  assert(
    appConfig.includes("'expo-apple-authentication'") ||
      appConfig.includes('"expo-apple-authentication"'),
    'expo-apple-authentication plugin present',
  );

  assert(
    entitlements.includes('com.apple.developer.applesignin'),
    'entitlements contain Sign in with Apple key',
  );
  assert(entitlements.includes('<string>Default</string>'), 'entitlements Default value');

  const debugEntitlements = pbxproj.match(
    /13B07F941A680F5B00A75B9A \/\* Debug \*\/ = \{[\s\S]*?CODE_SIGN_ENTITLEMENTS = ([^;]+);/,
  );
  const releaseEntitlements = pbxproj.match(
    /13B07F951A680F5B00A75B9A \/\* Release \*\/ = \{[\s\S]*?CODE_SIGN_ENTITLEMENTS = ([^;]+);/,
  );
  assert(
    debugEntitlements?.[1]?.includes('LogistiCore/LogistiCore.entitlements') === true,
    'Debug CODE_SIGN_ENTITLEMENTS points at LogistiCore.entitlements',
  );
  assert(
    releaseEntitlements?.[1]?.includes('LogistiCore/LogistiCore.entitlements') === true,
    'Release CODE_SIGN_ENTITLEMENTS points at LogistiCore.entitlements',
  );
  assert(
    /PRODUCT_BUNDLE_IDENTIFIER = com\.ethemsincar\.logisticore;/.test(pbxproj),
    'Xcode PRODUCT_BUNDLE_IDENTIFIER matches',
  );
  assert(
    pbxproj.includes('GoogleService-Info.plist in Resources'),
    'Release target includes GoogleService-Info.plist in Resources',
  );

  assert(
    readPlistString(rootPlist, 'BUNDLE_ID') === EXPECTED_BUNDLE_ID,
    'root plist BUNDLE_ID',
  );
  assert(
    readPlistString(iosPlist, 'BUNDLE_ID') === EXPECTED_BUNDLE_ID,
    'iOS plist BUNDLE_ID',
  );
  assert(
    readPlistString(rootPlist, 'PROJECT_ID') === EXPECTED_PROJECT_ID,
    'root plist PROJECT_ID',
  );
  assert(
    readPlistString(iosPlist, 'PROJECT_ID') === EXPECTED_PROJECT_ID,
    'iOS plist PROJECT_ID',
  );
  assert(!rootPlist.includes('com.anonymous'), 'root plist is not an anonymous Expo bundle');
  assert(!iosPlist.includes('com.anonymous'), 'iOS plist is not an anonymous Expo bundle');

  const archivePath =
    process.env.IOS_ARCHIVE_APP_PATH?.trim() || findLatestLogistiCoreArchiveApp();
  if (!archivePath) {
    failed += 1;
    console.error(
      '  ✗ archive entitlement preflight — no LogistiCore.app found (set IOS_ARCHIVE_APP_PATH)',
    );
  } else {
    verifyArchiveEntitlements(archivePath);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
