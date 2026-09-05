/** Node test harness — React Native / Expo shims for headless scripts. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

(globalThis as typeof globalThis & { expo?: Record<string, unknown> }).expo = {
  EventEmitter: class EventEmitter {
    addListener() {
      return { remove() {} };
    }
    removeAllListeners() {}
  },
  modules: {},
};

const reactNativeMock = {
  Platform: {
    OS: 'ios' as const,
    select<T>(specifics: { ios?: T; android?: T; default?: T }): T | undefined {
      return specifics.ios ?? specifics.default;
    },
  },
};

const expoConstantsMock = {
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
  expoConfig: {
    extra: {
      features: {},
      ads: {},
    },
  },
};

function installMock(moduleName: string, exportsValue: unknown): void {
  try {
    const modulePath = require.resolve(moduleName);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: exportsValue,
      children: [],
      paths: [],
      parent: null,
      path: '',
      require,
    } as NodeModule;
  } catch {
    // optional dependency — tests fail explicitly if required.
  }
}

installMock('react-native', reactNativeMock);
installMock('expo-constants', expoConstantsMock);
