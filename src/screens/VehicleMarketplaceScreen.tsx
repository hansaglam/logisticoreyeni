import * as Crypto from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppTutorialHelpButton from '../components/tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../components/tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../components/tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../hooks/useScreenAppTutorial';
import { useTutorialLayoutReady } from '../hooks/useTutorialLayoutReady';
import { useAppDialog } from '../components/AppDialogProvider';
import MarketplaceFiltersSheet from '../components/marketplace/MarketplaceFiltersSheet';
import VehicleListingCreateSheet from '../components/marketplace/VehicleListingCreateSheet';
import MarketplaceHeader, {
  type MarketplaceStats,
} from '../components/marketplace/MarketplaceHeader';
import {
  MarketplaceHistory,
  MyVehicleListings,
} from '../components/marketplace/MarketplaceListingGroups';
import { MarketplaceListingSkeletonList } from '../components/marketplace/MarketplaceListingSkeleton';
import MarketplaceTabs from '../components/marketplace/MarketplaceTabs';
import VehicleListingCard, {
  getMarketplaceTruckName,
} from '../components/marketplace/VehicleListingCard';
import {
  VehicleListingDetailSheet,
  VehiclePurchaseConfirmSheet,
} from '../components/marketplace/VehicleMarketplaceSheets';
import { VEHICLE_MARKETPLACE_ENABLED } from '../config/backendRoadmap';
import {
  getMarketplaceKindMessage,
  getMarketplaceKindTitle,
  mapFailureReasonToMarketplaceKind,
} from '../domain/marketplaceErrorModel';
import {
  getVehicleMarketplaceEligibility,
} from '../domain/vehicleMarketplaceEligibility';
import {
  applyMarketplaceFetchError,
  applyMarketplaceFetchSuccess,
  beginMarketplaceRefresh,
  type MarketplaceScreenState,
} from '../domain/vehicleMarketplaceScreenState';
import {
  DEFAULT_MARKETPLACE_FILTERS,
  filterAndSortMarketplaceListings,
  getMarketplaceErrorMessage,
  hasActiveMarketplaceFilters,
  mergeMarketplacePage,
  type MarketplaceFilters,
  type MarketplaceTab,
} from '../domain/vehicleMarketplacePresentation';
import { subscribeAuthState } from '../services/authService';
import { getFirebaseAuthSafe } from '../services/firebase';
import { logMarketplaceAuthProbe } from '../utils/marketplaceAuthDiagnostics';
import {
  logMarketplaceLoadError,
  logMarketplaceSellAuthoritativeLookup,
  logMarketplaceSellLocal,
} from '../utils/marketplaceSellDiagnostics';
import {
  cancelVehicleListing,
  createVehicleListing,
  getMyVehicleListings,
  getVehicleMarketplaceListings,
  purchaseVehicleListing,
} from '../services/vehicleMarketplaceService';
import { useGameStore } from '../store/gameStore';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import { colors, spacing } from '../theme';
import type {
  VehicleMarketplaceCursor,
  VehicleMarketplaceFailureReason,
  VehicleMarketplaceListing,
} from '../types/vehicleMarketplace';
import { AppScreen, EmptyState, GameIcon } from '../components/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import {
  logMarketplaceDev,
  showAlertAfterModalClose,
} from '../utils/marketplaceUiSafety';
import { markStartup } from '../utils/startupPerformance';

const PAGE_SIZE = 20;

function actionEnvelope(prefix: string) {
  const id = Crypto.randomUUID();
  return {
    transactionId: `${prefix}-${id}`,
    idempotencyKey: `${prefix}-${id}`,
  };
}

function isLinkedMarketplaceUser(): boolean {
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  return Boolean(user && !user.isAnonymous);
}

export default function VehicleMarketplaceScreen({
  onBack,
}: {
  onBack: () => void;
}) {
  const { alert: showAlert } = useAppDialog();
  const { scrollBottomPadding } = useTabBarLayout();
  const player = useGameStore((state) => state.player);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries);
  const activeTransfers = useGameStore((state) => state.activeTransfers);
  const applyReconciliation = useGameStore(
    (state) => state.applyVehicleMarketplaceReconciliation,
  );
  const pendingSellTruckId = useGameStore(
    (state) => state.pendingMarketplaceSellTruckId,
  );
  const clearPendingSellTruckId = useGameStore(
    (state) => state.clearPendingMarketplaceSellTruckId,
  );
  const [activeTab, setActiveTab] = useState<MarketplaceTab>('available');
  const [screenState, setScreenState] = useState<MarketplaceScreenState>({ status: 'idle' });
  const [myListings, setMyListings] = useState<VehicleMarketplaceListing[]>([]);
  const [myListingsError, setMyListingsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<VehicleMarketplaceCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [fleetLimit, setFleetLimit] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [filters, setFilters] = useState<MarketplaceFilters>(DEFAULT_MARKETPLACE_FILTERS);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selected, setSelected] = useState<VehicleMarketplaceListing | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<VehicleMarketplaceListing | null>(null);
  const [isBuyingVehicle, setIsBuyingVehicle] = useState(false);
  const [isDeletingListing, setIsDeletingListing] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [isCreatingListing, setIsCreatingListing] = useState(false);
  const { layoutReady, markLayoutReady } = useTutorialLayoutReady();
  const requestSeqRef = useRef(0);
  const lastAuthUidRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<VehicleMarketplaceListing>>(null);

  const listings = useMemo(() => {
    if (screenState.status === 'ready' || screenState.status === 'refreshing') {
      return screenState.listings;
    }
    return [];
  }, [screenState]);

  const marketplaceTutorial = useScreenAppTutorial({
    tutorialId: 'vehicle-marketplace',
    layoutReady,
    blockingModals:
      filtersVisible ||
      selected != null ||
      purchaseTarget != null ||
      createVisible,
    stepOptions: { hasListings: listings.length > 0 },
  });

  const isInitialLoading = screenState.status === 'idle' || screenState.status === 'loading';
  const isRefreshing = screenState.status === 'refreshing';
  const isUnavailable = screenState.status === 'error';
  const unavailableKind = screenState.status === 'error' ? screenState.error : null;

  const closeCreateSheet = useCallback(() => {
    logMarketplaceDev('create sheet close');
    setCreateVisible(false);
    setIsCreatingListing(false);
    clearPendingSellTruckId();
  }, [clearPendingSellTruckId]);

  const closeBlockingSheets = useCallback(() => {
    if (createVisible && !isCreatingListing) {
      closeCreateSheet();
      return true;
    }
    if (filtersVisible) {
      setFiltersVisible(false);
      return true;
    }
    if (selected != null) {
      setSelected(null);
      return true;
    }
    if (purchaseTarget != null && !isBuyingVehicle) {
      setPurchaseTarget(null);
      return true;
    }
    return false;
  }, [
    closeCreateSheet,
    createVisible,
    filtersVisible,
    isBuyingVehicle,
    isCreatingListing,
    purchaseTarget,
    selected,
  ]);

  const handleBack = useCallback(() => {
    logMarketplaceDev('back pressed', {
      createVisible,
      filtersVisible,
      selected: selected?.id ?? null,
      purchaseTarget: purchaseTarget?.id ?? null,
      isCreatingListing,
      isBuyingVehicle,
      screenStatus: screenState.status,
    });
    if (isCreatingListing || isBuyingVehicle) {
      return;
    }
    if (closeBlockingSheets()) return;
    onBack();
  }, [
    closeBlockingSheets,
    createVisible,
    filtersVisible,
    isBuyingVehicle,
    isCreatingListing,
    onBack,
    purchaseTarget,
    screenState.status,
    selected,
  ]);

  useEffect(() => {
    logMarketplaceDev('OPEN');
    void logMarketplaceAuthProbe('screen-open', {
      screenStatus: screenState.status,
    });
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isCreatingListing || isBuyingVehicle) {
        return true;
      }
      if (closeBlockingSheets()) {
        return true;
      }
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [closeBlockingSheets, isBuyingVehicle, isCreatingListing, onBack]);

  const resetMarketplaceData = useCallback(() => {
    setScreenState({ status: 'idle' });
    setMyListings([]);
    setMyListingsError(null);
    setCursor(undefined);
    setHasMore(false);
    setFleetLimit(null);
    setSelected(null);
    setPurchaseTarget(null);
  }, []);

  const syncMineAndReconcile = useCallback(async (): Promise<{
    ok: boolean;
    reason?: string;
  }> => {
    const result = await getMyVehicleListings();
    if (!result.ok) {
      setMyListings([]);
      setMyListingsError(result.reason ?? 'service-unavailable');
      return { ok: false, reason: result.reason };
    }
    setMyListings(result.listings);
    setMyListingsError(null);
    if (result.reconciliation) {
      applyReconciliation(result.reconciliation);
      setFleetLimit(
        Number.isFinite(result.reconciliation.fleetLimit)
          ? Number(result.reconciliation.fleetLimit)
          : null,
      );
    }
    return { ok: true };
  }, [applyReconciliation]);

  const loadFirstPage = useCallback(async (): Promise<{
    ok: boolean;
    reason?: string;
    listings?: VehicleMarketplaceListing[];
  }> => {
    const page = await getVehicleMarketplaceListings(PAGE_SIZE);
    if (!page.ok) {
      setHasMore(false);
      setCursor(undefined);
      return { ok: false, reason: page.reason };
    }
    const merged = mergeMarketplacePage([], page);
    setCursor(page.nextCursor);
    setHasMore(page.hasMore);
    return { ok: true, listings: merged };
  }, []);

  const refreshAll = useCallback(async (options?: { isRetry?: boolean }) => {
    const requestSeq = ++requestSeqRef.current;
    setScreenState((current) => beginMarketplaceRefresh(current));
    if (options?.isRetry) setRetrying(true);

    try {
      if (!isLinkedMarketplaceUser()) {
        if (requestSeq !== requestSeqRef.current) return;
        logMarketplaceDev('listings load failed', { reason: 'auth-required' });
        void logMarketplaceAuthProbe('screen-gate-blocked', {
          gate: 'isLinkedMarketplaceUser',
          condition: '!(currentUser && !currentUser.isAnonymous)',
        });
        setScreenState(
          applyMarketplaceFetchError(
            mapFailureReasonToMarketplaceKind('auth-required'),
          ),
        );
        setMyListings([]);
        setMyListingsError('auth-required');
        return;
      }

      const [publicResult, myResult] = await Promise.all([
        loadFirstPage(),
        syncMineAndReconcile(),
      ]);

      if (requestSeq !== requestSeqRef.current) return;

      if (!publicResult.ok) {
        logMarketplaceLoadError({
          code: publicResult.reason ?? 'unknown',
          message: getMarketplaceKindMessage(
            mapFailureReasonToMarketplaceKind(
              publicResult.reason as VehicleMarketplaceFailureReason | undefined,
            ),
          ),
          callableName: 'getVehicleMarketplaceListings',
        });
        logMarketplaceDev('listings load failed', {
          reason: publicResult.reason ?? 'unknown',
          kind: mapFailureReasonToMarketplaceKind(
            publicResult.reason as VehicleMarketplaceFailureReason | undefined,
          ),
        });
        void logMarketplaceAuthProbe('public-listings-failed', {
          reason: publicResult.reason ?? 'unknown',
          mappedKind: mapFailureReasonToMarketplaceKind(
            publicResult.reason as VehicleMarketplaceFailureReason | undefined,
          ),
        });
        setScreenState(
          applyMarketplaceFetchError(
            mapFailureReasonToMarketplaceKind(
              publicResult.reason as VehicleMarketplaceFailureReason | undefined,
            ),
          ),
        );
        return;
      }

      setScreenState(applyMarketplaceFetchSuccess(publicResult.listings ?? []));
      if (
        !myResult.ok &&
        (myResult.reason === 'auth-required' || myResult.reason === 'unauthenticated')
      ) {
        logMarketplaceDev('my listings auth failed', { reason: myResult.reason });
        void logMarketplaceAuthProbe('my-listings-auth-failed', {
          reason: myResult.reason,
        });
        setScreenState(
          applyMarketplaceFetchError(
            mapFailureReasonToMarketplaceKind('auth-required'),
          ),
        );
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setRetrying(false);
      }
    }
  }, [loadFirstPage, syncMineAndReconcile]);

  useEffect(() => {
    if (!VEHICLE_MARKETPLACE_ENABLED) return;
    markStartup('MARKETPLACE_INIT_START');
    void refreshAll().finally(() => {
      markStartup('MARKETPLACE_INIT_DONE');
    });
  }, [refreshAll]);

  useEffect(() => {
    if (!VEHICLE_MARKETPLACE_ENABLED) return;
    const unsub = subscribeAuthState((user) => {
      const uid = user && !user.isAnonymous ? user.uid : null;
      void logMarketplaceAuthProbe('auth-state-changed', {
        callbackUid: user?.uid ?? null,
        callbackIsAnonymous: user?.isAnonymous ?? null,
        linkedUid: uid,
        lastLinkedUid: lastAuthUidRef.current,
        skippedBecauseUnchanged: lastAuthUidRef.current === uid,
      });
      if (lastAuthUidRef.current === uid) return;
      lastAuthUidRef.current = uid;
      resetMarketplaceData();
      void refreshAll();
    });
    return unsub;
  }, [refreshAll, resetMarketplaceData]);

  useEffect(() => {
    if (!VEHICLE_MARKETPLACE_ENABLED || !pendingSellTruckId) return;
    logMarketplaceDev('pending sell open', { truckId: pendingSellTruckId });
    setActiveTab('mine');
    setCreateVisible(true);
  }, [pendingSellTruckId]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore || activeTab !== 'available' || isUnavailable) return;
    setLoadingMore(true);
    try {
      const page = await getVehicleMarketplaceListings(PAGE_SIZE, cursor);
      if (page.ok) {
        const merged = mergeMarketplacePage(listings, page);
        setScreenState(applyMarketplaceFetchSuccess(merged));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } else {
        logMarketplaceDev('load more failed', { reason: page.reason });
        // Keep existing listings visible; do not lock the whole screen on pagination failure.
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const onRefresh = async () => {
    if (retrying || isRefreshing) return;
    await refreshAll({ isRetry: true });
  };

  const activeMine = useMemo(
    () => myListings.filter((listing) => listing.status === 'active'),
    [myListings],
  );
  const history = useMemo(
    () => myListings.filter((listing) => listing.status !== 'active'),
    [myListings],
  );
  const visibleListings = useMemo(
    () => filterAndSortMarketplaceListings(listings, filters, getMarketplaceTruckName),
    [filters, listings],
  );
  const filtersActive = useMemo(() => hasActiveMarketplaceFilters(filters), [filters]);
  const stats = useMemo<MarketplaceStats>(() => {
    const prices = listings
      .map((listing) => listing.askingPrice)
      .filter((price) => Number.isFinite(price));
    return {
      activeListings: listings.length,
      averagePrice:
        prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
      modelCount: new Set(listings.map((listing) => listing.truckSnapshot.templateId)).size,
      myListings: activeMine.length,
    };
  }, [activeMine.length, listings]);

  const eligibilityContext = useMemo(
    () => ({
      trucks: player.trucks,
      drivers: player.drivers,
      trailers: player.trailers,
      activeDeliveries,
      activeTransfers,
      activeListingTruckIds: activeMine.map((listing) => listing.truckSnapshot.truckId),
    }),
    [activeDeliveries, activeMine, activeTransfers, player.drivers, player.trailers, player.trucks],
  );

  const canCreateListing = useMemo(
    () =>
      player.trucks.some(
        (truck) => getVehicleMarketplaceEligibility(truck.id, eligibilityContext).eligible,
      ),
    [eligibilityContext, player.trucks],
  );

  const beginPurchase = (listing: VehicleMarketplaceListing) => {
    const uid = getFirebaseAuthSafe()?.currentUser?.uid;
    if (uid && listing.sellerUid === uid) {
      showAlert('Satın alma yapılamadı', getMarketplaceErrorMessage('self-purchase'));
      return;
    }
    setSelected(null);
    setPurchaseTarget(listing);
  };

  const confirmPurchase = async () => {
    if (!purchaseTarget || isBuyingVehicle) return;
    setIsBuyingVehicle(true);
    try {
      const result = await purchaseVehicleListing({
        ...actionEnvelope('marketplace-purchase'),
        listingId: purchaseTarget.id,
        listingVersion: purchaseTarget.version,
        quotedPrice: purchaseTarget.askingPrice,
      });
      if (!result.ok) {
        setPurchaseTarget(null);
        showAlertAfterModalClose(
          showAlert,
          'Satın alma tamamlanamadı',
          getMarketplaceErrorMessage(result.reason),
        );
        if (result.reason === 'listing-not-active' || result.reason === 'stale-listing-version') {
          await onRefresh();
        }
        return;
      }
      await refreshAll();
      setPurchaseTarget(null);
      showAlertAfterModalClose(
        showAlert,
        'Satın alma tamamlandı',
        'Araç authoritative pazar kaydından filona aktarıldı.',
      );
    } finally {
      setIsBuyingVehicle(false);
    }
  };

  const requestCancel = (listing: VehicleMarketplaceListing) => {
    showAlert('İlan iptal edilsin mi?', 'Araç yeniden boşta duruma dönecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et',
        style: 'destructive',
        onPress: () => void performCancel(listing),
      },
    ]);
  };

  const performCancel = async (listing: VehicleMarketplaceListing) => {
    if (isDeletingListing) return;
    setIsDeletingListing(listing.id);
    try {
      const result = await cancelVehicleListing({
        ...actionEnvelope('marketplace-cancel'),
        listingId: listing.id,
        listingVersion: listing.version,
      });
      if (!result.ok) {
        showAlert('İlan iptal edilemedi', getMarketplaceErrorMessage(result.reason));
      } else {
        await refreshAll();
      }
    } finally {
      setIsDeletingListing(null);
    }
  };

  const performCreate = async (truck: (typeof player.trucks)[number], askingPrice: number) => {
    if (isCreatingListing) return;

    await logMarketplaceSellLocal(truck);
    const uid = getFirebaseAuthSafe()?.currentUser?.uid ?? null;
    const mineProbe = await getMyVehicleListings();
    const availableVehicleIds = (mineProbe.reconciliation?.vehicles ?? []).map(
      (vehicle) => vehicle.truckId,
    );
    logMarketplaceSellAuthoritativeLookup({
      uid,
      requestedVehicleId: truck.id,
      availableVehicleIds,
      source: mineProbe.ok
        ? 'getMyVehicleListings.reconciliation.vehicles'
        : `getMyVehicleListings-failed:${mineProbe.reason ?? 'unknown'}`,
    });

    const eligibility = getVehicleMarketplaceEligibility(truck.id, eligibilityContext);
    logMarketplaceDev('Sell Vehicle eligibility', {
      vehicleId: truck.id,
      vehicleStatus: truck.status,
      eligible: eligibility.eligible,
      reason: eligibility.reason ?? null,
    });
    if (!eligibility.eligible) {
      logMarketplaceDev('Sell Vehicle validation failed', { reason: eligibility.reason });
      // Keep sheet open; show inline-safe alert AFTER closing sheet to avoid nested Modals.
      closeCreateSheet();
      showAlertAfterModalClose(showAlert, 'İlan oluşturulamadı', eligibility.message);
      return;
    }

    setIsCreatingListing(true);
    logMarketplaceDev('Sell Vehicle isCreatingListing', { value: true });
    try {
      const result = await createVehicleListing({
        ...actionEnvelope('marketplace-create'),
        truckId: truck.id,
        askingPrice,
        clientSaveVersion: SAVE_GAME_VERSION,
      });
      if (!result.ok) {
        logMarketplaceDev('Sell Vehicle create failed', { reason: result.reason });
        closeCreateSheet();
        showAlertAfterModalClose(
          showAlert,
          'İlan oluşturulamadı',
          getMarketplaceErrorMessage(result.reason),
          [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Tekrar Dene',
              onPress: () => {
                void performCreate(truck, askingPrice);
              },
            },
          ],
        );
        return;
      }
      await refreshAll();
      closeCreateSheet();
      setActiveTab('mine');
      showAlertAfterModalClose(
        showAlert,
        'İlan oluşturuldu',
        'Araç backend tarafından kilitlendi ve pazarda yayınlandı.',
      );
    } finally {
      setIsCreatingListing(false);
      logMarketplaceDev('Sell Vehicle cleanup completed');
    }
  };

  if (!VEHICLE_MARKETPLACE_ENABLED) {
    return (
      <AppScreen>
        <MarketplaceHeader
          onBack={handleBack}
          stats={{ activeListings: 0, averagePrice: null, modelCount: 0, myListings: 0 }}
        />
        <EmptyState
          title="Araç Pazarı şu anda kullanılamıyor."
          message="Canlı doğrulama tamamlandığında bu alan kullanıma açılacak."
          icon="lock"
        />
      </AppScreen>
    );
  }

  const showAvailableEmpty =
    !isInitialLoading &&
    !isUnavailable &&
    activeTab === 'available' &&
    screenState.status === 'empty';
  const showFilteredEmpty =
    !isInitialLoading &&
    !isUnavailable &&
    activeTab === 'available' &&
    screenState.status === 'ready' &&
    visibleListings.length === 0;

  return (
    <View style={styles.screenRoot}>
      <AppScreen padding={false} reserveTabBarSpace={false}>
        <FlatList
          ref={listRef}
          data={activeTab === 'available' && !isUnavailable ? visibleListings : []}
          keyExtractor={(item) => item.id}
          onLayout={markLayoutReady}
          onScroll={marketplaceTutorial.handleScroll}
          onScrollEndDrag={marketplaceTutorial.handleScrollEnd}
          onMomentumScrollEnd={marketplaceTutorial.handleScrollEnd}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => {
            const listingCard = (
              <VehicleListingCard
                listing={item}
                onDetail={() => setSelected(item)}
                onPurchase={() => beginPurchase(item)}
              />
            );

            if (index === 0) {
              return (
                <AppTutorialTarget tutorialId="vehicle-marketplace" targetId="listings" layoutMode="stretch">
                  {listingCard}
                </AppTutorialTarget>
              );
            }

            return listingCard;
          }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accentBlue}
          />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={
          <>
            <MarketplaceHeader
              stats={stats}
              onBack={handleBack}
              loading={isInitialLoading || isRefreshing}
              onCreateListing={() => setCreateVisible(true)}
              helpAction={<AppTutorialHelpButton {...marketplaceTutorial.helpButtonProps} />}
            />
            <MarketplaceTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              counts={{
                available: listings.length,
                mine: activeMine.length,
                history: history.length,
              }}
            />
            {activeTab === 'available' ? (
              <View style={styles.toolbar}>
                <Text style={styles.resultText}>
                  {isInitialLoading ? 'Yükleniyor…' : `${visibleListings.length} araç gösteriliyor`}
                </Text>
                <AppTutorialTarget tutorialId="vehicle-marketplace" targetId="filters" layoutMode="stretch">
                  <TouchableOpacity style={styles.filterButton} onPress={() => setFiltersVisible(true)}>
                    <GameIcon name="filter" size={16} color={colors.accentBlue} />
                    <Text style={styles.filterText}>Filtreler</Text>
                    {filtersActive ? <View style={styles.filterDot} /> : null}
                  </TouchableOpacity>
                </AppTutorialTarget>
              </View>
            ) : activeTab === 'mine' ? (
              <View style={styles.toolbar}>
                <Text style={styles.resultText}>{activeMine.length} aktif ilan</Text>
                <TouchableOpacity style={styles.filterButton} onPress={() => setCreateVisible(true)}>
                  <GameIcon name="plus" size={16} color={colors.accentBlue} />
                  <Text style={styles.filterText}>Araç Sat</Text>
                </TouchableOpacity>
              </View>
            ) : <View style={styles.tabGap} />}
            {isInitialLoading ? <MarketplaceListingSkeletonList count={3} /> : null}
            {isUnavailable && unavailableKind ? (
              <EmptyState
                title={getMarketplaceKindTitle(unavailableKind)}
                message={getMarketplaceKindMessage(unavailableKind)}
                actionLabel={
                  unavailableKind === 'unauthenticated' ? undefined : 'Tekrar Dene'
                }
                onAction={
                  unavailableKind === 'unauthenticated' || retrying
                    ? undefined
                    : () => void onRefresh()
                }
                icon={unavailableKind === 'unauthenticated' ? 'lock' : 'warning'}
                compact
              />
            ) : null}
            {showAvailableEmpty ? (
              <EmptyState
                title="Aktif ilan bulunmuyor."
                message="Oyuncular araçlarını satışa çıkardığında burada görebilirsin."
                actionLabel={canCreateListing ? 'Aracını Satışa Çıkar' : undefined}
                onAction={canCreateListing ? () => setCreateVisible(true) : undefined}
                icon="truck"
                compact
              />
            ) : null}
            {showFilteredEmpty ? (
              <EmptyState
                title="Filtrelere uygun ilan yok."
                message="Filtreleri temizleyerek tüm aktif ilanları görebilirsin."
                actionLabel="Filtreleri Temizle"
                onAction={() => setFilters(DEFAULT_MARKETPLACE_FILTERS)}
                icon="filter"
                compact
              />
            ) : null}
            {activeTab === 'mine' && !isInitialLoading && !isUnavailable ? (
              myListingsError === 'marketplace-state-missing' ? (
                <EmptyState
                  title="İlanlarım hazırlanıyor"
                  message={getMarketplaceErrorMessage('marketplace-state-missing')}
                  icon="time"
                  compact
                />
              ) : (
                <AppTutorialTarget tutorialId="vehicle-marketplace" targetId="my-listings" layoutMode="stretch">
                  <MyVehicleListings
                    listings={activeMine}
                    cancellingId={isDeletingListing}
                    onDetail={setSelected}
                    onCancel={requestCancel}
                    onSellVehicle={() => setCreateVisible(true)}
                  />
                </AppTutorialTarget>
              )
            ) : null}
            {activeTab === 'history' && !isInitialLoading && !isUnavailable ? (
              <MarketplaceHistory listings={history} />
            ) : null}
          </>
        }
        ListFooterComponent={
          loadingMore ? <MarketplaceListingSkeletonList count={1} /> : null
        }
      />
      <MarketplaceFiltersSheet
        visible={filtersVisible}
        filters={filters}
        onApply={setFilters}
        onClose={() => setFiltersVisible(false)}
      />
      <VehicleListingCreateSheet
        visible={createVisible}
        trucks={player.trucks}
        creating={isCreatingListing}
        eligibilityContext={eligibilityContext}
        initialTruckId={pendingSellTruckId}
        onClose={closeCreateSheet}
        onCreate={(truck, askingPrice) => void performCreate(truck, askingPrice)}
      />
      <VehicleListingDetailSheet
        listing={selected}
        ownListing={selected ? activeMine.some((item) => item.id === selected.id) : false}
        onClose={() => setSelected(null)}
        onPurchase={() => selected && beginPurchase(selected)}
      />
      <VehiclePurchaseConfirmSheet
        listing={purchaseTarget}
        cash={player.money}
        fleetCount={player.trucks.length}
        fleetLimit={fleetLimit}
        purchasing={isBuyingVehicle}
        onClose={() => {
          if (isBuyingVehicle) return;
          setPurchaseTarget(null);
        }}
        onConfirm={() => void confirmPurchase()}
      />
      </AppScreen>
      <AppTutorialOverlay {...marketplaceTutorial.overlayProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  content: { paddingHorizontal: spacing.lg },
  separator: { height: spacing.md },
  toolbar: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: spacing.sm,
  },
  resultText: { color: colors.textMuted, fontSize: 11 },
  filterButton: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.accentBlueSoft,
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  filterText: { color: colors.accentBlue, fontSize: 11, fontWeight: '800' },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentBlue,
    marginLeft: 2,
  },
  tabGap: { height: spacing.md },
});
