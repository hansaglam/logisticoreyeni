import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import {
  buildRecoverySummary,
  confirmStartNewGameAfterRecovery,
  exportRawSaveForUser,
  restoreFromCloudSave,
  restoreFromLocalBackup,
  type SaveRecoveryProbeResult,
} from '../services/saveRecoveryService';
import { colors, spacing, typography } from '../theme';
import type { SaveRecoveryQuarantine } from '../storage/saveRecoveryQuarantine';

interface SaveRecoveryScreenProps {
  probe: SaveRecoveryProbeResult;
  onRecoveryComplete: () => void;
}

type RecoveryOperation = 'idle' | 'restoring-cloud' | 'restoring-local' | 'exporting' | 'starting-new-game';

type RecoveryAction = Exclude<RecoveryOperation, 'idle'>;

const ACTION_TO_OPERATION: Record<RecoveryAction, RecoveryOperation> = {
  'restoring-cloud': 'restoring-cloud',
  'restoring-local': 'restoring-local',
  exporting: 'exporting',
  'starting-new-game': 'starting-new-game',
};

export default function SaveRecoveryScreen({ probe, onRecoveryComplete }: SaveRecoveryScreenProps) {
  const { alert, showDialog } = useAppDialog();
  const [operation, setOperation] = useState<RecoveryOperation>('idle');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const operationRef = useRef<RecoveryOperation>('idle');

  const summary = useMemo(
    () => buildRecoverySummary(probe.quarantine),
    [probe.quarantine],
  );

  const setOperationSafe = useCallback((next: RecoveryOperation) => {
    operationRef.current = next;
    setOperation(next);
  }, []);

  const runRecoveryAction = useCallback(
    async (
      action: RecoveryAction,
      runner: () => Promise<{ ok: boolean; error?: string; stayOnScreen?: boolean }>,
    ) => {
      if (operationRef.current !== 'idle') return;
      setOperationSafe(ACTION_TO_OPERATION[action]);
      try {
        const result = await runner();
        if (result.ok) {
          if (!result.stayOnScreen) {
            onRecoveryComplete();
          }
          return;
        }
        await alert('Kurtarma Başarısız', result.error ?? 'İşlem tamamlanamadı.');
      } catch (error) {
        console.warn('[SaveRecoveryScreen] action failed:', error);
        await alert(
          'Kurtarma Başarısız',
          error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        );
      } finally {
        setOperationSafe('idle');
      }
    },
    [alert, onRecoveryComplete, setOperationSafe],
  );

  const handleCloudRestore = () => {
    void runRecoveryAction('restoring-cloud', async () => {
      const result = await restoreFromCloudSave();
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    });
  };

  const handleLocalRestore = () => {
    void runRecoveryAction('restoring-local', async () => {
      const result = await restoreFromLocalBackup();
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    });
  };

  const handleExport = () => {
    void runRecoveryAction('exporting', async () => {
      const result = await exportRawSaveForUser();
      if (result.ok) {
        await alert('Dışa Aktarma', 'Kayıt paylaşım penceresi açıldı.');
        return { ok: true, stayOnScreen: true };
      }
      return { ok: false, error: result.error };
    });
  };

  const handleNewGame = () => {
    if (operationRef.current !== 'idle') return;
    showDialog({
      title: 'Yeni Oyuna Başla',
      message:
        'Bozuk kayıt arşivlenecek ve yeni oyun oluşturulacak. Bu işlem mevcut aktif kaydın yerine geçer.',
      variant: 'warning',
      confirmLabel: 'Devam Et',
      cancelLabel: 'Vazgeç',
      onConfirm: () => {
        showDialog({
          title: 'Emin misin?',
          message:
            'Bozuk kayıt cihazda arşivlenir; bulut kaydı silinmez. Onayladıktan sonra temiz bir oyun başlar.',
          variant: 'danger',
          destructive: true,
          confirmLabel: 'Yeni Oyuna Başla',
          cancelLabel: 'İptal',
          onConfirm: () => {
            void runRecoveryAction('starting-new-game', async () => {
              const result = await confirmStartNewGameAfterRecovery();
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            });
          },
        });
      },
    });
  };

  const isBusy = operation !== 'idle';

  return (
    <View style={styles.root} pointerEvents="box-none">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Kayıt doğrulanamadı</Text>
        <Text style={styles.subtitle}>{summary}</Text>
        {probe.fatal ? (
          <Text style={styles.fatalNote}>
            Yedek yazılamadı; ana kayıt korunuyor. Dışa aktarma veya bulut geri yüklemeyi dene.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <RecoveryButton
            label="Bulut Kaydını Geri Yükle"
            description="Hesabınıza bağlı son güvenli kaydı indirir."
            loading={operation === 'restoring-cloud'}
            disabled={isBusy && operation !== 'restoring-cloud'}
            onPress={handleCloudRestore}
          />
          <RecoveryButton
            label="Yerel Yedeği Dene"
            description="Cihazdaki önceki kayıtları kontrol eder."
            loading={operation === 'restoring-local'}
            disabled={isBusy && operation !== 'restoring-local'}
            onPress={handleLocalRestore}
          />
          <RecoveryButton
            label="Kayıt Dosyasını Dışa Aktar"
            description="Destek ekibiyle paylaşmak için kaydı dışa aktarır."
            loading={operation === 'exporting'}
            disabled={isBusy && operation !== 'exporting'}
            onPress={handleExport}
          />
          <RecoveryButton
            label="Yeni Oyuna Başla"
            description="Bozuk kaydı arşivleyip temiz bir oyun başlatır."
            tone="destructive"
            loading={operation === 'starting-new-game'}
            disabled={isBusy && operation !== 'starting-new-game'}
            onPress={handleNewGame}
          />
        </View>

        {probe.quarantine ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowTechnicalDetails((value) => !value)}
            style={styles.technicalToggle}
          >
            <Text style={styles.technicalToggleLabel}>
              {showTechnicalDetails ? 'Teknik ayrıntıları gizle' : 'Teknik ayrıntıları göster'}
            </Text>
          </Pressable>
        ) : null}
        {showTechnicalDetails && probe.quarantine ? (
          <QuarantineDetails quarantine={probe.quarantine} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function QuarantineDetails({ quarantine }: { quarantine: SaveRecoveryQuarantine }) {
  return (
    <View style={styles.detailsCard}>
      <DetailRow label="Sebep" value={quarantine.reason} />
      <DetailRow label="Aşama" value={quarantine.stage} />
      <DetailRow
        label="Sürüm"
        value={quarantine.saveVersion != null ? String(quarantine.saveVersion) : '—'}
      />
      <DetailRow label="Checksum" value={quarantine.checksumStatus} />
      <DetailRow label="Deneme" value={String(quarantine.recoveryAttempts)} />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function RecoveryButton({
  label,
  description,
  onPress,
  loading,
  disabled,
  tone = 'primary',
}: {
  label: string;
  description: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'destructive';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'destructive' ? styles.buttonDestructive : styles.buttonPrimary,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && !loading && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} />
      ) : (
        <View style={styles.buttonContent}>
          <Text style={styles.buttonLabel}>{label}</Text>
          <Text style={styles.buttonDescription}>{description}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  title: {
    ...typography.screenTitle,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  fatalNote: {
    ...typography.caption,
    color: colors.amber,
    textAlign: 'center',
  },
  detailsCard: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  detailValue: {
    ...typography.caption,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonDestructive: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonContent: {
    alignItems: 'center',
    gap: 2,
  },
  buttonLabel: {
    ...typography.buttonText,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  buttonDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  technicalToggle: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  technicalToggleLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
