/**
 * Help & Guide — player-facing section content (repository-truth only).
 */

import type { GameIconName } from '../theme/icons';

export type HelpGuideSectionId =
  | 'getting_started'
  | 'deliveries'
  | 'vehicles_fleet'
  | 'fuel'
  | 'warehouses'
  | 'marketplace'
  | 'reputation'
  | 'driver_xp'
  | 'seasons_challenges'
  | 'achievements_progress'
  | 'account_cloud';

export type HelpGuideSectionMeta = {
  id: HelpGuideSectionId;
  title: string;
  summary: string;
  icon: GameIconName;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  /** Getting Started section shows replay CTA. */
  showReplayCta?: boolean;
};

export const HELP_GUIDE_REPLAY_CTA_LABEL = 'Başlangıç Rehberini Tekrar Göster';

export const HELP_GUIDE_REPLAY_HINT =
  'İstersen temel adımları oyun ekranları üzerinde tekrar görebilirsin.';

export const HELP_GUIDE_SECTIONS: readonly HelpGuideSectionMeta[] = [
  {
    id: 'getting_started',
    title: 'Başlarken',
    summary: 'Temel oyun döngüsü: sözleşme seç, teslim et, şirketini büyüt.',
    icon: 'map',
    showReplayCta: true,
    paragraphs: [
      'LogistiCore’da şirketini büyütmek için basit bir döngü izlersin: iş al, teslim et, kazancını yatır.',
      'İlk adımlarda İşler sekmesinden bir sözleşme seç, uygun kamyon ve şoförü hazırla, yakıtı kontrol et ve teslimatı tamamla.',
    ],
    bullets: [
      'İşler sekmesinden uygun bir sözleşme seç',
      'Boşta duran kamyon ve şoförü göreve ata',
      'Rotaya yetecek yakıtı kontrol et',
      'Teslimatı tamamlayarak nakit, şirket XP ve itibar kazan',
      'Filo, depo, piyasa ve şirket ekranlarıyla büyümeyi sürdür',
    ],
  },
  {
    id: 'deliveries',
    title: 'Teslimatlar',
    summary: 'Sözleşme seçimi, ekip atama ve teslimat tamamlanma akışı.',
    icon: 'contract',
    paragraphs: [
      'Teslimatlar İşler sekmesinden yönetilir. Uygun bir sözleşmede “Ekibi Seç” ile kamyon ve şoförünü belirleyip teslimatı başlatırsın.',
      'Başarılı teslimatlar nakit kazandırır; geç kalma veya başarısızlık ise ceza ve itibar kaybına yol açabilir.',
    ],
    bullets: [
      'Sözleşme seviyesi, itibar ve ekip uygunluğu kontrol edilir',
      'Kamyonun çıkış şehrinde ve boşta olması gerekir',
      'Kapasite, durum ve süre koşulları teslimatı etkiler',
      'Aktif teslimatları İşler ve Harita üzerinden takip edebilirsin',
    ],
  },
  {
    id: 'vehicles_fleet',
    title: 'Araçlar ve Filo',
    summary: 'Kamyon, şoför, römork ve geliştirmeler.',
    icon: 'truck',
    paragraphs: [
      'Filo ekranında kamyonlarını, şoförlerini ve römorklarını yönetirsin. Yeni araç ve personel Mağaza’dan alınır veya kiralanır.',
      'Kamyon geliştirmeleri Motor, Yakıt Verimliliği, Kargo ve Dayanıklılık alanlarında yapılır.',
    ],
    bullets: [
      'Mağaza: kamyon satın al / kirala, şoför işe al, römork al',
      'Bazı araç ve personel seçenekleri şirket seviyesine bağlıdır',
      'Filo’dan atama, bakım ve geliştirme işlemlerini yönet',
      'Geliştirme seviyelerinin üst sınırı vardır',
    ],
  },
  {
    id: 'fuel',
    title: 'Yakıt',
    summary: 'Rota yakıt ihtiyacı, ikmal ve yolda yakıt bitmesi.',
    icon: 'fuel',
    paragraphs: [
      'Teslimatı başlatmadan önce tankında rota için yeterli yakıt olmalıdır. Yetersiz yakıtta görev başlamaz.',
      'Şehirlerde yakıt ikmali yapabilir, gerektiğinde yolda yardım seçeneklerini kullanabilirsin. Rota sırasında yakıt biterse teslimat durabilir.',
    ],
    bullets: [
      'Başlangıçta rota ihtiyacı kontrol edilir',
      'Şehir ikmali ile tankı doldurabilirsin',
      'Yolda yakıt yardım seçenekleri mevcuttur',
      'Yakıt masrafı teslimat öncesi ikmal üzerinden işler',
    ],
  },
  {
    id: 'warehouses',
    title: 'Depolar',
    summary: 'Stok tutma, şehirler arası ticaret ve depo yükseltmeleri.',
    icon: 'warehouse',
    paragraphs: [
      'Depolar, Piyasa’dan aldığın ürünleri saklaman ve uygun şehirde satman için kullanılır.',
      'Yeni depo açmak şirket seviyene ve şehir kilidine bağlıdır. Standart ve soğuk zincir depoları vardır; kapasite yükseltmeleri seviye ister.',
    ],
    bullets: [
      'Ucuz şehirden al → depola → uygun yerde sat',
      'Açabileceğin depo sayısı seviyeyle artar',
      'Bazı şehirler daha yüksek seviyede açılır',
      'Depoların günlük işletme maliyeti vardır',
    ],
  },
  {
    id: 'marketplace',
    title: 'Piyasa & Araç Pazarı',
    summary: 'Ürün ticareti ve bağlı hesapla araç alım-satımı.',
    icon: 'market',
    paragraphs: [
      'Piyasa, şehirler arasında ürün alıp satmana olanak tanır. Fiyatlar ve fırsatlar şehirlere göre değişir.',
      'Araç Pazarı ise oyuncular arasında kamyon ilanı açıp alım-satım yapabileceğin ayrı bir alandır. Bu özellik için bağlı hesap gerekir ve işlemler oyun içi nakit ile yapılır.',
    ],
    bullets: [
      'Piyasa = ürün ticareti',
      'Araç Pazarı = kamyon ilanı / alım-satım',
      'Araç Pazarı için misafir hesap yeterli değildir',
      'Gerçek para ile araç ticareti yoktur',
    ],
  },
  {
    id: 'reputation',
    title: 'İtibar',
    summary: '0–100 itibar skalası ve prestijli sözleşmeler.',
    icon: 'reputation',
    paragraphs: [
      'İtibar, şirketinin güvenilirliğini gösterir (0–100). Zamanında ve başarılı teslimatlar itibarı yükseltir; gecikme ve başarısızlık düşürür.',
      'Yüksek itibar, prestijli sözleşmelere erişmeni kolaylaştırır. Prestijli işler için genellikle daha yüksek itibar gerekir.',
    ],
    bullets: [
      'İtibar Şirket özetinde görünür',
      'Başarılı ve zamanında teslimatlar itibarı güçlendirir',
      'Prestijli sözleşmeler yüksek itibar ister',
      'İtibar düşükken bazı işler kilitli kalabilir',
    ],
  },
  {
    id: 'driver_xp',
    title: 'Şoför XP',
    summary: 'Başarılı teslimatlarda şoför deneyimi.',
    icon: 'driver',
    paragraphs: [
      'Şoförler başarılı teslimatlarda deneyim kazanır ve seviye atlar. Başarısız veya iptal edilen teslimatlarda teslimat XP’si verilmez.',
      'Bazı özel sözleşmeler daha deneyimli şoför isteyebilir. Şoför seviyesi Filo ekranından takip edilir.',
    ],
    bullets: [
      'XP yalnızca başarılı teslimatta artar',
      'Geç ama tamamlanan teslimatlarda XP azalabilir',
      'İptal / başarısızlıkta teslimat XP’si yoktur',
      'Bazı işler minimum şoför seviyesi ister',
    ],
  },
  {
    id: 'seasons_challenges',
    title: 'Sezonlar ve Görevler',
    summary: 'Haftalık sezon ve bağlı hesap görevleri (açık olduğunda).',
    icon: 'trophy',
    paragraphs: [
      'Sezonlar ve görevler açık olduğunda bağlı hesapla haftalık ilerleme ve görev ödülleri takip edilir.',
      'Şu anki görevler ağırlıklı olarak Araç Pazarı alım-satımına odaklanır. Sezon sonu sıralama ödülleri henüz yoktur.',
    ],
    bullets: [
      'Bağlı hesap gerekir',
      'Görevler nakit ve sezon puanı verebilir',
      'Teslimat sayısına dayalı görevler henüz aktif değildir',
      'Final sıralama ödülü şu an yok',
    ],
  },
  {
    id: 'achievements_progress',
    title: 'Başarımlar ve İlerleme',
    summary: 'Kilometre taşlarını takip eden bilgilendirme kayıtları.',
    icon: 'level',
    paragraphs: [
      'Başarımlar açık olduğunda önemli kilometre taşlarını kaydeder ve bilgilendirme olarak gösterir.',
      'Başarımlar şu an nakit veya ekstra oyun ödülü vermez; ilerlemeyi takip etmene yardımcı olur.',
    ],
    bullets: [
      'Başarımlar bilgilendirme amaçlıdır',
      'Nakit ödül vaat etmez',
      'Şirket ekranındaki ilerleme alanından takip edilir',
      'Özellik kapalıysa menüde görünmeyebilir',
    ],
  },
  {
    id: 'account_cloud',
    title: 'Hesap ve Bulut Kayıt',
    summary: 'Misafir oyun, hesap bağlama ve bulut koruması.',
    icon: 'account',
    paragraphs: [
      'Misafir olarak oynayabilirsin; ancak ilerlemeni cihazlar arasında korumak için Google veya Apple ile hesap bağlaman gerekir.',
      'Bağlı hesapta bulut kayıt senkronu çalışır. Farklı cihaz veya oturumlarda kayıt çakışması olursa uygulama sana seçenek sunar.',
    ],
    bullets: [
      'Misafir: yerel ilerleme',
      'Bağlı hesap: bulut koruması',
      'Araç Pazarı gibi bazı özellikler bağlı hesap ister',
      'Hesap işlemleri Şirket → Hesap Merkezi’nden yönetilir',
    ],
  },
] as const;
