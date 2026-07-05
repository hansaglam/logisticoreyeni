import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface InfoBadgeProps {
  title: string;
  description: string;
}

export default function InfoBadge({ title, description }: InfoBadgeProps) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.iconButton}
      >
        <Text style={styles.iconText}>i</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>
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
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
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
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
});
