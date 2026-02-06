import React from 'react';

/** A segment of the score bar. */
export interface BarSegment {
  /** Percentage width between 0 and 100. */
  width: number;
  /** Tailwind colour class (e.g. bg-green-500). */
  colour: string;
}

export interface ScoreBarProps {
  /** Segments to render across the full width. */
  segments: BarSegment[];
  /** Optional height of the bar in pixels. Default is 4. */
  height?: number;
  className?: string;
}

/**
 * A horizontal bar composed of coloured segments. Used for trade size
 * distribution, buy/sell volumes and pressure indicators. The caller
 * controls segment widths and colours; widths should sum to 100.
 */
export const ScoreBar: React.FC<ScoreBarProps> = ({ segments, height = 4, className = '' }) => {
  return (
    <div className={`flex w-full overflow-hidden rounded bg-zinc-800 ${className}`} style={{ height }}>
      {segments.map((seg, idx) => (
        <div key={idx} style={{ width: `${seg.width}%` }} className={`${seg.colour}`}></div>
      ))}
    </div>
  );
};