import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UI } from '../theme/ui';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export default function ScreenHeader({ title, subtitle, right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerMain}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: UI.spacing.section,
  },
  headerMain: {
    flex: 1,
    marginRight: 12,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  title: {
    color: UI.colors.text,
    fontSize: UI.typography.title,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: UI.colors.textSecondary,
    fontSize: UI.typography.subtitle,
    marginTop: 4,
    lineHeight: 18,
  },
});
