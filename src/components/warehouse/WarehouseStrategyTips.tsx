import React, { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors, typography } from '../../theme';

const TIPS = [
  'Stok fazlası olan şehirlerde ürünler daha ucuz olabilir.',
  'Ürünü yüksek talep bulunan şehre taşıyarak daha fazla kâr edebilirsin.',
  'Soğuk depolar daha pahalıdır ancak bozulabilir ürün ticaretini açar.',
] as const;

interface WarehouseStrategyTipsProps {
  onMore?: () => void;
}

export default function WarehouseStrategyTips({ onMore }: WarehouseStrategyTipsProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((value) => !value);
  };

  return (
    <View style={styles.section}>
      <Pressable
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel="Depo stratejisi ipuçlarını aç"
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>Depo Stratejisi</Text>
          <Text style={styles.meta}>3 ipucu</Text>
        </View>
        <GameIcon
          name={expanded ? 'chevronUp' : 'chevronDown'}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {TIPS.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.tip}>{tip}</Text>
            </View>
          ))}
          {onMore ? (
            <Pressable onPress={onMore} hitSlop={8} style={styles.moreLink}>
              <Text style={styles.moreText}>Daha Fazla</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.28)',
    backgroundColor: '#0E1C34',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.accentAmber,
    fontSize: 11,
    marginTop: 1,
    fontWeight: '700',
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  tipRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  bullet: {
    color: colors.accentBlue,
    fontWeight: '800',
    lineHeight: 16,
  },
  tip: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  moreLink: {
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 32,
    justifyContent: 'center',
  },
  moreText: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
});
