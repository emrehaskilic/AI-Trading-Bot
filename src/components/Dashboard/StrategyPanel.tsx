import React, { memo, useMemo } from 'react';
import { useStrategy, SignalDirection, SignalStrength, StrategySignal } from '../../hooks/useStrategy';
import { formatNumber } from '../../utils/prometheusParser';

interface DirectionBadgeProps {
  direction: SignalDirection;
  size?: 'sm' | 'md' | 'lg';
}

const DirectionBadge = memo<DirectionBadgeProps>(({ direction, size = 'md' }) => {
  const config = useMemo(() => {
    switch (direction) {
      case 'buy':
        return {
          bgClass: 'bg-green-900/40',
          textClass: 'text-green-400',
          borderClass: 'border-green-800',
          icon: '↑',
          label: 'BUY',
        };
      case 'sell':
        return {
          bgClass: 'bg-red-900/40',
          textClass: 'text-red-400',
          borderClass: 'border-red-800',
          icon: '↓',
          label: 'SELL',
        };
      default:
        return {
          bgClass: 'bg-zinc-800',
          textClass: 'text-zinc-400',
          borderClass: 'border-zinc-700',
          icon: '−',
          label: 'NEUTRAL',
        };
    }
  }, [direction]);

  const sizeClasses = useMemo(() => {
    switch (size) {
      case 'sm':
        return 'px-2 py-0.5 text-xs';
      case 'lg':
        return 'px-4 py-2 text-lg font-bold';
      default:
        return 'px-3 py-1 text-sm';
    }
  }, [size]);

  return (
    <span className={`inline-flex items-center space-x-1 rounded border ${config.borderClass} ${config.bgClass} ${config.textClass} ${sizeClasses}`}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
});

DirectionBadge.displayName = 'DirectionBadge';

interface StrengthIndicatorProps {
  strength: SignalStrength;
}

const StrengthIndicator = memo<StrengthIndicatorProps>(({ strength }) => {
  const config = useMemo(() => {
    switch (strength) {
      case 'strong':
        return { bars: 3, colorClass: 'bg-green-500', label: 'Strong' };
      case 'moderate':
        return { bars: 2, colorClass: 'bg-yellow-500', label: 'Moderate' };
      case 'weak':
        return { bars: 1, colorClass: 'bg-orange-500', label: 'Weak' };
      default:
        return { bars: 0, colorClass: 'bg-zinc-600', label: 'Unknown' };
    }
  }, [strength]);

  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-3 rounded-sm ${i <= config.bars ? config.colorClass : 'bg-zinc-700'}`}
        />
      ))}
      <span className="text-xs text-zinc-400 ml-1">{config.label}</span>
    </div>
  );
});

StrengthIndicator.displayName = 'StrengthIndicator';

interface ConfidenceBarProps {
  confidence: number;
  showValue?: boolean;
}

const ConfidenceBar = memo<ConfidenceBarProps>(({ confidence, showValue = true }) => {
  const percentage = useMemo(() => Math.round(confidence * 100), [confidence]);
  
  const colorClass = useMemo(() => {
    if (confidence >= 0.8) return 'bg-green-500';
    if (confidence >= 0.6) return 'bg-yellow-500';
    if (confidence >= 0.4) return 'bg-orange-500';
    return 'bg-red-500';
  }, [confidence]);

  return (
    <div className="flex items-center space-x-2">
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showValue && (
        <span className="text-xs text-zinc-400 w-10 text-right">{percentage}%</span>
      )}
    </div>
  );
});

ConfidenceBar.displayName = 'ConfidenceBar';

interface SignalCardProps {
  signal: StrategySignal;
}

const SignalCard = memo<SignalCardProps>(({ signal }) => {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(signal.timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }, [signal.timestamp]);

  return (
    <div className="bg-zinc-800/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <DirectionBadge direction={signal.direction} size="sm" />
          <span className="text-xs text-zinc-500">{signal.strategy}</span>
        </div>
        <span className="text-xs text-zinc-600">{timeAgo}</span>
      </div>
      <div className="flex items-center justify-between">
        <StrengthIndicator strength={signal.strength} />
        <div className="flex items-center space-x-2">
          <span className="text-xs text-zinc-500">{signal.symbol}</span>
          <span className="text-sm font-medium text-zinc-300">
            ${formatNumber(signal.price, 2)}
          </span>
        </div>
      </div>
      <ConfidenceBar confidence={signal.confidence} />
    </div>
  );
});

SignalCard.displayName = 'SignalCard';

export interface StrategyPanelProps {
  className?: string;
  maxSignals?: number;
}

/**
 * Strategy Panel - Displays consensus decision and strategy signals
 * Optimized with React.memo and useMemo for performance
 */
export const StrategyPanel = memo<StrategyPanelProps>(({ className = '', maxSignals = 5 }) => {
  const { data, isLoading, error, lastUpdated, getSignalsByDirection } = useStrategy();

  const consensus = data?.consensus;
  const signals = data?.signals ?? [];

  const buySignals = useMemo(() => getSignalsByDirection('buy'), [getSignalsByDirection]);
  const sellSignals = useMemo(() => getSignalsByDirection('sell'), [getSignalsByDirection]);
  const neutralSignals = useMemo(() => getSignalsByDirection('neutral'), [getSignalsByDirection]);

  const recentSignals = useMemo(() => {
    return [...signals]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, maxSignals);
  }, [signals, maxSignals]);
  const strategyConfidenceEntries = useMemo(() => {
    return Object.entries(data?.strategyConfidence || {})
      .sort((a, b) => b[1].confidence - a[1].confidence);
  }, [data?.strategyConfidence]);

  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdated) return 'Never';
    return lastUpdated.toLocaleTimeString();
  }, [lastUpdated]);

  const agreementColor = useMemo(() => {
    const ratio = consensus?.agreementRatio ?? 0;
    if (ratio >= 0.8) return 'text-green-400';
    if (ratio >= 0.6) return 'text-yellow-400';
    if (ratio >= 0.4) return 'text-orange-400';
    return 'text-red-400';
  }, [consensus?.agreementRatio]);

  if (isLoading && !data && !error) {
    return (
      <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-48 text-sm text-zinc-500">
          Initial strategy snapshot loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Strategy</span>
        </h3>
        {error && (
          <span className="px-2 py-1 text-xs bg-red-900/40 text-red-400 rounded">
            Error
          </span>
        )}
      </div>

      {/* Consensus Decision */}
      {consensus && (
        <div className="mb-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-zinc-400">Consensus Decision</span>
            {consensus.executionRecommended && (
              <span className="px-2 py-0.5 text-xs bg-green-900/40 text-green-400 rounded">
                Execute
              </span>
            )}
          </div>
          
          <div className="flex items-center justify-center py-3">
            <DirectionBadge direction={consensus.direction} size="lg" />
          </div>
          
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>Confidence</span>
                <span>{(consensus.confidence * 100).toFixed(1)}%</span>
              </div>
              <ConfidenceBar confidence={consensus.confidence} showValue={false} />
            </div>
            
            <div className="flex justify-between items-center text-sm">
              <span className="text-zinc-400">Agreement Ratio</span>
              <span className={`font-medium ${agreementColor}`}>
                {(consensus.agreementRatio * 100).toFixed(1)}%
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-zinc-900/50 rounded p-2">
                <span className="text-zinc-500">Participating</span>
                <div className="text-zinc-300 mt-1">
                  {consensus.participatingStrategies.length} strategies
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded p-2">
                <span className="text-zinc-500">Conflicting</span>
                <div className="text-zinc-300 mt-1">
                  {consensus.conflictingStrategies.length} strategies
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Confidence Breakdown */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Strategy Confidence
        </h4>
        <div className="space-y-2">
          {strategyConfidenceEntries.length > 0 ? strategyConfidenceEntries.map(([strategyId, confidence]) => (
            <div key={strategyId} className="bg-zinc-800/40 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-300">{strategyId}</span>
                <span className="text-xs text-zinc-500">
                  {(confidence.confidence * 100).toFixed(1)}%
                </span>
              </div>
              <ConfidenceBar confidence={confidence.confidence} showValue={false} />
            </div>
          )) : (
            <div className="text-center text-zinc-600 py-3 text-xs">
              No strategy confidence data yet
            </div>
          )}
        </div>
      </div>

      {/* Signal Summary */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Signal Summary</h4>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-2 text-center">
            <div className="text-2xl font-bold text-green-400">{buySignals.length}</div>
            <div className="text-xs text-green-600">Buy</div>
          </div>
          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-2 text-center">
            <div className="text-2xl font-bold text-red-400">{sellSignals.length}</div>
            <div className="text-xs text-red-600">Sell</div>
          </div>
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-center">
            <div className="text-2xl font-bold text-zinc-400">{neutralSignals.length}</div>
            <div className="text-xs text-zinc-600">Neutral</div>
          </div>
        </div>
      </div>

      {/* Recent Signals */}
      <div>
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Recent Signals ({recentSignals.length})
        </h4>
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {recentSignals.length > 0 ? (
            recentSignals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))
          ) : (
            <div className="text-center text-zinc-600 py-4">
              No signals available
            </div>
          )}
        </div>
      </div>

      {/* Active Strategies */}
      {data?.activeStrategies && data.activeStrategies.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <h4 className="text-sm font-medium text-zinc-400 mb-2">
            Active Strategies ({data.activeStrategies.length})
          </h4>
          <div className="flex flex-wrap gap-1">
            {data.activeStrategies.map((strategy) => (
              <span
                key={strategy}
                className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded"
              >
                {strategy}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-zinc-800">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Last updated</span>
          <span>{formattedLastUpdate}</span>
        </div>
      </div>
    </div>
  );
});

StrategyPanel.displayName = 'StrategyPanel';

export default StrategyPanel;
