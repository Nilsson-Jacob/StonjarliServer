//const axios = require("axios");
//const regimeFilter = require("../filters/RegimeFilter");

import axios from "axios";
import regimeFilter from "../filters/RegimeFilter.js";
import pool from "../db/db.js";

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
  if (!FINNHUB_API_KEY) {
    console.error("❌ FINNHUB_API_KEY missing — cannot run strategy!");
    return;
  }

  console.log("🔍 Starting scan... keys check:", {
    FINNHUB: !!FINNHUB_API_KEY,
    ALPACA: !!ALPACA_KEY,
    COHERE: !!process.env.COHERE_API_KEY,
  });

  console.log("Running hidden spike scan for", symbols);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sentiments (
      id SERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      sentiment VARCHAR(15) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const qualified = []; // Stores stocks that pass all filters

  for (const symbol of symbols) {
    console.log(`🔎 Checking ${symbol}...`);

    try {
      const { data: q } = await axios.get(`${BASE_URL}/quote`, {
        params: { symbol, token: FINNHUB_API_KEY },
      });

      const current = q.c;
      const previous = q.pc;
      console.log(`📊 ${symbol}: current=${current}, previous=${previous}`);

      if (!current || !previous) {
        console.log(`⚠️ Skipping ${symbol}, missing quote data`);
        continue;
      }

      const pct = ((current - previous) / previous) * 100;
      console.log(`💹 ${symbol}: ${pct.toFixed(2)}% change`);

      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const to = new Date().toISOString().split("T")[0];

      const { data: news } = await axios.get(`${BASE_URL}/company-news`, {
        params: { symbol, from, to, token: FINNHUB_API_KEY },
      });

      console.log(`📰 ${symbol} returned ${news.length} articles`);
    } catch (err) {
      console.warn(`❌ Error scanning ${symbol}:`, err.message);
      await delay(2000); // back off before next one
      continue;
    }

    await delay(1200);
  }

  if (qualified.length === 0) {
    console.log("No spikes found today.");
    return [];
  }

  // 3️⃣ Sort qualified stocks by % gain (highest first)
  qualified.sort((a, b) => b.pct - a.pct);

  console.log("these are qualified: " + qualified);
  // 4️⃣ Limit to top 12 spikes
  const top = qualified.slice(0, 5);

  console.log("these are top: " + JSON.stringify(top[0]));
  // 5️⃣ Apply regime filter to remove unsuitable stocks
  const filteredTop = await regimeFilter(top);

  // 6️⃣ Place buy orders for filtered spikes
  for (const pick of filteredTop) {
    console.log("Buying spike:", pick.symbol);
    try {
      /* await axios.post(
        `${ALPACA_URL}/v2/orders`,
        {
          symbol: pick.symbol,
          qty: 1, // Buy 3 shares per spike
          side: "buy",
          type: "market",
          time_in_force: "gtc",
        },
        { headers }
      );*/
      console.log("✅ Bought", pick.symbol);
    } catch (err) {
      console.error("❌ Failed to buy spike:", pick.symbol, err.message);
    }
  }

  // 🧩 Save all headline-sentiment pairs in a single DB batch
  if (headLineAndVerdict.length > 0) {
    try {
      // Ensure the table exists
      await pool.query(`
      CREATE TABLE IF NOT EXISTS sentiments (
        id SERIAL PRIMARY KEY,
        headline TEXT NOT NULL,
        sentiment VARCHAR(15) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

      // Build parameterized multi-row insert
      const values = headLineAndVerdict
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(", ");

      const params = headLineAndVerdict.flatMap((r) => [
        r.headline,
        r.sentiment,
      ]);

      await pool.query(
        `INSERT INTO sentiments (headline, sentiment) VALUES ${values}`,
        params
      );

      console.log(
        `✅ Saved ${headLineAndVerdict.length} sentiment records to database`
      );
    } catch (err) {
      console.error("❌ Failed to save sentiments:", err.message);
    }
  }

  // Return top spikes (before filtering) for logging or further use
  return top;
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
