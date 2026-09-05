import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ActionButton, AppCard, GameIcon, StatusBadge } from '../../../components/ui';
import type { StatusBadgeVariant } from '../../../components/ui';
import { colors, formatMoney, typography } from '../../../theme';
import type { MarketOpportunity } from '../../../types/game';
import { getCityName } from '../../../utils/entityLookup';
import {
  formatMarketTradeOpportunityTitle,
  type MarketTradeOpportunity,
} from '../../../utils/marketTradeOpportunities';

const OPPORTUNITY_SCORE_CAP = 2500;

function normalizeOpportunityScore(rawScore: number | undefined | null): number {
  const safe = Number(rawScore ?? 0);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  if (safe <= 1) return Math.min(100, Math.round(safe * 100));
  if (safe <= 100) return Math.round(safe);

  const capped = Math.min(safe, OPPORTUNITY_SCORE_CAP);
  if (capped >= 2000) return 100;
  if (capped >= 1200) return 75 + Math.round(((capped - 1200) / 800) * 25);
  if (capped >= 700) return 50 + Math.round(((capped - 700) / 500) * 25);
  return Math.min(49, Math.round((capped / 700) * 49));
}

function getOpportunityPotential(normalizedScore: number): { label: string; variant: StatusBadgeVariant } {
  if (normalizedScore >= 80) return { label: 'Çok güçlü', variant: 'success' };
  if (normalizedScore >= 60) return { label: 'Güçlü', variant: 'success' };
  if (normalizedScore >= 40) return { label: 'Orta', variant: 'warning' };
  return { label: 'Zayıf', variant: 'muted' };
}

function getDemandLevelLabel(level: MarketOpportunity['demandLevel']): string {
  switch (level) {
    case 'high': return 'Yüksek';
    case 'medium': return 'Orta';
    default: return 'Düşük';
  }
}

function getOpportunityStrength(normalizedScore: number): { label: string; variant: StatusBadgeVariant } {
  if (normalizedScore >= 75) return { label: 'Güçlü fırsat', variant: 'success' };
  if (normalizedScore >= 50) return { label: 'İyi fırsat', variant: 'info' };
  return { label: 'Orta fırsat', variant: 'muted' };
}

export function TradeOpportunityCard({
  opportunity,
  onPress,
}: {
  opportunity: MarketTradeOpportunity;
  onPress: () => void;
}) {
  const badgeVariant: StatusBadgeVariant =
    opportunity.type === 'sell' ? 'amber' : opportunity.type === 'buy' ? 'success' : 'info';

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <AppCard style={styles.tradeOpportunityCard} padded>
        <View style={styles.cardTopRow}>
          <View style={styles.productIconBox}>
            <GameIcon name={opportunity.type === 'sell' ? 'warehouse' : 'market'} size={16} color={colors.accentBlue} />
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.opportunityRoute} numberOfLines={1}>
              {formatMarketTradeOpportunityTitle(opportunity)}
            </Text>
            <Text style={styles.opportunityProduct} numberOfLines={2}>{opportunity.description}</Text>
          </View>
          <StatusBadge label={opportunity.label} variant={badgeVariant} size="sm" />
        </View>
        {opportunity.netProfit != null ? (
          <Text style={[styles.tradeOpportunityProfit, { color: opportunity.netProfit >= 0 ? colors.success : colors.danger }]}>
            Net kâr: {opportunity.netProfit >= 0 ? '+' : ''}{formatMoney(opportunity.netProfit)}
          </Text>
        ) : null}
      </AppCard>
    </TouchableOpacity>
  );
}

export function OpportunityCard({
  opportunity,
  exactMatchesCount,
  relatedMatchesCount,
  onViewContracts,
}: {
  opportunity: MarketOpportunity;
  exactMatchesCount: number;
  relatedMatchesCount: number;
  onViewContracts: (opportunity: MarketOpportunity) => void;
}) {
  const normalizedScore = normalizeOpportunityScore(opportunity.score);
  const strength = getOpportunityStrength(normalizedScore);
  const potential = getOpportunityPotential(normalizedScore);
  const hasExactMatches = exactMatchesCount > 0;
  const hasRelatedMatches = relatedMatchesCount > 0;
  const hasAnyMatches = hasExactMatches || hasRelatedMatches;

  return (
    <AppCard style={styles.opportunityCard} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.productIconBox}><GameIcon name="route" size={16} color={colors.accentBlue} /></View>
        <View style={styles.cardMain}>
          <Text style={styles.opportunityRoute} numberOfLines={1}>
            {opportunity.fromCityName || getCityName(opportunity.fromCityId)} →{' '}
            {opportunity.toCityName || getCityName(opportunity.toCityId)}
          </Text>
          <Text style={styles.opportunityProduct} numberOfLines={1}>Ürün: {opportunity.productName}</Text>
        </View>
        <StatusBadge label={strength.label} variant={strength.variant} size="sm" />
      </View>
      <View style={styles.opportunityMetrics}>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          Fiyat farkı: <Text style={styles.opportunityValue}>{formatMoney(opportunity.priceGap)}</Text>
          {' · '}Mesafe: <Text style={styles.opportunityValue}>{Math.round(opportunity.distanceKm ?? 0)} km</Text>
        </Text>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          Talep: <Text style={styles.opportunityValue}>{getDemandLevelLabel(opportunity.demandLevel)}</Text>
          {' · '}Potansiyel: <Text style={styles.opportunityValue}>{potential.label}</Text>
          {' · '}Skor: <Text style={styles.opportunityValue}>{normalizedScore}/100</Text>
        </Text>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          {hasAnyMatches ? (
            hasExactMatches && hasRelatedMatches ? (
              <Text style={styles.opportunityValue}>{exactMatchesCount} tam · {relatedMatchesCount} yakın iş</Text>
            ) : hasExactMatches ? (
              <>Tam eşleşme: <Text style={[styles.opportunityValue, { color: colors.success }]}>{exactMatchesCount}</Text></>
            ) : (
              <>Yakın iş: <Text style={[styles.opportunityValue, { color: colors.accentAmber }]}>{relatedMatchesCount}</Text></>
            )
          ) : <Text style={styles.opportunityPending}>Uygun sözleşme bekleniyor</Text>}
        </Text>
      </View>
      <ActionButton
        label="Sözleşmeleri Gör" onPress={() => onViewContracts(opportunity)} variant="primary"
        icon="contract" iconSize={12} compact style={styles.opportunityAction}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  opportunityCard: { marginBottom: 9 },
  tradeOpportunityCard: { marginBottom: 8 },
  tradeOpportunityProfit: { ...typography.caption, fontWeight: '800', marginTop: 6 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  productIconBox: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(35,136,255,0.10)',
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardMain: { flex: 1, minWidth: 0 },
  opportunityRoute: { ...typography.bodySmall, fontWeight: '800', color: colors.textPrimary },
  opportunityProduct: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  opportunityMetrics: { marginTop: 4, gap: 1 },
  opportunityLine: { ...typography.caption, color: colors.textMuted },
  opportunityValue: { color: colors.textPrimary, fontWeight: '700' },
  opportunityPending: { color: colors.textMuted, fontStyle: 'italic' },
  opportunityAction: { marginTop: 6, minHeight: 34, paddingVertical: 6, alignSelf: 'flex-start' },
});
