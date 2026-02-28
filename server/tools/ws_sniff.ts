import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8787/ws?symbols=BTCUSDT');

ws.on('open', () => {
    console.log('Connected to WS');
});

ws.on('message', (data: any) => {
    try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'metrics' && msg.symbol === 'BTCUSDT') {
            console.log(JSON.stringify(Object.keys(msg.data)));
            if (msg.data.decision) {
                console.log('--- LATEST DECISION VIEW ---');
                console.log(JSON.stringify(msg.data.decision, null, 2));
            } else if (msg.data.orchestratorDecision) {
                console.log('--- LATEST ORC DECISION ---');
                console.log(JSON.stringify(msg.data.orchestratorDecision, null, 2));
            } else {
                console.log('--- FULL MESSAGE ---');
                console.log(JSON.stringify(msg.data).slice(0, 1000));
            }
            process.exit(0);
        }
    } catch (e) { }
});
