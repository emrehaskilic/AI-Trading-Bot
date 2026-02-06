import React from 'react';

export interface MetricTileProps {
  /** Title displayed in small uppercase text. */
  title: string;
  /** Main numeric or textual value. */
  value: React.ReactNode;
  /** Optional additional CSS classes for the value element. */
  valueClassName?: string;
  /** Optional wrapper classes. */
  className?: string;
}

/**
 * A simple tile used to present a metric with a heading and value. It uses
 * a dark translucent background and rounded corners. The value can be
 * colour coded via the `valueClassName` prop.
 */
export const MetricTile: React.FC<MetricTileProps> = ({ title, value, valueClassName = '', className = '' }) => {
  return (
    <div className={`bg-zinc-800/50 p-2 rounded ${className}`}> 
      <div className="font-semibold text-zinc-400 text-[10px] uppercase">{title}</div>
      <div className={`text-sm ${valueClassName}`}>{value}</div>
    </div>
  );
};