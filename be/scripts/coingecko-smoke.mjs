// be/scripts/coingecko-smoke.mjs  (run: node scripts/coingecko-smoke.mjs)
import 'dotenv/config';
const key = process.env.COINGECKO_API_KEY;
const base = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';
if (!key) { console.error('COINGECKO_API_KEY required'); process.exit(2); }
const h = { headers: { accept: 'application/json', 'x-cg-demo-api-key': key } };

const price = await (await fetch(`${base}/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true`, h)).json();
if (typeof price?.ethereum?.usd !== 'number') throw new Error('no ETH price: ' + JSON.stringify(price));
console.log('OK ETH price $' + price.ethereum.usd);

const search = await (await fetch(`${base}/search?query=bitcoin`, h)).json();
const id = search?.coins?.[0]?.id;
if (id !== 'bitcoin') throw new Error('search failed: ' + JSON.stringify(search?.coins?.[0]));
const coin = await (await fetch(`${base}/coins/${id}?localization=false&tickers=false&sparkline=true`, h)).json();
if (typeof coin?.market_data?.current_price?.usd !== 'number') throw new Error('coin data failed');
console.log('OK bitcoin $' + coin.market_data.current_price.usd + ' rank #' + coin.market_cap_rank + ' sparkline pts ' + (coin.market_data.sparkline_7d?.price?.length ?? 0));
console.log('CoinGecko demo key works ✓');
