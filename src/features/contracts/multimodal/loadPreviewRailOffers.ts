/**
 * Internal-only RAIL offer preview session (Map V2 Step 28).
 * Does not write save, mutate store, or insert into Contract[].
 */

import type { Driver, Trailer, Truck, Delivery, TruckTransfer } from '../../../types/game';
import { prepareRailMultimodalAcceptance } from '../../../domain/multimodalRailAcceptance';
import {
  evaluateRailMultimodalOfferAcceptance,
  generateRailMultimodalOffers,
  type RailMultimodalOffer,
} from '../../../domain/multimodalRailOffer';
import type { PersistedMultimodalShipment } from '../../../domain/multimodalShipmentPersistence';
import {
  isMultimodalUiPreviewEnabled,
  MULTIMODAL_UI_PREVIEW_SEED,
} from '../../../domain/multimodalUiPreviewGate';
import {
  presentRailMultimodalOffers,
  type RailOfferCardViewModel,
} from '../../../domain/presentation/multimodalRailOfferPresentation';
import { getTurkeyRoadTransferAccessArtifact } from '../../../mapV2/world/multimodalRoadTransferAccessLoader';

export type RailPreviewUiStatus = 'hidden' | 'ready' | 'empty' | 'error';

export type RailPreviewSession = {
  status: RailPreviewUiStatus;
  generationSeed: string;
  offers: readonly RailMultimodalOffer[];
  viewModels: readonly RailOfferCardViewModel[];
};

export const HIDDEN_RAIL_PREVIEW_SESSION: RailPreviewSession = {
  status: 'hidden',
  generationSeed: '',
  offers: [],
  viewModels: [],
};

export function loadPreviewRailOffers(input?: {
  playerLevel?: number;
  trucks?: readonly Truck[];
  drivers?: readonly Driver[];
  trailers?: readonly Trailer[];
  activeDeliveries?: readonly Delivery[];
  activeTransfers?: readonly TruckTransfer[];
  currentTime?: number;
  previewEnabled?: boolean;
  generationSeed?: string;
  mutationEnabled?: boolean;
  multimodalShipments?: readonly PersistedMultimodalShipment[];
}): RailPreviewSession {
  const previewEnabled = input?.previewEnabled ?? isMultimodalUiPreviewEnabled();
  const mutationEnabled = input?.mutationEnabled === true;
  if (!previewEnabled && !mutationEnabled) {
    return HIDDEN_RAIL_PREVIEW_SESSION;
  }

  try {
    const accessArtifact = getTurkeyRoadTransferAccessArtifact();
    const generationSeed = input?.generationSeed ?? MULTIMODAL_UI_PREVIEW_SEED;
    const generated = generateRailMultimodalOffers({
      generationSeed,
      accessArtifact,
      playerLevel: input?.playerLevel,
    });
    if (generated.status !== 'READY') {
      return {
        status: 'error',
        generationSeed,
        offers: [],
        viewModels: [],
      };
    }

    const fleet =
      input?.trucks && input.drivers && input.trailers
        ? {
            trucks: input.trucks,
            drivers: input.drivers,
            trailers: input.trailers,
            activeDeliveries: input.activeDeliveries,
            activeTransfers: input.activeTransfers,
            currentTime: input.currentTime,
          }
        : null;

    const acceptanceByOfferId = new Map(
      generated.offers.map((offer) => [
        offer.offerId,
        evaluateRailMultimodalOfferAcceptance({
          offer,
          accessArtifact,
          fleet,
          productionCheck: false,
        }),
      ]),
    );

    const acceptReadyByOfferId = new Map<
      string,
      { ready: boolean; reason?: string | null; alreadyAccepted?: boolean }
    >();
    if (mutationEnabled && fleet) {
      for (const offer of generated.offers) {
        const prepared = prepareRailMultimodalAcceptance({
          offer,
          accessArtifact,
          fleet,
          shipments: input.multimodalShipments ?? [],
          currentTimeGameHours: input.currentTime ?? 0,
          nowMs: 0,
          allowAcceptance: true,
        });
        acceptReadyByOfferId.set(offer.offerId, {
          ready: prepared.status === 'READY_TO_COMMIT',
          reason: prepared.status === 'READY_TO_COMMIT' ? null : prepared.reason,
          alreadyAccepted: prepared.status === 'OFFER_ALREADY_ACCEPTED',
        });
      }
    }

    const viewModels = presentRailMultimodalOffers(generated.offers, acceptanceByOfferId, {
      mutationEnabled,
      acceptReadyByOfferId,
    });
    return {
      status: viewModels.length === 0 ? 'empty' : 'ready',
      generationSeed,
      offers: generated.offers,
      viewModels,
    };
  } catch {
    return {
      status: 'error',
      generationSeed: input?.generationSeed ?? MULTIMODAL_UI_PREVIEW_SEED,
      offers: [],
      viewModels: [],
    };
  }
}
