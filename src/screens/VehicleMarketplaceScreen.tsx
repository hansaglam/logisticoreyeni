import * as Crypto from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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
  DEFAULT_MARKETPLACE_FILTERS,
  filterAndSortMarketplaceListings,
  getMarketplaceErrorMessage,
  mergeMarketplacePage,
  type MarketplaceFilters,
  type MarketplaceTab,
} from '../domain/vehicleMarketplacePresentation';
import {
  cancelVehicleListing,
  createVehicleListing,
  getMyVehicleListings,
  getVehicleMarketplaceListings,
  purchaseVehicleListing,
} from '../services/vehicleMarketplaceService';
import { getFirebaseAuthSafe } from '../services/firebase';
import { useGameStore } from '../store/gameStore';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import { colors, spacing } from '../theme';
import type {
  VehicleMarketplaceCursor,
  VehicleMarketplaceListing,
} from '../types/vehicleMarketplace';
import { AppScreen, EmptyState, GameIcon } from '../components/ui';

const PAGE_SIZE = 20;

function actionEnvelope(prefix: string) {
  const id = Crypto.randomUUID();
  return {
    transactionId: `${prefix}-${id}`,
    idempotencyKey: `${prefix}-${id}`,
  };
}

export default function VehicleMarketplaceScreen({
  onBack,
}: {
  onBack: () => void;
}) {
  const { alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
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
  const [listings, setListings] = useState<VehicleMarketplaceListing[]>([]);
  const [myListings, setMyListings] = useState<VehicleMarketplaceListing[]>([]);
  const [cursor, setCursor] = useState<VehicleMarketplaceCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [fleetLimit, setFleetLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [filters, setFilters] = useState<MarketplaceFilters>(DEFAULT_MARKETPLACE_FILTERS);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selected, setSelected] = useState<VehicleMarketplaceListing | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<VehicleMarketplaceListing | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [creating, setCreating] = useState(false);

  const syncMineAndReconcile = useCallback(async () => {
    const result = await getMyVehicleListings();
    if (!result.ok) return false;
    setMyListings(result.listings);
    if (result.reconciliation) {
      applyReconciliation(result.reconciliation);
      setFleetLimit(
        Number.isFinite(result.reconciliation.fleetLimit)
          ? Number(result.reconciliation.fleetLimit)
          : null,
      );
    }
    return true;
  }, [applyReconciliation]);

  const loadFirstPage = useCallback(async () => {
    const page = await getVehicleMarketplaceListings(PAGE_SIZE);
    if (!page.ok) {
      setUnavailable(true);
      setListings([]);
      setHasMore(false);
      return false;
    }
    setUnavailable(false);
    setListings(mergeMarketplacePage([], page));
    setCursor(page.nextCursor);
    setHasMore(page.hasMore);
    return true;
  }, []);

  const refreshAll = useCallback(async () => {
    const [publicOk, myOk] = await Promise.all([loadFirstPage(), syncMineAndReconcile()]);
    setUnavailable(!publicOk || !myOk);
  }, [loadFirstPage, syncMineAndReconcile]);

  useEffect(() => {
    let active = true;
    if (!VEHICLE_MARKETPLACE_ENABLED) {
      setLoading(false);
      return;
    }
    void refreshAll().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!VEHICLE_MARKETPLACE_ENABLED || !pendingSellTruckId) return;
    setActiveTab('mine');
    setCreateVisible(true);
  }, [pendingSellTruckId]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore || activeTab !== 'available') return;
    setLoadingMore(true);
    const page = await getVehicleMarketplaceListings(PAGE_SIZE, cursor);
    if (page.ok) {
      setListings((current) => mergeMarketplacePage(current, page));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } else {
      setUnavailable(true);
    }
    setLoadingMore(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
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
    if (!purchaseTarget || purchasing) return;
    setPurchasing(true);
    const result = await purchaseVehicleListing({
      ...actionEnvelope('marketplace-purchase'),
      listingId: purchaseTarget.id,
      listingVersion: purchaseTarget.version,
      quotedPrice: purchaseTarget.askingPrice,
    });
    if (!result.ok) {
      showAlert('Satın alma tamamlanamadı', getMarketplaceErrorMessage(result.reason));
      setPurchasing(false);
      if (result.reason === 'listing-not-active' || result.reason === 'stale-listing-version') {
        setPurchaseTarget(null);
        await onRefresh();
      }
      return;
    }
    await refreshAll();
    setPurchasing(false);
    setPurchaseTarget(null);
    showAlert('Satın alma tamamlandı', 'Araç authoritative pazar kaydından filona aktarıldı.');
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
    if (cancellingId) return;
    setCancellingId(listing.id);
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
    setCancellingId(null);
  };

  const performCreate = async (truck: (typeof player.trucks)[number], askingPrice: number) => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await createVehicleListing({
        ...actionEnvelope('marketplace-create'),
        truckId: truck.id,
        askingPrice,
        clientSaveVersion: SAVE_GAME_VERSION,
      });
      if (!result.ok) {
        showAlert('İlan oluşturulamadı', getMarketplaceErrorMessage(result.reason), [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Tekrar Dene',
            onPress: () => void performCreate(truck, askingPrice),
          },
        ]);
        return;
      }
      await refreshAll();
      setCreateVisible(false);
      clearPendingSellTruckId();
      setActiveTab('mine');
      showAlert('İlan oluşturuldu', 'Araç backend tarafından kilitlendi ve pazarda yayınlandı.');
    } finally {
      setCreating(false);
    }
  };

  if (!VEHICLE_MARKETPLACE_ENABLED) {
    return (
      <AppScreen>
        <MarketplaceHeader
          onBack={onBack}
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

  return (
    <AppScreen padding={false}>
      <FlatList
        data={activeTab === 'available' ? visibleListings : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <VehicleListingCard
            listing={item}
            onDetail={() => setSelected(item)}
            onPurchase={() => beginPurchase(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentBlue} />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={
          <>
            <MarketplaceHeader stats={stats} onBack={onBack} />
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
                <Text style={styles.resultText}>{visibleListings.length} araç gösteriliyor</Text>
                <TouchableOpacity style={styles.filterButton} onPress={() => setFiltersVisible(true)}>
                  <GameIcon name="filter" size={16} color={colors.accentBlue} />
                  <Text style={styles.filterText}>Filtreler</Text>
                </TouchableOpacity>
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
            {loading ? (
              <ActivityIndicator color={colors.accentBlue} style={styles.centerLoader} />
            ) : null}
            {!loading && unavailable ? (
              <EmptyState
                title="Araç Pazarı şu anda kullanılamıyor."
                message="Bağlantını kontrol edip tekrar dene."
                actionLabel="Tekrar Dene"
                onAction={() => void onRefresh()}
                icon="warning"
                compact
              />
            ) : null}
            {!loading && !unavailable && activeTab === 'available' && visibleListings.length === 0 ? (
              <EmptyState
                title="Şu anda satışta araç bulunmuyor."
                message="Yeni ilanlar sunucudan geldiğinde burada görünecek."
                icon="truck"
                compact
              />
            ) : null}
            {activeTab === 'mine' ? (
              <MyVehicleListings
                listings={activeMine}
                cancellingId={cancellingId}
                onDetail={setSelected}
                onCancel={requestCancel}
                onSellVehicle={() => setCreateVisible(true)}
              />
            ) : null}
            {activeTab === 'history' ? <MarketplaceHistory listings={history} /> : null}
          </>
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={colors.accentBlue} style={styles.footerLoader} /> : null
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
        creating={creating}
        initialTruckId={pendingSellTruckId}
        onClose={() => {
          setCreateVisible(false);
          clearPendingSellTruckId();
        }}
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
        purchasing={purchasing}
        onClose={() => setPurchaseTarget(null)}
        onConfirm={() => void confirmPurchase()}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
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
  tabGap: { height: spacing.md },
  centerLoader: { marginVertical: spacing.xl },
  footerLoader: { marginVertical: spacing.xl },
});
