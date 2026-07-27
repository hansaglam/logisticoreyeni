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

/** Segment graph routing için kullanılabilir mi? (undefined isCalibrated = true) */
export function isMapRoadSegmentRoutable(segment: MapRoadSegment): boolean {
  if (segment.isCalibrated === false) {
    return false;
  }
  return segment.points.length >= 2;
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
    isCalibrated: false,
    points: [],
  },
  {
    id: 'ankara-adana',
    fromCityId: 'ankara',
    toCityId: 'adana',
    isCalibrated: false,
    points: [],
  },
  {
    id: 'antalya-adana',
    fromCityId: 'antalya',
    toCityId: 'adana',
    isCalibrated: false,
    points: [],
  },
  {
    id: 'adana-diyarbakir',
    fromCityId: 'adana',
    toCityId: 'diyarbakir',
    isCalibrated: false,
    points: [],
  },
  {
    id: 'ankara-trabzon',
    fromCityId: 'ankara',
    toCityId: 'trabzon',
    isCalibrated: false,
    points: [],
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
