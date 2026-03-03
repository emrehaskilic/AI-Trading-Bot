/**
 * FAZ 1B - Replay Determinism Test Suite
 * 
 * Bu test script aşağıdaki testleri çalıştırır:
 * 1. Replay testi: Aynı historical input 3 kez çalıştır, hash üret
 * 2. Zero volume dataset testi
 * 3. Extreme imbalance testi
 * 4. Uzun süreli rolling window drift testi
 * 5. NaN / Infinity üretim kontrolü
 */

import { LegacyCalculator } from '../metrics/LegacyCalculator';
import { CvdCalculator } from '../metrics/CvdCalculator';
import { WindowStats } from '../metrics/RollingWindow';
import { createOrderbookState, OrderbookState } from '../metrics/OrderbookManager';

function seededUnit(seed: number): number {
    // Deterministic pseudo-random in [0,1)
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
}

// Test utilities
function createHash(obj: any): string {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

function generateMockOrderbook(seedBase: number = 1337): OrderbookState {
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    
    // Generate realistic orderbook
    const basePrice = 50000;
    for (let i = 0; i < 50; i++) {
        const bidQty = 1 + seededUnit(seedBase + i) * 10;
        const askQty = 1 + seededUnit(seedBase + 10_000 + i) * 10;
        bids.set(basePrice - i * 10, bidQty);
        asks.set(basePrice + i * 10, askQty);
    }
    
    const ob = createOrderbookState();
    ob.bids = bids;
    ob.asks = asks;
    ob.lastUpdateId = 1;
    ob.lastDepthTime = 1_000_000;
    ob.uiState = 'LIVE';
    ob.snapshotRequired = false;
    return ob;
}

function generateMockTrades(count: number, seedBase: number = 4242) {
    const trades = [];
    const baseTime = 1000000;
    
    for (let i = 0; i < count; i++) {
        const r1 = seededUnit(seedBase + i * 3 + 1);
        const r2 = seededUnit(seedBase + i * 3 + 2);
        const r3 = seededUnit(seedBase + i * 3 + 3);
        trades.push({
            price: 50000 + (r1 * 1000) - 500,
            quantity: (r2 * 5) + 0.1,
            side: r3 > 0.5 ? 'buy' as const : 'sell' as const,
            timestamp: baseTime + i * 100
        });
    }
    
    return trades;
}

// Test 1: Replay Determinism Test
function testReplayDeterminism(): { passed: boolean; hash: string; details: string } {
    console.log('\n=== TEST 1: Replay Determinism ===');
    
    const results: string[] = [];
    const hashes: string[] = [];
    
    // Run 3 times with same input
    for (let run = 0; run < 3; run++) {
        const calc = new LegacyCalculator('BTCUSDT');
        calc.reset(); // Ensure clean state
        
        // Add same trades
        const trades = generateMockTrades(100, 9001);
        for (const trade of trades) {
            calc.addTrade(trade);
        }
        
        // Compute metrics with deterministic timestamp
        const ob = generateMockOrderbook(7001);
        const metrics = calc.computeMetrics(ob, 1000000);
        
        const hash = createHash(metrics);
        hashes.push(hash);
        results.push(`Run ${run + 1}: hash=${hash}`);
    }
    
    // Verify all hashes match
    const allMatch = hashes.every(h => h === hashes[0]);
    
    console.log(results.join('\n'));
    console.log(`All hashes match: ${allMatch}`);
    
    return {
        passed: allMatch,
        hash: hashes[0],
        details: results.join('; ')
    };
}

// Test 2: Zero Volume Test
function testZeroVolume(): { passed: boolean; details: string } {
    console.log('\n=== TEST 2: Zero Volume Edge Case ===');
    
    const calc = new LegacyCalculator('BTCUSDT');
    calc.reset();
    
    // Don't add any trades - zero volume scenario
    const ob = generateMockOrderbook(7002);
    const metrics = calc.computeMetrics(ob, 1000000);
    
    // Check for NaN/Infinity
    const hasNaN = Object.values(metrics).some(v => typeof v === 'number' && isNaN(v));
    const hasInfinity = Object.values(metrics).some(v => typeof v === 'number' && !isFinite(v) && v !== 0);
    
    const passed = !hasNaN && !hasInfinity;
    
    console.log(`VWAP: ${metrics.vwap}`);
    console.log(`Has NaN: ${hasNaN}`);
    console.log(`Has Infinity: ${hasInfinity}`);
    console.log(`Test passed: ${passed}`);
    
    return {
        passed,
        details: `VWAP=${metrics.vwap}, NaN=${hasNaN}, Infinity=${hasInfinity}`
    };
}

// Test 3: Extreme Imbalance Test
function testExtremeImbalance(): { passed: boolean; details: string } {
    console.log('\n=== TEST 3: Extreme Imbalance ===');
    
    const calc = new LegacyCalculator('BTCUSDT');
    calc.reset();
    
    // Add extreme trades
    for (let i = 0; i < 10; i++) {
        calc.addTrade({
            price: 1e10, // Extreme price
            quantity: 1e10, // Extreme quantity
            side: 'buy',
            timestamp: 1000000 + i * 100
        });
    }
    
    const ob = generateMockOrderbook(7003);
    const metrics = calc.computeMetrics(ob, 1000000);
    
    // Check all values are finite
    const allFinite = Object.values(metrics).every(v => 
        typeof v !== 'number' || (isFinite(v) && !isNaN(v))
    );
    
    console.log(`All values finite: ${allFinite}`);
    console.log(`CVD Session: ${metrics.cvdSession}`);
    console.log(`Test passed: ${allFinite}`);
    
    return {
        passed: allFinite,
        details: `CVD=${metrics.cvdSession}, AllFinite=${allFinite}`
    };
}

// Test 4: Rolling Window Drift Test
function testRollingWindowDrift(): { passed: boolean; details: string } {
    console.log('\n=== TEST 4: Rolling Window Drift ===');
    
    const window = new WindowStats(60000, 1000); // 1 minute window
    window.reset();
    
    const results: number[] = [];
    
    // Add values over time
    for (let i = 0; i < 1000; i++) {
        window.add(i * 100, i);
        
        if (i % 100 === 0) {
            const stats = window.getStats(i * 100);
            results.push(stats.mean);
        }
    }
    
    // Run again with same input
    window.reset();
    const results2: number[] = [];
    
    for (let i = 0; i < 1000; i++) {
        window.add(i * 100, i);
        
        if (i % 100 === 0) {
            const stats = window.getStats(i * 100);
            results2.push(stats.mean);
        }
    }
    
    // Compare results
    const match = results.every((v, i) => Math.abs(v - results2[i]) < 1e-10);
    
    console.log(`Results match: ${match}`);
    console.log(`Sample means: ${results.slice(0, 5).join(', ')}`);
    console.log(`Test passed: ${match}`);
    
    return {
        passed: match,
        details: `Means match: ${match}`
    };
}

// Test 5: NaN/Infinity Sanitization Test
function testNaNInfinitySanitization(): { passed: boolean; details: string } {
    console.log('\n=== TEST 5: NaN/Infinity Sanitization ===');
    
    const calc = new LegacyCalculator('BTCUSDT');
    calc.reset();
    
    // Add trades with problematic values
    const problematicTrades = [
        { price: NaN, quantity: 1, side: 'buy' as const, timestamp: 1000000 },
        { price: 50000, quantity: Infinity, side: 'sell' as const, timestamp: 1000100 },
        { price: -Infinity, quantity: 1, side: 'buy' as const, timestamp: 1000200 },
        { price: 50000, quantity: 1, side: 'buy' as const, timestamp: 1000300 },
    ];
    
    for (const trade of problematicTrades) {
        calc.addTrade(trade as any);
    }
    
    const ob = generateMockOrderbook(7004);
    const metrics = calc.computeMetrics(ob, 1000000);
    
    // Check no NaN/Infinity in output
    const values = Object.values(metrics).filter(v => typeof v === 'number');
    const hasNaN = values.some(v => isNaN(v));
    const hasInfinity = values.some(v => !isFinite(v));
    
    const passed = !hasNaN && !hasInfinity;
    
    console.log(`Has NaN: ${hasNaN}`);
    console.log(`Has Infinity: ${hasInfinity}`);
    console.log(`Test passed: ${passed}`);
    
    return {
        passed,
        details: `NaN=${hasNaN}, Infinity=${hasInfinity}`
    };
}

// Test 6: CVD Calculator Determinism Test
function testCvdCalculatorDeterminism(): { passed: boolean; hash: string; details: string } {
    console.log('\n=== TEST 6: CVD Calculator Determinism ===');
    
    const hashes: string[] = [];
    
    for (let run = 0; run < 3; run++) {
        const calc = new CvdCalculator();
        calc.reset();
        
        const trades = generateMockTrades(50, 9002);
        for (const trade of trades) {
            calc.addTrade(trade as any, 1000000);
        }
        
        const metrics = calc.getMetrics();
        const hash = createHash(metrics);
        hashes.push(hash);
    }
    
    const allMatch = hashes.every(h => h === hashes[0]);
    
    console.log(`Hashes: ${hashes.join(', ')}`);
    console.log(`All match: ${allMatch}`);
    
    return {
        passed: allMatch,
        hash: hashes[0],
        details: `Hashes: ${hashes.join(', ')}`
    };
}

// Main test runner
async function runAllTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     FAZ 1B - REPLAY DETERMINISM TEST SUITE                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    const tests = [
        { name: 'Replay Determinism', fn: testReplayDeterminism },
        { name: 'Zero Volume', fn: testZeroVolume },
        { name: 'Extreme Imbalance', fn: testExtremeImbalance },
        { name: 'Rolling Window Drift', fn: testRollingWindowDrift },
        { name: 'NaN/Infinity Sanitization', fn: testNaNInfinitySanitization },
        { name: 'CVD Calculator Determinism', fn: testCvdCalculatorDeterminism },
    ];
    
    const results: Array<{ name: string; passed: boolean; hash?: string; details: string }> = [];
    
    for (const test of tests) {
        try {
            const result = test.fn();
            results.push({ name: test.name, ...result });
        } catch (error) {
            results.push({
                name: test.name,
                passed: false,
                details: `Error: ${error}`
            });
        }
    }
    
    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST SUMMARY                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    let passedCount = 0;
    for (const result of results) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} | ${result.name}`);
        if (result.hash) {
            console.log(`       Hash: ${result.hash}`);
        }
        console.log(`       Details: ${result.details}`);
        
        if (result.passed) passedCount++;
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`Total: ${passedCount}/${results.length} tests passed`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Final verdict
    const allPassed = passedCount === results.length;
    console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    
    if (allPassed) {
        console.log('\nReplay determinism verified!');
        console.log('FAZ 1B acceptance criteria met.');
    }
    
    return {
        allPassed,
        passed: passedCount,
        total: results.length,
        results
    };
}

// Run tests
runAllTests().then(result => {
    process.exit(result.allPassed ? 0 : 1);
}).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
});

export { runAllTests };
