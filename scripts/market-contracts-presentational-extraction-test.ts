import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

console.log('\n=== Market / Contracts Presentational Extraction ===\n');

const contractsScreen = read('src/screens/ContractsScreen.tsx');
const contractsOverview = read('src/features/contracts/components/ContractsOverview.tsx');
const marketScreen = read('src/screens/MarketScreen.tsx');
const marketOverview = read('src/features/market/components/MarketOverview.tsx');
const marketOpportunities = read('src/features/market/components/MarketOpportunityCards.tsx');
const presentationSources = `${contractsOverview}\n${marketOverview}\n${marketOpportunities}`;

assert(contractsScreen.includes("from '../features/contracts/components/ContractsOverview'"), 'Contracts container composes feature presentation');
assert(marketScreen.includes("from '../features/market/components/MarketOverview'"), 'Market container composes overview presentation');
assert(marketScreen.includes("from '../features/market/components/MarketOpportunityCards'"), 'Market container composes opportunity cards');

assert(!presentationSources.includes('useGameStore'), 'presentational components do not subscribe to Zustand');
assert(!presentationSources.includes('useEffect('), 'presentational components own no lifecycle effects');
assert(!presentationSources.includes('setInterval('), 'presentational components own no timers');
assert(!presentationSources.includes('setTimeout('), 'presentational components own no delayed work');
assert(!presentationSources.includes('startDelivery('), 'contract actions remain container-owned');
assert(!presentationSources.includes('buyProductForWarehouse('), 'market buy action remains container-owned');
assert(!presentationSources.includes('sellProductFromWarehouse('), 'market sell action remains container-owned');

assert(contractsScreen.includes('const handleConfirmAssignment'), 'contract acceptance callback remains in container');
assert(contractsScreen.includes('ContractAssignmentModal'), 'assignment modal remains screen-owned');
assert(marketScreen.includes('const handleBuyProductPress'), 'buy callback remains in Market container');
assert(marketScreen.includes('const handleSellProductPress'), 'sell callback remains in Market container');
assert(marketScreen.includes('TradeProductModal'), 'trade modal remains screen-owned');
assert(marketScreen.includes('marketGameDayAnchor'), 'market time bucket remains container-owned');
assert(contractsScreen.includes('selectCurrentTimeQuarterHour'), 'contract time bucket remains container-owned');

console.log('\nmarket-contracts-presentational-extraction-test: PASSED\n');
