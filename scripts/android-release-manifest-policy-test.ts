import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = resolve(ROOT, 'android');
const MAIN_MANIFEST = resolve(ANDROID_DIR, 'app/src/main/AndroidManifest.xml');
const DEBUG_MANIFEST = resolve(ANDROID_DIR, 'app/src/debug/AndroidManifest.xml');
const BUILD_GRADLE = resolve(ANDROID_DIR, 'app/build.gradle');

const FORBIDDEN_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
] as const;

const EXPECTED_PACKAGE = 'com.ethemsincar.logisticore';
const EXPECTED_ALLOW_BACKUP = 'false';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function listActivePermissions(manifestSource: string): string[] {
  const matches = [
    ...manifestSource.matchAll(
      /<uses-permission[^>]*android:name="([^"]+)"[^>]*\/?>/g,
    ),
  ];
  return matches
    .filter((match) => !match[0].includes('tools:node="remove"'))
    .map((match) => match[1]);
}

function assertNoForbiddenPermissions(label: string, manifestSource: string): void {
  const active = listActivePermissions(manifestSource);
  for (const permission of FORBIDDEN_PERMISSIONS) {
    assert.equal(
      active.includes(permission),
      false,
      `${label} must not declare ${permission}`,
    );
  }
}

function assertAllowBackup(label: string, manifestSource: string, expected: string): void {
  const match = manifestSource.match(/android:allowBackup="(true|false)"/);
  assert.ok(match, `${label} must declare android:allowBackup explicitly`);
  assert.equal(match[1], expected, `${label} allowBackup expected ${expected}`);
}

function findFiles(dir: string, fileName: string, hits: string[] = []): string[] {
  if (!existsSync(dir)) return hits;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findFiles(full, fileName, hits);
    } else if (entry === fileName) {
      hits.push(full);
    }
  }
  return hits;
}

function findMergedReleaseManifest(): string | null {
  const preferred = resolve(
    ANDROID_DIR,
    'app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml',
  );
  if (existsSync(preferred)) {
    return preferred;
  }
  const hits = findFiles(resolve(ANDROID_DIR, 'app/build/intermediates'), 'AndroidManifest.xml')
    .filter((path) => path.includes('merged_manifest') && path.includes('release'));
  return hits.sort().at(-1) ?? null;
}

function runReleaseManifestMergeTask(): void {
  const gradlew = resolve(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  assert.ok(existsSync(gradlew), 'Gradle wrapper missing under android/');
  execSync(`${gradlew} :app:processReleaseMainManifest`, {
    cwd: ANDROID_DIR,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function readTargetSdkFromGradle(): number | null {
  const gradle = read(BUILD_GRADLE);
  const match = gradle.match(/targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/);
  if (!match) return null;
  const rootGradle = read(resolve(ANDROID_DIR, 'build.gradle'));
  const extMatch = rootGradle.match(/targetSdkVersion\s*=\s*(\d+)/);
  if (extMatch) return Number(extMatch[1]);
  return null;
}

function main(): void {
  const mainManifest = read(MAIN_MANIFEST);
  const debugManifest = read(DEBUG_MANIFEST);

  assertNoForbiddenPermissions('main/AndroidManifest.xml', mainManifest);
  assertAllowBackup('main/AndroidManifest.xml', mainManifest, EXPECTED_ALLOW_BACKUP);

  for (const permission of FORBIDDEN_PERMISSIONS) {
    assert.match(
      mainManifest,
      new RegExp(`${permission.replace('.', '\\.')}[^\\n]*tools:node="remove"`),
      `main manifest must remove ${permission} via tools:node="remove"`,
    );
  }

  assert.match(mainManifest, /android:allowBackup="false"/);
  assert.match(debugManifest, /SYSTEM_ALERT_WINDOW/);

  let mergedPath = findMergedReleaseManifest();
  if (!mergedPath) {
    runReleaseManifestMergeTask();
    mergedPath = findMergedReleaseManifest();
  }
  assert.ok(mergedPath, 'Merged release AndroidManifest.xml not found after processReleaseMainManifest');
  const mergedManifest = read(mergedPath);

  assertNoForbiddenPermissions(`merged release (${mergedPath})`, mergedManifest);
  assertAllowBackup(`merged release (${mergedPath})`, mergedManifest, EXPECTED_ALLOW_BACKUP);
  assert.match(mergedManifest, new RegExp(`package="${EXPECTED_PACKAGE}"`));

  const packagedPath = resolve(
    ANDROID_DIR,
    'app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml',
  );
  if (existsSync(packagedPath)) {
    const packagedManifest = read(packagedPath);
    assertNoForbiddenPermissions(`packaged release (${packagedPath})`, packagedManifest);
    assertAllowBackup(`packaged release (${packagedPath})`, packagedManifest, EXPECTED_ALLOW_BACKUP);
  }

  const targetSdkMatch = mergedManifest.match(/android:targetSdkVersion="(\d+)"/);
  if (targetSdkMatch) {
    assert.ok(Number(targetSdkMatch[1]) >= 34, 'targetSdkVersion should be >= 34');
  } else {
    const gradleTarget = readTargetSdkFromGradle();
    assert.ok(gradleTarget == null || gradleTarget >= 34, 'Gradle targetSdkVersion should be >= 34');
  }

  console.log('[android-release-manifest-policy-test]');
  console.log(
    JSON.stringify(
      {
        status: 'MITIGATED',
        sources: {
          mainManifest: 'android/app/src/main/AndroidManifest.xml',
          debugManifest: 'android/app/src/debug/AndroidManifest.xml (SYSTEM_ALERT_WINDOW debug-only)',
          releaseManifest: 'none (uses main)',
          expoBlockedPermissions: 'app.config.js',
        },
        permissionOrigins: {
          SYSTEM_ALERT_WINDOW: 'Previously declared in main + debug; Expo/RN dev overlay legacy',
          READ_EXTERNAL_STORAGE: 'Previously declared in main; legacy storage',
          WRITE_EXTERNAL_STORAGE: 'Previously declared in main; legacy storage',
          MANAGE_EXTERNAL_STORAGE: 'Not present; guarded via tools:node=remove',
        },
        removedFromRelease: FORBIDDEN_PERMISSIONS,
        backupPolicy: {
          allowBackup: EXPECTED_ALLOW_BACKUP,
          rationale:
            'Cloud save + auth UID isolation — Android Auto Backup risks cross-restore of local AsyncStorage.',
        },
        mergedReleaseManifest: mergedPath,
        package: EXPECTED_PACKAGE,
        targetSdk:
          targetSdkMatch?.[1] ??
          readTargetSdkFromGradle() ??
          'see merged manifest / expo-root-project',
      },
      null,
      2,
    ),
  );
}

main();
