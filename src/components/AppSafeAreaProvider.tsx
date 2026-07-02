import React, { createContext, useContext } from 'react';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getFallbackInsets,
  isSafeAreaContextAvailable,
  type EdgeInsets,
} from '../utils/safeArea';

const InsetsContext = createContext<EdgeInsets>(getFallbackInsets());

function NativeInsetsBridge({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <InsetsContext.Provider value={insets}>{children}</InsetsContext.Provider>;
}

function NativeSafeAreaRoot({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <NativeInsetsBridge>{children}</NativeInsetsBridge>
    </SafeAreaProvider>
  );
}

function FallbackSafeAreaRoot({ children }: { children: React.ReactNode }) {
  return (
    <InsetsContext.Provider value={getFallbackInsets()}>{children}</InsetsContext.Provider>
  );
}

export function AppSafeAreaProvider({ children }: { children: React.ReactNode }) {
  if (isSafeAreaContextAvailable()) {
    return <NativeSafeAreaRoot>{children}</NativeSafeAreaRoot>;
  }
  return <FallbackSafeAreaRoot>{children}</FallbackSafeAreaRoot>;
}

export function useAppSafeAreaInsets(): EdgeInsets {
  return useContext(InsetsContext);
}
