const now = Math.floor(Date.now() / 1000);
const cases = [
  { name: 'from+to', q: `from=${now - 3600}&to=${now}` },
  { name: 'limit', q: `limit=10` },
  { name: 'from+to+limit', q: `from=${now - 3600}&to=${now}&limit=100` },
  { name: 'to+limit', q: `to=${now}&limit=10` },
];

for (const c of cases) {
  const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m&${c.q}`;
  const res = await fetch(url);
  const text = await res.text();
  console.log(`${c.name} → ${res.status} ${text.slice(0, 160)}`);
}
