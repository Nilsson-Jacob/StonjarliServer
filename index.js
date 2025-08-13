const express = require("express");
require("dotenv").config();
const axios = require("axios");

const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

const runPEADStrategy = require("./scripts/RunPEADStrategy");
const runHiddenSpikeStrategy = require("./scripts/RunHiddenSpikeStrategy");

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
    const response = await alpaca.get("/v2/account");
    res.json(response.data);
  } catch (error) {
    console.error("Alpaca API error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch Alpaca account info" });
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
  try {
    const response = await axios.get(`${BASE_URL}/v2/orders?status=closed`, {
      headers,
    });

    return response.data;
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    throw err;
  }
}

// Express route
app.get("/buydate", async (req, res) => {
  try {
    const closedOrders = await getBuyDate();

    console.log("in buydate with response: " + closedOrders);

    return res.send({ HEj: "ORDER" });
  } catch (error) {
    res.send(error);
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
