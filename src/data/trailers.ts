/**
 * LogistiCore - Dorse kataloğu (Trailer System V1)
 */

import type { ContractType, ProductId, Trailer, TrailerType } from '../types/game';

export interface TrailerMarketItem {
  id: string;
  name: string;
  type: TrailerType;
  capacityBonusTons: number;
  purchasePrice: number;
  compatibleCargoTypes?: ProductId[];
  compatibleContractTypes?: ContractType[];
  description: string;
  requiredLevel?: number;
}

export const TRAILER_MARKET: TrailerMarketItem[] = [
  {
    id: 'trailer-standard',
    name: 'Standart Dorse',
    type: 'standard',
    capacityBonusTons: 35,
    purchasePrice: 22_000,
    description: 'Orta ve ağır genel yükler için ek kapasite sağlar.',
    requiredLevel: 3,
  },
  {
    id: 'trailer-heavy',
    name: 'Ağır Yük Dorsesi',
    type: 'heavy',
    capacityBonusTons: 70,
    purchasePrice: 48_000,
    compatibleContractTypes: ['bulk', 'standard', 'high_reputation'],
    compatibleCargoTypes: ['machinery', 'steel'],
    description: 'Makine, çelik ve yüksek tonajlı işler için.',
    requiredLevel: 5,
  },
  {
    id: 'trailer-refrigerated',
    name: 'Soğutmalı Dorse',
    type: 'refrigerated',
    capacityBonusTons: 40,
    purchasePrice: 52_000,
    compatibleContractTypes: ['refrigerated'],
    compatibleCargoTypes: ['fruit', 'beverage'],
    description: 'Meyve, içecek ve soğuk zincir işleri için.',
    requiredLevel: 6,
  },
  {
    id: 'trailer-container',
    name: 'Konteyner Dorsesi',
    type: 'container',
    capacityBonusTons: 55,
    purchasePrice: 42_000,
    compatibleCargoTypes: ['electronics', 'textile', 'furniture'],
    description: 'Elektronik, tekstil ve liman bağlantılı yükler için.',
    requiredLevel: 4,
  },
];

export function findTrailerMarketItem(catalogId: string): TrailerMarketItem | undefined {
  return TRAILER_MARKET.find((item) => item.id === catalogId);
}

export function createTrailerFromTemplate(
  template: TrailerMarketItem,
  params: {
    id: string;
    city: string;
    createdAtGameTime: number;
  },
): Trailer {
  return {
    id: params.id,
    catalogId: template.id,
    name: template.name,
    type: template.type,
    capacityBonusTons: template.capacityBonusTons,
    compatibleCargoTypes: template.compatibleCargoTypes,
    compatibleContractTypes: template.compatibleContractTypes,
    purchasePrice: template.purchasePrice,
    condition: 100,
    city: params.city,
    status: 'idle',
    attachedTruckId: null,
    isOwned: true,
    createdAtGameTime: params.createdAtGameTime,
  };
}
