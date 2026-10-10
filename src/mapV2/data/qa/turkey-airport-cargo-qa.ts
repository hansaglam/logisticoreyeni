/** Official/public airport cargo QA. Not OSM. Not geometry. Reviewed 2026-09-19. */

export const AIRPORT_CARGO_QA_REVIEW_DATE = '2026-09-19' as const;
export const DHMI_CARGO_STATS_PERIOD = '2026-01..2026-08 YTD (preliminary)' as const;
export const DHMI_KARGO_PDF_URL = 'https://dhmi.gov.tr/Lists/Istatislikler/Attachments/442/KARGO.pdf' as const;

export const AIRPORT_CARGO_EVIDENCE_TYPES = [
  'OFFICIAL_CARGO_TERMINAL',
  'OFFICIAL_CARGO_SERVICE',
  'OFFICIAL_CARGO_STATISTICS',
  'OFFICIAL_FREIGHT_TRAFFIC',
  'OPERATOR_CARGO_SERVICE',
  'OTHER_OFFICIAL',
] as const;
export type AirportCargoEvidenceType = (typeof AIRPORT_CARGO_EVIDENCE_TYPES)[number];

export const AIRPORT_CARGO_EVIDENCE_STATUSES = ['ACCEPTED', 'WEAK', 'CONFLICTING'] as const;
export type AirportCargoEvidenceStatus = (typeof AIRPORT_CARGO_EVIDENCE_STATUSES)[number];

export type AirportCargoEvidenceRecord = {
  iata: string;
  sourceType: 'OFFICIAL_STATISTICS' | 'OPERATOR_PUBLIC' | 'OFFICIAL_NEWS';
  sourceAuthority: string;
  sourceReference: string;
  evidenceType: AirportCargoEvidenceType;
  observedFact: string;
  evidenceDate: string;
  status: AirportCargoEvidenceStatus;
  cargoTonnesYtd?: number;
};

export type AirportOperationalQa = {
  iata: string;
  operationalStatus: 'OPERATIONAL' | 'CLOSED_OR_INACTIVE';
  reason: string;
  sourceReference: string;
};

function dhmiCargo(iata: string, tonnes: number, label: string): AirportCargoEvidenceRecord {
  return {
    iata,
    sourceType: 'OFFICIAL_STATISTICS',
    sourceAuthority: 'DHMİ',
    sourceReference: DHMI_KARGO_PDF_URL,
    evidenceType: 'OFFICIAL_CARGO_STATISTICS',
    observedFact: `DHMİ Kargo Trafiği (ton, kargo-only, not baggage+mail yük) ${DHMI_CARGO_STATS_PERIOD}: ${label} = ${tonnes} t`,
    evidenceDate: AIRPORT_CARGO_QA_REVIEW_DATE,
    status: tonnes >= 10 ? 'ACCEPTED' : 'WEAK',
    cargoTonnesYtd: tonnes,
  };
}

/** DHMİ KARGO.pdf YTD August 2026 totals. Empty/blank rows omitted. Zero rows omitted (not KNOWN_UNAVAILABLE). */
export const DHMI_CARGO_TONNES_YTD_2026_AUG: ReadonlyArray<{ iata: string; tonnes: number; label: string }> = [
  { iata: 'IST', tonnes: 1_341_298, label: 'İstanbul' },
  { iata: 'SAW', tonnes: 37_720, label: 'İstanbul Sabiha Gökçen' },
  { iata: 'ADB', tonnes: 18_840, label: 'İzmir Adnan Menderes' },
  { iata: 'ESB', tonnes: 8_411, label: 'Ankara Esenboğa' },
  { iata: 'AYT', tonnes: 7_519, label: 'Antalya' },
  { iata: 'COV', tonnes: 3_005, label: 'Çukurova' },
  { iata: 'GZT', tonnes: 1_192, label: 'Gaziantep' },
  { iata: 'DIY', tonnes: 1_114, label: 'Diyarbakır' },
  { iata: 'BAL', tonnes: 796, label: 'Batman' },
  { iata: 'ASR', tonnes: 603, label: 'Kayseri' },
  { iata: 'VAN', tonnes: 590, label: 'Van Ferit Melen' },
  { iata: 'TZX', tonnes: 448, label: 'Trabzon' },
  { iata: 'KYA', tonnes: 280, label: 'Konya' },
  { iata: 'SZF', tonnes: 226, label: 'Samsun Çarşamba' },
  { iata: 'MQM', tonnes: 213, label: 'Mardin' },
  { iata: 'TEQ', tonnes: 190, label: 'Tekirdağ Çorlu Atatürk' },
  { iata: 'DNZ', tonnes: 170, label: 'Denizli Çardak' },
  { iata: 'MLX', tonnes: 147, label: 'Malatya' },
  { iata: 'BJV', tonnes: 137, label: 'Muğla Milas-Bodrum' },
  { iata: 'KCM', tonnes: 113, label: 'Kahramanmaraş' },
  { iata: 'ERZ', tonnes: 91, label: 'Erzurum' },
  { iata: 'EZS', tonnes: 90, label: 'Elazığ' },
  { iata: 'OGU', tonnes: 89, label: 'Ordu-Giresun' },
  { iata: 'MSR', tonnes: 71, label: 'Muş Sultan Alparslan' },
  { iata: 'DLM', tonnes: 68, label: 'Muğla Dalaman' },
  { iata: 'GNY', tonnes: 59, label: 'Şanlıurfa GAP' },
  { iata: 'ADF', tonnes: 43, label: 'Adıyaman' },
  { iata: 'RZV', tonnes: 38, label: 'Rize-Artvin' },
  { iata: 'ERC', tonnes: 33, label: 'Erzincan' },
  { iata: 'HTY', tonnes: 30, label: 'Hatay' },
  { iata: 'MZH', tonnes: 24, label: 'Amasya Merzifon' },
  { iata: 'NKT', tonnes: 17, label: 'Şırnak' },
  { iata: 'NAV', tonnes: 15, label: 'Kapadokya' },
  { iata: 'VAS', tonnes: 14, label: 'Sivas Nuri Demirağ' },
  { iata: 'KSY', tonnes: 12, label: 'Kars Harakani' },
  { iata: 'AJI', tonnes: 10, label: 'Ağrı Ahmed-i Hani' },
  { iata: 'TJK', tonnes: 9, label: 'Tokat' },
  { iata: 'IGD', tonnes: 7, label: 'Iğdır' },
  { iata: 'BGG', tonnes: 6, label: 'Bingöl' },
  { iata: 'YKO', tonnes: 6.2, label: 'Hakkari Yüksekova' },
  { iata: 'SXZ', tonnes: 5, label: 'Siirt' },
  { iata: 'ONQ', tonnes: 3.4, label: 'Zonguldak Çaycuma' },
  { iata: 'ISE', tonnes: 3, label: 'Isparta Süleyman Demirel' },
  { iata: 'EDO', tonnes: 2.2, label: 'Balıkesir Koca Seyit' },
  { iata: 'GZP', tonnes: 1.4, label: 'Gazipaşa Alanya' },
  { iata: 'CKZ', tonnes: 0.3, label: 'Çanakkale' },
  { iata: 'YEI', tonnes: 0.1, label: 'Bursa Yenişehir' },
];

export const TURKEY_AIRPORT_CARGO_EVIDENCE: readonly AirportCargoEvidenceRecord[] = [
  ...DHMI_CARGO_TONNES_YTD_2026_AUG.map((row) => dhmiCargo(row.iata, row.tonnes, row.label)),
  {
    iata: 'IST',
    sourceType: 'OPERATOR_PUBLIC',
    sourceAuthority: 'IGA İstanbul Havalimanı',
    sourceReference: 'https://www.istairport.com/hizmetler/kesfet/havalimani-olanaklari/posta-hizmetleri-kargo',
    evidenceType: 'OPERATOR_CARGO_SERVICE',
    observedFact: 'Operator publishes postal/cargo facilities; M11 lists Kargo Terminali stop.',
    evidenceDate: AIRPORT_CARGO_QA_REVIEW_DATE,
    status: 'ACCEPTED',
  },
  {
    iata: 'SAW',
    sourceType: 'OPERATOR_PUBLIC',
    sourceAuthority: 'ISG Sabiha Gökçen',
    sourceReference: 'https://www.sabihagokcen.aero/kurumsal-bilgiler/ticari-faaliyetler/kargo-hizmetleri/kargo-terminal-hizmetleri',
    evidenceType: 'OFFICIAL_CARGO_TERMINAL',
    observedFact: 'Operator cargo terminal: 24/7 handling, import/export warehouses, ULD, cold storage, X-ray.',
    evidenceDate: AIRPORT_CARGO_QA_REVIEW_DATE,
    status: 'ACCEPTED',
  },
  {
    iata: 'COV',
    sourceType: 'OFFICIAL_NEWS',
    sourceAuthority: 'DHMİ Çukurova',
    sourceReference: 'https://dhmi.gov.tr/Sayfalar/Havalimani/Cukurova/HaberDetay.aspx?q=1017',
    evidenceType: 'OFFICIAL_CARGO_TERMINAL',
    observedFact: 'DHMİ: Turkish Cargo facility opened at Çukurova, 5,500 m² enclosed, 25,000 t/year capacity.',
    evidenceDate: AIRPORT_CARGO_QA_REVIEW_DATE,
    status: 'ACCEPTED',
  },
];

export const TURKEY_AIRPORT_OPERATIONAL_QA: readonly AirportOperationalQa[] = [
  {
    iata: 'ISL',
    operationalStatus: 'CLOSED_OR_INACTIVE',
    reason: 'İstanbul Atatürk closed for scheduled civil operations; DHMİ cargo table row empty.',
    sourceReference: DHMI_KARGO_PDF_URL,
  },
  {
    iata: 'ADA',
    operationalStatus: 'CLOSED_OR_INACTIVE',
    reason: 'Adana Şakirpaşa civil traffic replaced by Çukurova (opened 2024-08-10). DHMİ 2026 cargo table: Adana blank, Çukurova reported.',
    sourceReference: 'https://dhmi.gov.tr/Sayfalar/Havalimani/Cukurova/GenelBilgiler.aspx',
  },
];

export function cargoEvidenceForIata(iata: string | null | undefined): AirportCargoEvidenceRecord[] {
  if (!iata) return [];
  return TURKEY_AIRPORT_CARGO_EVIDENCE.filter((row) => row.iata === iata);
}

export function operationalQaForIata(iata: string | null | undefined): AirportOperationalQa | undefined {
  if (!iata) return undefined;
  return TURKEY_AIRPORT_OPERATIONAL_QA.find((row) => row.iata === iata);
}

export function dhmiCargoTonnesForIata(iata: string | null | undefined): number | null {
  if (!iata) return null;
  const row = DHMI_CARGO_TONNES_YTD_2026_AUG.find((item) => item.iata === iata);
  return row ? row.tonnes : null;
}
