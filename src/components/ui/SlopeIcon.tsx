import React from 'react';

/**
 * Render a small icon representing the sign of a slope.  Positive
 * slopes are represented by an upward arrow in green, negative slopes
 * by a downward arrow in red, and near‑zero slopes by a tilde.
 */
const SlopeIcon: React.FC<{ value: number }> = ({ value }) => {
  if (Math.abs(value) < 0.1) return <span className="text-zinc-600">~</span>;
  return value > 0 ? (
    <svg className="w-4 h-4 text-green-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-red-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
    </svg>
  );
};

export default SlopeIcon;