/**
 * Absolute-positioned host for ContextualGuideCard above tab bar.
 *
 * Inactive guides (dismissed / completed) only subscribe to status — near-zero cost.
 * When visible: subtle dim + full-screen interaction blocker under the card.
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { GameIcon } from '../../components/ui';
import { colors } from '../../theme';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { useGameStore } from '../../store/gameStore';
import type { ContextualGuideCardId, ContextualGuideStatus } from '../../types/game';
import ContextualGuideCard from '../components/ContextualGuideCard';
import { useContextualGuideHost } from '../hooks/useContextualGuideHost';
import { isContextualGuideAutoShowAllowed } from '../contextualGuideSequence';

export type ContextualGuideHostProps = {
  cardId: ContextualGuideCardId;
  blockingUi?: boolean;
  /** Extra gap above tab bar (screen-specific CTAs). */
  extraBottomOffset?: number;
  testID?: string;
};

function selectGuideStatus(state: {
  contextualGuide?: { status?: ContextualGuideStatus } | null;
}): ContextualGuideStatus | undefined {
  return state.contextualGuide?.status;
}

type ActiveProps = ContextualGuideHostProps;

function ContextualGuideHostActive({
  cardId,
  blockingUi,
  extraBottomOffset = 0,
  testID,
}: ActiveProps) {
  const { totalBarHeight } = useTabBarLayout();
  const host = useContextualGuideHost(cardId, { blockingUi });

  if (!host.visible) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      testID={testID ? `${testID}-overlay` : undefined}
    >
      {/* Blocks taps on the screen behind the guide; dim keeps context visible. */}
      <View
        pointerEvents="auto"
        style={styles.dim}
        testID={testID ? `${testID}-blocker` : 'contextual-guide-blocker'}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View pointerEvents="box-none" style={styles.anchor}>
        <ContextualGuideCard
          testID={testID ?? `contextual-guide-${cardId}`}
          title={host.title}
          description={host.description}
          primaryLabel={host.primaryLabel}
          currentStep={host.currentStep}
          totalSteps={host.totalSteps}
          bottomOffset={totalBarHeight + extraBottomOffset}
          onPrimaryPress={host.onPrimaryPress}
          onDismiss={host.onDismiss}
          dismissAccessibilityLabel={
            host.allowDismiss ? 'Eğitimden Çık' : undefined
          }
          icon={
            <GameIcon name={host.iconName} size={20} color={colors.accentBlue} />
          }
        />
      </View>
    </View>
  );
}

function ContextualGuideHostComponent({
  cardId,
  blockingUi,
  extraBottomOffset = 0,
  testID,
}: ContextualGuideHostProps) {
  const status = useGameStore(selectGuideStatus);

  if (!isContextualGuideAutoShowAllowed({ status: status ?? 'dismissed' })) {
    return null;
  }

  return (
    <ContextualGuideHostActive
      cardId={cardId}
      blockingUi={blockingUi}
      extraBottomOffset={extraBottomOffset}
      testID={testID}
    />
  );
}

const ContextualGuideHost = memo(ContextualGuideHostComponent);
export default ContextualGuideHost;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 40,
    elevation: 40,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 18, 32, 0.22)',
  },
  anchor: {
    width: '100%',
    zIndex: 1,
  },
});
