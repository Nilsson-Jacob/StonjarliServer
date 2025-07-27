const express = require("express");
require("dotenv").config();
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json()); // ✅ This is what parses JSON in requests

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
