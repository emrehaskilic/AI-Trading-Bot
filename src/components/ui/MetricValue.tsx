import React from 'react';

/**
 * Display a numeric metric with automatic colouring based on its sign.
 * Formatting uses Intl.NumberFormat for locale‑aware output.
 */
interface MetricValueProps {
  value: number;
  format?: 'number' | 'currency' | 'percentage';
  reverseColor?: boolean;
  currency?: string;
  locale?: string;
}

const MetricValue: React.FC<MetricValueProps> = ({
  value,
  format = 'number',
  reverseColor = false,
  currency = 'USD',
  locale,
}) => {
  let color = 'text-zinc-300';
  if (value > 0.0001) color = reverseColor ? 'text-red-500' : 'text-green-500';
  if (value < -0.0001) color = reverseColor ? 'text-green-500' : 'text-red-500';

  const resolvedLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  let formatted = '';
  if (format === 'currency') {
    formatted = new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } else if (format === 'percentage') {
    formatted = new Intl.NumberFormat(resolvedLocale, {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100);
  } else {
    formatted = new Intl.NumberFormat(resolvedLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  return <span className={`font-mono font-medium ${color}`} aria-live="polite">{formatted}</span>;
};

export default MetricValue;
