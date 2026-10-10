/**
 * PRODUCTION FEATURE-FLAG PROTOTYPES — NOT WIRED.
 * Do not import from runtime. Default remains fully off.
 */
export type MultimodalRolloutMode =
  | 'MULTIMODAL_OFF'
  | 'DEV_PREVIEW'
  | 'INTERNAL_TEST'
  | 'PRODUCTION_ROLLOUT';

export type MultimodalModeGate = {
  RAIL: boolean;
  SEA: boolean;
  AIR: boolean;
};

export type MultimodalFeatureFlags = {
  rollout: MultimodalRolloutMode;
  /** When false, generator must not create new multimodal offers. Existing shipments still execute. */
  allowNewMultimodalContractCreation: boolean;
  /** When false, UI hides multimodal offers; persisted shipments remain loadable. */
  showMultimodalOffersInUi: boolean;
  modeGates: MultimodalModeGate;
};

export const DEFAULT_MULTIMODAL_FEATURE_FLAGS: MultimodalFeatureFlags = {
  rollout: 'MULTIMODAL_OFF',
  allowNewMultimodalContractCreation: false,
  showMultimodalOffersInUi: false,
  modeGates: { RAIL: false, SEA: false, AIR: false },
};
