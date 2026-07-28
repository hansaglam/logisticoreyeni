/**
 * mapRoadNetwork.ts
 *
 * Normalize (0–1) polyline verileri — turkey-logistics-network-map.png ana yollarına hizalı.
 *
 * Kalibrasyon:
 * 1) debug.ts → mapCalibrationEnabled: true
 * 2) Haritada yol üzerine dokun → konsol { x, y }
 * 3) Ara noktaları buraya ekle; uç noktalar WORLD_MAP_POSITIONS ile eşleşmeli
 */

import { WORLD_MAP_POSITIONS } from './worldMapPositions';
import { getResolvedMapDebugFlags } from '../config/debug';
import { debugWarn } from '../utils/debugLog';

export type MapRoadPoint = {
  x: number;
  y: number;
};

export type MapRoadSegment = {
  id: string;
  fromCityId: string;
  toCityId: string;
  points: MapRoadPoint[];
  /** false → graph routing kullanmaz; points kalibre edilene kadar boş bırakılır */
  isCalibrated?: boolean;
};

/** Segment graph routing için kullanılabilir mi? (undefined isCalibrated = true sayılır) */
export function isValidMapRoadPoint(point: MapRoadPoint): boolean {
  if (typeof point.x === 'string' || typeof point.y === 'string') {
    debugWarn(
      getResolvedMapDebugFlags().roadWarnings,
      '[map-road] invalid point type — string coordinate',
      point,
    );
    return false;
  }
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function countValidMapRoadPoints(points: MapRoadPoint[]): number {
  return points.filter(isValidMapRoadPoint).length;
}

export type MapRoadSegmentExclusionReason =
  | 'included'
  | 'not-calibrated'
  | 'insufficient-points'
  | 'invalid-point'
  | 'invalid-city'
  | 'duplicate-id';

export interface MapRoadSegmentCheck {
  id: string;
  fromCityId: string;
  toCityId: string;
  isCalibrated: boolean;
  pointCount: number;
  validPointCount: number;
  includedInGraph: boolean;
  exclusionReason: MapRoadSegmentExclusionReason;
}

const KNOWN_ROAD_CITY_IDS = new Set<string>([
  'istanbul',
  'bursa',
  'ankara',
  'izmir',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
]);

export function getMapRoadSegmentExclusionReason(
  segment: MapRoadSegment,
  options?: { duplicateIds?: Set<string> },
): MapRoadSegmentExclusionReason {
  if (options?.duplicateIds?.has(segment.id)) {
    return 'duplicate-id';
  }

  const from = segment.fromCityId?.trim().toLowerCase();
  const to = segment.toCityId?.trim().toLowerCase();
  if (!from || !to || !KNOWN_ROAD_CITY_IDS.has(from) || !KNOWN_ROAD_CITY_IDS.has(to)) {
    return 'invalid-city';
  }

  if (segment.isCalibrated === false) {
    return 'not-calibrated';
  }

  if (segment.points.length < 2) {
    return 'insufficient-points';
  }

  if (segment.points.some((point) => !isValidMapRoadPoint(point))) {
    return 'invalid-point';
  }

  return 'included';
}

export function isMapRoadSegmentRoutable(segment: MapRoadSegment): boolean {
  return getMapRoadSegmentExclusionReason(segment) === 'included';
}

export function buildMapRoadSegmentCheck(
  segment: MapRoadSegment,
  includedInGraph: boolean,
  duplicateIds?: Set<string>,
): MapRoadSegmentCheck {
  const exclusionReason = getMapRoadSegmentExclusionReason(segment, { duplicateIds });
  return {
    id: segment.id,
    fromCityId: segment.fromCityId,
    toCityId: segment.toCityId,
    isCalibrated: segment.isCalibrated !== false,
    pointCount: segment.points.length,
    validPointCount: countValidMapRoadPoints(segment.points),
    includedInGraph,
    exclusionReason: includedInGraph ? 'included' : exclusionReason,
  };
}

export function findDuplicateMapRoadSegmentIds(): Set<string> {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const segment of MAP_ROAD_SEGMENTS) {
    if (seenIds.has(segment.id)) {
      duplicateIds.add(segment.id);
    }
    seenIds.add(segment.id);
  }
  return duplicateIds;
}

export function findDuplicateMapRoadCityPairs(): Map<string, string[]> {
  const pairs = new Map<string, string[]>();
  for (const segment of MAP_ROAD_SEGMENTS) {
    const from = segment.fromCityId.trim().toLowerCase();
    const to = segment.toCityId.trim().toLowerCase();
    const key = getMapRoadCityPairKey(from, to);
    const ids = pairs.get(key) ?? [];
    ids.push(segment.id);
    pairs.set(key, ids);
  }
  return pairs;
}

/** Yönsüz şehir çifti anahtarı — istanbul|trabzon === trabzon|istanbul */
export function getMapRoadCityPairKey(fromCityId: string, toCityId: string): string {
  return [fromCityId.trim().toLowerCase(), toCityId.trim().toLowerCase()].sort().join('|');
}

/** MAP_ROAD_CITY_IDS üzerinden tüm benzersiz çiftler (28 adet). */
export function getAllMapRoadCityPairs(): Array<[string, string]> {
  const cities = [...MAP_ROAD_CITY_IDS];
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      pairs.push([cities[i], cities[j]]);
    }
  }
  return pairs;
}

const MAP_ROAD_SEGMENT_ID_BY_PAIR: Record<string, string> = {
  'adana|ankara': 'ankara-adana',
  'adana|antalya': 'antalya-adana',
  'adana|bursa': 'bursa-adana',
  'adana|diyarbakir': 'adana-diyarbakir',
  'adana|istanbul': 'istanbul-adana',
  'adana|izmir': 'izmir-adana',
  'adana|trabzon': 'adana-trabzon',
  'ankara|bursa': 'bursa-ankara',
  'ankara|diyarbakir': 'ankara-diyarbakir',
  'ankara|istanbul': 'istanbul-ankara',
  'ankara|izmir': 'izmir-ankara',
  'ankara|trabzon': 'ankara-trabzon',
  'antalya|bursa': 'bursa-antalya',
  'antalya|diyarbakir': 'antalya-diyarbakir',
  'antalya|istanbul': 'istanbul-antalya',
  'antalya|izmir': 'izmir-antalya',
  'antalya|trabzon': 'antalya-trabzon',
  'bursa|diyarbakir': 'bursa-diyarbakir',
  'bursa|istanbul': 'istanbul-bursa',
  'bursa|izmir': 'bursa-izmir',
  'bursa|trabzon': 'bursa-trabzon',
  'diyarbakir|istanbul': 'istanbul-diyarbakir',
  'diyarbakir|izmir': 'izmir-diyarbakir',
  'diyarbakir|trabzon': 'diyarbakir-trabzon',
  'istanbul|izmir': 'izmir-istanbul',
  'istanbul|trabzon': 'istanbul-trabzon',
  'izmir|trabzon': 'izmir-trabzon',
  'ankara|antalya': 'ankara-antalya',
};

export function getCanonicalMapRoadSegmentId(fromCityId: string, toCityId: string): string {
  const key = getMapRoadCityPairKey(fromCityId, toCityId);
  return MAP_ROAD_SEGMENT_ID_BY_PAIR[key] ?? `${fromCityId}-${toCityId}`;
}

export interface MissingMapRoadCityPair {
  fromCityId: string;
  toCityId: string;
  pairKey: string;
  suggestedSegmentId: string;
}

/** MAP_ROAD_SEGMENTS'te karşılığı olmayan şehir çiftleri. */
export function findMissingMapRoadCityPairs(): MissingMapRoadCityPair[] {
  const covered = new Set<string>();
  for (const segment of MAP_ROAD_SEGMENTS) {
    covered.add(getMapRoadCityPairKey(segment.fromCityId, segment.toCityId));
  }

  const missing: MissingMapRoadCityPair[] = [];
  for (const [cityA, cityB] of getAllMapRoadCityPairs()) {
    const pairKey = getMapRoadCityPairKey(cityA, cityB);
    if (covered.has(pairKey)) {
      continue;
    }
    missing.push({
      fromCityId: cityA,
      toCityId: cityB,
      pairKey,
      suggestedSegmentId: getCanonicalMapRoadSegmentId(cityA, cityB),
    });
  }
  return missing;
}

export function findDuplicateMapRoadCityPairKeys(): Array<{ pairKey: string; segmentIds: string[] }> {
  const duplicates: Array<{ pairKey: string; segmentIds: string[] }> = [];
  for (const [pairKey, segmentIds] of findDuplicateMapRoadCityPairs().entries()) {
    if (segmentIds.length > 1) {
      duplicates.push({ pairKey, segmentIds });
    }
  }
  return duplicates;
}

export function getMapRoadSegmentById(segmentId: string): MapRoadSegment | undefined {
  return MAP_ROAD_SEGMENTS.find((segment) => segment.id === segmentId);
}

const C = WORLD_MAP_POSITIONS;

/** Segment uçları şehir koordinatlarıyla birebir eşleşir. */
export const MAP_ROAD_SEGMENTS: MapRoadSegment[] = [
  {
    id: 'istanbul-bursa',
    fromCityId: 'istanbul',
    toCityId: 'bursa',
    points: [
      
      { x: 0.1791, y: 0.1915 },
      { x: 0.1987, y: 0.2108 },
      { x: 0.1979, y: 0.2316 },
      { x: 0.1953, y: 0.2502 },
      { x: 0.1922, y: 0.2771 },
      { x: 0.1822, y: 0.3003 },
      
    ],
  },
  {
    id: 'istanbul-ankara',
    fromCityId: 'istanbul',
    toCityId: 'ankara',
    points: [
      
      { x: 0.1798, y: 0.1916 },
      { x: 0.2019, y: 0.2151 },
      { x: 0.2348, y: 0.2259 },
      { x: 0.2792, y: 0.2259 },
      { x: 0.3076, y: 0.246 },
      { x: 0.3291, y: 0.2372 },
      { x: 0.3424, y: 0.2656 },
      { x: 0.3584, y: 0.3063 },
      { x: 0.3744, y: 0.348 },
      
    ],
  },
  {
    id: 'istanbul-antalya',
    fromCityId: 'istanbul',
    toCityId: 'antalya',
    isCalibrated: true,
    points: [
      { x: 0.1768, y: 0.1911 },
      { x: 0.2013, y: 0.2157 },
      { x: 0.1979, y: 0.2287 },
      { x: 0.1958, y: 0.2486 },
      { x: 0.1914, y: 0.2718 },
      { x: 0.1835, y: 0.3010 },
      { x: 0.1992, y: 0.3210 },
      { x: 0.2183, y: 0.3404 },
      { x: 0.2373, y: 0.3558 },
      { x: 0.2446, y: 0.3867 },
      { x: 0.2451, y: 0.3859 },
      { x: 0.2530, y: 0.4128 },
      { x: 0.2546, y: 0.4434 },
      { x: 0.2543, y: 0.4675 },
      { x: 0.2504, y: 0.4875 },
      { x: 0.2451, y: 0.5115 },
      { x: 0.2459, y: 0.5310 },
      { x: 0.2525, y: 0.5570 },
      { x: 0.2407, y: 0.5918 },
      { x: 0.2274, y: 0.6094 },
      { x: 0.2303, y: 0.6317 },
      { x: 0.2360, y: 0.6479 },
      { x: 0.2491, y: 0.6592 },
      { x: 0.2551, y: 0.6838 },
      { x: 0.2572, y: 0.6954 },
      { x: 0.2532, y: 0.7093 },
    ],
  },
  {
    id: 'istanbul-adana',
    fromCityId: 'istanbul',
    toCityId: 'adana',
    isCalibrated: true,
    points: [
        { x: 0.1788, y: 0.1915 },
        { x: 0.1934, y: 0.1998 },
        { x: 0.2031, y: 0.2175 },
        { x: 0.2341, y: 0.2244 },
        { x: 0.2524, y: 0.2267 },
        { x: 0.2670, y: 0.2337 },
        { x: 0.2775, y: 0.2277 },
        { x: 0.2887, y: 0.2314 },
        { x: 0.3083, y: 0.2453 },
        { x: 0.3369, y: 0.2379 },
        { x: 0.3429, y: 0.2648 },
        { x: 0.3572, y: 0.2824 },
        { x: 0.3593, y: 0.3163 },
        { x: 0.3745, y: 0.3432 },
        { x: 0.3923, y: 0.3664 },
        { x: 0.4048, y: 0.3988 },
        { x: 0.4142, y: 0.4072 },
        { x: 0.4265, y: 0.4234 },
        { x: 0.4424, y: 0.4540 },
        { x: 0.4599, y: 0.4785 },
        { x: 0.4680, y: 0.5017 },
        { x: 0.4831, y: 0.4984 },
        { x: 0.5048, y: 0.5179 },
        { x: 0.4941, y: 0.5402 },
        { x: 0.4936, y: 0.5601 },
        { x: 0.4777, y: 0.5833 },
        { x: 0.4698, y: 0.6102 },
        { x: 0.4659, y: 0.6302 },
        { x: 0.4858, y: 0.6487 },
        { x: 0.4824, y: 0.6756 },
        { x: 0.4923, y: 0.6909 },
        { x: 0.4975, y: 0.7104 },
    ],
  },
  {
    id: 'istanbul-diyarbakir',
    fromCityId: 'istanbul',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [

      { x: 0.1793, y: 0.1923 },
       { x: 0.1919, y: 0.1979 },
       { x: 0.2010, y: 0.2155 },
      { x: 0.2360, y: 0.2262 },
      { x: 0.2543, y: 0.2285 },
      { x: 0.2801, y: 0.2271 },
      { x: 0.3075, y: 0.2433 },
      { x: 0.3320, y: 0.2355 },
      { x: 0.3419, y: 0.2554 },
      { x: 0.3532, y: 0.2772 },
      { x: 0.3592, y: 0.3148 },
      { x: 0.3756, y: 0.3472 },
      { x: 0.3956, y: 0.3695 },
      { x: 0.4053, y: 0.4001 },
      { x: 0.4225, y: 0.4219 },
      { x: 0.4421, y: 0.4535 },
      { x: 0.4361, y: 0.4818 },
      { x: 0.4283, y: 0.5156 },
      { x: 0.4270, y: 0.5425 },
      { x: 0.4354, y: 0.5671 },
      { x: 0.4367, y: 0.5871 },
      { x: 0.4445, y: 0.6019 },
      { x: 0.4544, y: 0.6019 },
      { x: 0.4703, y: 0.6334 },
      { x: 0.4839, y: 0.6464 },
      { x: 0.4834, y: 0.6757 },
      { x: 0.4946, y: 0.6919 },
      { x: 0.4972, y: 0.7072 },
      { x: 0.5471, y: 0.6835 },
      { x: 0.5727, y: 0.6873 },
      { x: 0.5891, y: 0.6826 },
      { x: 0.6069, y: 0.6979 },
      { x: 0.6311, y: 0.7118 },
      { x: 0.6648, y: 0.7002 },
      { x: 0.6891, y: 0.6733 },
      { x: 0.6951, y: 0.6747 },
      { x: 0.7074, y: 0.6288 },
      { x: 0.7181, y: 0.6209 },
      { x: 0.7316, y: 0.5871 },
    ],
  },
  {
    id: 'istanbul-trabzon',
    fromCityId: 'istanbul',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.1782, y: 0.1909 },
      { x: 0.2018, y: 0.2183 },
      { x: 0.2340, y: 0.2248 },
      { x: 0.2539, y: 0.2273 },
      { x: 0.2884, y: 0.2308 },
      { x: 0.3074, y: 0.2422 },
      { x: 0.3389, y: 0.2382 },
      { x: 0.3594, y: 0.2133 },
      { x: 0.3771, y: 0.2258 },
      { x: 0.3939, y: 0.2173 },
      { x: 0.4095, y: 0.2482 },
       { x: 0.4193, y: 0.2223 },
       { x: 0.4370, y: 0.2332 },
       { x: 0.4513, y: 0.2158 },
       { x: 0.4748, y: 0.2233 },
       { x: 0.4924, y: 0.2208 },
       { x: 0.4980, y: 0.2332 },
      { x: 0.5081, y: 0.2308 },
      { x: 0.5227, y: 0.2512 },
       { x: 0.5570, y: 0.2786 },
       { x: 0.5738, y: 0.2636 },
       { x: 0.5887, y: 0.2870 },
       { x: 0.6142, y: 0.2985 },
       { x: 0.6290, y: 0.3010 },
      { x: 0.6324, y: 0.3259 },
      { x: 0.6304, y: 0.3463 },
      { x: 0.6890, y: 0.3548 },
      { x: 0.7120, y: 0.3337 },
      { x: 0.7181, y: 0.2809 },
       { x: 0.7218, y: 0.2634 },
      { x: 0.7153, y: 0.2545 },
      { x: 0.7125, y: 0.2331 },
      { x: 0.7218, y: 0.2156 },
    ],
  },
  {
    id: 'bursa-izmir',
    fromCityId: 'bursa',
    toCityId: 'izmir',
    points: [
      
      { x: 0.1816, y: 0.2975 },
      { x: 0.1664, y: 0.2915 },
      { x: 0.1518, y: 0.2845 },
      { x: 0.1447, y: 0.3077 },
      { x: 0.1348, y: 0.3207 },
      { x: 0.1164, y: 0.3517 },
      { x: 0.1177, y: 0.3832 },
      { x: 0.1112, y: 0.4047 },
      { x: 0.1073, y: 0.4241 },
      { x: 0.1094, y: 0.4343 },
      { x: 0.1039, y: 0.4542 },
      { x: 0.0942, y: 0.4658 },
      { x: 0.0882, y: 0.4821 },
      { x: 0.0887, y: 0.502 },
      { x: 0.083, y: 0.5159 },
      
    ],
  },
  {
    id: 'bursa-ankara',
    fromCityId: 'bursa',
    toCityId: 'ankara',
    points: [
      
      { x: 0.1823, y: 0.2991 },
      { x: 0.1941, y: 0.3214 },
      { x: 0.2019, y: 0.3205 },
      { x: 0.2251, y: 0.346 },
      { x: 0.2361, y: 0.3539 },
      { x: 0.2473, y: 0.3437 },
      { x: 0.2578, y: 0.3553 },
      { x: 0.275, y: 0.3729 },
      { x: 0.2993, y: 0.3854 },
      { x: 0.3118, y: 0.3915 },
      { x: 0.321, y: 0.4031 },
      { x: 0.3408, y: 0.3775 },
      { x: 0.3578, y: 0.3738 },
      { x: 0.3742, y: 0.3506 },


      
    ],
  },
  {
    id: 'bursa-antalya',
    fromCityId: 'bursa',
    toCityId: 'antalya',
    isCalibrated: true,
    points: [
      { x: 0.1823, y: 0.2968 },
       { x: 0.1902, y: 0.3163 },
       { x: 0.2006, y: 0.3186 },
       { x: 0.2111, y: 0.3339 },
       { x: 0.2361, y: 0.3516 },
       { x: 0.2453, y: 0.3664 },
       { x: 0.2439, y: 0.3877 },
       { x: 0.2518, y: 0.4109 },
       { x: 0.2552, y: 0.4341 },
       { x: 0.2539, y: 0.4657 },
       { x: 0.2513, y: 0.4856 },
       { x: 0.2466, y: 0.5172 },
       { x: 0.2453, y: 0.5441 },
       { x: 0.2513, y: 0.5557 },
       { x: 0.2408, y: 0.5942 },
      { x: 0.2283, y: 0.6071 },
      { x: 0.2296, y: 0.6306 },
        { x: 0.2356, y: 0.6459 },
        { x: 0.2439, y: 0.6575 },
        { x: 0.2505, y: 0.6630 },
      { x: 0.2565, y: 0.6923 },
      { x: 0.2518, y: 0.7099 },
    ],
  },
  {
    id: 'bursa-adana',
    fromCityId: 'bursa',
    toCityId: 'adana',
    isCalibrated: true,
    points: [
      { x: 0.1823, y: 0.2991 },
      { x: 0.1941, y: 0.3214 },
      { x: 0.2019, y: 0.3205 },
      { x: 0.2251, y: 0.346 },
      { x: 0.2361, y: 0.3539 },
      { x: 0.2473, y: 0.3437 },
      { x: 0.2578, y: 0.3553 },
      { x: 0.275, y: 0.3729 },
      { x: 0.2993, y: 0.3854 },
      { x: 0.3118, y: 0.3915 },
      { x: 0.321, y: 0.4031 },
      { x: 0.3408, y: 0.3775 },
      { x: 0.3578, y: 0.3738 },
      { x: 0.3742, y: 0.3506 },
      {x: 0.3744, y: 0.3476},
      {x: 0.395, y: 0.3671},
      {x: 0.4028, y: 0.3933},
      {x: 0.4114, y: 0.4054},
      {x: 0.408, y: 0.4237},
      {x: 0.408, y: 0.4377},
      {x: 0.409, y: 0.4651},
      {x: 0.4176, y: 0.4712},
      {x: 0.4176, y: 0.4944},
      {x: 0.4244, y: 0.5218},
      {x: 0.4279, y: 0.548},
      {x: 0.4536, y: 0.5187},
      {x: 0.4649, y: 0.5589},
      {x: 0.4728, y: 0.5662},
      {x: 0.4779, y: 0.5863},
      {x: 0.47, y: 0.6034},
      {x: 0.4666, y: 0.632},
      {x: 0.4848, y: 0.646},
      {x: 0.4841, y: 0.6783},
      {x: 0.495, y: 0.6935},
      {x: 0.4968, y: 0.7087},
    ],
  },
  {
    id: 'bursa-diyarbakir',
    fromCityId: 'bursa',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [

      { x: 0.1823, y: 0.2991 },
      { x: 0.1941, y: 0.3214 },
      { x: 0.2019, y: 0.3205 },
      { x: 0.2251, y: 0.346 },
      { x: 0.2361, y: 0.3539 },
      { x: 0.2473, y: 0.3437 },
      { x: 0.2578, y: 0.3553 },
      { x: 0.275, y: 0.3729 },
      { x: 0.2993, y: 0.3854 },
      { x: 0.3118, y: 0.3915 },
      { x: 0.321, y: 0.4031 },
      { x: 0.3408, y: 0.3775 },
      { x: 0.3578, y: 0.3738 },
      { x: 0.3742, y: 0.3506 },
      {x: 0.3744, y: 0.3476},
      {x: 0.395, y: 0.3671},
      {x: 0.4028, y: 0.3933},
      {x: 0.4114, y: 0.4054},
      {x: 0.408, y: 0.4237},
      {x: 0.408, y: 0.4377},
      {x: 0.409, y: 0.4651},
      {x: 0.4176, y: 0.4712},
      {x: 0.4176, y: 0.4944},
      {x: 0.4244, y: 0.5218},
      {x: 0.4279, y: 0.548},
      {x: 0.4536, y: 0.5187},
      {x: 0.4649, y: 0.5589},
      {x: 0.4728, y: 0.5662},
      {x: 0.4779, y: 0.5863},
      {x: 0.47, y: 0.6034},
      {x: 0.4666, y: 0.632},
      {x: 0.4848, y: 0.646},
      {x: 0.4841, y: 0.6783},
      {x: 0.495, y: 0.6935},
      {x: 0.4968, y: 0.7087},
      { x: 0.4970, y: 0.7018 },
      { x: 0.5480, y: 0.6814 },
      { x: 0.5631, y: 0.6825 },
      { x: 0.5716, y: 0.6895 },
      { x: 0.5891, y: 0.6814 },
      { x: 0.6057, y: 0.7002 },
      { x: 0.6316, y: 0.7136 },
      { x: 0.6476, y: 0.7029 },
      { x: 0.6642, y: 0.7018 },
      { x: 0.6796, y: 0.6798 },
      { x: 0.6932, y: 0.6734 },
      { x: 0.7068, y: 0.6300 },
      { x: 0.7183, y: 0.6208 },
      { x: 0.7204, y: 0.6101 },
      { x: 0.7304, y: 0.5897 },
    ],
  },
  {
    id: 'bursa-trabzon',
    fromCityId: 'bursa',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.1822, y: 0.3003 },
  { x: 0.1922, y: 0.2771 },
  { x: 0.1953, y: 0.2502 },
  { x: 0.1979, y: 0.2316 },
  { x: 0.1987, y: 0.2108 },
  { x: 0.1791, y: 0.1915 },
  { x: 0.1782, y: 0.1909 },
      { x: 0.2018, y: 0.2183 },
      { x: 0.2340, y: 0.2248 },
      { x: 0.2539, y: 0.2273 },
      { x: 0.2884, y: 0.2308 },
      { x: 0.3074, y: 0.2422 },
      { x: 0.3389, y: 0.2382 },
      { x: 0.3594, y: 0.2133 },
      { x: 0.3771, y: 0.2258 },
      { x: 0.3939, y: 0.2173 },
      { x: 0.4095, y: 0.2482 },
       { x: 0.4193, y: 0.2223 },
       { x: 0.4370, y: 0.2332 },
       { x: 0.4513, y: 0.2158 },
       { x: 0.4748, y: 0.2233 },
       { x: 0.4924, y: 0.2208 },
       { x: 0.4980, y: 0.2332 },
      { x: 0.5081, y: 0.2308 },
      { x: 0.5227, y: 0.2512 },
       { x: 0.5570, y: 0.2786 },
       { x: 0.5738, y: 0.2636 },
       { x: 0.5887, y: 0.2870 },
       { x: 0.6142, y: 0.2985 },
       { x: 0.6290, y: 0.3010 },
      { x: 0.6324, y: 0.3259 },
      { x: 0.6304, y: 0.3463 },
      { x: 0.6890, y: 0.3548 },
      { x: 0.7120, y: 0.3337 },
      { x: 0.7181, y: 0.2809 },
       { x: 0.7218, y: 0.2634 },
      { x: 0.7153, y: 0.2545 },
      { x: 0.7125, y: 0.2331 },
      { x: 0.7218, y: 0.2156 },
    ],
  },
  {
    id: 'izmir-antalya',
    fromCityId: 'izmir',
    toCityId: 'antalya',
    points: [
      
      { x: 0.0831, y: 0.5157 },
      { x: 0.0774, y: 0.5486 },
      { x: 0.0813, y: 0.5778 },
      { x: 0.0925, y: 0.5741 },
      { x: 0.1042, y: 0.5903 },
      { x: 0.1293, y: 0.5871 },
      { x: 0.139, y: 0.5718 },
      { x: 0.174, y: 0.6043 },
      { x: 0.193, y: 0.6548 },
      { x: 0.2139, y: 0.685 },
      { x: 0.2212, y: 0.7281 },
      { x: 0.2337, y: 0.7272 },
      { x: 0.2528, y: 0.7082 },
      
    ],
  },
  {
    id: 'izmir-ankara',
    fromCityId: 'izmir',
    toCityId: 'ankara',
    points: [
      
      { x: 0.0819, y: 0.5147 },
      { x: 0.1123, y: 0.503 },
      { x: 0.1221, y: 0.5135 },
      { x: 0.1379, y: 0.5019 },
      { x: 0.1552, y: 0.4914 },
      { x: 0.1742, y: 0.4984 },
      { x: 0.1873, y: 0.4955 },
      { x: 0.2014, y: 0.478 },
      { x: 0.2161, y: 0.4605 },
      { x: 0.2309, y: 0.4681 },
      { x: 0.2508, y: 0.4838 },
      { x: 0.2641, y: 0.4879 },
      { x: 0.2782, y: 0.4675 },
      { x: 0.289, y: 0.4629 },
      { x: 0.2972, y: 0.4396 },
      { x: 0.3211, y: 0.4029 },
      { x: 0.3552, y: 0.3814 },
      { x: 0.3542, y: 0.3768 },
      { x: 0.3738, y: 0.3535 },
      
      
    ],
  },
  {
    id: 'ankara-antalya',
    fromCityId: 'ankara',
    toCityId: 'antalya',
    points: [
    
      { x: 0.3742, y: 0.3481 },
      { x: 0.3512, y: 0.3797 },
      { x: 0.3334, y: 0.3843 },
      { x: 0.3201, y: 0.4038 },
      { x: 0.2992, y: 0.4414 },
      { x: 0.2872, y: 0.4599 },
      { x: 0.2755, y: 0.4669 },
      { x: 0.2643, y: 0.4906 },
      { x: 0.3018, y: 0.5314 },
      { x: 0.3274, y: 0.5474 },
      { x: 0.3491, y: 0.5636 },
      { x: 0.3595, y: 0.5905 },
      { x: 0.3347, y: 0.6091 },
      { x: 0.3261, y: 0.629 },
      { x: 0.3162, y: 0.6429 },
      { x: 0.3058, y: 0.6638 },
      { x: 0.2945, y: 0.6921 },
      { x: 0.2867, y: 0.7093 },
      { x: 0.2525, y: 0.7093 },
      
     
    ],
  },
  {
    id: 'izmir-istanbul',
    fromCityId: 'izmir',
    toCityId: 'istanbul',
    isCalibrated: true,
    points: [
      { x: 0.0835, y: 0.5144 },
      { x: 0.0882, y: 0.4959 },
      { x: 0.0869, y: 0.4796 },
      { x: 0.1052, y: 0.455 },
      { x: 0.1078, y: 0.4212 },
      { x: 0.117, y: 0.3989 },
      { x: 0.1156, y: 0.3581 },
      { x: 0.1342, y: 0.3182 },
      { x: 0.1441, y: 0.3126 },
      { x: 0.148, y: 0.288 },
      { x: 0.1814, y: 0.295 },
      { x: 0.19, y: 0.2843 },
      { x: 0.1979, y: 0.2533 },
      { x: 0.1947, y: 0.2389 },
      { x: 0.2, y: 0.2273 },
      { x: 0.2026, y: 0.2157 },
      { x: 0.1801, y: 0.1925 },
     
    ],
  },
  {
    id: 'izmir-adana',
    fromCityId: 'izmir',
    toCityId: 'adana',
    isCalibrated: true,
    points: [
      { x: 0.0828, y: 0.5150 },
        { x: 0.1125, y: 0.5050 },
        { x: 0.1210, y: 0.5115 },
        { x: 0.1521, y: 0.4925 },
        { x: 0.1597, y: 0.4975 },
        { x: 0.1661, y: 0.4915 },
        { x: 0.1866, y: 0.4965 },
      { x: 0.2006, y: 0.4925 },
      { x: 0.2113, y: 0.5100 },
      { x: 0.2509, y: 0.4875 },
      { x: 0.2812, y: 0.5059 },
      { x: 0.3025, y: 0.5363 },
      { x: 0.3137, y: 0.5338 },
      { x: 0.3263, y: 0.5478 },
      { x: 0.3356, y: 0.5438 },
      { x: 0.3597, y: 0.5862 },
      { x: 0.3653, y: 0.5689 },
      { x: 0.3914, y: 0.6138 },
      { x: 0.4029, y: 0.6178 },
      { x: 0.4310, y: 0.6342 },
      { x: 0.4439, y: 0.6302 },
      { x: 0.4571, y: 0.6128 },
      { x: 0.4784, y: 0.6392 },
       { x: 0.4863, y: 0.6492 },
       { x: 0.4835, y: 0.6766 },
       { x: 0.4947, y: 0.6906 },
      { x: 0.4966, y: 0.7065 },
    ],
  },
  {
    id: 'izmir-diyarbakir',
    fromCityId: 'izmir',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [
      { x: 0.0828, y: 0.5150 },
      { x: 0.1125, y: 0.5050 },
      { x: 0.1210, y: 0.5115 },
      { x: 0.1521, y: 0.4925 },
      { x: 0.1597, y: 0.4975 },
      { x: 0.1661, y: 0.4915 },
      { x: 0.1866, y: 0.4965 },
    { x: 0.2006, y: 0.4925 },
    { x: 0.2113, y: 0.5100 },
    { x: 0.2509, y: 0.4875 },
    { x: 0.2812, y: 0.5059 },
    { x: 0.3025, y: 0.5363 },
    { x: 0.3137, y: 0.5338 },
    { x: 0.3263, y: 0.5478 },
    { x: 0.3356, y: 0.5438 },
    { x: 0.3597, y: 0.5862 },
    { x: 0.3653, y: 0.5689 },
    { x: 0.3914, y: 0.6138 },
    { x: 0.4029, y: 0.6178 },
    { x: 0.4310, y: 0.6342 },
    { x: 0.4439, y: 0.6302 },
    { x: 0.4571, y: 0.6128 },
    { x: 0.4784, y: 0.6392 },
     { x: 0.4863, y: 0.6492 },
     { x: 0.4835, y: 0.6766 },
     { x: 0.4947, y: 0.6906 },
    { x: 0.4966, y: 0.7065 },
    { x: 0.4970, y: 0.7018 },
      { x: 0.5480, y: 0.6814 },
      { x: 0.5631, y: 0.6825 },
      { x: 0.5716, y: 0.6895 },
      { x: 0.5891, y: 0.6814 },
      { x: 0.6057, y: 0.7002 },
      { x: 0.6316, y: 0.7136 },
      { x: 0.6476, y: 0.7029 },
      { x: 0.6642, y: 0.7018 },
      { x: 0.6796, y: 0.6798 },
      { x: 0.6932, y: 0.6734 },
      { x: 0.7068, y: 0.6300 },
      { x: 0.7183, y: 0.6208 },
      { x: 0.7204, y: 0.6101 },
      { x: 0.7304, y: 0.5897 },
    ],
  },
  {
    id: 'izmir-trabzon',
    fromCityId: 'izmir',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.0835, y: 0.5144 },
      { x: 0.0882, y: 0.4959 },
      { x: 0.0869, y: 0.4796 },
      { x: 0.1052, y: 0.455 },
      { x: 0.1078, y: 0.4212 },
      { x: 0.117, y: 0.3989 },
      { x: 0.1156, y: 0.3581 },
      { x: 0.1342, y: 0.3182 },
      { x: 0.1441, y: 0.3126 },
      { x: 0.148, y: 0.288 },
      { x: 0.1814, y: 0.295 },
      { x: 0.19, y: 0.2843 },
      { x: 0.1979, y: 0.2533 },
      { x: 0.1947, y: 0.2389 },
      { x: 0.2, y: 0.2273 },
      { x: 0.2026, y: 0.2157 },
      { x: 0.1801, y: 0.1925 },
      { x: 0.1782, y: 0.1909 },
      { x: 0.2018, y: 0.2183 },
      { x: 0.2340, y: 0.2248 },
      { x: 0.2539, y: 0.2273 },
      { x: 0.2884, y: 0.2308 },
      { x: 0.3074, y: 0.2422 },
      { x: 0.3389, y: 0.2382 },
      { x: 0.3594, y: 0.2133 },
      { x: 0.3771, y: 0.2258 },
      { x: 0.3939, y: 0.2173 },
      { x: 0.4095, y: 0.2482 },
       { x: 0.4193, y: 0.2223 },
       { x: 0.4370, y: 0.2332 },
       { x: 0.4513, y: 0.2158 },
       { x: 0.4748, y: 0.2233 },
       { x: 0.4924, y: 0.2208 },
       { x: 0.4980, y: 0.2332 },
      { x: 0.5081, y: 0.2308 },
      { x: 0.5227, y: 0.2512 },
       { x: 0.5570, y: 0.2786 },
       { x: 0.5738, y: 0.2636 },
       { x: 0.5887, y: 0.2870 },
       { x: 0.6142, y: 0.2985 },
       { x: 0.6290, y: 0.3010 },
      { x: 0.6324, y: 0.3259 },
      { x: 0.6304, y: 0.3463 },
      { x: 0.6890, y: 0.3548 },
      { x: 0.7120, y: 0.3337 },
      { x: 0.7181, y: 0.2809 },
       { x: 0.7218, y: 0.2634 },
      { x: 0.7153, y: 0.2545 },
      { x: 0.7125, y: 0.2331 },
      { x: 0.7218, y: 0.2156 },
    ],
  },
  {
    id: 'ankara-adana',
    fromCityId: 'ankara',
    toCityId: 'adana',
    isCalibrated: true,
    points: [
      {x: 0.3744, y: 0.3476},
      {x: 0.395, y: 0.3671},
      {x: 0.4028, y: 0.3933},
      {x: 0.4114, y: 0.4054},
      {x: 0.408, y: 0.4237},
      {x: 0.408, y: 0.4377},
      {x: 0.409, y: 0.4651},
      {x: 0.4176, y: 0.4712},
      {x: 0.4176, y: 0.4944},
      {x: 0.4244, y: 0.5218},
      {x: 0.4279, y: 0.548},
      {x: 0.4536, y: 0.5187},
      {x: 0.4649, y: 0.5589},
      {x: 0.4728, y: 0.5662},
      {x: 0.4779, y: 0.5863},
      {x: 0.47, y: 0.6034},
      {x: 0.4666, y: 0.632},
      {x: 0.4848, y: 0.646},
      {x: 0.4841, y: 0.6783},
      {x: 0.495, y: 0.6935},
      {x: 0.4968, y: 0.7087},

    ],
  },
    {
    id: 'antalya-adana',
    fromCityId: 'antalya',
    toCityId: 'adana',
    isCalibrated: true,
    points: [
      { x: 0.2524, y: 0.7084 },
      { x: 0.2801, y: 0.7084 },
      { x: 0.2978, y: 0.7223 },
      { x: 0.3109, y: 0.7376 },
      { x: 0.3234, y: 0.6907 },
      { x: 0.3334, y: 0.6754 },
      { x: 0.3412, y: 0.6754 },
      { x: 0.3438, y: 0.6907 },
      { x: 0.3503, y: 0.6907 },
      { x: 0.3571, y: 0.6745 },
      { x: 0.3655, y: 0.6508 },
      { x: 0.3788, y: 0.6652 },
      { x: 0.3871, y: 0.6907 },
      { x: 0.4104, y: 0.6754 },
      { x: 0.4294, y: 0.6522 },
      { x: 0.4425, y: 0.63 },
      { x: 0.4563, y: 0.6137 },
      { x: 0.478, y: 0.6369 },
      { x: 0.4845, y: 0.6485 },
      { x: 0.4872, y: 0.6629 },
      { x: 0.4838, y: 0.6777 },
      { x: 0.4916, y: 0.6884 },
      { x: 0.4971, y: 0.7084 },
    ],
  },
  {
    id: 'antalya-diyarbakir',
    fromCityId: 'antalya',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [
      { x: 0.2524, y: 0.7084 },
      { x: 0.2801, y: 0.7084 },
      { x: 0.2978, y: 0.7223 },
      { x: 0.3109, y: 0.7376 },
      { x: 0.3234, y: 0.6907 },
      { x: 0.3334, y: 0.6754 },
      { x: 0.3412, y: 0.6754 },
      { x: 0.3438, y: 0.6907 },
      { x: 0.3503, y: 0.6907 },
      { x: 0.3571, y: 0.6745 },
      { x: 0.3655, y: 0.6508 },
      { x: 0.3788, y: 0.6652 },
      { x: 0.3871, y: 0.6907 },
      { x: 0.4104, y: 0.6754 },
      { x: 0.4294, y: 0.6522 },
      { x: 0.4425, y: 0.63 },
      { x: 0.4563, y: 0.6137 },
      { x: 0.478, y: 0.6369 },
      { x: 0.4845, y: 0.6485 },
      { x: 0.4872, y: 0.6629 },
      { x: 0.4838, y: 0.6777 },
      { x: 0.4916, y: 0.6884 },
      { x: 0.4971, y: 0.7084 },
      { x: 0.4970, y: 0.7018 },
      { x: 0.5480, y: 0.6814 },
      { x: 0.5631, y: 0.6825 },
      { x: 0.5716, y: 0.6895 },
      { x: 0.5891, y: 0.6814 },
      { x: 0.6057, y: 0.7002 },
      { x: 0.6316, y: 0.7136 },
      { x: 0.6476, y: 0.7029 },
      { x: 0.6642, y: 0.7018 },
      { x: 0.6796, y: 0.6798 },
      { x: 0.6932, y: 0.6734 },
      { x: 0.7068, y: 0.6300 },
      { x: 0.7183, y: 0.6208 },
      { x: 0.7204, y: 0.6101 },
      { x: 0.7304, y: 0.5897 },
    ],
  },
  {
    id: 'antalya-trabzon',
    fromCityId: 'antalya',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.2514, y: 0.7097 },
      { x: 0.2791, y: 0.7097 },
       { x: 0.2976, y: 0.7199 },
       { x: 0.3115, y: 0.7366 },
       { x: 0.3245, y: 0.6874 },
        { x: 0.3310, y: 0.6828 },
       { x: 0.3344, y: 0.6744 },
       { x: 0.3410, y: 0.6781 },
       { x: 0.3522, y: 0.6522 },
        { x: 0.3514, y: 0.6220 },
       { x: 0.3605, y: 0.5905 },
       { x: 0.3882, y: 0.5710 },
       { x: 0.4008, y: 0.5557 },
      { x: 0.4094, y: 0.5571 },
      { x: 0.4284, y: 0.5455 },
      { x: 0.4679, y: 0.5023 },
        { x: 0.4822, y: 0.4993 },
       { x: 0.5052, y: 0.5179 },
       { x: 0.5269, y: 0.4863 },
       { x: 0.5460, y: 0.4631 },
       { x: 0.5538, y: 0.4446 },
       { x: 0.5546, y: 0.4260 },
       { x: 0.5624, y: 0.4047 },
       { x: 0.5742, y: 0.3945 },
       { x: 0.5802, y: 0.3685 },
       { x: 0.5932, y: 0.3685 },
       { x: 0.6066, y: 0.3509 },
       { x: 0.6288, y: 0.3439 },
      { x: 0.6643, y: 0.3486 },
      { x: 0.6734, y: 0.3356 },
      { x: 0.6893, y: 0.3110 },
      { x: 0.6919, y: 0.2702 },
        { x: 0.6966, y: 0.2586 },
      { x: 0.6940, y: 0.2493 },
      { x: 0.7045, y: 0.2377 },
      { x: 0.7131, y: 0.2354 },
      { x: 0.7214, y: 0.2145 },
    ],
  },
  {

    id: 'adana-diyarbakir',
    fromCityId: 'adana',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [
      { x: 0.4970, y: 0.7018 },
      { x: 0.5480, y: 0.6814 },
      { x: 0.5631, y: 0.6825 },
      { x: 0.5716, y: 0.6895 },
      { x: 0.5891, y: 0.6814 },
      { x: 0.6057, y: 0.7002 },
      { x: 0.6316, y: 0.7136 },
      { x: 0.6476, y: 0.7029 },
      { x: 0.6642, y: 0.7018 },
      { x: 0.6796, y: 0.6798 },
      { x: 0.6932, y: 0.6734 },
      { x: 0.7068, y: 0.6300 },
      { x: 0.7183, y: 0.6208 },
      { x: 0.7204, y: 0.6101 },
      { x: 0.7304, y: 0.5897 },
    ],
  },
  {
    id: 'adana-trabzon',
    fromCityId: 'adana',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.4966, y: 0.7072 },
      { x: 0.5490, y: 0.6826 },
      { x: 0.5464, y: 0.6487 },
      { x: 0.5543, y: 0.6455 },
        { x: 0.5530, y: 0.6269 },
        { x: 0.5485, y: 0.6139 },
        { x: 0.5569, y: 0.5810 },
        { x: 0.5543, y: 0.5624 },
        { x: 0.5663, y: 0.5532 },
        { x: 0.5694, y: 0.5300 },
        { x: 0.5624, y: 0.4901 },
        { x: 0.5524, y: 0.4845 },
        { x: 0.5446, y: 0.4678 },
        { x: 0.5616, y: 0.4047 },
        { x: 0.5762, y: 0.3908 },
        { x: 0.5801, y: 0.3709 },
        { x: 0.5958, y: 0.3653 },
        { x: 0.6083, y: 0.3500 },
        { x: 0.6148, y: 0.3523 },
        { x: 0.6321, y: 0.3430 },
        { x: 0.6621, y: 0.3486 },
      { x: 0.6827, y: 0.3509 },
      { x: 0.6898, y: 0.3570 },
      { x: 0.6989, y: 0.3440 },
      { x: 0.7114, y: 0.3338 },
      { x: 0.7122, y: 0.3185 },
      { x: 0.7187, y: 0.3008 },
      { x: 0.7166, y: 0.2800 },
      { x: 0.7221, y: 0.2693 },
      { x: 0.7166, y: 0.2591 },
      { x: 0.7127, y: 0.2354 },
      { x: 0.7208, y: 0.2159 },

    ],
  },
  {
    id: 'ankara-trabzon',
    fromCityId: 'ankara',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.3745, y: 0.3497 },
      { x: 0.3933, y: 0.3691 },
      { x: 0.4096, y: 0.3718 },
      { x: 0.4290, y: 0.3675 },
      { x: 0.4357, y: 0.3429 },
      { x: 0.4428, y: 0.3183 },
      { x: 0.4520, y: 0.3183 },
      { x: 0.4770, y: 0.3029 },
      { x: 0.4908, y: 0.2756 },
      { x: 0.5234, y: 0.2494 },
      { x: 0.5416, y: 0.2658 },
      { x: 0.5554, y: 0.2783 },
      { x: 0.5616, y: 0.2340 },
      { x: 0.5850, y: 0.2242 },
      { x: 0.5942, y: 0.1996 },
      { x: 0.6198, y: 0.2078 },
      { x: 0.6530, y: 0.2176 },
      { x: 0.6811, y: 0.1985 },
      { x: 0.6934, y: 0.1958 },
      { x: 0.7235, y: 0.2160 },
    ],
  },
  {
    id: 'ankara-diyarbakir',
    fromCityId: 'ankara',
    toCityId: 'diyarbakir',
    isCalibrated: true,
    points: [
      {x: 0.3744, y: 0.3476},
      {x: 0.395, y: 0.3671},
      {x: 0.4028, y: 0.3933},
      {x: 0.4114, y: 0.4054},
      {x: 0.408, y: 0.4237},
      {x: 0.408, y: 0.4377},
      {x: 0.409, y: 0.4651},
      {x: 0.4176, y: 0.4712},
      {x: 0.4176, y: 0.4944},
      {x: 0.4244, y: 0.5218},
      {x: 0.4279, y: 0.548},
      {x: 0.4536, y: 0.5187},
      {x: 0.4649, y: 0.5589},
      {x: 0.4728, y: 0.5662},
      {x: 0.4779, y: 0.5863},
      {x: 0.47, y: 0.6034},
      {x: 0.4666, y: 0.632},
      {x: 0.4848, y: 0.646},
      {x: 0.4841, y: 0.6783},
      {x: 0.495, y: 0.6935},
      {x: 0.4968, y: 0.7087},
      { x: 0.4970, y: 0.7018 },
      { x: 0.5480, y: 0.6814 },
      { x: 0.5631, y: 0.6825 },
      { x: 0.5716, y: 0.6895 },
      { x: 0.5891, y: 0.6814 },
      { x: 0.6057, y: 0.7002 },
      { x: 0.6316, y: 0.7136 },
      { x: 0.6476, y: 0.7029 },
      { x: 0.6642, y: 0.7018 },
      { x: 0.6796, y: 0.6798 },
      { x: 0.6932, y: 0.6734 },
      { x: 0.7068, y: 0.6300 },
      { x: 0.7183, y: 0.6208 },
      { x: 0.7204, y: 0.6101 },
      { x: 0.7304, y: 0.5897 },
    ],
  },
  {
    id: 'diyarbakir-trabzon',
    fromCityId: 'diyarbakir',
    toCityId: 'trabzon',
    isCalibrated: true,
    points: [
      { x: 0.7328, y: 0.5878 },
      { x: 0.7310, y: 0.5539 },
        { x: 0.7401, y: 0.5433 },
        { x: 0.7388, y: 0.5187 },
        { x: 0.7448, y: 0.5108 },
        { x: 0.7453, y: 0.4909 },
        { x: 0.7506, y: 0.4755 },
        { x: 0.7626, y: 0.4630 },
        { x: 0.7756, y: 0.4677 },
        { x: 0.7861, y: 0.4524 },
        { x: 0.7960, y: 0.4561 },
        { x: 0.8012, y: 0.4477 },
        { x: 0.8129, y: 0.4486 },
        { x: 0.8210, y: 0.4278 },
      { x: 0.7968, y: 0.3893 },
      { x: 0.8007, y: 0.3763 },
        { x: 0.7973, y: 0.3661 },
        { x: 0.8025, y: 0.3522 },
        { x: 0.8025, y: 0.3253 },
        { x: 0.7844, y: 0.3341 },
        { x: 0.7739, y: 0.3119 },
        { x: 0.7622, y: 0.3026 },
        { x: 0.7536, y: 0.2794 },
        { x: 0.7306, y: 0.2794 },
        { x: 0.7254, y: 0.2877 },
        { x: 0.7181, y: 0.2794 },
        { x: 0.7207, y: 0.2618 },
        { x: 0.7115, y: 0.2349 },
        { x: 0.7214, y: 0.2154 },
    ],
  },
];

export const MAP_ROAD_CITY_IDS = [
  'istanbul',
  'bursa',
  'ankara',
  'izmir',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
] as const;
