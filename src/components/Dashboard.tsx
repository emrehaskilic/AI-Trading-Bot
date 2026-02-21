import React, { useEffect, useMemo, useState } from 'react';
import LiveTelemetryDashboard from './LiveTelemetryDashboard';
import DryRunDashboard from './DryRunDashboard';
import AIDryRunDashboard from './AIDryRunDashboard';
import { isViewerModeEnabled } from '../services/proxyAuth';

type AppTab = 'telemetry' | 'dry-run' | 'ai-dry-run';

function tabFromHash(hash: string): AppTab {
  if (hash === '#dry-run') return 'dry-run';
  if (hash === '#ai-dry-run') return 'ai-dry-run';
  return 'telemetry';
}

const Dashboard: React.FC = () => {
  const readonlyViewer = useMemo(() => isViewerModeEnabled(), []);
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const initial = tabFromHash(window.location.hash);
    return readonlyViewer ? 'telemetry' : initial;
  });

  useEffect(() => {
    const onHashChange = () => {
      const next = tabFromHash(window.location.hash);
      setActiveTab(readonlyViewer ? 'telemetry' : next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [readonlyViewer]);

  const tabs = useMemo<Array<{ id: AppTab; label: string }>>(() => (
    readonlyViewer
      ? [{ id: 'telemetry', label: 'Live Telemetry' }]
      : [
          { id: 'telemetry', label: 'Live Telemetry' },
          { id: 'dry-run', label: 'Dry Run' },
          { id: 'ai-dry-run', label: 'AI Dry Run' },
        ]
  ), [readonlyViewer]);

  const setTab = (tab: AppTab) => {
    if (readonlyViewer && tab !== 'telemetry') {
      return;
    }
    setActiveTab(tab);
    const hash = tab === 'dry-run'
      ? '#dry-run'
      : tab === 'ai-dry-run'
        ? '#ai-dry-run'
        : '#telemetry';
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200">
      <div className="sticky top-0 z-20 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-xs tracking-[0.2em] uppercase text-zinc-500">Orderflow Control Surface</div>
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1 gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  activeTab === tab.id
                    ? 'bg-zinc-200 text-zinc-900 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {readonlyViewer && (
          <div className="max-w-7xl mx-auto px-6 pb-3 text-[11px] uppercase tracking-wide text-amber-300">
            Read-only external viewer mode aktif
          </div>
        )}
      </div>

      <div className={activeTab === 'telemetry' ? 'block' : 'hidden'}>
        <LiveTelemetryDashboard />
      </div>

      {!readonlyViewer && (
        <>
          <div className={activeTab === 'dry-run' ? 'block' : 'hidden'}>
            <DryRunDashboard />
          </div>
          <div className={activeTab === 'ai-dry-run' ? 'block' : 'hidden'}>
            <AIDryRunDashboard />
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
