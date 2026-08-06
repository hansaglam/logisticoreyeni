/**
 * Kullanıcı adı belirleme / düzenleme modalı.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  USERNAME_MAX_LENGTH,
  usernameReasonMessage,
  validateUsernameFormat,
} from '../../domain/usernameValidation';
import { getFirebaseAuthSafe } from '../../services/firebase';
import {
  checkUsernameAvailability,
  setUsername,
} from '../../services/usernameService';
import { colors, radius, spacing, typography } from '../../theme';
import { ActionButton } from '../ui';

export type UsernameModalMode = 'setup' | 'edit';

interface UsernameSetupModalProps {
  visible: boolean;
  mode: UsernameModalMode;
  initialUsername?: string | null;
  suggestedUsername?: string;
  nextChangeAvailableAtMs?: number | null;
  onClose: () => void;
  onSaved: (username: string) => void;
}

function formatCooldown(nextAtMs: number): string {
  const remaining = Math.max(0, nextAtMs - Date.now());
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  if (days <= 1) return 'Yaklaşık 1 gün sonra tekrar değiştirebilirsin.';
  return `${days} gün sonra tekrar değiştirebilirsin.`;
}

export default function UsernameSetupModal({
  visible,
  mode,
  initialUsername,
  suggestedUsername,
  nextChangeAvailableAtMs,
  onClose,
  onSaved,
}: UsernameSetupModalProps) {
  const [value, setValue] = useState(initialUsername ?? suggestedUsername ?? '');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitLock = useRef(false);
  const checkGenerationRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setValue(initialUsername ?? suggestedUsername ?? '');
    setStatusText(null);
    setStatusOk(false);
    setSubmitting(false);
    submitLock.current = false;
    checkGenerationRef.current += 1;
  }, [visible, initialUsername, suggestedUsername]);

  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setStatusText(null);
      setStatusOk(false);
      return;
    }
    const local = validateUsernameFormat(trimmed);
    if (!local.ok) {
      setStatusOk(false);
      setStatusText(usernameReasonMessage(local.reason));
      return;
    }
    if (mode === 'edit' && initialUsername && local.username === initialUsername) {
      setStatusOk(true);
      setStatusText('Mevcut kullanıcı adın');
      return;
    }
    setChecking(true);
    const generation = checkGenerationRef.current + 1;
    checkGenerationRef.current = generation;
    const uidAtStart = getFirebaseAuthSafe()?.currentUser?.uid ?? null;
    debounceRef.current = setTimeout(() => {
      void (async () => {
        const result = await checkUsernameAvailability(local.username);
        if (generation !== checkGenerationRef.current) {
          return;
        }
        const uidNow = getFirebaseAuthSafe()?.currentUser?.uid ?? null;
        if (uidAtStart !== uidNow) {
          setChecking(false);
          setStatusOk(false);
          setStatusText(usernameReasonMessage('auth-required'));
          return;
        }
        setChecking(false);
        if (!result.ok) {
          setStatusOk(false);
          setStatusText(usernameReasonMessage(result.reason));
          return;
        }
        if (!result.available) {
          setStatusOk(false);
          setStatusText(usernameReasonMessage(result.reason ?? 'username-taken'));
          return;
        }
        setStatusOk(true);
        setStatusText('Müsait');
      })();
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      checkGenerationRef.current += 1;
    };
  }, [value, visible, mode, initialUsername]);

  const cooldownBlocked =
    mode === 'edit' &&
    typeof nextChangeAvailableAtMs === 'number' &&
    nextChangeAvailableAtMs > Date.now() &&
    value.trim() !== (initialUsername ?? '');

  const canSubmit = useMemo(() => {
    if (submitting || checking || cooldownBlocked) return false;
    const local = validateUsernameFormat(value);
    return local.ok && statusOk;
  }, [checking, cooldownBlocked, statusOk, submitting, value]);

  const handleSubmit = async () => {
    if (!canSubmit || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const result = await setUsername(value.trim());
      if (!result.ok) {
        setStatusOk(false);
        setStatusText(
          result.reason === 'username-change-cooldown' && result.nextChangeAvailableAtMs
            ? formatCooldown(result.nextChangeAvailableAtMs)
            : usernameReasonMessage(result.reason),
        );
        return;
      }
      onSaved(result.username);
      onClose();
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {mode === 'setup' ? 'Kullanıcı Adını Belirle' : 'Kullanıcı Adını Düzenle'}
          </Text>
          <Text style={styles.subtitle}>
            Bu ad liderlik tablosunda, Araç Pazarı’nda ve diğer oyunculara görünen alanlarda
            kullanılacak.
          </Text>

          {mode === 'edit' && initialUsername ? (
            <Text style={styles.current}>Mevcut: {initialUsername}</Text>
          ) : null}

          <TextInput
            value={value}
            onChangeText={(text) => setValue(text.slice(0, USERNAME_MAX_LENGTH))}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={USERNAME_MAX_LENGTH}
            placeholder="ornek_oyuncu"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            editable={!submitting}
          />

          <View style={styles.statusRow}>
            {checking ? <ActivityIndicator size="small" color={colors.accentBlue} /> : null}
            <Text
              style={[styles.statusText, statusOk ? styles.statusOk : styles.statusBad]}
              numberOfLines={2}
            >
              {cooldownBlocked && nextChangeAvailableAtMs
                ? formatCooldown(nextChangeAvailableAtMs)
                : statusText ?? ' '}
            </Text>
          </View>

          <ActionButton
            label={submitting ? 'Kaydediliyor…' : 'Devam Et'}
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            variant="primary"
            style={styles.submit}
          />

          <Pressable onPress={onClose} disabled={submitting} style={styles.later}>
            <Text style={styles.laterText}>
              {mode === 'setup' ? 'Daha sonra' : 'İptal'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: '#0B1422',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.35)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  current: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
  input: {
    marginTop: spacing.xs,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.35)',
    backgroundColor: 'rgba(8, 20, 38, 0.95)',
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  statusRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  statusOk: {
    color: colors.success,
  },
  statusBad: {
    color: colors.amber,
  },
  submit: {
    marginTop: spacing.xs,
    minHeight: 52,
  },
  later: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  laterText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 13,
  },
});
