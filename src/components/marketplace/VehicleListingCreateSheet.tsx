import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { getTruckArtwork } from '../../assets/fleetAssets';
import { vehicleMarketplaceBalance } from '../../config/balance';
import { calculateTruckResaleValue } from '../../simulation/fleetManagement';
import { colors, formatMoney, spacing, typography } from '../../theme';
import type { Truck } from '../../types/game';
import { ActionButton, GameIcon } from '../ui';

export default function VehicleListingCreateSheet({
  visible,
  trucks,
  creating,
  initialTruckId,
  onClose,
  onCreate,
}: {
  visible: boolean;
  trucks: Truck[];
  creating: boolean;
  initialTruckId?: string | null;
  onClose: () => void;
  onCreate: (truck: Truck, askingPrice: number) => void;
}) {
  const eligible = useMemo(
    () => trucks.filter((truck) => truck.status === 'idle' && truck.ownershipType !== 'leased'),
    [trucks],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = eligible.find((truck) => truck.id === selectedId) ?? eligible[0];
  const recommended = selected ? calculateTruckResaleValue(selected) : 0;
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (visible && eligible[0]) {
      const preferred = eligible.some((truck) => truck.id === initialTruckId)
        ? initialTruckId
        : eligible[0].id;
      setSelectedId(preferred ?? eligible[0].id);
    }
  }, [eligible, initialTruckId, visible]);
  useEffect(() => {
    setPrice(recommended > 0 ? String(recommended) : '');
  }, [recommended]);

  const askingPrice = Number(price.replace(/[^\d]/g, ''));
  const min = Math.round(recommended * vehicleMarketplaceBalance.vehicleMarketplaceMinPriceRatio);
  const max = Math.round(recommended * vehicleMarketplaceBalance.vehicleMarketplaceMaxPriceRatio);
  const validPrice = Number.isFinite(askingPrice) && askingPrice >= min && askingPrice <= max;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Aracı Satışa Çıkar</Text>
              <Text style={styles.subtitle}>Uygun ve boşta olan kamyonunu seç</Text>
            </View>
            <TouchableOpacity style={styles.close} onPress={onClose} disabled={creating}>
              <GameIcon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {eligible.length === 0 ? (
              <Text style={styles.empty}>Satışa uygun boşta aracın bulunmuyor.</Text>
            ) : (
              eligible.map((truck) => {
                const art = getTruckArtwork(truck);
                const active = selected?.id === truck.id;
                return (
                  <TouchableOpacity
                    key={truck.id}
                    style={[styles.truckRow, active && styles.truckRowActive]}
                    onPress={() => setSelectedId(truck.id)}
                  >
                    <View style={styles.artWrap}>
                      {art ? <Image source={art} resizeMode="contain" style={styles.art} /> : null}
                    </View>
                    <View style={styles.truckMain}>
                      <Text style={styles.truckName}>{truck.name}</Text>
                      <Text style={styles.truckMeta}>
                        Kondisyon %{Math.round(truck.condition)} · {Math.round(truck.totalMileageKm ?? 0).toLocaleString('tr-TR')} km
                      </Text>
                    </View>
                    {active ? <GameIcon name="success" size={20} color={colors.success} /> : null}
                  </TouchableOpacity>
                );
              })
            )}
            {selected ? (
              <View style={styles.priceCard}>
                <View style={styles.priceLine}>
                  <Text style={styles.label}>Önerilen değer</Text>
                  <Text style={styles.recommended}>{formatMoney(recommended)}</Text>
                </View>
                <Text style={styles.label}>Satış fiyatı</Text>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="numeric"
                  style={[styles.input, !validPrice && styles.inputInvalid]}
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={[styles.hint, !validPrice && styles.invalid]}>
                  İzin verilen aralık: {formatMoney(min)} – {formatMoney(max)}
                </Text>
                <View style={styles.priceLine}>
                  <Text style={styles.label}>İlan ücreti</Text>
                  <Text style={styles.value}>
                    {formatMoney(vehicleMarketplaceBalance.vehicleMarketplaceListingFee)}
                  </Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
          <ActionButton
            label={creating ? 'İlan oluşturuluyor…' : 'Satış İlanı Oluştur'}
            onPress={() => selected && onCreate(selected, askingPrice)}
            disabled={!selected || !validPrice || creating}
            icon="truck"
            fullWidth
            style={styles.action}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.74)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 26,
    borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.borderStrong,
    paddingBottom: spacing.xl,
  },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  title: { ...typography.sectionTitle, fontSize: 17 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardSoft, borderWidth: 1, borderColor: colors.border },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.lg },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 72, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing.sm },
  truckRowActive: { borderColor: colors.accentBlue, backgroundColor: colors.accentBlueSoft },
  artWrap: { width: 78, height: 54, borderRadius: 10, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  art: { width: 74, height: 48 },
  truckMain: { flex: 1, minWidth: 0 },
  truckName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  truckMeta: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  priceCard: { marginTop: spacing.sm, backgroundColor: colors.surface2, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  priceLine: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.textMuted, fontSize: 11 },
  value: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  recommended: { color: colors.success, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background2, color: colors.textPrimary, paddingHorizontal: spacing.md, fontSize: 17, fontWeight: '800' },
  inputInvalid: { borderColor: colors.danger },
  hint: { color: colors.textMuted, fontSize: 10 },
  invalid: { color: colors.danger },
  action: { marginHorizontal: spacing.lg, minHeight: 50 },
});
