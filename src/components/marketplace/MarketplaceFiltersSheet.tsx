import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CITIES } from '../../data/cities';
import {
  DEFAULT_MARKETPLACE_FILTERS,
  type MarketplaceFilters,
  type MarketplaceSort,
} from '../../domain/vehicleMarketplacePresentation';
import { colors, spacing, typography } from '../../theme';
import { ActionButton, GameIcon } from '../ui';

const SORTS: Array<[MarketplaceSort, string]> = [
  ['newest', 'Yeni İlanlar'],
  ['price-asc', 'En Düşük Fiyat'],
  ['price-desc', 'En Yüksek Fiyat'],
  ['condition-desc', 'En İyi Kondisyon'],
  ['mileage-asc', 'En Düşük KM'],
];

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[^\d.]/g, ''));
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

export default function MarketplaceFiltersSheet({
  visible,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: MarketplaceFilters;
  onApply: (filters: MarketplaceFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Filtrele ve Sırala</Text>
              <Text style={styles.subtitle}>Sana uygun aracı daha hızlı bul</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <GameIcon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Field
              label="Marka / model"
              value={draft.query}
              placeholder="Örn. Nordvik"
              onChangeText={(query) => setDraft({ ...draft, query })}
            />
            <View style={styles.twoColumns}>
              <Field
                label="Minimum fiyat"
                value={draft.minPrice?.toString() ?? ''}
                placeholder="$0"
                keyboardType="numeric"
                onChangeText={(value) => setDraft({ ...draft, minPrice: parseOptionalNumber(value) })}
              />
              <Field
                label="Maksimum fiyat"
                value={draft.maxPrice?.toString() ?? ''}
                placeholder="Sınırsız"
                keyboardType="numeric"
                onChangeText={(value) => setDraft({ ...draft, maxPrice: parseOptionalNumber(value) })}
              />
            </View>
            <Text style={styles.label}>Kondisyon</Text>
            <View style={styles.chips}>
              {[undefined, 50, 75, 90].map((value) => (
                <Chip
                  key={value ?? 'all'}
                  label={value == null ? 'Tümü' : `%${value}+`}
                  selected={draft.minCondition === value}
                  onPress={() => setDraft({ ...draft, minCondition: value })}
                />
              ))}
            </View>
            <Text style={styles.label}>Kilometre</Text>
            <View style={styles.chips}>
              {[undefined, 25_000, 50_000, 100_000].map((value) => (
                <Chip
                  key={value ?? 'all'}
                  label={value == null ? 'Tümü' : `< ${(value / 1_000).toFixed(0)}K`}
                  selected={draft.maxMileage === value}
                  onPress={() => setDraft({ ...draft, maxMileage: value })}
                />
              ))}
            </View>
            <Text style={styles.label}>Şehir</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chips}>
                <Chip label="Tümü" selected={!draft.cityId} onPress={() => setDraft({ ...draft, cityId: undefined })} />
                {CITIES.map((city) => (
                  <Chip
                    key={city.id}
                    label={city.name}
                    selected={draft.cityId === city.id}
                    onPress={() => setDraft({ ...draft, cityId: city.id })}
                  />
                ))}
              </View>
            </ScrollView>
            <Text style={styles.label}>Upgrade seviyesi</Text>
            <View style={styles.chips}>
              {[undefined, 1, 2, 3].map((value) => (
                <Chip
                  key={value ?? 'all'}
                  label={value == null ? 'Tümü' : `Sv.${value}+`}
                  selected={draft.minUpgradeLevel === value}
                  onPress={() => setDraft({ ...draft, minUpgradeLevel: value })}
                />
              ))}
            </View>
            <Text style={styles.label}>Sıralama</Text>
            <View style={styles.sortList}>
              {SORTS.map(([key, label]) => (
                <Chip
                  key={key}
                  label={label}
                  selected={draft.sort === key}
                  onPress={() => setDraft({ ...draft, sort: key })}
                  wide
                />
              ))}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <ActionButton
              label="Temizle"
              variant="secondary"
              onPress={() => setDraft(DEFAULT_MARKETPLACE_FILTERS)}
              style={styles.footerButton}
            />
            <ActionButton
              label="Filtreleri Uygula"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              style={styles.footerButton}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
    </View>
  );
}

function Chip({ label, selected, onPress, wide = false }: {
  label: string; selected: boolean; onPress: () => void; wide?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, wide && styles.wideChip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 26,
    borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.borderStrong,
    paddingBottom: spacing.lg,
  },
  handle: {
    width: 42, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong,
    alignSelf: 'center', marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  close: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.cardSoft, borderWidth: 1, borderColor: colors.border,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 5 },
  input: {
    minHeight: 44, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, borderRadius: 12, paddingHorizontal: spacing.md,
  },
  field: { flex: 1 },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  chip: {
    minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  wideChip: { width: '48.5%' },
  chipSelected: { backgroundColor: colors.accentBlueSoft, borderColor: colors.accentBlue },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chipTextSelected: { color: colors.accentBlue },
  sortList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  footerButton: { flex: 1, minHeight: 48 },
});
