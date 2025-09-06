const axios = require("axios");
const regimeFilter = require("../filters/RegimeFilter");

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ALPACA_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET = process.env.ALPACA_API_SECRET;

const BASE_URL = "https://finnhub.io/api/v1";
const ALPACA_URL = "https://paper-api.alpaca.markets";

const headers = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const symbols = [
  // EV & Battery
  "TSLA",
  "NIO",
  "LCID",
  "RIVN",
  "CHPT",
  "BLNK",

  // AI / Semiconductors
  "NVDA",
  "AMD",
  "INTC",
  "PLTR",
  "SMCI",
  "AI",

  // Biotech / Health
  "MRNA",
  "NVAX",
  "BNTX",
  "CRSP",
  "VRTX",

  // Space & Defense
  "JOBY",
  "RKLB",
  "LMT",
  "BA",

  // Tech / SaaS
  "SNOW",
  "NET",
  "DDOG",
  "MDB",
  "SHOP",
  "COIN",
  "PLTR",

  // Consumer / Surprise movers
  "CVNA",
  "GME",
  "AMC",
  "ROKU",
];

// Fetch recent company news and return top gainers that match criteria
async function runHiddenSpikeStrategy() {
  console.log("Running hidden spike scan for", symbols);

  const qualified = [];

  for (const symbol of symbols) {
    try {
      // 1. Get quote (current and prev close)
      const { data: q } = await axios.get(`${BASE_URL}/quote`, {
        params: { symbol, token: FINNHUB_API_KEY },
      });

      const current = q.c,
        previous = q.pc;
      if (!current || !previous || current > 60) continue;

      const pct = ((current - previous) / previous) * 100;
      if (pct < 10) continue; // require >10% up

      // 2. Fetch recent company news from last 1 day
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const to = new Date().toISOString().split("T")[0];

      const { data: news } = await axios.get(`${BASE_URL}/company-news`, {
        params: { symbol, _from: from, to, token: FINNHUB_API_KEY },
      });

      const found = news.find((n) =>
        /investment|partnership|strategic|stake|private investment/i.test(
          n.headline
        )
      );
      if (!found) continue;

      qualified.push({ symbol, pct, newsHeadline: found.headline });
      console.log(`Spike detected for ${symbol}: +${pct.toFixed(1)}%`);
    } catch (err) {
      console.warn("Error scanning", symbol, err.message);
    }
    await delay(1200);
  }

  if (qualified.length === 0) {
    console.log("No spikes found today.");
    return [];
  }

  // Sort by percent gain
  qualified.sort((a, b) => b.pct - a.pct);
  const top = qualified.slice(0, 5); // buy only first spike
  const filteredTop = regimeFilter(top);

  for (const pick of filteredTop) {
    console.log("Buying spike:", pick.symbol);
    try {
      await axios.post(
        `${ALPACA_URL}/v2/orders`,
        {
          symbol: pick.symbol,
          qty: 3,
          side: "buy",
          type: "market",
          time_in_force: "gtc",
        },
        { headers }
      );
      console.log("✅ Bought", pick.symbol);
    } catch (err) {
      console.error("❌ Failed to buy spike:", pick.symbol, err.message);
    }
  }

  return top;
}

module.exports = runHiddenSpikeStrategy;
