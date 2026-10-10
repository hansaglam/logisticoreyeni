/**
 * MAP-01 Map V2 world experience (DEV / internal).
 *
 * Back contract:
 * - COUNTRY → WORLD, restoring the previous world camera when captured
 * - WORLD with a selection → deselect
 * - WORLD with no selection → close this experience (Simülasyon Testi), not the app
 * Android hardwareBackPress follows the same stack.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppDialog } from '../../components/AppDialogProvider';
import { IconButton, ScreenHeader } from '../../components/ui';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { useEffectiveCompanyProgression } from '../../hooks/useEffectiveCompanyProgression';
import {
  isCanonicalProgressionEligibilityAllowed,
  resolveProgressionEligibilityAuthority,
} from '../../domain/canonicalProgressionEligibility';
import { useGameStore } from '../../store/gameStore';
import { colors, radius, spacing, typography } from '../../theme';
import type { CameraSnapshot } from '../geo/worldCamera';
import {
  COUNTRY_ENTER_FADE_MS,
  COUNTRY_ENTER_WORLD_PADDING,
  COUNTRY_ENTER_ZOOM_MS,
  COUNTRY_OVERVIEW_MAX_SCALE_FACTOR,
  COUNTRY_OVERVIEW_MIN_SCALE_FACTOR,
  WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR,
  WORLD_NAV_MAX_SCALE_FACTOR,
  WORLD_MIN_SCALE_FACTOR,
} from '../geo/worldCamera';
import {
  canEnterCityDetail,
  canEnterCountryMode,
  countryFocusBounds,
  countryWorkingBounds,
  mapV2BackAction,
  type MapV2ExperienceMode,
} from '../gameplay/mapV2ExperienceNavigation';
import {
  buildCityOperationViewModel,
  cityNodeOperationHint,
  selectActiveDeliveriesByCity,
  selectOwnedTrucksByCity,
  selectWarehousesByCity,
  type CityNodeOperationHint,
  type CityOperationViewModel,
} from '../gameplay/cityOperation';
import {
  buildPlayerProgressionSnapshot,
  canOpenCityOperations,
  evaluateCityProgression,
  MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
  type MapV2CityProgressionMode,
} from '../gameplay/cityProgression';
import { isRailPlayerVisualPreviewEnabled } from '../gameplay/railPlayerVisual';
import { isSeaPlayerVisualPreviewEnabled } from '../gameplay/seaPlayerVisual';
import { isAirPlayerVisualPreviewEnabled } from '../gameplay/airPlayerVisual';
import {
  buildLegacyAllUnlockedPolicies,
  buildTurkeyCityProgressionPreviewPolicies,
} from '../gameplay/cityProgression.preview.fixture';
import { resolveCountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { resolveCountryDisplayName } from '../presentation/countryDisplayName';
import { paintForCountryAvailability, paintForCountryDashboard, MAP_V2_OCEAN } from '../presentation/countryPaint';
import { availabilityStatusLabel, mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';
import MapV2GeographicCanvas, { type MapV2GeographicCanvasHandle } from '../world/MapV2GeographicCanvas';
import { mappedGeoCityIds, gameplayIdForGeoCity, turkeyOverviewGameplayCities } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';
import MapV2CityDetailScreen from './MapV2CityDetailScreen';
import MapV2CityLockPanel from './MapV2CityLockPanel';
import MapV2CitySelectionPanel from './MapV2CitySelectionPanel';
import MapV2CountryCitiesPane from './MapV2CountryCitiesPane';
import MapV2CountryHeader from './MapV2CountryHeader';
import MapV2CountryModeTabs, { type CountryModeTab } from './MapV2CountryModeTabs';
import MapV2CountryOverviewShell from './MapV2CountryOverviewShell';
import MapV2CountrySelectionPanel from './MapV2CountrySelectionPanel';

type Props = {
  onClose: () => void;
  cityProgressionMode?: MapV2CityProgressionMode;
};

const EMPTY_WAREHOUSES: never[] = [];
const EMPTY_TRUCKS: never[] = [];
const EMPTY_DELIVERIES: never[] = [];

export default function MapV2WorldScreen({
  onClose,
  cityProgressionMode = MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
}: Props) {
  const { contentBottomPadding } = useTabBarLayout();
  const { width: windowWidth } = useWindowDimensions();
  const compactPhone = windowWidth < 360;
  const { showDialog } = useAppDialog();
  const canvasRef = useRef<MapV2GeographicCanvasHandle>(null);
  const [mode, setMode] = useState<MapV2ExperienceMode>('WORLD');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCountryId, setFocusCountryId] = useState<string | null>(null);
  const [worldCamera, setWorldCamera] = useState<CameraSnapshot | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [countryTab, setCountryTab] = useState<CountryModeTab>('map');
  const [progressionMode, setProgressionMode] = useState<MapV2CityProgressionMode>(cityProgressionMode);
  const [railVisualPreview, setRailVisualPreview] = useState(() => isRailPlayerVisualPreviewEnabled());
  const [seaVisualPreview, setSeaVisualPreview] = useState(() => isSeaPlayerVisualPreviewEnabled());
  const [airVisualPreview, setAirVisualPreview] = useState(() => isAirPlayerVisualPreviewEnabled());
  const [worldApproach, setWorldApproach] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overviewCities = useMemo(() => turkeyOverviewGameplayCities(), []);
  const homeCityId = useGameStore((state) => state.player?.homeCityId ?? null);
  const progressionPlayer = useGameStore((state) => state.player);
  const effectiveProgression = useEffectiveCompanyProgression(progressionPlayer);
  const progressionEligibility = resolveProgressionEligibilityAuthority({
    eligibilityGateEnabled: isCanonicalProgressionEligibilityAllowed(),
    progression: effectiveProgression,
    localLevel: Math.max(1, progressionPlayer?.level ?? progressionPlayer?.companyLevel ?? 1),
    localReputation: progressionPlayer?.reputation ?? 0,
  });
  const playerLevel =
    progressionEligibility.canEvaluate && progressionEligibility.level != null
      ? progressionEligibility.level
      : 0;
  const reputation =
    progressionEligibility.canEvaluate && progressionEligibility.reputation != null
      ? progressionEligibility.reputation
      : 0;
  const money = useGameStore((state) => state.player?.money ?? 0);
  const warehouses = useGameStore((state) => state.player?.warehouses) ?? EMPTY_WAREHOUSES;
  const trucks = useGameStore((state) => state.player?.trucks) ?? EMPTY_TRUCKS;
  const deliveries = useGameStore((state) => state.activeDeliveries) ?? EMPTY_DELIVERIES;
  const selectedCity = selectedCityId
    ? overviewCities.find((city) => city.geoCityId === selectedCityId)
    : undefined;
  const operationsByGeoCityId = useMemo(() => {
    const snapshot = { homeCityId, warehouses, trucks, deliveries };
    const next: Record<string, CityOperationViewModel> = {};
    for (const city of overviewCities) {
      const legacyCityId = gameplayIdForGeoCity(city.geoCityId);
      if (!legacyCityId) continue;
      next[city.geoCityId] = buildCityOperationViewModel({
        legacyCityId,
        geoCityId: city.geoCityId,
        displayName: resolveCityDisplayName(city, 'tr'),
        snapshot,
      });
    }
    return next;
  }, [deliveries, homeCityId, overviewCities, trucks, warehouses]);
  const operationHints = useMemo(() => {
    const next: Record<string, CityNodeOperationHint> = {};
    for (const [geoCityId, model] of Object.entries(operationsByGeoCityId)) {
      next[geoCityId] = cityNodeOperationHint(model);
    }
    return next;
  }, [operationsByGeoCityId]);
  const selectedOperation = selectedCityId ? operationsByGeoCityId[selectedCityId] : undefined;
  const progressionSnapshot = useMemo(
    () =>
      buildPlayerProgressionSnapshot({
        homeCityId,
        level: playerLevel,
        reputation,
        money,
        warehouses,
        trucks,
        deliveries,
      }),
    [deliveries, homeCityId, money, playerLevel, reputation, trucks, warehouses],
  );
  const cityPolicies = useMemo(() => {
    if (progressionMode === 'LEGACY_ALL_UNLOCKED') {
      return buildLegacyAllUnlockedPolicies(homeCityId);
    }
    return buildTurkeyCityProgressionPreviewPolicies(homeCityId);
  }, [homeCityId, progressionMode]);
  const cityProgression = useMemo(
    () =>
      evaluateCityProgression({
        mode: progressionMode,
        snapshot: progressionSnapshot,
        policies: cityPolicies,
      }),
    [cityPolicies, progressionMode, progressionSnapshot],
  );
  const availabilityByGeoCityId = useMemo(() => {
    const next: Record<string, (typeof cityProgression.byCityId)[string]['availability']> = {};
    for (const city of overviewCities) {
      const gameplayId = gameplayIdForGeoCity(city.geoCityId);
      if (!gameplayId) continue;
      const state = cityProgression.byCityId[gameplayId];
      if (state) next[city.geoCityId] = state.availability;
    }
    return next;
  }, [cityProgression, overviewCities]);
  const selectedGameplayId = selectedCityId ? gameplayIdForGeoCity(selectedCityId) : undefined;
  const selectedCityProgression = selectedGameplayId ? cityProgression.byCityId[selectedGameplayId] : undefined;
  const selectedCityLocked = selectedCityProgression
    ? !selectedCityProgression.canOpenDetail
    : false;
  const turkeyCityLayer = useMemo(() => {
    if (mode !== 'COUNTRY' || focusCountryId !== 'country.tur') return null;
    return {
      cities: overviewCities,
      selectedCityId,
      mappedGeoCityIds: mappedGeoCityIds(),
      showLegacyHalo: false,
      presentation: 'DASHBOARD' as const,
      operationHints,
      availabilityByGeoCityId,
      onSelectCity: setSelectedCityId,
      resolveLabel: (city: (typeof overviewCities)[number]) => resolveCityDisplayName(city, 'tr'),
    };
  }, [availabilityByGeoCityId, focusCountryId, mode, operationHints, overviewCities, selectedCityId]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (typeof value === 'boolean') setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => {
      sub?.remove?.();
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    };
  }, []);

  const selected = selectedId ? getCountryRecord(selectedId) : undefined;
  const availability = selectedId ? resolveCountryGameplayAvailability(selectedId) : null;
  const displayName = resolveCountryDisplayName(selected, 'tr');
  const focusRecord = focusCountryId ? getCountryRecord(focusCountryId) : undefined;
  const animate = !reduceMotion;

  const countryDrawIds = useMemo(() => {
    if (mode !== 'COUNTRY' || !focusCountryId) return null;
    return [focusCountryId];
  }, [focusCountryId, mode]);

  const countryPanBounds = useMemo(() => {
    if (mode !== 'COUNTRY' || !focusRecord) return null;
    return countryWorkingBounds(focusRecord, 'COUNTRY_HIGH');
  }, [focusRecord, mode]);

  const getCountryPaint = useCallback(
    (geoCountryId: string, isSelected: boolean) => {
      if (mode === 'COUNTRY') {
        return paintForCountryDashboard();
      }
      return paintForCountryAvailability(resolveCountryGameplayAvailability(geoCountryId), isSelected);
    },
    [mode],
  );

  const enterCountry = useCallback(
    (geoCountryId: string) => {
      const nextAvailability = resolveCountryGameplayAvailability(geoCountryId);
      if (!canEnterCountryMode(nextAvailability)) return;
      const snapshot = canvasRef.current?.captureCamera() ?? null;
      setWorldCamera(snapshot ? { ...snapshot } : null);
      setSelectedId(geoCountryId);
      setSelectedCityId(null);
      const commit = () => {
        setWorldApproach(false);
        setFocusCountryId(geoCountryId);
        setMode('COUNTRY');
      };
      if (!animate) {
        commit();
        return;
      }
      setWorldApproach(true);
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        Animated.timing(fade, {
          toValue: 1,
          duration: COUNTRY_ENTER_FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) return;
          commit();
          requestAnimationFrame(() => {
            Animated.timing(fade, {
              toValue: 0,
              duration: COUNTRY_ENTER_FADE_MS + 40,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }).start();
          });
        });
      }, COUNTRY_ENTER_ZOOM_MS);
    },
    [animate, fade],
  );

  const returnFromCityDetail = useCallback(() => {
    setMode('COUNTRY');
  }, []);

  const enterCityDetail = useCallback(
    (geoCityId: string) => {
      if (!canEnterCityDetail(geoCityId, new Set(mappedGeoCityIds()))) return;
      const gameplayId = gameplayIdForGeoCity(geoCityId);
      const availability = gameplayId ? cityProgression.byCityId[gameplayId]?.availability : undefined;
      if (!canOpenCityOperations(geoCityId, new Set(mappedGeoCityIds()), availability)) return;
      setSelectedCityId(geoCityId);
      setMode('CITY_DETAIL');
    },
    [cityProgression],
  );

  const returnToWorld = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    fade.setValue(0);
    setWorldApproach(false);
    setMode('WORLD');
    setFocusCountryId(null);
    setSelectedCityId(null);
    setCountryTab('map');
    requestAnimationFrame(() => {
      if (worldCamera) {
        canvasRef.current?.restoreCamera(worldCamera, animate);
      } else {
        canvasRef.current?.applyHome(animate);
      }
    });
  }, [animate, fade, worldCamera]);

  useEffect(() => {
    if (!worldApproach || mode !== 'WORLD' || !selectedId || !animate) return;
    const record = getCountryRecord(selectedId);
    if (!record) return;
    const frame = requestAnimationFrame(() => {
      canvasRef.current?.applyBounds(
        countryFocusBounds(record, 'COUNTRY_HIGH'),
        COUNTRY_ENTER_WORLD_PADDING,
        true,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [animate, mode, selectedId, worldApproach]);

  useEffect(() => {
    if (mode !== 'COUNTRY' || !focusCountryId || !focusRecord) return;
    const bounds = countryWorkingBounds(focusRecord, 'COUNTRY_HIGH');
    const frame = requestAnimationFrame(() => {
      canvasRef.current?.applyBounds(bounds, 0, false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusCountryId, focusRecord, mode]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = mapV2BackAction(mode, {
        selectedCityId,
        selectedCountryId: selectedId,
      });
      if (action === 'EXIT_CITY_DETAIL') {
        returnFromCityDetail();
        return true;
      }
      if (action === 'CLEAR_CITY_SELECTION') {
        setSelectedCityId(null);
        return true;
      }
      if (action === 'EXIT_COUNTRY') {
        returnToWorld();
        return true;
      }
      if (action === 'CLEAR_COUNTRY_SELECTION') {
        setSelectedId(null);
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mode, onClose, returnFromCityDetail, returnToWorld, selectedCityId, selectedId]);

  const onSelect = useCallback(
    (geoCountryId: string | null) => {
      if (mode === 'COUNTRY') return;
      setSelectedId(geoCountryId);
    },
    [mode],
  );

  const onPrimary = useCallback(() => {
    if (!selectedId || !availability) return;
    if (canEnterCountryMode(availability)) {
      enterCountry(selectedId);
      return;
    }
    if (availability === 'LOCKED') {
      showDialog({
        title: mapV2ExperienceCopy.requirementsTitle,
        message: mapV2ExperienceCopy.requirementsBody,
        confirmLabel: mapV2ExperienceCopy.closeSelection,
      });
    }
  }, [availability, enterCountry, selectedId, showDialog]);

  const onComingSoon = useCallback(() => {
    showDialog({
      title: mapV2ExperienceCopy.comingSoonTitle,
      message: mapV2ExperienceCopy.comingSoonBody,
      confirmLabel: mapV2ExperienceCopy.closeSelection,
    });
  }, [showDialog]);

  const onCountryDetails = useCallback(() => {
    showDialog({
      title: resolveCountryDisplayName(focusRecord, 'tr'),
      message: mapV2ExperienceCopy.countryOpsBody,
      confirmLabel: mapV2ExperienceCopy.closeSelection,
    });
  }, [focusRecord, showDialog]);

  const onCountryCta = useCallback(
    (action: 'cities' | 'contracts' | 'expand' | 'details') => {
      if (action === 'cities') {
        setCountryTab('cities');
        return;
      }
      if (action === 'details') {
        onCountryDetails();
        return;
      }
      onComingSoon();
    },
    [onComingSoon, onCountryDetails],
  );

  const headerTitle = mapV2ExperienceCopy.worldTitle;
  const headerSubtitle = mapV2ExperienceCopy.worldSubtitle;
  const gameplayCityCount = focusCountryId === 'country.tur' ? mappedGeoCityIds().length : 0;
  const worldMaxScale = worldApproach ? WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR : WORLD_NAV_MAX_SCALE_FACTOR;
  const countryStatus = availabilityStatusLabel(
    focusCountryId ? resolveCountryGameplayAvailability(focusCountryId) : 'STARTER_AVAILABLE',
  );

  useEffect(() => {
    if (mode !== 'CITY_DETAIL') return;
    if (!selectedOperation || selectedCityLocked) {
      setMode('COUNTRY');
    }
  }, [mode, selectedCityLocked, selectedOperation]);

  if (mode === 'CITY_DETAIL' && selectedOperation && !selectedCityLocked) {
    return (
      <View style={[styles.root, { paddingBottom: contentBottomPadding }, compactPhone && styles.rootNarrow]}>
        <MapV2CityDetailScreen
          model={selectedOperation}
          countryTitle={resolveCountryDisplayName(focusRecord, 'tr') || mapV2ExperienceCopy.cityCountryTurkey}
          warehouses={selectWarehousesByCity(warehouses, selectedOperation.legacyCityId)}
          trucks={selectOwnedTrucksByCity(trucks, selectedOperation.legacyCityId, homeCityId)}
          deliveries={selectActiveDeliveriesByCity(deliveries, selectedOperation.legacyCityId)}
          onBack={returnFromCityDetail}
          reduceMotion={reduceMotion}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        { paddingBottom: contentBottomPadding },
        compactPhone && styles.rootNarrow,
        mode === 'COUNTRY' && styles.rootCountry,
      ]}
    >
      {mode === 'COUNTRY' ? (
        <MapV2CountryHeader
          title={resolveCountryDisplayName(focusRecord, 'tr')}
          identityLine={mapV2ExperienceCopy.countryIdentityLine}
          onBack={returnToWorld}
        />
      ) : (
        <ScreenHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          onBack={onClose}
          compact
          rightAction={
            <IconButton
              icon="refresh"
              onPress={() => canvasRef.current?.applyHome(animate)}
              accessibilityLabel={mapV2ExperienceCopy.resetWorld}
              size={18}
            />
          }
        />
      )}
      {mode === 'COUNTRY' ? (
        <MapV2CountryModeTabs
          active={countryTab}
          onChange={(tab) => {
            setCountryTab(tab);
          }}
        />
      ) : null}
      <View
        style={[
          styles.canvasWrap,
          mode === 'COUNTRY' && styles.canvasWrapCountry,
          mode === 'COUNTRY' && selectedCityId ? styles.canvasWrapCountrySelected : null,
          mode === 'COUNTRY' && countryTab !== 'map' ? styles.canvasCollapsed : null,
        ]}
        pointerEvents={mode === 'COUNTRY' && countryTab !== 'map' ? 'none' : 'auto'}
      >
        <MapV2GeographicCanvas
          ref={canvasRef}
          selectedId={mode === 'COUNTRY' ? focusCountryId : selectedId}
          lodOverride={mode === 'COUNTRY' ? 'COUNTRY_HIGH' : 'AUTO'}
          cullEnabled={mode === 'WORLD'}
          onSelect={onSelect}
          getCountryPaint={getCountryPaint}
          homePolicy="INHABITED"
          maxScaleFactor={mode === 'COUNTRY' ? COUNTRY_OVERVIEW_MAX_SCALE_FACTOR : worldMaxScale}
          minScaleFactor={mode === 'COUNTRY' ? COUNTRY_OVERVIEW_MIN_SCALE_FACTOR : WORLD_MIN_SCALE_FACTOR}
          contentBounds={countryPanBounds}
          forcedDrawIds={countryDrawIds}
          hitTestIds={mode === 'COUNTRY' ? [] : null}
          cityLayer={turkeyCityLayer}
          playerCorridorLayer={
            mode === 'COUNTRY' && focusCountryId === 'country.tur'
              ? {
                  enabled: true,
                  availabilityByGeoCityId,
                  reduceMotion,
                }
              : null
          }
          playerRailCorridorLayer={
            mode === 'COUNTRY' && focusCountryId === 'country.tur' && railVisualPreview
              ? {
                  enabled: true,
                  availabilityByGeoCityId,
                  reduceMotion,
                }
              : null
          }
          playerSeaCorridorLayer={
            mode === 'COUNTRY' && focusCountryId === 'country.tur' && seaVisualPreview
              ? {
                  enabled: true,
                  availabilityByGeoCityId,
                  reduceMotion,
                }
              : null
          }
          playerAirCorridorLayer={
            mode === 'COUNTRY' && focusCountryId === 'country.tur' && airVisualPreview
              ? {
                  enabled: true,
                  availabilityByGeoCityId,
                  reduceMotion,
                }
              : null
          }
          elasticGestures={mode !== 'COUNTRY'}
          mapGesturesEnabled={mode !== 'COUNTRY'}
          countryVisualProfile={mode === 'COUNTRY' ? 'DASHBOARD' : 'DEFAULT'}
          viewportClip={mode === 'WORLD' ? 'ROUNDED' : 'NONE'}
        />
        <Animated.View pointerEvents="none" style={[styles.fade, { opacity: fade, backgroundColor: MAP_V2_OCEAN }]} />
      </View>
      {mode === 'COUNTRY' && __DEV__ ? (
        <View style={styles.devChips}>
          <Pressable
            onPress={() =>
              setProgressionMode((current) =>
                current === 'MAP_V2_PROGRESSION_PREVIEW' ? 'LEGACY_ALL_UNLOCKED' : 'MAP_V2_PROGRESSION_PREVIEW',
              )
            }
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              progressionMode === 'MAP_V2_PROGRESSION_PREVIEW'
                ? mapV2ExperienceCopy.cityProgressionPreviewOn
                : mapV2ExperienceCopy.cityProgressionPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {progressionMode === 'MAP_V2_PROGRESSION_PREVIEW'
                ? mapV2ExperienceCopy.cityProgressionPreviewOn
                : mapV2ExperienceCopy.cityProgressionPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setRailVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              railVisualPreview
                ? mapV2ExperienceCopy.railVisualPreviewOn
                : mapV2ExperienceCopy.railVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {railVisualPreview
                ? mapV2ExperienceCopy.railVisualPreviewOn
                : mapV2ExperienceCopy.railVisualPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSeaVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              seaVisualPreview ? mapV2ExperienceCopy.seaVisualPreviewOn : mapV2ExperienceCopy.seaVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {seaVisualPreview
                ? mapV2ExperienceCopy.seaVisualPreviewOn
                : mapV2ExperienceCopy.seaVisualPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAirVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              airVisualPreview ? mapV2ExperienceCopy.airVisualPreviewOn : mapV2ExperienceCopy.airVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {airVisualPreview
                ? mapV2ExperienceCopy.airVisualPreviewOn
                : mapV2ExperienceCopy.airVisualPreviewOff}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {mode === 'COUNTRY' && countryTab === 'cities' ? (
        <MapV2CountryCitiesPane
          cities={overviewCities}
          selectedCityId={selectedCityId}
          operationsByGeoCityId={operationsByGeoCityId}
          availabilityByGeoCityId={availabilityByGeoCityId}
          onSelect={setSelectedCityId}
          onInspect={enterCityDetail}
        />
      ) : null}
      {mode === 'COUNTRY' &&
      selectedCity &&
      selectedCityLocked &&
      selectedCityProgression &&
      (countryTab === 'map' || countryTab === 'cities') ? (
        <MapV2CityLockPanel
          displayName={resolveCityDisplayName(selectedCity, 'tr')}
          progression={selectedCityProgression}
          onClose={() => setSelectedCityId(null)}
        />
      ) : null}
      {mode === 'COUNTRY' && (countryTab === 'contracts' || countryTab === 'trade') ? (
        <View style={styles.soon}>
          <Text style={styles.soonTitle}>{mapV2ExperienceCopy.comingSoonTitle}</Text>
          <Text style={styles.soonBody}>{mapV2ExperienceCopy.comingSoonTabBody}</Text>
        </View>
      ) : null}
      {mode === 'COUNTRY' && countryTab === 'map' ? (
        <>
          {focusCountryId === 'country.tur' && selectedCity && !selectedCityLocked ? (
            <MapV2CitySelectionPanel
              displayName={resolveCityDisplayName(selectedCity, 'tr')}
              city={selectedCity}
              showDevFields={false}
              compactOps
              operation={selectedOperation}
              onClose={() => setSelectedCityId(null)}
              onInspect={selectedCityId ? () => enterCityDetail(selectedCityId) : undefined}
            />
          ) : null}
          <MapV2CountryOverviewShell
            countryTitle={resolveCountryDisplayName(focusRecord, 'tr')}
            statusLabel={countryStatus}
            totalCities={gameplayCityCount}
            openCityCount={cityProgression.country.unlockedCities}
            progressRatio={cityProgression.country.progressRatio}
            onCta={onCountryCta}
            railPreview={railVisualPreview}
            seaPreview={seaVisualPreview}
            airPreview={airVisualPreview}
          />
        </>
      ) : null}
      {mode === 'WORLD' && selected && availability ? (
        <MapV2CountrySelectionPanel
          displayName={displayName}
          availability={availability}
          onClose={() => setSelectedId(null)}
          onPrimary={onPrimary}
        />
      ) : null}
      {mode === 'WORLD' && !(selected && availability) ? (
        <Text style={styles.hint}>{mapV2ExperienceCopy.tapHint}</Text>
      ) : null}
      {mode === 'WORLD' ? (
        <View style={styles.legend} accessibilityRole="summary" accessibilityLabel={`${mapV2ExperienceCopy.worldLegendStarter}, ${mapV2ExperienceCopy.worldLegendOpen}, ${mapV2ExperienceCopy.worldLegendLocked}`}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchStarter]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendStarter}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchOpen]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendOpen}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchLocked]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendLocked}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.sm, gap: spacing.sm },
  rootCountry: { gap: spacing.sm },
  rootNarrow: { paddingHorizontal: spacing.xs, gap: spacing.sm },
  canvasWrap: {
    flex: 1,
    borderRadius: 36,
    overflow: 'hidden',
    minHeight: 220,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: '#020814',
  },
  canvasWrapCountry: {
    flex: 1.45,
    minHeight: 248,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(110, 180, 220, 0.34)',
    backgroundColor: '#020B14',
  },
  canvasWrapCountrySelected: {
    borderColor: 'rgba(186, 236, 255, 0.55)',
  },
  canvasCollapsed: { flex: 0, minHeight: 0, height: 0, borderWidth: 0 },
  soon: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  soonTitle: { ...typography.cardTitle, color: colors.textPrimary },
  soonBody: { ...typography.bodySmall, color: colors.textSecondary },
  fade: { ...StyleSheet.absoluteFillObject },
  hint: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  legend: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  swatchStarter: { backgroundColor: '#1A6F96', borderWidth: 1, borderColor: '#5EC8FF' },
  swatchOpen: { backgroundColor: '#155A7A', borderWidth: 1, borderColor: '#3A8FBF' },
  swatchLocked: { backgroundColor: '#0C1D2E', borderWidth: 1, borderColor: '#2A4258' },
  legendText: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  devChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  devChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  devChipText: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
});
