/**
 * Shared Map V2 geographic experience.
 *
 * Startup is WORLD with the inhabited-world camera. Türkiye is not forced.
 * Diagnostic chrome and the Harita command center both call this hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing } from 'react-native';

import { useEffectiveCompanyProgression } from '../../hooks/useEffectiveCompanyProgression';
import {
  isCanonicalProgressionEligibilityAllowed,
  resolveProgressionEligibilityAuthority,
} from '../../domain/canonicalProgressionEligibility';
import { useGameStore } from '../../store/gameStore';
import type { CameraSnapshot } from '../geo/worldCamera';
import {
  COUNTRY_ENTER_FADE_MS,
  COUNTRY_ENTER_WORLD_PADDING,
  COUNTRY_ENTER_ZOOM_MS,
  WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR,
  WORLD_NAV_MAX_SCALE_FACTOR,
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
import {
  buildLegacyAllUnlockedPolicies,
  buildTurkeyCityProgressionPreviewPolicies,
} from '../gameplay/cityProgression.preview.fixture';
import { resolveCountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { resolveCountryDisplayName } from '../presentation/countryDisplayName';
import { paintForCountryAvailability, paintForCountryDashboard } from '../presentation/countryPaint';
import { availabilityStatusLabel, mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';
import type { MapV2GeographicCanvasHandle } from '../world/MapV2GeographicCanvas';
import { gameplayIdForGeoCity, mappedGeoCityIds, turkeyOverviewGameplayCities } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';
import type { CountryModeTab } from '../screens/MapV2CountryModeTabs';

export const MAP_V2_EXPERIENCE_INITIAL_MODE = 'WORLD' as const;

const EMPTY_WAREHOUSES: never[] = [];
const EMPTY_TRUCKS: never[] = [];
const EMPTY_DELIVERIES: never[] = [];

export type MapV2CountrySelection = {
  geoCountryId: string | null;
  displayName: string | null;
};

export type MapV2CitySelection = {
  geoCityId: string | null;
  displayName: string | null;
  legacyCityId: string | null;
};

export type MapV2MarkerSelection = {
  markerId: string;
  kind: 'city' | 'country';
} | null;

export type MapV2RouteSelection = {
  routeId: string;
} | null;

export type MapV2GeographicExperienceOptions = {
  cityProgressionMode?: MapV2CityProgressionMode;
  railVisualPreview?: boolean;
  seaVisualPreview?: boolean;
  airVisualPreview?: boolean;
  emphasizeRoad?: boolean;
  showRailFoundation?: boolean;
  /** Diagnostic panel enters a country. Command center enters from a tap. */
  enterCountryOnSelect?: boolean;
  /** Full city-detail page stays diagnostic-only. */
  cityDetailEnabled?: boolean;
  handleHardwareBack?: boolean;
  onClose?: () => void;
  onCountrySelect?: (selection: MapV2CountrySelection) => void;
  onCitySelect?: (selection: MapV2CitySelection) => void;
  onRouteSelect?: (selection: MapV2RouteSelection) => void;
  onMarkerSelect?: (selection: MapV2MarkerSelection) => void;
};

export function useMapV2GeographicExperience(options: MapV2GeographicExperienceOptions = {}) {
  const {
    cityProgressionMode = MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
    railVisualPreview = false,
    seaVisualPreview = false,
    airVisualPreview = false,
    emphasizeRoad = false,
    showRailFoundation = false,
    enterCountryOnSelect = false,
    cityDetailEnabled = true,
    handleHardwareBack = false,
    onClose,
    onCountrySelect,
    onCitySelect,
    onRouteSelect,
    onMarkerSelect,
  } = options;

  const canvasRef = useRef<MapV2GeographicCanvasHandle>(null);
  const [mode, setMode] = useState<MapV2ExperienceMode>(MAP_V2_EXPERIENCE_INITIAL_MODE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCountryId, setFocusCountryId] = useState<string | null>(null);
  const [worldCamera, setWorldCamera] = useState<CameraSnapshot | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [countryTab, setCountryTab] = useState<CountryModeTab>('map');
  const [worldApproach, setWorldApproach] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCountrySelectRef = useRef(onCountrySelect);
  const onCitySelectRef = useRef(onCitySelect);
  const onRouteSelectRef = useRef(onRouteSelect);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  onCountrySelectRef.current = onCountrySelect;
  onCitySelectRef.current = onCitySelect;
  onRouteSelectRef.current = onRouteSelect;
  onMarkerSelectRef.current = onMarkerSelect;

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
    if (cityProgressionMode === 'LEGACY_ALL_UNLOCKED') {
      return buildLegacyAllUnlockedPolicies(homeCityId);
    }
    return buildTurkeyCityProgressionPreviewPolicies(homeCityId);
  }, [cityProgressionMode, homeCityId]);
  const cityProgression = useMemo(
    () =>
      evaluateCityProgression({
        mode: cityProgressionMode,
        snapshot: progressionSnapshot,
        policies: cityPolicies,
      }),
    [cityPolicies, cityProgressionMode, progressionSnapshot],
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
  const selectedCityLocked = selectedCityProgression ? !selectedCityProgression.canOpenDetail : false;
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
      if (!cityDetailEnabled) {
        setSelectedCityId(geoCityId);
        return;
      }
      if (!canEnterCityDetail(geoCityId, new Set(mappedGeoCityIds()))) return;
      const gameplayId = gameplayIdForGeoCity(geoCityId);
      const cityAvailability = gameplayId ? cityProgression.byCityId[gameplayId]?.availability : undefined;
      if (!canOpenCityOperations(geoCityId, new Set(mappedGeoCityIds()), cityAvailability)) return;
      setSelectedCityId(geoCityId);
      setMode('CITY_DETAIL');
    },
    [cityDetailEnabled, cityProgression],
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

  const onSelect = useCallback(
    (geoCountryId: string | null) => {
      if (mode === 'COUNTRY') return;
      setSelectedId(geoCountryId);
      if (!enterCountryOnSelect || !geoCountryId) return;
      const nextAvailability = resolveCountryGameplayAvailability(geoCountryId);
      if (canEnterCountryMode(nextAvailability)) {
        enterCountry(geoCountryId);
      }
    },
    [enterCountry, enterCountryOnSelect, mode],
  );

  useEffect(() => {
    if (!handleHardwareBack) return;
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
      if (onClose) {
        onClose();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [handleHardwareBack, mode, onClose, returnFromCityDetail, returnToWorld, selectedCityId, selectedId]);

  useEffect(() => {
    if (mode !== 'CITY_DETAIL') return;
    if (!cityDetailEnabled || !selectedOperation || selectedCityLocked) {
      setMode('COUNTRY');
    }
  }, [cityDetailEnabled, mode, selectedCityLocked, selectedOperation]);

  useEffect(() => {
    const record = selectedId ? getCountryRecord(selectedId) : undefined;
    const name = selectedId ? resolveCountryDisplayName(record, 'tr') : null;
    onCountrySelectRef.current?.({
      geoCountryId: selectedId,
      displayName: name && name.length > 0 ? name : null,
    });
    if (selectedId) {
      onMarkerSelectRef.current?.({ markerId: selectedId, kind: 'country' });
    }
  }, [selectedId]);

  useEffect(() => {
    const city = selectedCityId ? overviewCities.find((item) => item.geoCityId === selectedCityId) : undefined;
    const name = city ? resolveCityDisplayName(city, 'tr') : null;
    onCitySelectRef.current?.({
      geoCityId: selectedCityId,
      displayName: name && name.length > 0 ? name : null,
      legacyCityId: selectedCityId ? gameplayIdForGeoCity(selectedCityId) ?? null : null,
    });
    if (selectedCityId) {
      onMarkerSelectRef.current?.({ markerId: selectedCityId, kind: 'city' });
    }
  }, [overviewCities, selectedCityId]);

  const worldMaxScale = worldApproach ? WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR : WORLD_NAV_MAX_SCALE_FACTOR;
  const gameplayCityCount = focusCountryId === 'country.tur' ? mappedGeoCityIds().length : 0;
  const countryStatus = availabilityStatusLabel(
    focusCountryId ? resolveCountryGameplayAvailability(focusCountryId) : 'STARTER_AVAILABLE',
  );

  return {
    canvasRef,
    mode,
    selectedId,
    setSelectedId,
    focusCountryId,
    focusRecord,
    selected,
    availability,
    displayName,
    worldCamera,
    reduceMotion,
    selectedCityId,
    setSelectedCityId,
    countryTab,
    setCountryTab,
    worldApproach,
    fade,
    animate,
    overviewCities,
    homeCityId,
    warehouses,
    trucks,
    deliveries,
    selectedCity,
    operationsByGeoCityId,
    operationHints,
    selectedOperation,
    cityProgression,
    availabilityByGeoCityId,
    selectedCityProgression,
    selectedCityLocked,
    turkeyCityLayer,
    countryDrawIds,
    countryPanBounds,
    getCountryPaint,
    enterCountry,
    returnFromCityDetail,
    enterCityDetail,
    returnToWorld,
    onSelect,
    worldMaxScale,
    gameplayCityCount,
    countryStatus,
    railVisualPreview,
    seaVisualPreview,
    airVisualPreview,
    emphasizeRoad,
    showRailFoundation,
    onRouteSelect: onRouteSelectRef.current,
    mapV2ExperienceCopy,
  };
}

export type MapV2GeographicExperience = ReturnType<typeof useMapV2GeographicExperience>;
