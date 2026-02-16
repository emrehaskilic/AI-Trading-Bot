import { test } from 'node:test';
import assert from 'node:assert';
import { AIDryRunController } from '../ai/AIDryRunController';

// Minimal mock for dependencies
const mockSession = {} as any;

test('AIParse Logic', async (t) => {
    const controller = new AIDryRunController(mockSession);
    // Access private method
    const parse = (text: string) => (controller as any).parseAction(text);

    await t.test('Valid simple JSON', () => {
        const res = parse('{"action":"HOLD"}');
        assert.ok(res);
        assert.strictEqual(res?.action, 'HOLD');
    });

    await t.test('JSON with markdown fences', () => {
        const text = 'Here is the plan:\n```json\n{"action": "ENTRY", "side": "LONG", "sizeMultiplier": 1.5}\n```\nExplanation...';
        const res = parse(text);
        assert.ok(res);
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'LONG');
        assert.strictEqual(res?.sizeMultiplier, 1.5);
    });

    await t.test('JSON inside text without fences', () => {
        const text = 'I think we should buy. {"action": "BUY", "sizeMultiplier": "0.5"} logic logic';
        const res = parse(text);
        assert.ok(res);
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'LONG'); // BUY mapped to LONG
        assert.strictEqual(res?.sizeMultiplier, 0.5); // String parsed to number
    });

    await t.test('Nested JSON object finding', () => {
        // A common failure case is multiple braces
        const text = 'Some context { invalid json } but here is the real one: {"action":"EXIT", "reason":"High Vol"}';
        // Our simple parser might fail on this if it takes the outermost { }. 
        // The implementation tries multiple candidates.
        // Candidate 1: Full text (fails)
        // Candidate 2: Fences (none)
        // Candidate 3: First { to last } -> "{ invalid json } but here is the real one: {"action":"EXIT", "reason":"High Vol"}" (fails parse)
        // Candidate 4: RegExp match all objects -> matches {"action":"EXIT", "reason":"High Vol"} (succeeds)

        const res = parse(text);
        assert.ok(res);
        assert.strictEqual(res?.action, 'EXIT');
        assert.strictEqual(res?.reason, 'High Vol');
    });

    await t.test('Correct mapping of aliases', () => {
        let res = parse('{"action":"SELL"}');
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'SHORT');

        res = parse('{"action":"SHORT"}');
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'SHORT');

        res = parse('{"action":"WAIT"}');
        assert.strictEqual(res?.action, 'HOLD');
    });

    await t.test('Array input handling', () => {
        const text = '[{"action": "ADD", "sizeMultiplier": 0.2}, {"action": "HOLD"}]';
        const res = parse(text);
        assert.ok(res);
        assert.strictEqual(res?.action, 'ADD'); // Should take first
        assert.strictEqual(res?.sizeMultiplier, 0.2);
    });

    await t.test('Case insensitivity', () => {
        const res = parse('{"action": "entry", "side": "long"}');
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'LONG');
    });

    await t.test('Smart quotes and trailing comma are normalized', () => {
        const text = '```json\n{“action”: “ENTRY”, “side”: “LONG”, “sizeMultiplier”: “0.8”,}\n```';
        const res = parse(text);
        assert.ok(res);
        assert.strictEqual(res?.action, 'ENTRY');
        assert.strictEqual(res?.side, 'LONG');
        assert.strictEqual(res?.sizeMultiplier, 0.8);
    });

    await t.test('Invalid or empty input returns null', () => {
        assert.strictEqual(parse(''), null);
        assert.strictEqual(parse('Just some text'), null);
        assert.strictEqual(parse('{"action": "UNKNOWN"}'), null);
    });
});
