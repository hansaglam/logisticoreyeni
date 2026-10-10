import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MapV2SpikeCanvas, { type MapV2SpikeCanvasHandle, type SpikeCanvasLayers } from './MapV2SpikeCanvas';
import MapV2SpikeControls from './MapV2SpikeControls';
import { SPIKE_DEFAULT_SELECTED_ID, createSpikeMarkerPool } from './spikeSyntheticData';

export default function MapV2RendererSpikeScreen({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<MapV2SpikeCanvasHandle>(null);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const [markerCount, setMarkerCount] = useState(100);
  const [routeCount, setRouteCount] = useState(5);
  const [animationPaused, setAnimationPaused] = useState(false);
  const [qualityEffects, setQualityEffects] = useState(true);
  const [cullEnabled, setCullEnabled] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [canvasMountKey, setCanvasMountKey] = useState(0);
  const [selectedId, setSelectedId] = useState(SPIKE_DEFAULT_SELECTED_ID);
  const [visibleMarkers, setVisibleMarkers] = useState(100);
  const [layers, setLayers] = useState<SpikeCanvasLayers>({
    regions: true,
    routes: true,
    markers: true,
    labels: true,
    vehicle: true,
  });

  const pool = useMemo(() => createSpikeMarkerPool(markerCount), [markerCount]);
  const selected = pool.find((m) => m.id === selectedId) ?? pool[0];

  const onCullStats = useCallback((visible: number) => {
    setVisibleMarkers(visible);
  }, []);

  const selectedLabel = selected
    ? `${selected.label ?? selected.id}${selected.locked ? ' (locked)' : ''}`
    : 'none';

  const selectNextHub = useCallback(() => {
    const hubs = pool.filter((m) => m.kind === 'hub');
    if (hubs.length === 0) return;
    const idx = hubs.findIndex((m) => m.id === selectedId);
    const next = hubs[(idx + 1) % hubs.length];
    if (next) setSelectedId(next.id);
  }, [pool, selectedId]);

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 8), paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Debug</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 Skia spike
        </Text>
      </View>
      <Text style={styles.disclaimer}>
        Fictional Noxmere scene. Not geography. Not production map.
      </Text>
      <View style={styles.canvasWrap}>
        <MapV2SpikeCanvas
          key={canvasMountKey}
          ref={canvasRef}
          markerCount={markerCount}
          routeCount={routeCount}
          animationPaused={animationPaused}
          reduceMotion={reduceMotion}
          qualityEffects={qualityEffects}
          cullEnabled={cullEnabled}
          layers={layers}
          selectedId={selectedId}
          onSelectId={setSelectedId}
          onCullStats={onCullStats}
        />
      </View>
      <View
        style={styles.a11y}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Selected ${selectedLabel}. ${visibleMarkers} of ${markerCount} markers in view.`}
      >
        <Text style={styles.a11yTitle}>Selected (RN, not canvas)</Text>
        <Text style={styles.a11yBody}>{selectedLabel}</Text>
        <Pressable accessibilityRole="button" onPress={selectNextHub} style={styles.a11yBtn}>
          <Text style={styles.a11yBtnText}>Select next hub</Text>
        </Pressable>
      </View>
      <MapV2SpikeControls
        markerCount={markerCount}
        routeCount={routeCount}
        animationPaused={animationPaused}
        showLayers={layers}
        qualityEffects={qualityEffects}
        cullEnabled={cullEnabled}
        reduceMotion={reduceMotion}
        selectedLabel={selectedLabel}
        visibleMarkers={visibleMarkers}
        totalMarkers={markerCount}
        screenRenderCount={renderCountRef.current}
        canvasMountKey={canvasMountKey}
        onMarkerCount={setMarkerCount}
        onRouteCount={setRouteCount}
        onTogglePause={() => setAnimationPaused((v) => !v)}
        onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
        onToggleEffects={() => setQualityEffects((v) => !v)}
        onToggleCull={() => setCullEnabled((v) => !v)}
        onToggleReduceMotion={() => setReduceMotion((v) => !v)}
        onResetCamera={() => canvasRef.current?.resetCamera()}
        onRemountCanvas={() => setCanvasMountKey((k) => k + 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 },
  back: { paddingVertical: 8, paddingRight: 8 },
  backText: { color: '#38BDF8', fontSize: 16, fontWeight: '600' },
  title: { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
  disclaimer: { color: '#64748B', fontSize: 11, paddingHorizontal: 12, marginBottom: 4 },
  canvasWrap: { flex: 1, minHeight: 240 },
  a11y: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    gap: 4,
  },
  a11yTitle: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  a11yBody: { color: '#F8FAFC', fontSize: 14 },
  a11yBtn: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#164E63', borderRadius: 6 },
  a11yBtnText: { color: '#E0F2FE', fontSize: 13, fontWeight: '600' },
});
