import React, { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

const MapScaleContext = createContext<SharedValue<number> | null>(null);

export function MapScaleProvider({
  mapScale,
  children,
}: {
  mapScale: SharedValue<number>;
  children: React.ReactNode;
}) {
  return <MapScaleContext.Provider value={mapScale}>{children}</MapScaleContext.Provider>;
}

export function useMapScale(): SharedValue<number> | null {
  return useContext(MapScaleContext);
}
