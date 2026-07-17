/**
 * Kamyon görünen adları — gerçek marka/model yerine kurmaca isimler.
 * Internal catalog id'ler değişmez; yalnızca user-facing name güncellenir.
 */

import { getTruckCatalogId } from '../data/trucks';
import type { Player, Truck } from '../types/game';

/** Katalog id → kanonik görünen ad */
export const TRUCK_CATALOG_DISPLAY_NAMES: Record<string, string> = {
  'truck-starter-1': 'İzmir Express',
  'truck-ford-cargo': 'Fordan CargoPro',
  'truck-volvo-fh': 'Nordvik Titan',
  'truck-mercedes-actros': 'Sternberg Atlas',
  'truck-refrigerated': 'Ege Coldline',
  'truck-heavy-haul': 'Marmara Heavy',
};

/** Eski kayıtlardaki tam eşleşen isimler → yeni isim */
const LEGACY_TRUCK_NAME_EXACT: Record<string, string> = {
  'Ford Cargo 1833': 'Fordan CargoPro',
  'Ford Cargo 1833 (Kiralık)': 'Fordan CargoPro (Kiralık)',
  'Volvo FH 460': 'Nordvik Titan',
  'Volvo FH 460 (Kiralık)': 'Nordvik Titan (Kiralık)',
  'Volvo FH16': 'Nordvik Titan',
  'Volvo FH 16': 'Nordvik Titan',
  'Mercedes Actros': 'Sternberg Atlas',
  'Mercedes Actros (Kiralık)': 'Sternberg Atlas (Kiralık)',
  'Mercedes-Benz Actros': 'Sternberg Atlas',
  'Scania R Serisi': 'Skandia R-Line',
  'Scania R-Series': 'Skandia R-Line',
  'MAN TGX': 'Mandor X',
  'DAF XF': 'Daxon FX',
  'Iveco S-Way': 'Evico Wayline',
  'Renault Trucks': 'Renard Haul',
  'Renault Truck': 'Renard Haul',
  'Owned Volvo': 'Nordvik Titan',
  'Ağır Yük Kamyonu': 'Marmara Heavy',
  'Soğutmalı Kamyon': 'Ege Coldline',
};

/** İsim içinde geçen gerçek marka ifadeleri → kurmaca karşılık */
const LEGACY_TRUCK_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/Ford\s+Cargo\s*1833?/gi, 'Fordan CargoPro'],
  [/Mercedes[\s-]*Actros/gi, 'Sternberg Atlas'],
  [/Mercedes[\s-]*Benz/gi, 'Sternberg'],
  [/Volvo\s+FH\s*16?/gi, 'Nordvik Titan'],
  [/Volvo\s+FH/gi, 'Nordvik Titan'],
  [/\bVolvo\b/gi, 'Nordvik'],
  [/Scania\s+R[\s-]*Serisi/gi, 'Skandia R-Line'],
  [/\bScania\b/gi, 'Skandia'],
  [/MAN\s+TGX/gi, 'Mandor X'],
  [/\bMAN\b/gi, 'Mandor'],
  [/DAF\s+XF/gi, 'Daxon FX'],
  [/\bDAF\b/gi, 'Daxon'],
  [/Iveco\s+S[\s-]*Way/gi, 'Evico Wayline'],
  [/\bIveco\b/gi, 'Evico'],
  [/Renault\s+Trucks?/gi, 'Renard Haul'],
  [/\bRenault\b/gi, 'Renard'],
];

const LEASE_SUFFIX = /(\s*\(Kiralık\))\s*$/i;

function stripLeaseSuffix(name: string): { base: string; leased: boolean } {
  const match = name.match(LEASE_SUFFIX);
  if (!match) {
    return { base: name.trim(), leased: false };
  }
  return { base: name.replace(LEASE_SUFFIX, '').trim(), leased: true };
}

function applyLeaseSuffix(name: string, leased: boolean): string {
  if (!leased) return name;
  if (LEASE_SUFFIX.test(name)) return name;
  return `${name} (Kiralık)`;
}

function sanitizeLegacyTruckName(name: string): string {
  const exact = LEGACY_TRUCK_NAME_EXACT[name];
  if (exact) return exact;

  const { base, leased } = stripLeaseSuffix(name);
  const exactBase = LEGACY_TRUCK_NAME_EXACT[base];
  if (exactBase) {
    return applyLeaseSuffix(exactBase, leased);
  }

  let sanitized = base;
  for (const [pattern, replacement] of LEGACY_TRUCK_NAME_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  if (sanitized !== base) {
    return applyLeaseSuffix(sanitized.trim(), leased);
  }

  return name;
}

/** Kamyon için güncel görünen adı çözümler (katalog id öncelikli). */
export function resolveTruckDisplayName(truck: Pick<Truck, 'id' | 'catalogId' | 'name'>): string {
  const catalogId = getTruckCatalogId(truck);
  const canonical = TRUCK_CATALOG_DISPLAY_NAMES[catalogId];
  const { leased } = stripLeaseSuffix(truck.name);

  if (canonical) {
    return applyLeaseSuffix(canonical, leased);
  }

  return sanitizeLegacyTruckName(truck.name);
}

export function migrateTruckDisplayName<T extends Pick<Truck, 'id' | 'catalogId' | 'name'>>(truck: T): T {
  const nextName = resolveTruckDisplayName(truck);
  if (nextName === truck.name) {
    return truck;
  }
  return { ...truck, name: nextName };
}

export function migratePlayerTruckNames(player: Player): Player {
  if (!Array.isArray(player.trucks) || player.trucks.length === 0) {
    return player;
  }

  let changed = false;
  const trucks = player.trucks.map((truck) => {
    const migrated = migrateTruckDisplayName(truck);
    if (migrated !== truck) {
      changed = true;
    }
    return migrated;
  });

  return changed ? { ...player, trucks } : player;
}
