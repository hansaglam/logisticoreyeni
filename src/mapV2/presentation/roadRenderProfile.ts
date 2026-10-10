import type { TransportNetworkLod } from '../geo/transportNetwork';
import { ROAD_OVERVIEW_EXIT_REL_ZOOM, ROAD_OVERVIEW_MAX_REL_ZOOM } from '../geo/roadRuntimePackage';
import type { TransportPaint, TransportStyleClass } from './transportPaint';
import { paintForCountryFocus } from './countryPaint';

export const ROAD_RENDER_PROFILE_DEBUG = 'DEBUG' as const;
export const ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW = 'COUNTRY_OVERVIEW' as const;
export const ROAD_RENDER_PROFILE_COUNTRY_DETAIL = 'COUNTRY_DETAIL' as const;

export const ROAD_RENDER_PROFILES = [
  ROAD_RENDER_PROFILE_DEBUG,
  ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW,
  ROAD_RENDER_PROFILE_COUNTRY_DETAIL,
] as const;
export type RoadRenderProfile = (typeof ROAD_RENDER_PROFILES)[number];

const ALL_ROAD_STYLES: TransportStyleClass[] = ['ROAD_MOTORWAY', 'ROAD_TRUNK', 'ROAD_PRIMARY', 'ROAD_SECONDARY'];
export const ROAD_OVERVIEW_CORRIDOR_STYLES: TransportStyleClass[] = ['ROAD_TRUNK', 'ROAD_MOTORWAY'];

export type RoadDrawPlan = {
  useOverview: boolean;
  useChunks: boolean;
  keepOverviewCorridors: boolean;
  overviewStyles: TransportStyleClass[];
  chunkStyles: TransportStyleClass[];
  visibleStyles: TransportStyleClass[];
};

/** Player country overview: corridors only. Primary/secondary stay off at fit zoom. */
export function visibleRoadStylesForProfile(
  profile: RoadRenderProfile,
  relZoom: number,
): TransportStyleClass[] {
  if (profile === ROAD_RENDER_PROFILE_DEBUG) return ALL_ROAD_STYLES;
  if (profile === ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW) return ['ROAD_MOTORWAY', 'ROAD_TRUNK'];
  if (relZoom < 1.22) return ['ROAD_MOTORWAY', 'ROAD_TRUNK'];
  if (relZoom < 1.48) return ['ROAD_MOTORWAY', 'ROAD_TRUNK', 'ROAD_PRIMARY'];
  return ALL_ROAD_STYLES;
}

export function resolveRoadDrawPlan(
  profile: RoadRenderProfile,
  relZoom: number,
  lodOverride: TransportNetworkLod | 'AUTO',
  overviewHysteresis: boolean,
): RoadDrawPlan {
  const visibleStyles = visibleRoadStylesForProfile(profile, relZoom);
  if (profile === ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW) {
    return {
      useOverview: true,
      useChunks: false,
      keepOverviewCorridors: true,
      overviewStyles: ROAD_OVERVIEW_CORRIDOR_STYLES,
      chunkStyles: [],
      visibleStyles,
    };
  }
  if (profile === ROAD_RENDER_PROFILE_COUNTRY_DETAIL) {
    const addPrimary = relZoom >= 1.22;
    const addSecondary = relZoom >= 1.48;
    const chunkStyles: TransportStyleClass[] = [];
    if (addPrimary) chunkStyles.push('ROAD_PRIMARY');
    if (addSecondary) chunkStyles.push('ROAD_SECONDARY');
    return {
      useOverview: true,
      useChunks: chunkStyles.length > 0,
      keepOverviewCorridors: true,
      overviewStyles: ROAD_OVERVIEW_CORRIDOR_STYLES,
      chunkStyles,
      visibleStyles,
    };
  }
  let useOverview = overviewHysteresis;
  if (lodOverride === 'NETWORK_MEDIUM' || lodOverride === 'NETWORK_HIGH') useOverview = false;
  else if (lodOverride === 'NETWORK_LOW') useOverview = relZoom < ROAD_OVERVIEW_MAX_REL_ZOOM;
  else if (overviewHysteresis) {
    if (relZoom >= ROAD_OVERVIEW_MAX_REL_ZOOM) useOverview = false;
  } else if (relZoom < ROAD_OVERVIEW_EXIT_REL_ZOOM) {
    useOverview = true;
  }
  return {
    useOverview,
    useChunks: !useOverview,
    keepOverviewCorridors: false,
    overviewStyles: useOverview ? ALL_ROAD_STYLES : [],
    chunkStyles: useOverview ? [] : ALL_ROAD_STYLES,
    visibleStyles,
  };
}

/** Country border is 0.00042. Overview roads must stay well below that. */
export function paintForRoadProfile(styleClass: TransportStyleClass, profile: RoadRenderProfile): TransportPaint {
  if (profile === ROAD_RENDER_PROFILE_DEBUG) {
    if (styleClass === 'ROAD_MOTORWAY') return { color: '#5B9EC4', dash: [], strokeWidth: 0.00022 };
    if (styleClass === 'ROAD_TRUNK') return { color: '#3E7A9A', dash: [], strokeWidth: 0.00016 };
    if (styleClass === 'ROAD_PRIMARY') return { color: '#2F5F7A', dash: [], strokeWidth: 0.00012 };
    if (styleClass === 'ROAD_SECONDARY' || styleClass === 'ROAD_TERTIARY' || styleClass === 'ROAD_UNKNOWN') {
      return { color: '#244A62', dash: [], strokeWidth: 0.00008 };
    }
  }
  if (styleClass === 'ROAD_MOTORWAY') return { color: '#3A6F8C73', dash: [], strokeWidth: 0.00011 };
  if (styleClass === 'ROAD_TRUNK') return { color: '#2C587375', dash: [], strokeWidth: 0.00008 };
  if (styleClass === 'ROAD_PRIMARY') return { color: '#2A4F6655', dash: [], strokeWidth: 0.00006 };
  if (styleClass === 'ROAD_SECONDARY' || styleClass === 'ROAD_TERTIARY' || styleClass === 'ROAD_UNKNOWN') {
    return { color: '#23425844', dash: [], strokeWidth: 0.000045 };
  }
  return { color: '#3A6F8C73', dash: [], strokeWidth: 0.00008 };
}

export function countryOverviewRoadStrokeIsSubordinate(): boolean {
  const border = paintForCountryFocus().strokeWidth;
  const motorway = paintForRoadProfile('ROAD_MOTORWAY', ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW).strokeWidth;
  return motorway < border * 0.4;
}
