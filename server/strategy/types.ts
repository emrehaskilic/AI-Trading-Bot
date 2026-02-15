export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface Trade {
  symbol: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

export interface IStrategy {
  onOrderBookUpdate(orderBook: OrderBook): void;
  onTradeUpdate(trade: Trade): void;
}
