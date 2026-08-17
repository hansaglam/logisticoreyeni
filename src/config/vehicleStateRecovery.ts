/**
 * Stuck araç kurtarma — maliyet ve eşikler.
 * Sistem kaynaklı tutarsızlık her zaman ücretsizdir.
 * Oyuncu kaynaklı (ileride) ilk kurtarma ücretsiz, sonrakiler küçük bedel.
 */
export const vehicleStateRecoveryConfig = {
  subsequentCashCost: 350,
  subsequentReputationCost: 2,
  stalledProgressMax: 0.999,
  fuelEmptyEpsilonL: 1e-6,
} as const;
