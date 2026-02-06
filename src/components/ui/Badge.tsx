import React from 'react';

/**
 * A small pill component used to display the current connection state. Colours
 * follow the dark orderflow aesthetic and convey semantic meaning: green
 * denotes live data, red indicates stale data and yellow signals resync.
 */
export interface BadgeProps {
  state: string;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ state, className = '' }) => {
  const colourMap: Record<string, string> = {
    LIVE: 'bg-green-900/40 text-green-400',
    STALE: 'bg-red-900/40 text-red-400',
    RESYNCING: 'bg-yellow-900/40 text-yellow-400'
  };
  const classes = colourMap[state] || 'bg-zinc-800 text-zinc-400';
  return (
    <span className={`px-2 py-0.5 text-xs font-mono rounded ${classes} ${className}`}>{state}</span>
  );
};