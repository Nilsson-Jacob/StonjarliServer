// peadStrategy.js
// Enhanced PEAD strategy with improvements:
// 1) Dynamic timing: BMO (before market open) vs AMC (after market close) and Friday → Monday handling
// 2) EPS surprise + revenue filter to ensure meaningful beats
// 3) Liquidity & momentum confirmation to avoid illiquid or dead stocks
// 4) Position sizing based on equity & assumed stop-loss risk

const axios = require("axios");
const regimeFilter = require("../filters/RegimeFilter");

// API keys and endpoints
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ALPACA_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET = process.env.ALPACA_API_SECRET;

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const ALPACA_BASE = process.env.ALPACA_BASE_URL;

// === Configurable parameters ===
const PRICE_MIN = 5; // Minimum stock price
const PRICE_MAX = 100; // Maximum stock price
const MIN_INTRADAY_VOLUME = 500_000; // Minimum intraday volume for liquidity
const MIN_ADV10 = 500_000; // Minimum average daily volume over 10 days
const MIN_MOMENTUM_PCT = 0.03; // Minimum price increase from previous close (+3%)
const MIN_EPS_SURPRISE_RATIO = 1.2; // Minimum EPS surprise (20% beat)
const MAX_CANDIDATES = 5; // Max number of stocks to consider per run

// Risk management parameters for position sizing
const RISK_PCT_OF_EQUITY = 0.005; // 0.5% of equity per trade
const ASSUMED_STOP_PCT = 0.05; // Assume 5% stop-loss

// Alpaca order headers
const headers = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

// Alpaca HTTP client
const alpaca = axios.create({
  baseURL: ALPACA_BASE,
  headers,
});

const url = "https://stonjarliserver.onrender.com/buy";

// Helper delay for API rate limits
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Converts to safe number
const safeNum = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};

// Format date as YYYY-MM-DD
function toISODate(d) {
  return d.toISOString().split("T")[0];
}

// === Timing logic ===
// Determine which earnings dates to pull based on today
function getDatesToCheck() {
  const today = new Date();
  const weekday = today.getDay();
  const dates = [];

  // Always check yesterday
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  dates.push(yest);

  // On Monday, also include Friday
  if (weekday === 1) {
    const fri = new Date(today);
    fri.setDate(today.getDate() - 3);
    dates.push(fri);
  }

  return dates;
}

// Get current account equity (used for position sizing)
async function getEquity() {
  const { data } = await alpaca.get("/v2/account");
  return (
    safeNum(data.equity) || safeNum(data.portfolio_value) || safeNum(data.cash)
  );
}

// Wrapper for Finnhub API
async function finnhub(path, params = {}) {
  const { data } = await axios.get(`${FINNHUB_BASE}${path}`, {
    params: { token: FINNHUB_API_KEY, ...params },
  });
  return data;
}

// Get earnings calendar for a specific date
async function getEarnings(date) {
  return (
    (
      await finnhub("/calendar/earnings", {
        from: toISODate(date),
        to: toISODate(date),
      })
    )?.earningsCalendar || []
  );
}

// Get stock quote
async function getQuote(symbol) {
  return finnhub("/quote", { symbol });
}

// Get stock metrics (ADV10)
async function getMetrics(symbol) {
  const data = await finnhub("/stock/metric", { symbol, metric: "all" });
  const adv10 =
    safeNum(data?.metric?.["10DayAverageTradingVolume"]) ||
    safeNum(data?.metric?.["10DayAvgVolume"]) ||
    NaN;
  return { adv10 };
}

// === Filter logic ===
// Earnings must beat EPS by at least MIN_EPS_SURPRISE_RATIO and revenue must beat as well
function earningsPass(e) {
  const epsA = safeNum(e.epsActual);
  const epsE = safeNum(e.epsEstimate);
  if (
    !Number.isFinite(epsA) ||
    !Number.isFinite(epsE) ||
    epsA <= 0 ||
    epsE <= 0
  )
    return false;

  const revenueBeat = safeNum(e.revenueActual) > safeNum(e.revenueEstimate);
  return epsA / epsE >= MIN_EPS_SURPRISE_RATIO && revenueBeat;
}

// Price momentum filter: require a positive reaction
function momentumPass(current, previousClose) {
  return (current - previousClose) / previousClose >= MIN_MOMENTUM_PCT;
}

// Liquidity filter: ensure the stock is tradable
function liquidityPass(price, intradayVol, adv10) {
  return (
    price >= PRICE_MIN &&
    price <= PRICE_MAX &&
    intradayVol >= MIN_INTRADAY_VOLUME &&
    adv10 >= MIN_ADV10
  );
}

// Position sizing: risk-based quantity calculation
function computeQty(price, equity) {
  const riskDollars = equity * RISK_PCT_OF_EQUITY;
  const perShareRisk = price * ASSUMED_STOP_PCT;
  return Math.max(1, Math.floor(riskDollars / perShareRisk));
}

// Place a market buy order on Alpaca
async function placeBuy(symbol, qty) {
  return alpaca.post("/v2/orders", {
    symbol,
    qty,
    side: "buy",
    type: "market",
    time_in_force: "gtc",
  });
}

// === Main strategy ===
async function runPEADStrategy() {
  const errors = [];
  const placed = [];

  try {
    // Determine which earnings dates to check
    const datesToCheck = getDatesToCheck();
    let raw = [];
    for (const date of datesToCheck) {
      const e = await getEarnings(date);
      raw = raw.concat(e);
    }

    // Step 1: Filter earnings for strong EPS + revenue beats
    const earningsFiltered = raw.filter(earningsPass);
    if (earningsFiltered.length === 0) {
      return `Sent orders for:  | Errors: No earnings matched filters`;
    }

    // Fetch current equity for position sizing
    let equity;
    try {
      equity = await getEquity();
    } catch (e) {
      console.warn(
        "⚠️ Failed to fetch equity, defaulting to qty=1:",
        e.message
      );
      equity = NaN;
    }

    const qualified = [];
    for (const e of earningsFiltered) {
      const symbol = e.symbol;
      const releaseTiming = e.hour; // bmo = before market open, amc = after market close

      // Decide which day to measure reaction: same day for bmo, next day for amc
      const refDate = new Date(e.date);
      const checkDate =
        releaseTiming === "amc"
          ? new Date(refDate.getTime() + 24 * 3600 * 1000)
          : refDate;

      try {
        // Fetch quote and metrics
        const quote = await getQuote(symbol);
        const current = safeNum(quote?.c);
        const previousClose = safeNum(quote?.pc);
        const intradayVol = safeNum(quote?.v);
        const { adv10 } = await getMetrics(symbol);

        // Apply liquidity & momentum filters
        if (
          liquidityPass(current, intradayVol, adv10) &&
          momentumPass(current, previousClose)
        ) {
          qualified.push({
            ...e,
            price: current,
            momentumPct: (current - previousClose) / previousClose,
            surpriseRatio: safeNum(e.epsActual) / safeNum(e.epsEstimate),
          });
        }
      } catch (err) {
        console.warn(`Failed fetching data for ${symbol}:`, err.message);
      }
      await delay(1200); // avoid rate limiting
    }

    if (qualified.length === 0) {
      return `Sent orders for:  | Errors: No qualified stocks after liquidity/momentum filters`;
    }

    // Step 2: Sort by EPS surprise (then momentum), limit to MAX_CANDIDATES
    const ranked = qualified
      .sort(
        (a, b) =>
          b.surpriseRatio - a.surpriseRatio || b.momentumPct - a.momentumPct
      )
      .slice(0, MAX_CANDIDATES);

    // Step 3: Apply regime filter (optional macro filter)
    let candidates = ranked;
    try {
      candidates = await regimeFilter(ranked);
    } catch (e) {
      console.warn("⚠️ regimeFilter failed:", e.message);
    }

    // simple  test
    candidates = { symbol: "AAPL" };

    // Step 4: Place buy orders with position sizing
    for (const stock of candidates) {
      //const qty = Number.isFinite(equity) ? computeQty(stock.price, equity) : 1;

      try {
        //await placeBuy(stock.symbol, qty);

        // The body you want to send
        const body = {
          symbol: stock.symbol,
          qty: 1,
        };

        await axios.post(url, body);

        placed.push(`${stock.symbol} (qty ${qty})`);
        await delay(300); // brief delay between orders
      } catch (err) {
        const msg = err?.response?.data?.message || err.message;
        console.error(`❌ Failed to buy ${stock.symbol}:`, msg);
        errors.push(`❌ Failed to buy ${stock.symbol}: ${msg}`);
      }
    }

    return `Sent orders for: ${placed.join(", ")} | Errors: ${errors.join(
      "; "
    )}`;
  } catch (err) {
    const msg = err?.response?.data?.message || err.message;
    console.error("PEAD strategy failed:", msg);
    return `Sent orders for: ${placed.join(", ")} | Errors: ${errors.join(
      "; "
    )}`;
  }
}

module.exports = runPEADStrategy;
