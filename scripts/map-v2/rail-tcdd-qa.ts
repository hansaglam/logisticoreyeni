import type { CityTransportAccess } from '../../src/mapV2/geo/transportNetwork';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from '../../src/mapV2/geo/transportNetwork';

/** TCDD is QA/reference only. Do not copy TCDD map geometry. */
export const TCDD_QA_STATUS = 'TCDD_QA_ONLY' as const;

export type TcddQaCorridor = {
  id: string;
  gameplayCityA: string;
  gameplayCityB: string;
  publicNote: string;
  expected: 'LIKELY_PRESENT' | 'MAY_BE_ABSENT';
};

/**
 * Public TCDD network knowledge for discrepancy checks — not a geometry source.
 * No tiles, no traces, no screenshots.
 */
export const TCDD_QA_CORRIDORS: TcddQaCorridor[] = [
  {
    id: 'istanbul-ankara',
    gameplayCityA: 'istanbul',
    gameplayCityB: 'ankara',
    publicNote: 'TCDD conventional + YHT corridor is publicly documented.',
    expected: 'LIKELY_PRESENT',
  },
  {
    id: 'izmir-ankara',
    gameplayCityA: 'izmir',
    gameplayCityB: 'ankara',
    publicNote: 'TCDD west–central corridor via Afyon/Eskişehir is publicly documented.',
    expected: 'LIKELY_PRESENT',
  },
  {
    id: 'ankara-adana',
    gameplayCityA: 'ankara',
    gameplayCityB: 'adana',
    publicNote: 'TCDD central–south corridor is publicly documented.',
    expected: 'LIKELY_PRESENT',
  },
  {
    id: 'adana-diyarbakir',
    gameplayCityA: 'adana',
    gameplayCityB: 'diyarbakir',
    publicNote: 'TCDD southeast corridor is publicly documented (may be fragmented in OSM).',
    expected: 'LIKELY_PRESENT',
  },
  {
    id: 'istanbul-bursa',
    gameplayCityA: 'istanbul',
    gameplayCityB: 'bursa',
    publicNote: 'Bursa high-speed / national mainline access is incomplete in public TCDD operations.',
    expected: 'MAY_BE_ABSENT',
  },
  {
    id: 'antalya-network',
    gameplayCityA: 'antalya',
    gameplayCityB: 'antalya',
    publicNote: 'Antalya city has no TCDD mainline passenger/freight station in common public network maps.',
    expected: 'MAY_BE_ABSENT',
  },
  {
    id: 'trabzon-network',
    gameplayCityA: 'trabzon',
    gameplayCityB: 'trabzon',
    publicNote: 'Trabzon city has no TCDD mainline into the urban core in common public network maps.',
    expected: 'MAY_BE_ABSENT',
  },
];

export type TcddQaCorridorResult = {
  id: string;
  expected: TcddQaCorridor['expected'];
  osmSameComponent: boolean | null;
  cityAStatus: string;
  cityBStatus: string;
  note: string;
};

function componentRoots(nodes: GeoTransportNodeRecord[], edges: GeoTransportEdgeRecord[]): Map<string, string> {
  const parent = new Map(nodes.map((n) => [n.nodeId, n.nodeId]));
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur) ?? cur) ?? cur);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  for (const edge of edges) {
    const a = find(edge.fromNodeId);
    const b = find(edge.toNodeId);
    if (a !== b) parent.set(a, b);
  }
  const roots = new Map<string, string>();
  for (const node of nodes) roots.set(node.nodeId, find(node.nodeId));
  return roots;
}

export function runTcddQa(args: {
  gameplayToGeo: Record<string, string>;
  cityAccess: CityTransportAccess[];
  nodes: GeoTransportNodeRecord[];
  edges: GeoTransportEdgeRecord[];
}): { status: typeof TCDD_QA_STATUS; corridors: TcddQaCorridorResult[]; notes: string[] } {
  const accessByCity = new Map(args.cityAccess.map((row) => [row.geoCityId, row]));
  const roots = componentRoots(args.nodes, args.edges);
  const corridors = TCDD_QA_CORRIDORS.map((row) => {
    const geoA = args.gameplayToGeo[row.gameplayCityA];
    const geoB = args.gameplayToGeo[row.gameplayCityB];
    const accessA = geoA ? accessByCity.get(geoA) : undefined;
    const accessB = geoB ? accessByCity.get(geoB) : undefined;
    const nodeA = accessA?.accessNodeIds[0];
    const nodeB = accessB?.accessNodeIds[0];
    let osmSameComponent: boolean | null = null;
    if (row.gameplayCityA === row.gameplayCityB) {
      osmSameComponent = (accessA?.status ?? 'UNRESOLVED') !== 'UNRESOLVED';
    } else if (nodeA && nodeB) {
      osmSameComponent = roots.get(nodeA) === roots.get(nodeB);
    }
    return {
      id: row.id,
      expected: row.expected,
      osmSameComponent,
      cityAStatus: accessA?.status ?? 'UNRESOLVED',
      cityBStatus: accessB?.status ?? 'UNRESOLVED',
      note: row.publicNote,
    };
  });
  const notes = [
    'TCDD_QA_ONLY — official TCDD materials were not copied as geometry.',
    'OSM classification mistakes and gaps are expected; this is not a 100% correctness claim.',
    'Station existence is not a freight-terminal claim.',
  ];
  return { status: TCDD_QA_STATUS, corridors, notes };
}
