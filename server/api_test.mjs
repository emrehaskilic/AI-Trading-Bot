import fs from 'fs';

fetch('http://localhost:8787/api/dry-run/status')
    .then(res => res.json())
    .then(data => {
        const btc = data.status?.perSymbol['BTCUSDT'];
        if (btc && btc.performance) delete btc.performance.pnlCurve;
        fs.writeFileSync('.out.json', JSON.stringify(btc, null, 2));
        console.log('done');
    })
    .catch(console.error);
