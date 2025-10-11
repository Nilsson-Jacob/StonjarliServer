//const axios = require("axios");
//const regimeFilter = require("../filters/RegimeFilter");

import axios from "axios";
import regimeFilter from "../filters/RegimeFilter.js";
import pool from "../db/db.js";

bVHX4abnMXEVHJvUjAM3FG7GiMinwOuyJUu2QFge;

// API keys
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ALPACA_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET = process.env.ALPACA_API_SECRET;

const BASE_URL = "https://finnhub.io/api/v1";
const ALPACA_URL = process.env.ALPACA_BASE_URL;

// Headers for Alpaca orders
const headers = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

//const { CohereClient } = require("cohere-ai");
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY, // store in .env, don’t hardcode
});

// Utility function to delay execution (prevents hitting API rate limits)
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

let headLineAndVerdict = [];

// Symbols to scan for hidden spikes
const symbols = [
  "TSLA",
  "NIO",
  "LCID",
  "RIVN",
  "CHPT",
  "BLNK",
  "NVDA",
  "AMD",
  "INTC",
  "PLTR",
  "SMCI",
  "AI",
  "MRNA",
  "NVAX",
  "BNTX",
  "CRSP",
  "VRTX",
  "JOBY",
  "RKLB",
  "LMT",
  "BA",
  "SNOW",
  "NET",
  "DDOG",
  "MDB",
  "SHOP",
  "COIN",
  "PLTR",
  "CVNA",
  "GME",
  "AMC",
  "ROKU",
];

// Main function to detect and buy hidden spikes
export default async function runHiddenSpikeStrategy() {
  // ⚠️ Purge all sentiment data
  try {
    await pool.query("TRUNCATE TABLE sentiments RESTART IDENTITY;");
    console.log("🗑️ All sentiment records purged");
    /*res
      .status(200)
      .json({ message: "All sentiment records deleted successfully." });*/
  } catch (err) {
    console.error("❌ Failed to purge sentiments:", err.message);
    /* res.status(500).json({ error: "Failed to purge sentiment data." });*/
  }

  if (!FINNHUB_API_KEY) {
    console.error("❌ Missing FINNHUB_API_KEY");
    return [];
  }

  console.log("🚀 Starting hidden spike scan...");
  console.log("API Keys:", {
    FINNHUB: !!FINNHUB_API_KEY,
    ALPACA: !!ALPACA_KEY,
    COHERE: !!process.env.COHERE_API_KEY,
  });

  // Make sure sentiments table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sentiments (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) NOT NULL,
      headline TEXT NOT NULL,
      sentiment VARCHAR(15) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const potentialBuys = [];

  for (const symbol of symbols) {
    console.log(`\n🔎 Checking ${symbol}...`);
    await delay(1200);
    try {
      const { data: q } = await axios.get(`${BASE_URL}/quote`, {
        params: { symbol, token: FINNHUB_API_KEY },
      });

      const current = q.c;
      const previous = q.pc;
      if (!current || !previous) continue;

      const pct = ((current - previous) / previous) * 100;
      console.log(`📊 ${symbol}: ${pct.toFixed(2)}% change`);

      // Skip if small move
      if (Math.abs(pct) < 5.0) continue;

      // Get last 3 days of company news
      const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const to = new Date().toISOString().split("T")[0];

      const { data: news } = await axios.get(`${BASE_URL}/company-news`, {
        params: { symbol, from, to, token: FINNHUB_API_KEY },
      });

      console.log(`📰 ${symbol} returned ${news.length} articles`);
      if (!news.length) continue;

      // Find relevant headline
      const found = news.find((n) =>
        /investment|partnership|strategic|stake|acquisition|merger|deal|collaboration|earnings beat|AI|contract|defense|launch|OpenAI|upgrade/i.test(
          n.headline
        )
      );

      if (!found) continue;

      console.log(`🧠 Checking sentiment for: "${found.headline}"`);
      const sentiment = await checkSentiment(found.headline);

      if (sentiment === "positive") {
        potentialBuys.push({
          symbol,
          pct,
          headline: found.headline,
          sentiment,
        });
      }
    } catch (err) {
      console.warn(`❌ Error scanning ${symbol}:`, err.message);
    }

    await delay(1200);
  }

  if (potentialBuys.length === 0) {
    console.log("No potential buys found today.");
    return [];
  }

  // Apply regime filter
  console.log("🧩 Applying regime filter...");
  const filtered = await regimeFilter(potentialBuys);
  console.log(
    `✅ ${filtered.length} passed regime filter: ${filtered
      .map((s) => s.symbol)
      .join(", ")}`
  );

  const successfulBuys = [];

  for (const pick of filtered) {
    try {
      console.log(`💰 Placing buy order for ${pick.symbol}`);
      await axios.post(
        `${ALPACA_URL}/v2/orders`,
        {
          symbol: pick.symbol,
          qty: 1,
          side: "buy",
          type: "market",
          time_in_force: "gtc",
        },
        { headers }
      );
      console.log(`✅ Bought ${pick.symbol}`);

      // Save only bought ones to DB
      await pool.query(
        `INSERT INTO sentiments (symbol, headline, sentiment) VALUES ($1, $2, $3)`,
        [pick.symbol, pick.headline, pick.sentiment]
      );

      successfulBuys.push(pick);
    } catch (err) {
      console.error(`❌ Failed to buy ${pick.symbol}:`, err.message);
    }
  }

  if (successfulBuys.length === 0) {
    console.log("No buys were executed.");
  } else {
    console.log(
      `🎯 Final buys: ${successfulBuys.map((b) => b.symbol).join(", ")}`
    );
  }

  return successfulBuys;
}

async function checkSentiment(headline) {
  try {
    const response = await cohere.chat({
      model: "command-r7b-12-2024", // Cohere’s best reasoning model
      message: `Classify the sentiment of this headline as "positive", "negative" or "neutral": "${headline}"`,
      temperature: 0,
    });

    const sentiment = response.text.toLowerCase();
    if (sentiment.includes("positive")) {
      headLineAndVerdict.push({ headline: headline, sentiment: "positive" });
      return "positive";
    }
    if (sentiment.includes("negative")) {
      headLineAndVerdict.push({ headline: headline, sentiment: "negative" });
      return "negative";
    }
    if (sentiment.includes("neutral")) {
      headLineAndVerdict.push({ headline: headline, sentiment: "neutral" });
      return "neutral";
    }

    return "neutral";
  } catch (err) {
    console.error("Cohere sentiment check failed:", err.message);
    return "neutral";
  }
}

//module.exports = runHiddenSpikeStrategy;
