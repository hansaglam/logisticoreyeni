import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import { GameIcon } from '../../ui';
import MapBottomKpiBar from './MapBottomKpiBar';
import MapCommandRail from './MapCommandRail';
import MapContextualInspector from './MapContextualInspector';
import MapTopStatusBar from './MapTopStatusBar';
import { resolveMapCommandMode, type MapCommandMode } from './mapCommandMode';
import type { MapCommandTelemetry } from './mapCommandTelemetry';
import { mapUiTheme, resolveMapChrome, resolveMapLayoutBand } from './mapUiTheme';

interface MapCommandCenterShellProps {
  mode: MapCommandMode;
  telemetry: MapCommandTelemetry;
  helpSlot?: React.ReactNode;
  onModeChange: (mode: MapCommandMode) => void;
  onExit: () => void;
  locationLabel?: string | null;
  children: React.ReactNode;
}

function MapCommandCenterShell({
  mode,
  telemetry,
  helpSlot,
  onModeChange,
  onExit,
  locationLabel,
  children,
}: MapCommandCenterShellProps) {
  const safeMode = resolveMapCommandMode(mode);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const band = resolveMapLayoutBand(width);
  const chrome = useMemo(() => resolveMapChrome(band), [band]);
  const [inspectorOpen, setInspectorOpen] = useState(band !== 'compact');
  const bandRef = useRef(band);
  const loggedLayoutRef = useRef(false);

  useEffect(() => {
    if (bandRef.current === band) return;
    bandRef.current = band;
    setInspectorOpen(band !== 'compact');
  }, [band]);

  useEffect(() => {
    if (!__DEV__ || loggedLayoutRef.current || width < height) return;
    loggedLayoutRef.current = true;
    console.log('[map-command-center] layout', {
      windowWidth: width,
      windowHeight: height,
      safeTop: insets.top,
      safeBottom: insets.bottom,
      safeLeft: insets.left,
      safeRight: insets.right,
      band,
    });
  }, [band, height, insets.bottom, insets.left, insets.right, insets.top, width]);

  const showInspector = inspectorOpen;
  const inspectorOverlay = chrome.inspectorMode === 'overlay';

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      pointerEvents="box-none"
    >
      <MapTopStatusBar helpSlot={helpSlot} showCompanyName={band === 'wide'} />
      <View style={styles.body} pointerEvents="box-none">
        <MapCommandRail
          mode={safeMode}
          width={chrome.railWidth}
          showLabels={chrome.showRailLabels}
          showStatus={band === 'wide'}
          onModeChange={(next) => onModeChange(resolveMapCommandMode(next))}
          onExit={onExit}
        />
        <View style={styles.viewport} pointerEvents="box-none">
          <View style={styles.mapSlot} pointerEvents="auto">
            {children}
          </View>
          {showInspector && inspectorOverlay ? (
            <MapContextualInspector
            mode={safeMode}
            telemetry={telemetry}
            width={chrome.inspectorWidth}
            overlay
            locationLabel={locationLabel}
            onClose={() => setInspectorOpen(false)}
            />
          ) : null}
          {!showInspector ? (
            <Pressable
              style={styles.inspectorToggle}
              onPress={() => setInspectorOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Özeti göster"
              accessibilityState={{ selected: false }}
            >
              <GameIcon name="back" size={16} color={mapUiTheme.cyanPrimary} />
            </Pressable>
          ) : null}
        </View>
        {showInspector && !inspectorOverlay ? (
          <MapContextualInspector
            mode={safeMode}
            telemetry={telemetry}
            width={chrome.inspectorWidth}
            overlay={false}
            locationLabel={locationLabel}
            onClose={() => setInspectorOpen(false)}
          />
        ) : null}
      </View>
      <MapBottomKpiBar telemetry={telemetry} scroll={band === 'compact'} />
    </View>
  );
}

export default React.memo(MapCommandCenterShell);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    backgroundColor: mapUiTheme.background,
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 0,
    minWidth: 0,
  },
  viewport: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  mapSlot: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  inspectorToggle: {
    position: 'absolute',
    right: 0,
    top: mapUiTheme.space8,
    zIndex: 3,
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mapUiTheme.surfaceGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.border,
    borderTopLeftRadius: mapUiTheme.smallRadius,
    borderBottomLeftRadius: mapUiTheme.smallRadius,
  },
});
