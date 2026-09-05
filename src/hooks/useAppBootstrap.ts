import { useCallback, useEffect, useState } from 'react';

import { initAnonymousAuth } from '../services/authService';
import { configureGoogleSignIn } from '../services/googleAuthService';
import { logProductionBuildConfigOnce } from '../services/productionBuildAudit';
import type { SaveRecoveryProbeResult } from '../services/saveRecoveryService';
import { logFirebaseRuntimeConfigOnce } from '../utils/firebaseRuntimeConfig';
import { logStartupError } from '../utils/startupErrors';
import { markStartup } from '../utils/startupPerformance';
import { useGameStore } from '../store/gameStore';

export type AppBootPhase = 'loading' | 'recovery' | 'ready';

export type AppBootstrapState = {
  bootPhase: AppBootPhase;
  bootHint: string;
  recoveryProbe: SaveRecoveryProbeResult | null;
  handleRecoveryComplete: () => void;
};

/**
 * Owns local-first boot, save-recovery probing and the parallel auth bootstrap.
 * Game initialization deliberately remains local-first and does not await Firebase.
 */
export function useAppBootstrap(): AppBootstrapState {
  const [bootPhase, setBootPhase] = useState<AppBootPhase>('loading');
  const [bootHint, setBootHint] = useState('Şirket hazırlanıyor...');
  const [recoveryProbe, setRecoveryProbe] = useState<SaveRecoveryProbeResult | null>(null);

  const startGame = useCallback(async () => {
    try {
      await useGameStore.getState().initializeGame();
      setBootPhase('ready');
    } catch (error) {
      logStartupError('initialize-game', error);
      setBootPhase('ready');
    }
  }, []);

  const handleRecoveryComplete = useCallback(() => {
    void (async () => {
      try {
        const { invalidateSaveRecoveryColdStartProbe, probeSaveRecoveryWithCloudAttempt } =
          await import('../services/saveRecoveryService');
        invalidateSaveRecoveryColdStartProbe();
        const probe = await probeSaveRecoveryWithCloudAttempt({ force: true });
        if (probe.required && !probe.quarantine?.userChoseNewGame) {
          setRecoveryProbe(probe);
          setBootPhase('recovery');
          return;
        }
        await startGame();
      } catch (error) {
        logStartupError('recovery-complete', error);
        await startGame();
      }
    })();
  }, [startGame]);

  useEffect(() => {
    markStartup('JS_READY');
    // Local-first: persistence/recovery resolves before game hydration. Auth starts in
    // parallel because local gameplay must not wait for a network dependency.
    let cancelled = false;
    void (async () => {
      try {
        configureGoogleSignIn();
        logFirebaseRuntimeConfigOnce();
        setBootHint('Kayıt yükleniyor...');
        const { probeSaveRecoveryOnColdStart } = await import(
          '../services/saveRecoveryService'
        );
        const probe = await probeSaveRecoveryOnColdStart();
        if (cancelled) return;
        logProductionBuildConfigOnce();
        if (probe.required && !probe.quarantine?.userChoseNewGame) {
          setRecoveryProbe(probe);
          setBootPhase('recovery');
          void (async () => {
            markStartup('AUTH_INIT_START');
            try {
              await initAnonymousAuth();
            } catch (error) {
              logStartupError('auth-init-recovery', error);
            } finally {
              markStartup('AUTH_INIT_DONE');
            }
            if (cancelled) return;
            try {
              const {
                invalidateSaveRecoveryColdStartProbe,
                probeSaveRecoveryWithCloudAttempt,
              } = await import('../services/saveRecoveryService');
              invalidateSaveRecoveryColdStartProbe();
              const cloudProbe = await probeSaveRecoveryWithCloudAttempt({ force: true });
              if (cancelled) return;
              if (!cloudProbe.required || cloudProbe.quarantine?.userChoseNewGame) {
                await startGame();
              }
            } catch (error) {
              logStartupError('save-recovery-cloud-probe', error);
              await startGame();
            }
          })();
          return;
        }
        await startGame();
      } catch (error) {
        logStartupError('cold-start', error);
        try {
          await startGame();
        } catch (startError) {
          logStartupError('cold-start-fallback', startError);
        }
      }
    })();

    void (async () => {
      markStartup('AUTH_INIT_START');
      try {
        await initAnonymousAuth();
      } catch (error) {
        logStartupError('auth-init', error);
      } finally {
        markStartup('AUTH_INIT_DONE');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startGame]);

  return { bootPhase, bootHint, recoveryProbe, handleRecoveryComplete };
}
