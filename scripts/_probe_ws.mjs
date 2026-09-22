import WebSocket from 'ws';

const endpoints = ['wss://fx-ws.gateio.ws/v4/ws/usdt', 'wss://api.gateio.ws/ws/v4/'];

for (const url of endpoints) {
  const ws = new WebSocket(url);
  const tag = url;
  ws.on('open', () => {
    console.log(`OPEN ${tag}`);
    ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'futures.tickers',
        event: 'subscribe',
        payload: ['BTC_USDT', 'ETH_USDT'],
      }),
    );
  });
  ws.on('message', (data) => {
    console.log(`${tag} ${data.toString().slice(0, 200)}`);
  });
  ws.on('error', (e) => console.log(`ERR ${tag} ${e.message}`));
  ws.on('close', (c) => console.log(`CLOSE ${tag} ${c}`));
}

setTimeout(() => process.exit(0), 10000);
