# Production multimodal prototypes (Step 21)

These TypeScript types exist only to freeze a **proposed** persistence/flag shape.

They MUST NOT be imported by:

- `src/store/gameStore.ts`
- `src/storage/saveGame.ts`
- `src/simulation/contracts.ts`
- `src/simulation/delivery.ts`
- `src/types/game.ts`
- backend / Firestore functions
- production screens

Default product behavior remains ROAD-only Contract / Delivery.
