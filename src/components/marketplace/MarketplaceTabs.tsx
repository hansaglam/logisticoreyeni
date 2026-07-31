import React from 'react';

import type { MarketplaceTab } from '../../domain/vehicleMarketplacePresentation';
import { SegmentedControl } from '../ui';

export default function MarketplaceTabs({
  activeTab,
  onChange,
  counts,
}: {
  activeTab: MarketplaceTab;
  onChange: (tab: MarketplaceTab) => void;
  counts: Partial<Record<MarketplaceTab, number>>;
}) {
  return (
    <SegmentedControl
      activeKey={activeTab}
      onChange={onChange}
      options={[
        { key: 'available', label: 'Satılık Araçlar', count: counts.available },
        { key: 'mine', label: 'İlanlarım', count: counts.mine },
        { key: 'history', label: 'Geçmiş', count: counts.history },
      ]}
    />
  );
}
