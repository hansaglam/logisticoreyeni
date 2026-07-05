import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

interface ListRowCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: GameIconName;
  right?: React.ReactNode;
  onPress?: () => void;
}

export default function ListRowCard({
  title,
  subtitle,
  meta,
  icon,
  right,
  onPress,
}: ListRowCardProps) {
  const content = (
    <>
      {icon ? (
        <View style={styles.iconWrap}>
          <GameIcon name={icon} size={18} color={colors.accentBlue} />
        </View>
      ) : null}
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.card}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.cardTitle,
  },
  subtitle: {
    ...typography.bodySmall,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.textSecondary,
  },
  right: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
});
