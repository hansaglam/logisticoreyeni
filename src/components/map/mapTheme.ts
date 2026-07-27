export const MAP_BG = '#050A12';
export const MAP_CARD_BG = '#020914';
export const MAP_SURFACE = '#081426';
export const MAP_BORDER = 'rgba(50,95,150,0.38)';
export const MAP_BORDER_ACCENT = 'rgba(35,136,255,0.48)';
export const MAP_TITLE_COLOR = '#F3F7FF';
export const MAP_MUTED = '#91A0B8';
export const MAP_ACCENT = '#39A0FF';
export const MAP_ACCENT_BORDER = '#2388FF';

export const MAP_HORIZONTAL_PADDING = 16;

export const MAP_HEADER_ICON_SIZE = 52;
export const MAP_HEADER_ICON_SIZE_COMPACT = 48;
export const MAP_HEADER_ICON_RADIUS = 16;
export const MAP_HEADER_REFRESH_SIZE = 44;
export const MAP_HEADER_REFRESH_SIZE_COMPACT = 40;
export const MAP_HEADER_TITLE_SIZE = 24;
export const MAP_HEADER_TITLE_SIZE_COMPACT = 21;
export const MAP_HEADER_SUBTITLE_SIZE = 11.5;

export const MAP_FILTER_TAB_HEIGHT = 43;
export const MAP_FILTER_CONTAINER_GAP = 8;
export const MAP_SPACING_HEADER_TO_FILTERS = 12;
export const MAP_SPACING_FILTERS_TO_STATS = 10;
export const MAP_SPACING_STATS_TO_MAP = 10;
export const MAP_SPACING_MAP_TO_PANEL = 10;
export const MAP_SPACING_PANEL_TO_TRACKING = 14;

export const MAP_STATS_HEIGHT = 52;
export const MAP_STATS_RADIUS = 17;

export const MAP_CARD_RADIUS = 22;
export const MAP_VIEWPORT_HEIGHT = 340;
export const MAP_VIEWPORT_HEIGHT_COMPACT = 290;
/** Harita asset deniz tonu — fit görünümünde letterbox uyumu. */
export const MAP_VIEWPORT_BACKGROUND = '#031225';

/** Operational başlangıç relative scale üst sınırı (cihaz bazlı hesap + clamp). */
export const MAP_OPERATIONAL_SCALE_MAX = 1.85;
/** Maksimum zoom: operational ve fit scale'den türetilir. */
export const MAP_MAX_SCALE_OPERATIONAL_FACTOR = 2.1;
export const MAP_MAX_SCALE_FIT_FACTOR = 3.2;
/** Detail level eşikleri operational absolute scale'e göre. */
export const MAP_DETAIL_LEVEL_MEDIUM_FACTOR = 1.1;
export const MAP_DETAIL_LEVEL_HIGH_FACTOR = 1.55;
/** Çift dokunma zoom çarpanı ve max zoom yakınlık eşiği. */
export const MAP_DOUBLE_TAP_ZOOM_FACTOR = 1.5;
export const MAP_DOUBLE_TAP_MAX_PROXIMITY = 0.88;
export const MAP_GESTURE_SNAP_MS = 165;
export const MAP_RESET_ANIMATION_MS = MAP_GESTURE_SNAP_MS;
/** Minimum zoom'da fit merkezine snap eşiği. */
export const MAP_FIT_EPSILON = 0.015;

export const MAP_MARKER_HIT_RADIUS = 20;

export const MAP_MARKER_GLOW = '#2388FF';
export const MAP_MARKER_CORE = '#39A0FF';
export const MAP_ROUTE_STROKE = '#39A0FF';
/** Aktif teslimat rotası — tamamlanan segment (ana stroke). */
export const MAP_ROUTE_ACTIVE = '#34D399';
export const MAP_ROUTE_COMPLETED = '#22C55E';
/** Aktif teslimat rotası — kalan segment (aynı ton, düşük opacity). */
export const MAP_ROUTE_REMAINING = '#22C55E';
export const MAP_ROUTE_REMAINING_OPACITY = 0.42;
export const MAP_ROUTE_REMAINING_WIDTH = 2.2;
export const MAP_ROUTE_COMPLETED_WIDTH = 3;
export const MAP_ROUTE_COMPLETED_GLOW = 'rgba(34, 197, 94, 0.28)';
export const MAP_ROUTE_COMPLETED_GLOW_WIDTH = 6;
export const MAP_ROUTE_GLOW = 'rgba(34, 197, 94, 0.28)';
export const MAP_ROUTE_ACTIVE_WIDTH = 3;
export const MAP_ROUTE_GLOW_WIDTH = 7;
/** Transfer rotaları — mavi kalır. */
export const MAP_TRANSFER_ROUTE = '#39A0FF';

export const MAP_DELIVERY_ORIGIN = '#39A0FF';
export const MAP_DELIVERY_DESTINATION = '#34D399';
export const MAP_DELIVERY_DESTINATION_GLOW = 'rgba(52, 211, 153, 0.25)';

export const MAP_TRUCK_MARKER_SIZE = 28;
export const MAP_TRUCK_MARKER_MIN_SCREEN = 22;
export const MAP_TRUCK_MARKER_MAX_SCREEN = 30;
export const MAP_TRUCK_MARKER_BORDER = '#5DD4FF';
export const MAP_TRUCK_MARKER_FILL = '#031225';
export const MAP_TRUCK_MARKER_ANIM_MS = 750;

export const MAP_DELIVERY_PROGRESS_TRACK = '#132238';
export const MAP_DELIVERY_PROGRESS_FILL = '#39A0FF';

export const MAP_PANEL_RADIUS = 18;
export const MAP_PANEL_MIN_HEIGHT = 82;

export const MAP_TRUCK_CARD_HEIGHT = 86;
export const MAP_TRUCK_CARD_HEIGHT_DELIVERY = 94;
export const MAP_TRUCK_CARD_RADIUS = 17;
