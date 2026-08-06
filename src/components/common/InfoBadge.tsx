import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { MIN_TOUCH_TARGET, getSafeModalMaxHeight } from '../../constants/layout';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';

interface InfoBadgeProps {
  title: string;
  description: string;
}

export default function InfoBadge({ title, description }: InfoBadgeProps) {
  const [visible, setVisible] = useState(false);
  const insets = useAppSafeAreaInsets();
  const { height } = useWindowDimensions();
  const cardMaxHeight = getSafeModalMaxHeight(height, insets, 0.7);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={styles.iconGlyph}>
          <Text style={styles.iconText}>i</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={[styles.card, { maxHeight: cardMaxHeight }]}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.description}>{description}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setVisible(false)}>
              <Text style={styles.closeButtonText}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  iconGlyph: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
    width: '100%',
  },
  title: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  description: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
  },
  closeButton: {
    marginTop: 14,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
});
