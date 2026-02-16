import { useMemo, useState } from 'react';

interface ConfigurationErrorProps {
  message: string;
}

const ConfigurationError = ({ message }: ConfigurationErrorProps) => {
  const [copied, setCopied] = useState(false);
  const envExample = useMemo(() => {
    return [
      'VITE_PROXY_API_KEY="your_proxy_api_key"',
      'VITE_PROXY_API="http://localhost:8787"',
    ].join('\n');
  }, []);

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(envExample);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-red-500/40 bg-zinc-900/90 p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-red-400">Yapilandirma Hatasi</h1>
        <p className="mt-3 text-sm text-zinc-200">{message}</p>
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">.env.local Ornegi</span>
            <button
              type="button"
              onClick={copyExample}
              className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              aria-label=".env.local ornegini panoya kopyala"
            >
              {copied ? 'Kopyalandi' : 'Kopyala'}
            </button>
          </div>
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all">{envExample}</pre>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          Kurulum adimlari icin{' '}
          <a
            href="https://github.com/emrehaskilic/AI-Trading-Bot/blob/main/README_SETUP.md"
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400/50 rounded-sm"
            aria-label="README_SETUP dosyasini yeni sekmede ac"
          >
            README_SETUP.md
          </a>
          {' '}dosyasini takip edin.
        </p>
      </div>
    </div>
  );
};

export default ConfigurationError;
