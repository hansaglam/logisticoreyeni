/**
 * Map V2 Step 28 production multimodal UI foundation.
 * Run: npx tsx scripts/map-v2-multimodal-ui-foundation-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import {
  evaluateRailMultimodalOfferAcceptance,
  generateRailMultimodalOffers,
  MAX_RAIL_MULTIMODAL_OFFERS,
  type RailMultimodalOffer,
} from '../src/domain/multimodalRailOffer';
import { MULTIMODAL_FEATURE_ROLLOUT } from '../src/domain/multimodalShipmentPersistence';
import {
  isMultimodalUiPreviewEnabled,
  MULTIMODAL_UI_PREVIEW_SEED,
} from '../src/domain/multimodalUiPreviewGate';
import {
  formatMultimodalDurationGameSeconds,
  mapFleetFeasibilityToVisualState,
  presentRailMultimodalOffer,
  presentRailMultimodalOffers,
  RAIL_OFFER_MODE_STAGES,
  viewModelExposesInternalDiagnostics,
} from '../src/domain/presentation/multimodalRailOfferPresentation';
import {
  HIDDEN_RAIL_PREVIEW_SESSION,
  loadPreviewRailOffers,
} from '../src/features/contracts/multimodal/loadPreviewRailOffers';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { formatMoney, formatTons } from '../src/theme/format';
import { getCityName, getProductName } from '../src/utils/entityLookup';

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const access = getTurkeyRoadTransferAccessArtifact();

console.log('\n=== Map V2 Multimodal UI Foundation (Step 28) ===\n');

assert(SAVE_GAME_VERSION === 6, 'AA SAVE_GAME_VERSION = 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'AF MULTIMODAL_OFF default');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AC RAIL FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AD SEA FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AE AIR FOUNDATION_ONLY');

assert(
  !isMultimodalUiPreviewEnabled({ featureRollout: 'MULTIMODAL_OFF', envValue: '', isDev: true }),
  'CASE1 preview flag OFF hides UI',
);
assert(
  isMultimodalUiPreviewEnabled({
    featureRollout: 'MULTIMODAL_OFF',
    envValue: 'true',
    isDev: true,
  }),
  'CASE2 preview ON in DEV',
);
assert(
  !isMultimodalUiPreviewEnabled({
    featureRollout: 'MULTIMODAL_OFF',
    envValue: 'true',
    isDev: false,
  }),
  'CASE3 production env-only fail closed',
);
assert(
  !isMultimodalUiPreviewEnabled({
    featureRollout: 'INTERNAL_TEST',
    envValue: 'true',
    isDev: true,
  }),
  'preview does not unlock when rollout is not MULTIMODAL_OFF',
);

const contractsScreen = read('src/screens/ContractsScreen.tsx');
const overview = read('src/features/contracts/components/ContractsOverview.tsx');
const presentation = read('src/domain/presentation/multimodalRailOfferPresentation.ts');
const cardSrc = read('src/features/contracts/multimodal/MultimodalRailOfferCard.tsx');
const detailSrc = read('src/features/contracts/multimodal/MultimodalRailOfferDetailModal.tsx');
const stripSrc = read('src/features/contracts/multimodal/MultimodalModeStrip.tsx');
const loadSrc = read('src/features/contracts/multimodal/loadPreviewRailOffers.ts');
const storeSrc = read('src/store/gameStore.ts');
const saveSrc = read('src/storage/saveGame.ts');
const contractsGen = read('src/simulation/contracts.ts');
const mapScreen = read('src/screens/MapScreen.tsx');
const routes = read('src/data/routes.ts');
const actionBtn = read('src/components/ui/ActionButton.tsx');

assert(overview.includes("'available' | 'active' | 'completed' | 'rail'"), 'segment union includes rail');
assert(contractsScreen.includes('if (!railSectionVisible)'), 'A hide when preview off');
assert(contractsScreen.includes("key: 'rail'"), 'B rail tab after gate');
assert(contractsScreen.includes('loadPreviewRailOffers'), 'preview loader wired');
assert(!contractsScreen.includes('as Contract'), 'D no MultimodalRailOffer as Contract');
assert(!loadSrc.includes('as Contract'), 'D loader no Contract cast');
assert(!contractsScreen.includes('availableContracts.push'), 'C no insert into availableContracts');
assert(!contractsScreen.includes('...railPreview.offers'), 'C offers not spread into ROAD list');
assert(contractsScreen.includes("type: 'rail'"), 'separate rail list items');
assert(contractsScreen.includes('handleQuickStartDelivery'), 'Y ROAD accept path still present');
assert(contractsScreen.includes('onStartDelivery={handleQuickStartDelivery}'), 'Y sheet still ROAD handler');
assert(!detailSrc.includes('startDelivery'), 'R detail has no startDelivery');
assert(!detailSrc.includes('createDelivery'), 'T no createDelivery');
assert(!detailSrc.includes('completeDelivery'), 'V no completeDelivery');
assert(!cardSrc.includes('onAccept'), 'R card has no onAccept');
assert(!detailSrc.includes('gameStore'), 'S no gameStore in detail');
assert(!cardSrc.includes('gameStore'), 'S no gameStore in card');
assert(!storeSrc.includes('acceptMultimodalOffer'), 'S no acceptMultimodalOffer');
assert(!storeSrc.includes('startMultimodalShipment'), 'S no startMultimodalShipment');
assert(!storeSrc.includes('reserveMultimodalResources'), 'S no reserve action');
assert(!storeSrc.includes('payRailCarrier'), 'S no payRailCarrier');
assert(!detailSrc.includes('getMultimodalSettlementId'), 'W no settlement from UI');
assert(!cardSrc.includes('getMultimodalSettlementId'), 'W no settlement from card');
assert(!saveSrc.includes('railOffers'), 'Z no railOffers in save');
assert(!saveSrc.includes('selectedRailOffer'), 'Z no selectedRailOffer persist');
assert(saveSrc.includes('SAVE_GAME_VERSION = 6'), 'AA version literal');
assert(!read('backend/src/index.ts').includes('multimodalRailOfferPresentation'), 'AB no backend presentation');
assert(!read('firestore.rules').includes('railOffer'), 'AB no firestore railOffer');
assert(!mapScreen.includes('MultimodalRailOfferCard'), 'AH MapScreen unchanged by rail card');
assert(!mapScreen.includes('isMultimodalUiPreviewEnabled'), 'AH MapScreen no preview gate');
assert(routes.includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'AG routes.ts unchanged marker');
assert(!contractsGen.includes('generateRailMultimodalOffers'), 'AI ROAD generator no Step 27');
assert(!contractsGen.includes('MultimodalRailOfferCard'), 'AI ROAD generator no Step 28 UI');
assert(!contractsGen.includes('isMultimodalUiPreviewEnabled'), 'AI contracts.ts no UI gate');
assert(contractsScreen.includes('selectAvailableContractsForUi(contracts)'), '66 ROAD data source');
assert(contractsScreen.includes('<ContractCard'), '66 ROAD card path');
assert(contractsScreen.includes('HIDDEN_RAIL_PREVIEW_SESSION'), '66 no generate when hidden');
assert(detailSrc.includes('label={viewModel.ctaLabel}'), 'Q CTA from view model');
assert(detailSrc.includes('disabled'), 'Q CTA disabled');
assert(detailSrc.includes('() => undefined'), 'R CTA keeps no-op when disabled');
assert(actionBtn.includes('accessibilityState={{ disabled }}'), 'AP disabled announced');
assert(stripSrc.includes("name={stageIcon(stage.mode)}"), 'L icons with labels');
assert(RAIL_OFFER_MODE_STAGES.map((s) => s.mode).join('→') === 'ROAD→RAIL→ROAD', 'L mode strip ROAD→RAIL→ROAD');
assert(cardSrc.includes('minWidth: 0'), 'AQ compact minWidth 0');
assert(!cardSrc.includes('width: 400'), 'AQ no fixed 400');
assert(!detailSrc.includes('width: 400'), 'AQ detail no fixed 400');
assert(!presentation.includes('estimateMultimodalRailTariff'), '63 no tariff recompute');
assert(!presentation.includes('estimateMultimodalShipmentDuration'), '64 no duration recompute');
assert(!presentation.includes('estimateRailOfferEconomics'), '63 no economics recompute');
assert(!cardSrc.includes('@shopify/react-native-skia'), 'AR no Skia card');
assert(!loadSrc.includes('dijkstra') && !loadSrc.includes('Dijkstra'), 'AS no pathfinding in loader');
assert(!presentation.includes('turkey-road-graph'), 'AR no full ROAD graph');
assert(!cardSrc.includes('MapScreen'), 'AR no map in card');

const hidden = loadPreviewRailOffers({ previewEnabled: false });
assert(hidden.status === 'hidden' && hidden.offers.length === 0 && hidden.viewModels.length === 0, 'A loader hidden');
assert(HIDDEN_RAIL_PREVIEW_SESSION.status === 'hidden', 'A hidden session shape');

const generated = generateRailMultimodalOffers({
  generationSeed: MULTIMODAL_UI_PREVIEW_SEED,
  accessArtifact: access,
  playerLevel: 1,
});
assert(generated.status === 'READY', 'preview seed generates');
assert(generated.offers.length <= MAX_RAIL_MULTIMODAL_OFFERS, 'AL at most 8');

const emptyVm = presentRailMultimodalOffers([]);
assert(emptyVm.length === 0, 'AJ 0 offers empty view models');

const first = generated.offers[0];
if (first) {
  const readyFleet = createDevMultimodalRoadPlanningFleet({
    originCityId: first.originCityId,
    destinationCityId: first.destinationCityId,
    cargoWeightTons: first.cargo.quantity,
  });
  const acceptance = evaluateRailMultimodalOfferAcceptance({
    offer: first,
    accessArtifact: access,
    fleet: readyFleet,
    productionCheck: false,
  });
  assert(acceptance.canAcceptNow === false, '65 canAcceptNow remains false');
  const vm = presentRailMultimodalOffer(first, acceptance);
  assert(!!vm, 'E presentable offer');
  if (vm) {
    assert(vm.paymentText === formatMoney(first.playerPayment), 'F payment from playerPayment');
    assert(vm.paymentText !== formatMoney(first.economics.railCarrierCost), 'G payment is not railCarrierCost');
    assert(
      vm.durationText === formatMultimodalDurationGameSeconds(first.durationSnapshot.totalDurationGameSeconds),
      'H duration from durationSnapshot',
    );
    assert(
      vm.deadlineText === formatMultimodalDurationGameSeconds(first.deadlineSnapshot.deadlineGameSeconds),
      'I deadline from deadlineSnapshot',
    );
    assert(vm.cargoName === getProductName(first.cargo.productId), 'J cargo display resolver');
    assert(vm.cargoAmountText === formatTons(first.cargo.quantity), 'K tonnes display');
    assert(vm.originName === getCityName(first.originCityId), '19 city helper origin');
    assert(vm.destinationName === getCityName(first.destinationCityId), '19 city helper dest');
    assert(vm.modeStages.length === 3, 'L three stages');
    assert(vm.ctaDisabled === true, 'Q ctaDisabled');
    assert(vm.ctaLabel === 'Yakında', 'Q Yakında');
    assert(vm.ctaAccessibilityLabel.includes('devre dışı'), 'AP CTA a11y disabled');
    assert(vm.accessibilityLabel.includes(vm.originName), 'AO a11y origin');
    assert(vm.accessibilityLabel.includes('Demiryolu'), 'AO a11y multimodal');
    assert(!viewModelExposesInternalDiagnostics(vm), 'AT no technical IDs in player VM');
    assert(!vm.explanation.includes('FOUNDATION_ONLY'), '12 no FOUNDATION_ONLY');
    assert(vm.explanation.includes('üçüncü taraf'), 'J third-party wording');
    assert(!vm.explanation.includes('lokomotif'), '8 no locomotive');
    assert(
      first.deadlineSnapshot.deadlineGameSeconds > first.durationSnapshot.totalDurationGameSeconds,
      '23 deadline snapshot distinct from duration',
    );
    assert(typeof vm.firstMileLabel === 'string' && vm.firstMileLabel.includes('Demiryolu terminali'), '27 generic terminal');
  }

  const missingOrigin = evaluateRailMultimodalOfferAcceptance({
    offer: first,
    accessArtifact: access,
    fleet: { trucks: [], drivers: [], trailers: [] },
    productionCheck: false,
  });
  const originVm = presentRailMultimodalOffer(first, missingOrigin);
  assert(originVm?.visualState === 'FLEET_PREPARATION_REQUIRED' || originVm?.visualState === 'UNAVAILABLE', 'M fleet mapping');
  assert(Boolean(originVm?.readinessLabel.includes('Filo')), 'N preparation copy');
  assert(mapFleetFeasibilityToVisualState('ORIGIN_FLEET_UNAVAILABLE') === 'FLEET_PREPARATION_REQUIRED', 'N origin visual');
  assert(mapFleetFeasibilityToVisualState('DESTINATION_FLEET_UNAVAILABLE') === 'FLEET_PREPARATION_REQUIRED', 'O dest visual');
  assert(mapFleetFeasibilityToVisualState('DRIVER_UNAVAILABLE') === 'FLEET_PREPARATION_REQUIRED', 'P driver visual');
  const trailerVm = presentRailMultimodalOffer(first, {
    ...missingOrigin,
    fleetFeasibility: 'REQUIRES_FLEET_CHANGE',
    reasons: ['NO_ELIGIBLE_TRAILER'],
  });
  assert(trailerVm?.extraReadinessText === 'Uygun dorse gerekli', 'P trailer copy');
  const driverVm = presentRailMultimodalOffer(first, {
    ...missingOrigin,
    fleetFeasibility: 'DRIVER_UNAVAILABLE',
    reasons: ['NO_ELIGIBLE_DRIVER'],
  });
  assert(driverVm?.extraReadinessText === 'Uygun sürücü gerekli', 'P driver copy');
} else {
  assert(false, 'preview seed produced at least one offer');
}

const oneVm = presentRailMultimodalOffers(generated.offers.slice(0, 1));
assert(oneVm.length === (generated.offers[0] ? 1 : 0), 'AK 1 offer render');

const eightSource = generateRailMultimodalOffers({
  generationSeed: MULTIMODAL_UI_PREVIEW_SEED,
  accessArtifact: access,
  playerLevel: 99,
  maxOffers: 8,
});
const eightVm = presentRailMultimodalOffers(eightSource.offers);
assert(eightVm.length === eightSource.offers.filter((o) => presentRailMultimodalOffer(o)).length, 'AL 8 stable present');
assert(new Set(eightVm.map((row) => row.offerId)).size === eightVm.length, 'AL unique keys');
const eightVm2 = presentRailMultimodalOffers(
  generateRailMultimodalOffers({
    generationSeed: MULTIMODAL_UI_PREVIEW_SEED,
    accessArtifact: access,
    playerLevel: 99,
    maxOffers: 8,
  }).offers,
);
assert(eightVm.map((row) => row.offerId).join('|') === eightVm2.map((row) => row.offerId).join('|'), 'AV same seed same order');

const previewSession = loadPreviewRailOffers({
  previewEnabled: true,
  generationSeed: MULTIMODAL_UI_PREVIEW_SEED,
  playerLevel: 1,
});
const previewSession2 = loadPreviewRailOffers({
  previewEnabled: true,
  generationSeed: MULTIMODAL_UI_PREVIEW_SEED,
  playerLevel: 1,
});
assert(
  previewSession.viewModels.map((row) => row.offerId).join('|') ===
    previewSession2.viewModels.map((row) => row.offerId).join('|'),
  'AV loader determinism',
);
assert(previewSession.status === 'ready' || previewSession.status === 'empty', '16 separate session');

if (first) {
  const unknown = presentRailMultimodalOffer({ ...first, offerSchemaVersion: 99 } as unknown as RailMultimodalOffer);
  assert(unknown === null, 'AM unknown schema fail closed');
  const nanMoney = presentRailMultimodalOffer({ ...first, playerPayment: Number.NaN });
  assert(nanMoney === null, 'AN NaN money not actionable');
  const infMoney = presentRailMultimodalOffer({ ...first, playerPayment: Number.POSITIVE_INFINITY });
  assert(infMoney === null, 'AN invalid money fail closed');
}

assert(formatMultimodalDurationGameSeconds(16364) !== '16364', '22 not raw integer dump');
assert(formatMultimodalDurationGameSeconds(Number.NaN) === null, '22 invalid duration');

assert(!loadSrc.includes('Date.now'), '39 no Date.now in loader');
assert(loadSrc.includes('MULTIMODAL_UI_PREVIEW_SEED'), '39 deterministic seed');
assert(contractsScreen.includes('selectedRailOfferId'), '42 ephemeral selected id');
assert(!contractsScreen.includes('setPlayerMoney'), 'X no money write in screen');
assert(!detailSrc.includes('player.money'), 'X detail no money');
assert(!cardSrc.includes('financeLedger'), 'Y no ledger on card');

assert(MAX_RAIL_MULTIMODAL_OFFERS === 8, '54 max 8 constant');
assert(contractsScreen.includes('Şu anda uygun demiryolu taşıma teklifi bulunmuyor'), 'AJ empty copy');
assert(contractsScreen.includes('Demiryolu teklifleri şu anda gösterilemiyor'), '30 error copy');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.exit(1);
}
