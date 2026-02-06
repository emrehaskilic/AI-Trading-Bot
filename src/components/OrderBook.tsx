import React from 'react';

/**
 * Order book ladder component.  Displays the top levels of bids and
 * asks along with a depth bar that scales relative to the largest
 * cumulative size on either side.  Prices and sizes are colour coded.
 * The ``bids`` and ``asks`` props are arrays of `[price, size, total]`
 * where ``total`` is the cumulative size up to that level.  The
 * ``currentPrice`` is displayed between the ask and bid ladders.
 */
export interface OrderBookProps {
  bids?: [number, number, number][];
  asks?: [number, number, number][];
  currentPrice: number;
}

const OrderBook: React.FC<OrderBookProps> = ({ bids = [], asks = [], currentPrice }) => {
  // Only display the first 8 levels on each side
  const depth = 8;
  const displayBids = bids.slice(0, depth);
  // For asks, the server returns asks sorted ascending (best ask first).  We
  // reverse for display so that the best ask appears closest to the price
  // line and deeper asks appear above.
  const displayAsks = asks.slice(0, depth).reverse();
  // Determine maximum total for scaling bars.  Use the last bid's total (largest)
  // and the first ask's total (largest after reversing) scaled by 1.5 for asks.
  const maxTotal = Math.max(
    displayBids.length > 0 ? displayBids[displayBids.length - 1][2] : 0,
    displayAsks.length > 0 ? displayAsks[0][2] * 1.5 : 0,
  ) || 1;
  return (
    <div className="w-full text-xs font-mono bg-zinc-950 p-2 rounded border border-zinc-800">
      <div className="flex justify-between text-zinc-500 mb-1 px-1">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      {/* Asks (sellers) */}
      <div className="flex flex-col-reverse">
        {displayAsks.map(([price, size, total], idx) => (
          <div key={`ask-${idx}`} className="relative flex justify-between px-1 py-0.5 hover:bg-zinc-800">
            {/* Depth bar for asks (red) */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-red-500/10 z-0"
              style={{ width: `${(total / maxTotal) * 100}%` }}
            />
            <span className="text-red-400 z-10">{price.toFixed(2)}</span>
            <span className="text-zinc-300 z-10">{size.toFixed(3)}</span>
            <span className="text-zinc-500 z-10">{total.toFixed(1)}</span>
          </div>
        ))}
      </div>
      {/* Mid price */}
      <div className="text-center py-2 text-lg font-bold text-white border-y border-zinc-800 my-1">
        {currentPrice > 0 ? currentPrice.toFixed(2) : 'N/A'}
      </div>
      {/* Bids (buyers) */}
      <div>
        {displayBids.map(([price, size, total], idx) => (
          <div key={`bid-${idx}`} className="relative flex justify-between px-1 py-0.5 hover:bg-zinc-800">
            {/* Depth bar for bids (green) */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-green-500/10 z-0"
              style={{ width: `${(total / maxTotal) * 100}%` }}
            />
            <span className="text-green-400 z-10">{price.toFixed(2)}</span>
            <span className="text-zinc-300 z-10">{size.toFixed(3)}</span>
            <span className="text-zinc-500 z-10">{total.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderBook;