import React from 'react';
import { LegacyMetrics } from '../../types/metrics';
import { MetricTile } from '../ui/MetricTile';

export interface LeftStatsPanelProps {
  legacyMetrics?: LegacyMetrics;
}

/**
 * Left stats panel for the expanded desktop row. It displays core orderflow
 * metrics: the last traded price (VWAP proxy), the weighted order book
 * imbalance (OBI), deep book imbalance and the divergence between them. The
 * values are colour coded based on their sign to aid quick interpretation.
 */
const LeftStatsPanel: React.FC<LeftStatsPanelProps> = ({ legacyMetrics }) => {
  if (!legacyMetrics) {
    return <div className="text-zinc-500 text-sm">No legacy data</div>;
  }
  const posNegClass = (n: number) => (n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-zinc-300');
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <MetricTile title="OBI W" value={legacyMetrics.obiWeighted.toFixed(2)} valueClassName={posNegClass(legacyMetrics.obiWeighted)} />
      <MetricTile title="OBI D" value={legacyMetrics.obiDeep.toFixed(2)} valueClassName={posNegClass(legacyMetrics.obiDeep)} />
      <MetricTile title="OBI Div" value={legacyMetrics.obiDivergence.toFixed(2)} valueClassName={posNegClass(legacyMetrics.obiDivergence)} />
      <MetricTile title="VWAP" value={legacyMetrics.vwap.toFixed(2)} valueClassName="text-zinc-300" />
    </div>
  );
};

export default LeftStatsPanel;