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
};

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
      C.izmir,
      { x: 0.142, y: 0.432 },
      { x: 0.172, y: 0.458 },
      { x: 0.205, y: 0.482 },
      { x: 0.242, y: 0.508 },
      { x: 0.278, y: 0.532 },
      { x: 0.312, y: 0.555 },
      { x: 0.332, y: 0.568 },
      C.antalya,
    ],
  },
  {
    id: 'izmir-ankara',
    fromCityId: 'izmir',
    toCityId: 'ankara',
    points: [
      C.izmir,
      { x: 0.158, y: 0.398 },
      { x: 0.205, y: 0.382 },
      { x: 0.252, y: 0.365 },
      { x: 0.302, y: 0.348 },
      { x: 0.352, y: 0.328 },
      { x: 0.395, y: 0.312 },
      C.ankara,
    ],
  },
  {
    id: 'ankara-antalya',
    fromCityId: 'ankara',
    toCityId: 'antalya',
    points: [
      C.ankara,
      { x: 0.418, y: 0.338 },
      { x: 0.408, y: 0.385 },
      { x: 0.395, y: 0.432 },
      { x: 0.382, y: 0.478 },
      { x: 0.368, y: 0.522 },
      { x: 0.358, y: 0.552 },
      C.antalya,
    ],
  },
];

export const MAP_ROAD_CITY_IDS = ['istanbul', 'bursa', 'ankara', 'izmir', 'antalya'] as const;
