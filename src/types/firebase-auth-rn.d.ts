/**
 * Firebase Auth React Native exports — web tip tanımlarında yok,
 * Metro RN resolve'ta runtime'da mevcut.
 */

import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }): Persistence;
}

export {};
