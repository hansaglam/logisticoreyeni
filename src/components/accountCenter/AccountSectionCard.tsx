import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, typography } from '../../theme';
import { ACCOUNT_CARD_PADDING, accountCardStyle } from './accountCenterTheme';

export interface AccountSectionCardProps {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  headerRight?: React.ReactNode;
}

export default function AccountSectionCard({
  title,
  children,
  style,
  headerRight,
}: AccountSectionCardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {headerRight}
        </View>
      ) : null}
      <View style={[styles.body, !title && styles.bodyStandalone]}>{children}</View>
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
    gap: 12,
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingTop: ACCOUNT_CARD_PADDING,
    paddingBottom: 8,
  },
  title: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
  },
  body: {
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingBottom: ACCOUNT_CARD_PADDING,
    gap: 10,
  },
  bodyStandalone: {
    paddingTop: ACCOUNT_CARD_PADDING,
  },
});
