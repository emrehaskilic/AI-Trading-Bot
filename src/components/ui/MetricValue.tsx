import React from 'react';

/**
 * Display a numeric metric with automatic colouring based on its sign.
 * Positive values are green, negative values are red and values near
 * zero are rendered in neutral colour.  The number of decimal places
 * can be customised via the format prop.
 */
const MetricValue: React.FC<{ value: number; format?: 'number' | 'currency' | 'percent'; reverseColor?: boolean }> = ({ value, format = 'number', reverseColor = false }) => {
  let color = 'text-zinc-300';
  if (value > 0.0001) color = reverseColor ? 'text-red-500' : 'text-green-500';
  if (value < -0.0001) color = reverseColor ? 'text-green-500' : 'text-red-500';
  const formatted = format === 'currency'
    ? `$${value.toFixed(2)}`
    : format === 'percent'
      ? `${(value * 100).toFixed(1)}%`
      : value.toFixed(2);
  return <span className={`font-mono font-medium ${color}`}>{formatted}</span>;
};

export default MetricValue;