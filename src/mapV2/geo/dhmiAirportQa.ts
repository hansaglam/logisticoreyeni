/**
 * DHMİ public identity QA only. Not geometry. Not mass verification.
 * Codes are civil IATA identity references commonly published by DHMİ
 * plus other published civil airports in Türkiye (IST/SAW are not DHMİ-operated).
 */
export type DhmiIdentityRow = {
  iata: string;
  name: string;
  role?: 'INTERNATIONAL' | 'DOMESTIC' | 'CLOSED';
  dhmıOperated?: boolean;
};

export const DHMI_IDENTITY_QA_ROWS: readonly DhmiIdentityRow[] = [
  { iata: 'ADA', name: 'Adana Şakirpaşa', role: 'CLOSED', dhmıOperated: true },
  { iata: 'ADB', name: 'İzmir Adnan Menderes', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'ADF', name: 'Adıyaman', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'AJI', name: 'Ağrı Ahmed-i Hani', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'AOE', name: 'Eskişehir Hasan Polatkan', role: 'DOMESTIC', dhmıOperated: false },
  { iata: 'ASR', name: 'Kayseri', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'AYT', name: 'Antalya', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'BAL', name: 'Batman', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'BJV', name: 'Milas-Bodrum', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'BZI', name: 'Balıkesir Merkez', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'COV', name: 'Çukurova', role: 'INTERNATIONAL', dhmıOperated: false },
  { iata: 'CKZ', name: 'Çanakkale', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'DIY', name: 'Diyarbakır', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'DLM', name: 'Dalaman', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'DNZ', name: 'Denizli Çardak', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'EDO', name: 'Balıkesir Koca Seyit', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'ERC', name: 'Erzincan', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'ERZ', name: 'Erzurum', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'ESB', name: 'Ankara Esenboğa', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'EZS', name: 'Elazığ', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'GNY', name: 'Şanlıurfa GAP', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'GZT', name: 'Gaziantep', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'GZP', name: 'Gazipaşa-Alanya', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'HTY', name: 'Hatay', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'IGD', name: 'Iğdır', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'ISE', name: 'Isparta Süleyman Demirel', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'ISL', name: 'İstanbul Atatürk', role: 'CLOSED', dhmıOperated: false },
  { iata: 'IST', name: 'İstanbul Havalimanı', role: 'INTERNATIONAL', dhmıOperated: false },
  { iata: 'KCM', name: 'Kahramanmaraş', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'KSY', name: 'Kars Harakani', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'KYA', name: 'Konya', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'MLX', name: 'Malatya', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'MQM', name: 'Mardin', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'MSR', name: 'Muş', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'NAV', name: 'Nevşehir Kapadokya', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'NOP', name: 'Sinop', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'OGU', name: 'Ordu-Giresun', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'SAW', name: 'İstanbul Sabiha Gökçen', role: 'INTERNATIONAL', dhmıOperated: false },
  { iata: 'SZF', name: 'Samsun Çarşamba', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'TEQ', name: 'Tekirdağ Çorlu', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'TZX', name: 'Trabzon', role: 'INTERNATIONAL', dhmıOperated: true },
  { iata: 'VAN', name: 'Van Ferit Melen', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'VAS', name: 'Sivas Nuri Demirağ', role: 'DOMESTIC', dhmıOperated: true },
  { iata: 'YEI', name: 'Bursa Yenişehir', role: 'DOMESTIC', dhmıOperated: true },
];

export const DHMI_IATA_SET = new Set(DHMI_IDENTITY_QA_ROWS.map((row) => row.iata));
