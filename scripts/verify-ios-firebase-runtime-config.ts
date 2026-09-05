/**
 * Build-time verification that iOS / Firebase runtime identity is canonical.
 * Run: npm run verify:ios-firebase
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_FIREBASE_AUTH_DOMAIN,
  EXPECTED_FIREBASE_MESSAGING_SENDER_ID,
  EXPECTED_FIREBASE_PROJECT_ID,
  EXPECTED_IOS_BUNDLE_ID,
  FORBIDDEN_IOS_BUNDLE_IDS,
  isForbiddenIosBundleId,
} from '../src/config/firebaseRuntimeContract';

const ROOT = process.cwd();

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
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1] ?? null;
}

function findGoogleServicePlists(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'Pods' ||
      entry.name === 'build' ||
      entry.name === 'dist' ||
      entry.name === '.git' ||
      entry.name === '.expo'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findGoogleServicePlists(full, acc);
      continue;
    }
    if (entry.name === 'GoogleService-Info.plist') {
      acc.push(path.relative(ROOT, full));
    }
  }
  return acc;
}

function loadResolvedAppConfig(): {
  bundleIdentifier: string | null;
  projectId: string | null;
  authDomain: string | null;
  appId: string | null;
  messagingSenderId: string | null;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const factory = require(path.join(ROOT, 'app.config.js')) as () => {
    ios?: { bundleIdentifier?: string };
    extra?: {
      firebase?: {
        projectId?: string;
        authDomain?: string;
        appId?: string;
        messagingSenderId?: string;
      };
    };
  };
  const config = factory();
  return {
    bundleIdentifier: config.ios?.bundleIdentifier ?? null,
    projectId: config.extra?.firebase?.projectId ?? null,
    authDomain: config.extra?.firebase?.authDomain ?? null,
    appId: config.extra?.firebase?.appId ?? null,
    messagingSenderId: config.extra?.firebase?.messagingSenderId ?? null,
  };
}

function run(): void {
  console.log('\nverify-ios-firebase-runtime-config\n');

  assert(fileExists('app.json'), 'app.json exists');
  assert(fileExists('app.config.js'), 'app.config.js exists');
  assert(fileExists('src/config/firebase.public.json'), 'firebase.public.json exists');
  assert(fileExists('src/config/firebaseRuntimeContract.ts'), 'runtime contract exists');
  assert(fileExists('ios/LogistiCore.xcodeproj/project.pbxproj'), 'Xcode project exists');
  assert(!fileExists('eas.json'), 'no eas.json override profile');

  const appJson = JSON.parse(read('app.json')) as {
    expo?: { ios?: { bundleIdentifier?: string } };
  };
  const appConfigSrc = read('app.config.js');
  const pbxproj = read('ios/LogistiCore.xcodeproj/project.pbxproj');
  const publicConfig = JSON.parse(read('src/config/firebase.public.json')) as {
    projectId?: string;
    authDomain?: string;
    messagingSenderId?: string;
    appId?: string;
    apiKey?: string;
  };
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert(
    appJson.expo?.ios?.bundleIdentifier === EXPECTED_IOS_BUNDLE_ID,
    'app.json ios.bundleIdentifier',
    appJson.expo?.ios?.bundleIdentifier ?? '<missing>',
  );
  assert(
    appConfigSrc.includes(`bundleIdentifier: '${EXPECTED_IOS_BUNDLE_ID}'`),
    'app.config.js hardcodes expected bundle ID',
  );
  assert(
    publicConfig.projectId === EXPECTED_FIREBASE_PROJECT_ID,
    'public firebase projectId',
    publicConfig.projectId,
  );
  assert(
    publicConfig.authDomain === EXPECTED_FIREBASE_AUTH_DOMAIN,
    'public firebase authDomain',
    publicConfig.authDomain,
  );
  assert(
    publicConfig.messagingSenderId === EXPECTED_FIREBASE_MESSAGING_SENDER_ID,
    'public firebase messagingSenderId',
    publicConfig.messagingSenderId,
  );
  assert(
    typeof publicConfig.apiKey === 'string' && publicConfig.apiKey.startsWith('AIza'),
    'public firebase apiKey present',
  );
  assert(
    typeof publicConfig.appId === 'string' && publicConfig.appId.startsWith('1:363783837598:'),
    'public firebase appId prefix',
    publicConfig.appId,
  );

  const resolved = loadResolvedAppConfig();
  assert(
    resolved.bundleIdentifier === EXPECTED_IOS_BUNDLE_ID,
    'resolved expo ios.bundleIdentifier',
    resolved.bundleIdentifier ?? '<missing>',
  );
  assert(
    resolved.projectId === EXPECTED_FIREBASE_PROJECT_ID,
    'resolved extra.firebase.projectId',
    resolved.projectId || '<empty>',
  );
  assert(
    resolved.authDomain === EXPECTED_FIREBASE_AUTH_DOMAIN,
    'resolved extra.firebase.authDomain',
    resolved.authDomain || '<empty>',
  );
  assert(Boolean(resolved.appId), 'resolved extra.firebase.appId is non-empty');
  assert(
    resolved.messagingSenderId === EXPECTED_FIREBASE_MESSAGING_SENDER_ID,
    'resolved extra.firebase.messagingSenderId',
    resolved.messagingSenderId || '<empty>',
  );

  const envProjectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (envProjectId) {
    assert(
      envProjectId === EXPECTED_FIREBASE_PROJECT_ID,
      'EXPO_PUBLIC_FIREBASE_PROJECT_ID matches canonical project',
      envProjectId,
    );
  } else {
    assert(true, 'EXPO_PUBLIC_FIREBASE_PROJECT_ID unset — public fallback used');
  }

  const plists = findGoogleServicePlists(ROOT);
  assert(plists.length > 0, 'at least one GoogleService-Info.plist exists');
  console.log(`  • plist files: ${plists.join(', ') || '<none>'}`);

  const plistSnapshots = plists.map((relativePath) => {
    const contents = read(relativePath);
    return {
      relativePath,
      projectId: readPlistString(contents, 'PROJECT_ID'),
      bundleId: readPlistString(contents, 'BUNDLE_ID'),
      googleAppId: readPlistString(contents, 'GOOGLE_APP_ID'),
      clientId: readPlistString(contents, 'CLIENT_ID'),
      reversedClientId: readPlistString(contents, 'REVERSED_CLIENT_ID'),
      contents,
    };
  });

  for (const plist of plistSnapshots) {
    assert(
      plist.projectId === EXPECTED_FIREBASE_PROJECT_ID,
      `${plist.relativePath} PROJECT_ID`,
      plist.projectId ?? '<missing>',
    );
    assert(
      plist.bundleId === EXPECTED_IOS_BUNDLE_ID,
      `${plist.relativePath} BUNDLE_ID`,
      plist.bundleId ?? '<missing>',
    );
    assert(
      !isForbiddenIosBundleId(plist.bundleId),
      `${plist.relativePath} is not a forbidden bundle`,
      plist.bundleId ?? '<missing>',
    );
    for (const forbidden of FORBIDDEN_IOS_BUNDLE_IDS) {
      assert(
        !plist.contents.includes(forbidden),
        `${plist.relativePath} does not contain ${forbidden}`,
      );
    }
    assert(Boolean(plist.googleAppId), `${plist.relativePath} GOOGLE_APP_ID present`);
    assert(Boolean(plist.clientId), `${plist.relativePath} CLIENT_ID present`);
    assert(Boolean(plist.reversedClientId), `${plist.relativePath} REVERSED_CLIENT_ID present`);
  }

  const activePlistPath = 'ios/LogistiCore/GoogleService-Info.plist';
  assert(
    plists.includes(activePlistPath),
    'active iOS target plist path exists',
    activePlistPath,
  );

  const resourcesPhase = pbxproj.match(
    /Begin PBXResourcesBuildPhase section[\s\S]*?End PBXResourcesBuildPhase section/,
  )?.[0] ?? '';
  const resourceMatches = resourcesPhase.match(/GoogleService-Info\.plist in Resources/g) ?? [];
  assert(
    resourceMatches.length === 1,
    'Copy Bundle Resources includes GoogleService-Info.plist exactly once',
    `count=${resourceMatches.length}`,
  );
  const buildFileMatches = pbxproj.match(
    /isa = PBXBuildFile; fileRef = [^;]+ \/\* GoogleService-Info\.plist \*\//g,
  ) ?? [];
  assert(
    buildFileMatches.length === 1,
    'Xcode has a single GoogleService-Info.plist build file',
    `count=${buildFileMatches.length}`,
  );
  assert(
    pbxproj.includes('path = "LogistiCore/GoogleService-Info.plist"'),
    'Xcode file ref points at ios/LogistiCore/GoogleService-Info.plist',
  );
  assert(
    !pbxproj.includes('path = GoogleService-Info.plist;') &&
      !pbxproj.includes('path = "../GoogleService-Info.plist"'),
    'root GoogleService-Info.plist is not an Xcode resource',
  );

  const debugBundle = pbxproj.match(
    /13B07F941A680F5B00A75B9A \/\* Debug \*\/ = \{[\s\S]*?PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/,
  );
  const releaseBundle = pbxproj.match(
    /13B07F951A680F5B00A75B9A \/\* Release \*\/ = \{[\s\S]*?PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/,
  );
  assert(
    debugBundle?.[1]?.trim() === EXPECTED_IOS_BUNDLE_ID,
    'Debug PRODUCT_BUNDLE_IDENTIFIER',
    debugBundle?.[1],
  );
  assert(
    releaseBundle?.[1]?.trim() === EXPECTED_IOS_BUNDLE_ID,
    'Release PRODUCT_BUNDLE_IDENTIFIER',
    releaseBundle?.[1],
  );
  assert(
    /PRODUCT_NAME = LogistiCore;/.test(pbxproj),
    'PRODUCT_NAME is LogistiCore',
  );
  assert(
    pbxproj.includes('13B07F861A680F5B00A75B9A /* LogistiCore */'),
    'native target name is LogistiCore',
  );

  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  assert(
    typeof deps.firebase === 'string',
    'JS Firebase SDK is the canonical dependency',
  );
  assert(
    !Object.keys(deps).some((name) => name.startsWith('@react-native-firebase/')),
    'React Native Firebase native SDK is not mixed in',
  );

  const firebaseSrc = read('src/services/firebase.ts');
  assert(firebaseSrc.includes('getApps().length > 0'), 'canonical getApps singleton guard');
  assert(firebaseSrc.includes('initializeApp('), 'initializeApp present');
  assert(!firebaseSrc.includes('getAuth('), 'does not use getAuth(');
  assert(firebaseSrc.includes('firebase.public.json'), 'public config fallback wired');

  const appleSrc = read('src/services/appleAuthService.ts');
  assert(appleSrc.includes('config-validation'), 'Apple auth has config-validation stage');
  assert(appleSrc.includes('FIREBASE_RUNTIME_CONFIG_MISMATCH'), 'Apple auth hard-guard code present');

  const appSrc = `${read('App.tsx')}\n${read('src/hooks/useAppBootstrap.ts')}`;
  assert(appSrc.includes('logFirebaseRuntimeConfigOnce'), 'startup runtime config log present');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
