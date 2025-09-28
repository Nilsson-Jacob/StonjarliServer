const express = require("express");
require("dotenv").config();
const axios = require("axios");

const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

const yahooFinance = require("yahoo-finance2").default;

//const runPEADStrategy = require("./scripts/PREVRunPEADStrategy.js");
//const runHiddenSpikeStrategy = require("./scripts/PREVRunHiddenSpikeStrategy.js");
const runPEADStrategy = require("./scripts/RunPEADStrategy.js");
const runHiddenSpikeStrategy = require("./scripts/RunHiddenSpikeStrategy.js");
const runSellStocks = require("./scripts/runSellStocks.js");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

let todays = [];
let information = {};

app.use(express.json()); // ✅ This is what parses JSON in requests
app.use(cors()); // You can pass options to restrict allowed origins

app.get("/test", (req, res) => {
  res.send("✅ Test route working");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

const alpaca = axios.create({
  baseURL: process.env.ALPACA_BASE_URL,
  headers: {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET,
  },
});

app.get("/", (req, res) => {
  res.send("Hello from backend JN!");
});

app.get("/account", async (req, res) => {
  try {
    console.log("Delaying 30 seconds before running strat...");
    await new Promise((resolve) => setTimeout(resolve, 24000)); // wait 30s

    const response = await alpaca.get("/v2/account");
    res.json(response.data);
  } catch (error) {
    console.error("Alpaca API error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch Alpaca account info" });
  }
});

app.get("/todays/:date", async (req, res) => {
  try {
    //const today = new Date().toISOString().substring(0, 10); // e.g. "2025-08-17"
    const { date } = req.params; // Get the date from the URL, e.g., '2025-08-16'

    // Build start & end times for today in ISO8601
    const after = `${date}T00:00:00Z`;
    const until = `${date}T23:59:59Z`;

    const response = await alpaca.get(
      `${BASE_URL}/v2/orders?status=closed&after=${after}&until=${until}`
    );

    res.send("Response.data is this: " + response.data + " Date is: " + date);
  } catch (error) {
    console.error("Alpaca API error:", error.response?.data || error.message);
    res.send("Some error");
  }
});

app.get("/SP500/:startDate", async (req, res) => {
  try {
    const { startDate } = req.params;
    const endDate = new Date().toISOString().substring(0, 10); // today

    const queryOptions = {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    };

    // 🔑 yahoo-finance2 syntax:
    const data = await yahooFinance.historical("^GSPC", queryOptions);

    if (!Array.isArray(data) || data.length < 2) {
      /*return res.status(404).json({
        error: "Not enough data",
        startDate,
        endDate,
        count: data?.length || 0,
      });*/

      res.send(data);
    }

    const startPrice = data[0].close;
    const endPrice = data[data.length - 1].close;
    const growthPct = ((endPrice - startPrice) / startPrice) * 100;

    return res.json({
      startDate,
      endDate,
      startPrice,
      endPrice,
      growthPct: Number(growthPct.toFixed(2)),
    });
  } catch (error) {
    console.error("SP500 route error:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.get("/positions", async (req, res) => {
  try {
    const response = await alpaca.get("/v2/positions");

    // For now.
    if (response.data.length == 0) {
      res.status(200).json({
        data: [{ symbol: "AAPL" }, { symbol: "AMEX" }],
      });
    } else {
      res.status(200).json({
        data: response.data,
      });
    }
  } catch (err) {
    console.error(
      "❌ Failed to get positions",
      err.response?.data || err.message
    );
    res
      .status(500)
      .json({ error: "Failed to get positions", details: err.response?.data });
  }
});

// Utility: Get latest buy order fill date for a symbol
async function getBuyDate() {
  const BASE_URL = process.env.ALPACA_BASE_URL;

  try {
    const response = await alpaca.get(`${BASE_URL}/v2/orders?status=closed`);
    return response.data;
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    throw err;
  }
}

app.get("/daily", async (req, res) => {
  return todays;
});

app.get("/justBuy/:symbol", (async) => {
  symbol = req.body.symbol;

  return alpaca.post("/v2/orders", {
    symbol,
    qty,
    side: "buy",
    type: "market",
    time_in_force: "gtc",
  });
});

// Express route
app.get("/buydate", async (req, res) => {
  try {
    const closedOrders = await getBuyDate();

    console.log("in buydate with response: " + closedOrders);

    res.send(closedOrders);
  } catch (error) {
    res.send("there was error");
  }
});

app.get("/runpead", async (req, res) => {
  try {
    const response = await runPEADStrategy();
    res.send(response);
  } catch (error) {
    console.error("Error running PEAD strategy:", error);
    //res.status(500).json({ error: "Failed to run PEAD strategy" });
    res.send("Could not run PEAD, is market closed? : " + error);
  }
});

app.get("/runhis", async (req, res) => {
  const picks = await runHiddenSpikeStrategy();
  res.json({ picks });
});

app.get("/runStrat", async (req, res) => {
  try {
    const aPeadStrat = await runPEADStrategy();
    await delay(1200); // prevent rate limit

    const aHSS = await runHiddenSpikeStrategy();
    await delay(1200); // prevent rate limit

    const aSellOrders = await runSellStocks();
    await delay(1200); // prevent rate limit

    let response = {
      pead: aPeadStrat,
      hss: aHSS,
      sellOrders: aSellOrders,
    };

    const todaysDate = new Date();
    const dateKey = todaysDate.toISOString().substring(0, 10);

    // push an object with the date as the key
    todays = response;
    res.send(response);
  } catch (error) {
    console.error("Error running strategy", error);
    //res.status(500).json({ error: "Failed to run PEAD strategy" });
    res.send("Could not run strategy : " + error);
  }
});

app.get("/sell", async (req, res) => {
  try {
    const aSellOrders = await runSellStocks();

    let response = {
      sellOrders: aSellOrders,
    };

    res.send(response);
  } catch (error) {
    res.send("Could not run strategy : " + error);
  }
});

app.post("/buy", async (req, res) => {
  const { symbol, qty } = req.body;

  if (!symbol || !qty) {
    return res.status(400).json({ error: "Missing 'symbol' or 'qty'" });
  }

  try {
    const order = {
      symbol: symbol.toUpperCase(),
      qty: Number(qty),
      side: "buy",
      type: "market",
      time_in_force: "gtc", // Good 'Til Cancelled
    };

    const response = await alpaca.post("/v2/orders", order);
    res.status(200).json({
      message: `✅ Order submitted for ${qty} share(s) of ${symbol}`,
      data: response.data,
    });
  } catch (err) {
    console.error("❌ Order failed:", err.response?.data || err.message);
    res
      .status(500)
      .json({ error: "Order submission failed", details: err.response?.data });
  }
});

app.get("/earnings", async (req, res) => {
  const baseURL = "https://finnhub.io/api/v1";
  const apiKey = "cupln21r01qk8dnkqkcgcupln21r01qk8dnkqkd0";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const to = yesterday.toISOString().split("T")[0];

  const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // past 1 day
    .toISOString()
    .split("T")[0];

  try {
    const res = await axios.get(`${baseURL}/calendar/earnings`, {
      params: {
        from,
        to,
        token: apiKey,
      },
    });

    const raw = res.data.earningsCalendar || [];
    console.log("Fetched earnings count:", raw.length);

    const filtered = await Promise.all(
      raw.map(async (entry) => {
        const surpriseRatio = entry.epsActual / entry.epsEstimate;

        // Basic EPS check
        if (!entry.epsActual || !entry.epsEstimate || surpriseRatio <= 1.1)
          return false;

        // Only include AMC/BMO (after-market or before-market)
        if (entry.hour !== "amc" && entry.hour !== "bmo") return false;
        else return true;
      })
    );
    // Fetch price, volume, market cap

    res.send(filtered.filter((e) => e));
  } catch (err) {
    console.error("Error fetching earnings from Finnhub:", err.message);
    res.send([]);
  }
});
