import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, typography } from '../../theme';
import { ACCOUNT_CARD_PADDING, accountCardStyle } from './accountCenterTheme';

export interface AccountSectionCardProps {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  headerRight?: React.ReactNode;
  compact?: boolean;
}

export default function AccountSectionCard({
  title,
  children,
  style,
  headerRight,
  compact = false,
}: AccountSectionCardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={[styles.headerRow, compact && styles.headerRowCompact]}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {headerRight}
        </View>
      ) : null}
      <View style={[styles.body, !title && styles.bodyStandalone, compact && styles.bodyCompact]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...accountCardStyle,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingTop: ACCOUNT_CARD_PADDING,
    paddingBottom: 6,
  },
  headerRowCompact: {
    paddingBottom: 4,
  },
  title: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  body: {
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingBottom: ACCOUNT_CARD_PADDING,
    gap: 8,
  },
  bodyCompact: {
    gap: 4,
    paddingBottom: 12,
  },
  bodyStandalone: {
    paddingTop: ACCOUNT_CARD_PADDING,
  },
});
