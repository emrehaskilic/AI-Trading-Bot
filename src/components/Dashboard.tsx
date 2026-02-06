import React, { useEffect, useState } from 'react';
import { useTelemetrySocket } from '../services/useTelemetrySocket';
import { MetricsState, MetricsMessage } from '../types/metrics';
import SymbolRow from './SymbolRow';
import MobileSymbolCard from './MobileSymbolCard';

/**
 * Dashboard component implementing the original Orderflow Matrix UI.  It
 * manages the list of active trading pairs, fetches available pairs
 * from Binance for selection and renders either a desktop table or
 * mobile cards.  Orderflow metrics are obtained via the telemetry
 * WebSocket using the useTelemetrySocket hook.  No metrics are
 * computed on the client; the UI merely renders values provided by
 * the server.
 */
export const Dashboard: React.FC = () => {
  // Default pairs to display when the page loads
  const [selectedPairs, setSelectedPairs] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  // All available USDT perpetual pairs from Binance
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [isLoadingPairs, setIsLoadingPairs] = useState(true);
  // Whether to show latency debug values in the UI
  const [showLatency, setShowLatency] = useState(false);

  // Connect to telemetry WebSocket for selected pairs
  const marketData: MetricsState = useTelemetrySocket(selectedPairs);

  // Fetch list of USDT perpetual symbols from Binance once on mount.
  useEffect(() => {
    const fetchPairs = async () => {
      try {
        const proxyUrl = (import.meta as any).env?.VITE_PROXY_API || 'http://localhost:8787';
        const res = await fetch(`${proxyUrl}/api/exchange-info`);
        const data = await res.json();
        // Proxy already returns { symbols: string[] }
        setAvailablePairs(data.symbols);
        setIsLoadingPairs(false);
      } catch (err) {
        console.error('Failed to fetch pairs', err);
        // Fallback list
        setAvailablePairs(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'BNBUSDT']);
        setIsLoadingPairs(false);
      }
    };
    fetchPairs();
  }, []);

  const togglePair = (pair: string) => {
    if (selectedPairs.includes(pair)) {
      setSelectedPairs(selectedPairs.filter(p => p !== pair));
    } else {
      setSelectedPairs([...selectedPairs, pair]);
    }
  };

  const filteredPairs = availablePairs.filter(p => p.includes(searchTerm.toUpperCase()));

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Orderflow Matrix</h1>
            <p className="text-zinc-500 text-sm mt-1">Real‑time Orderflow Telemetry</p>
          </div>
          {/* Pair Selector */}
          <div className="relative z-50">
            <button
              onClick={() => setDropdownOpen(!isDropdownOpen)}
              className="flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white px-4 py-2 rounded-lg transition-all text-sm font-medium"
            >
              <span>{isLoadingPairs ? 'Loading Pairs...' : 'Select Pairs'}</span>
              <span className="bg-zinc-700 text-xs px-1.5 py-0.5 rounded-full">{selectedPairs.length}</span>
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isDropdownOpen && !isLoadingPairs && (
              <div className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden flex flex-col z-[100]">
                <div className="p-2 border-b border-zinc-800">
                  <input
                    type="text"
                    placeholder="Search..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-2 space-y-1">
                  {filteredPairs.map(pair => (
                    <div
                      key={pair}
                      onClick={() => togglePair(pair)}
                      className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm ${selectedPairs.includes(pair) ? 'bg-blue-900/30 text-blue-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
                    >
                      <span>{pair}</span>
                      {selectedPairs.includes(pair) && (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      )}
                    </div>
                  ))}
                  {filteredPairs.length === 0 && (
                    <div className="p-2 text-center text-xs text-zinc-500">No pairs found</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Latency toggle */}
          <label className="flex items-center space-x-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={showLatency}
              onChange={(e) => setShowLatency(e.target.checked)}
              className="accent-blue-600"
            />
            <span>Show Latency</span>
          </label>
        </div>
        {/* Mobile View (Cards) */}
        <div className="md:hidden space-y-3 mb-8">
          {selectedPairs.map(symbol => {
            const msg: MetricsMessage | undefined = marketData[symbol];
            if (!msg) return null;
            return <MobileSymbolCard key={symbol} symbol={symbol} data={msg} showLatency={showLatency} />;
          })}
          {selectedPairs.length === 0 && (
            <div className="p-8 text-center text-zinc-600 bg-zinc-900/50 rounded-lg border border-zinc-800 border-dashed">
              Select a trading pair to begin.
            </div>
          )}
        </div>
        {/* Desktop View (Table) */}
        <div className="hidden md:block border border-zinc-800 rounded-t-xl overflow-hidden bg-zinc-900/80">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-12 gap-4 p-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                <div className="col-span-2">Symbol</div>
                <div className="col-span-2">Price</div>
                <div className="col-span-2">OBI (W)</div>
                <div className="col-span-2">Delta Z</div>
                <div className="col-span-2">CVD Slope</div>
                <div className="col-span-1">Signal</div>
                <div className="col-span-1 text-right">Status</div>
              </div>
              {/* Table Body */}
              <div className="bg-black/20 divide-y divide-zinc-800/50">
                {selectedPairs.map(symbol => {
                  const msg: MetricsMessage | undefined = marketData[symbol];
                  if (!msg) return null;
                  return <SymbolRow key={symbol} symbol={symbol} data={msg} showLatency={showLatency} />;
                })}
                {selectedPairs.length === 0 && (
                  <div className="p-12 text-center text-zinc-600">
                    Select a trading pair to begin monitoring.
                  </div>
                )}
                {Object.keys(marketData).length === 0 && selectedPairs.length > 0 && (
                  <div className="p-12 text-center text-zinc-500 animate-pulse">
                    Connecting to telemetry server...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 text-xs text-zinc-600 text-center">
          Data provided via backend telemetry. All calculations are performed server‑side.
        </div>
      </div>
    </div>
  );
};

export default Dashboard;