// Minimal assertion helper
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { AbsorptionDetector } from '../metrics/AbsorptionDetector';

/**
 * Unit tests for the AbsorptionDetector.
 *
 * These tests verify that absorption is only detected when all four
 * conditions are satisfied and that each missing condition prevents
 * detection (false positives).  Each scenario feeds a sequence of
 * trades along with synthetic orderbook sizes to the detector.
 */
export function runTests() {
  // Scenario: missing repeated fills (condition 1)
  {
    const det = new AbsorptionDetector({ windowMs: 5000, minRepeats: 3 });
    let res = 0;
    // Three trades at different prices -> should not detect
    res = det.addTrade('XYZ', 100, 'buy', Date.now(), 10);
    assert(res === 0, 'no repeat 1');
    res = det.addTrade('XYZ', 101, 'buy', Date.now(), 10);
    assert(res === 0, 'no repeat 2');
    res = det.addTrade('XYZ', 102, 'buy', Date.now(), 10);
    assert(res === 0, 'no repeat 3');
  }
  // Scenario: no aggressive direction consistency (condition 2)
  {
    const det = new AbsorptionDetector({ windowMs: 5000, minRepeats: 3 });
    let res = 0;
    // Alternate buy/sell at same price
    res = det.addTrade('XYZ', 100, 'buy', Date.now(), 10);
    assert(res === 0, 'alt dir 1');
    res = det.addTrade('XYZ', 100, 'sell', Date.now(), 10);
    assert(res === 0, 'alt dir 2');
    res = det.addTrade('XYZ', 100, 'buy', Date.now(), 10);
    assert(res === 0, 'alt dir 3');
  }
  // Scenario: price moves beyond threshold (condition 3)
  {
    const det = new AbsorptionDetector({ windowMs: 5000, minRepeats: 3, priceThreshold: 0.001 });
    let res = 0;
    const base = Date.now();
    res = det.addTrade('XYZ', 100, 'buy', base, 10);
    res = det.addTrade('XYZ', 100.2, 'buy', base + 10, 12); // 0.2% price change > 0.1% threshold
    res = det.addTrade('XYZ', 100.2, 'buy', base + 20, 14);
    assert(res === 0, 'price moved beyond threshold');
  }
  // Scenario: orderbook size not refreshing (condition 4)
  {
    const det = new AbsorptionDetector({ windowMs: 5000, minRepeats: 3 });
    let res = 0;
    const ts = Date.now();
    res = det.addTrade('XYZ', 100, 'buy', ts, 10);
    res = det.addTrade('XYZ', 100, 'buy', ts + 10, 9); // size decreases -> no refresh
    res = det.addTrade('XYZ', 100, 'buy', ts + 20, 8);
    assert(res === 0, 'size not refreshing should not detect');
  }
  // Scenario: all conditions met
  {
    const det = new AbsorptionDetector({ windowMs: 5000, minRepeats: 3 });
    let res = 0;
    const ts = Date.now();
    res = det.addTrade('XYZ', 200, 'sell', ts, 20);
    res = det.addTrade('XYZ', 200, 'sell', ts + 10, 25); // size increases (refresh)
    res = det.addTrade('XYZ', 200, 'sell', ts + 20, 30);
    assert(res === 1, 'should detect absorption when all conditions met');
  }
}