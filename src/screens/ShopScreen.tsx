/**
 * LogistiCore - Mağaza Ekranı
 *
 * Kamyon, dorse ve şoför satın alma / işe alma — premium mağaza UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import DriverMarketCard from '../components/shop/DriverMarketCard';
import ShopCategoryTabs from '../components/shop/ShopCategoryTabs';
import ShopFilterChips from '../components/shop/ShopFilterChips';
import ShopHeroHeader from '../components/shop/ShopHeroHeader';
import ShopResourceBar from '../components/shop/ShopResourceBar';
import TrailerMarketCard from '../components/shop/TrailerMarketCard';
import TruckMarketCard, { filterTruckMarketByClass } from '../components/shop/TruckMarketCard';
import {
  isDriverAffordable,
  isExpertDriverTier,
  getDriverMarketSortRank,
  SHOP_BACKGROUND,
  SHOP_SCROLL_BOTTOM_EXTRA,
  SHOP_SPACING_RESOURCE_TO_HERO,
  SHOP_SPACING_TABS_TO_FILTERS,
  type ShopCategory,
  type TruckShopClass,
} from '../components/shop/shopTheme';
import { AppCard, AppScreen, EmptyState, GameIcon } from '../components/ui';
import {
  countOwnedTrucksOfCatalog,
  resolveTruckMarketRequiredLevel,
  TRUCK_MARKET,
  type TruckMarketItem,
} from '../data/trucks';
import { TRAILER_MARKET, type TrailerMarketItem } from '../data/trailers';
import {
  getDriverPoolForLevel,
  getDriverTierLabel,
  isDriverPoolItemHired,
  resolveDriverRequiredLevel,
  type DriverMarketItem,
} from '../data/drivers';
import { getTrailerTypeLabel } from '../simulation/trailerOps';
import { getLevelProgress } from '../simulation/leveling';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing } from '../theme';
import type { TrailerType } from '../types/game';

const STATUS_MESSAGE_TIMEOUT_MS = 2500;

type StatusMessage = { type: 'success' | 'error'; text: string } | null;
type TruckFilter = 'all' | TruckShopClass;
type TrailerFilter = 'all' | TrailerType;
type DriverFilter = 'all' | 'affordable' | 'hired' | 'expert';

const TRUCK_FILTERS = [
  { key: 'all' as const, label: 'Tümü' },
  { key: 'light' as const, label: 'Hafif', icon: 'truck' as const },
  { key: 'medium' as const, label: 'Orta', icon: 'truck' as const },
  { key: 'tractor' as const, label: 'Çekici', icon: 'truck' as const },
  { key: 'heavy' as const, label: 'Ağır', icon: 'truck' as const },
];

const TRAILER_FILTERS = [
  { key: 'all' as const, label: 'Tümü' },
  { key: 'standard' as const, label: 'Standart', icon: 'level' as const },
  { key: 'heavy' as const, label: 'Ağır Yük', icon: 'warning' as const },
  { key: 'refrigerated' as const, label: 'Soğutmalı', icon: 'maintenance' as const },
  { key: 'container' as const, label: 'Konteyner', icon: 'inventory' as const },
];

const DRIVER_FILTERS = [
  { key: 'all' as const, label: 'Tümü' },
  { key: 'affordable' as const, label: 'Uygun', icon: 'success' as const },
  { key: 'hired' as const, label: 'Kadroda', icon: 'driver' as const },
  { key: 'expert' as const, label: 'Uzman', icon: 'level' as const },
];

export default function ShopScreen() {
  const { showDialog } = useAppDialog();
  const { tabBarHeight } = useTabBarLayout();
  const scrollBottomPadding = tabBarHeight + SHOP_SCROLL_BOTTOM_EXTRA;

  const player = useGameStore((state) => state.player);
  const buyTruck = useGameStore((state) => state.buyTruck);
  const buyTrailer = useGameStore((state) => state.buyTrailer);
  const leaseTruck = useGameStore((state) => state.leaseTruck);
  const hireDriver = useGameStore((state) => state.hireDriver);
  const pendingShopCategory = useGameStore((state) => state.pendingShopCategory);
  const clearPendingShopCategory = useGameStore((state) => state.clearPendingShopCategory);
  const isPaused = useGameStore((state) => state.isPaused);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);

  const [activeCategory, setActiveCategory] = useState<ShopCategory>('trucks');
  const [truckFilter, setTruckFilter] = useState<TruckFilter>('all');
  const [trailerFilter, setTrailerFilter] = useState<TrailerFilter>('all');
  const [driverFilter, setDriverFilter] = useState<DriverFilter>('affordable');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  useEffect(() => {
    if (!pendingShopCategory) return;
    setActiveCategory(pendingShopCategory);
    if (pendingShopCategory === 'drivers') {
      setDriverFilter('affordable');
    }
    clearPendingShopCategory();
  }, [pendingShopCategory, clearPendingShopCategory]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const trucks = useMemo(() => player?.trucks ?? [], [player?.trucks]);
  const drivers = useMemo(() => player?.drivers ?? [], [player?.drivers]);
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerMoney = player?.money ?? 0;
  const playerDiamonds = Math.max(0, player?.diamonds ?? 0);

  const levelProgress = useMemo(
    () => (player ? getLevelProgress(player) : { level: 1, progressRatio: 0 }),
    [player],
  );

  const sortedTruckMarket = useMemo(
    () =>
      [...TRUCK_MARKET].sort(
        (a, b) => resolveTruckMarketRequiredLevel(a) - resolveTruckMarketRequiredLevel(b),
      ),
    [],
  );

  const filteredTrucks = useMemo(
    () => filterTruckMarketByClass(sortedTruckMarket, truckFilter),
    [sortedTruckMarket, truckFilter],
  );

  const filteredTrailers = useMemo(() => {
    if (trailerFilter === 'all') return TRAILER_MARKET;
    return TRAILER_MARKET.filter((item) => item.type === trailerFilter);
  }, [trailerFilter]);

  const driverPool = useMemo(() => getDriverPoolForLevel(playerLevel), [playerLevel]);

  const filteredDrivers = useMemo(() => {
    const filtered = driverPool.filter((template) => {
      const hired = isDriverPoolItemHired(drivers, template.id);
      switch (driverFilter) {
        case 'affordable':
          return isDriverAffordable(template, playerMoney, playerLevel, hired);
        case 'hired':
          return hired;
        case 'expert':
          return isExpertDriverTier(template.tier);
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      const hiredA = isDriverPoolItemHired(drivers, a.id);
      const hiredB = isDriverPoolItemHired(drivers, b.id);
      const rankA = getDriverMarketSortRank(a, playerMoney, playerLevel, hiredA);
      const rankB = getDriverMarketSortRank(b, playerMoney, playerLevel, hiredB);
      if (rankA !== rankB) return rankA - rankB;
      return (a.requiredLevel ?? 1) - (b.requiredLevel ?? 1);
    });
  }, [driverFilter, driverPool, drivers, playerLevel, playerMoney]);

  const ownedTruckCountByCatalog = useMemo(() => {
    const map = new Map<string, number>();
    for (const template of sortedTruckMarket) {
      map.set(template.id, countOwnedTrucksOfCatalog(trucks, template.id));
    }
    return map;
  }, [sortedTruckMarket, trucks]);

  const handleBuyTruck = useCallback(
    (catalogId: string) => {
      if (typeof buyTruck !== 'function') {
        setStatusMessage({ type: 'error', text: 'Yakında' });
        return;
      }
      const result = buyTruck(catalogId);
      if (!result.success) {
        setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
        return;
      }
      setStatusMessage({ type: 'success', text: result.message ?? 'Kamyon satın alındı' });
    },
    [buyTruck],
  );

  const handleLeaseTruck = useCallback(
    (catalogId: string) => {
      if (typeof leaseTruck !== 'function') {
        setStatusMessage({ type: 'error', text: 'Kiralama henüz kullanılamıyor' });
        return;
      }
      const result = leaseTruck(catalogId);
      if (!result.success) {
        setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
        return;
      }
      setStatusMessage({ type: 'success', text: result.message ?? 'Kamyon kiralandı' });
    },
    [leaseTruck],
  );

  const handleBuyTrailer = useCallback(
    (catalogId: string) => {
      if (typeof buyTrailer !== 'function') {
        setStatusMessage({ type: 'error', text: 'Dorse satın alma henüz kullanılamıyor' });
        return;
      }
      const result = buyTrailer(catalogId);
      setStatusMessage({
        type: result.success ? 'success' : 'error',
        text: result.message ?? (result.success ? 'Dorse satın alındı' : 'Satın alma başarısız'),
      });
    },
    [buyTrailer],
  );

  const handleHireDriver = useCallback(
    (poolId: string) => {
      if (typeof hireDriver !== 'function') {
        setStatusMessage({ type: 'error', text: 'Yakında' });
        return;
      }
      const result = hireDriver(poolId);
      if (!result.success) {
        setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
        return;
      }
      setStatusMessage({ type: 'success', text: result.message ?? 'Şoför işe alındı' });
    },
    [hireDriver],
  );

  const handleTruckDetail = useCallback(
    (template: TruckMarketItem) => {
      const requiredLevel = resolveTruckMarketRequiredLevel(template);
      const ownedCount = countOwnedTrucksOfCatalog(trucks, template.id);
      const weeklyLeaseCost = template.weeklyLeaseCost ?? 0;
      showDialog({
        title: template.name,
        message: 'Kamyon detayları',
        details: [
          { label: 'Satın alma', value: formatMoney(template.purchasePrice), tone: 'success' },
          {
            label: 'Haftalık kira',
            value: weeklyLeaseCost > 0 ? formatMoney(weeklyLeaseCost) : 'Yok',
            tone: 'muted',
          },
          { label: 'Kapasite', value: `${template.capacity} t` },
          { label: 'Hız', value: `${template.speed} km/h` },
          { label: 'Yakıt', value: `${template.fuelConsumptionPerKm.toFixed(2)} L/km` },
          { label: 'Dayanıklılık', value: String(template.reliability) },
          { label: 'Level', value: `Lv. ${requiredLevel}+` },
          { label: 'Filonda', value: `${ownedCount} adet`, tone: ownedCount > 0 ? 'success' : 'muted' },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: 'Tamam',
      });
    },
    [showDialog, trucks],
  );

  const handleTrailerDetail = useCallback(
    (template: TrailerMarketItem) => {
      const requiredLevel = template.requiredLevel ?? 1;
      showDialog({
        title: template.name,
        message: template.description,
        details: [
          { label: 'Tip', value: getTrailerTypeLabel(template.type) },
          { label: 'Kapasite', value: `+${template.capacityBonusTons} t`, tone: 'success' },
          { label: 'Fiyat', value: formatMoney(template.purchasePrice), tone: 'success' },
          { label: 'Level', value: `Lv. ${requiredLevel}+` },
          { label: 'Dayanıklılık', value: '60' },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: 'Tamam',
      });
    },
    [showDialog],
  );

  const handleDriverDetail = useCallback(
    (template: DriverMarketItem) => {
      const requiredLevel = resolveDriverRequiredLevel(template);
      const hired = isDriverPoolItemHired(drivers, template.id);
      showDialog({
        title: template.name,
        message: getDriverTierLabel(template.tier),
        details: [
          { label: 'Deneyim', value: String(template.experience) },
          { label: 'Dikkat', value: String(template.attention) },
          { label: 'Hız', value: String(template.speed) },
          { label: 'Yakıt tasarrufu', value: String(template.fuelSaving) },
          { label: 'Maaş', value: `${formatMoney(template.salaryPerDay)}/gün`, tone: 'warning' },
          { label: 'İşe alım', value: formatMoney(template.hiringFee), tone: 'success' },
          { label: 'Level', value: `Lv. ${requiredLevel}+` },
          { label: 'Durum', value: hired ? 'Kadroda' : 'Müsait', tone: hired ? 'success' : 'muted' },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: 'Tamam',
      });
    },
    [drivers, showDialog],
  );

  const handleCategoryChange = useCallback((category: ShopCategory) => {
    setActiveCategory(category);
    if (category === 'drivers') {
      setDriverFilter('affordable');
    }
  }, []);

  return (
    <AppScreen scroll scrollBottomPadding={scrollBottomPadding} contentContainerStyle={styles.screenContent}>
      <View style={styles.screenStack}>
        <View style={styles.topSection}>
          {player ? (
            <ShopResourceBar
              money={playerMoney}
              diamonds={playerDiamonds}
              level={levelProgress.level}
              xpProgress={levelProgress.progressRatio}
              isPaused={isPaused}
              onTogglePause={isPaused ? resumeGame : pauseGame}
            />
          ) : null}

          <View style={styles.heroWrap}>
            <ShopHeroHeader />
          </View>

          <ShopCategoryTabs activeCategory={activeCategory} onChange={handleCategoryChange} />
        </View>

        {statusMessage ? (
          <AppCard
            variant={statusMessage.type === 'success' ? 'success' : 'danger'}
            style={styles.statusBanner}
            padded
          >
            <View style={styles.statusBannerRow}>
              <GameIcon
                name={statusMessage.type === 'success' ? 'success' : 'warning'}
                size={16}
                color={statusMessage.type === 'success' ? colors.success : colors.danger}
              />
              <Text
                style={[
                  styles.statusBannerText,
                  { color: statusMessage.type === 'success' ? colors.success : colors.danger },
                ]}
              >
                {statusMessage.text}
              </Text>
            </View>
          </AppCard>
        ) : null}

        {activeCategory === 'trucks' ? (
          <View style={styles.listSection}>
            <ShopFilterChips filters={TRUCK_FILTERS} activeFilter={truckFilter} onChange={setTruckFilter} />
            {filteredTrucks.length === 0 ? (
              <EmptyState title="Bu filtrede kamyon yok" icon="truck" compact />
            ) : (
              filteredTrucks.map((template) => (
                <TruckMarketCard
                  key={template.id}
                  template={template}
                  playerMoney={playerMoney}
                  playerLevel={playerLevel}
                  ownedCount={ownedTruckCountByCatalog.get(template.id) ?? 0}
                  canBuy={typeof buyTruck === 'function'}
                  canLease={typeof leaseTruck === 'function'}
                  onBuy={handleBuyTruck}
                  onLease={handleLeaseTruck}
                  onDetail={handleTruckDetail}
                />
              ))
            )}
          </View>
        ) : null}

        {activeCategory === 'trailers' ? (
          <View style={styles.listSection}>
            <ShopFilterChips filters={TRAILER_FILTERS} activeFilter={trailerFilter} onChange={setTrailerFilter} />
            {filteredTrailers.length === 0 ? (
              <EmptyState title="Bu filtrede dorse yok" icon="route" compact />
            ) : (
              filteredTrailers.map((template) => (
                <TrailerMarketCard
                  key={template.id}
                  template={template}
                  playerMoney={playerMoney}
                  playerLevel={playerLevel}
                  onBuy={handleBuyTrailer}
                  onDetail={handleTrailerDetail}
                />
              ))
            )}
          </View>
        ) : null}

        {activeCategory === 'drivers' ? (
          <View style={styles.listSection}>
            <ShopFilterChips filters={DRIVER_FILTERS} activeFilter={driverFilter} onChange={setDriverFilter} />
            {filteredDrivers.length === 0 ? (
              <EmptyState title="Bu filtrede şoför yok" icon="driver" compact />
            ) : (
              filteredDrivers.map((template) => (
                <DriverMarketCard
                  key={template.id}
                  template={template}
                  playerMoney={playerMoney}
                  playerLevel={playerLevel}
                  alreadyHired={isDriverPoolItemHired(drivers, template.id)}
                  canHire={typeof hireDriver === 'function'}
                  onHire={handleHireDriver}
                  onDetail={handleDriverDetail}
                />
              ))
            )}
          </View>
        ) : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    backgroundColor: SHOP_BACKGROUND,
  },
  screenStack: {
    gap: spacing.sm,
  },
  topSection: {
    gap: 0,
  },
  heroWrap: {
    marginTop: SHOP_SPACING_RESOURCE_TO_HERO,
  },
  statusBanner: {
    marginBottom: 0,
  },
  statusBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  listSection: {
    gap: 10,
    marginTop: SHOP_SPACING_TABS_TO_FILTERS,
  },
});
