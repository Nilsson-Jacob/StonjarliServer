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
  console.log("Running hidden spike scan for", symbols);

  // reset array at start of run so you don't accumulate duplicates across runs
  headLineAndVerdict = [];

  // ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sentiments (
      id SERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      sentiment VARCHAR(15) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const qualified = [];
  const pctThreshold = 1; // change as desired (1 => 1%)

  // the improved regex (you already used this)
  const catalystRegex = new RegExp(
    "investment|investor|partnership|strategic|stake|private investment|acquisition|merger|deal|collaboration|earnings beat|earnings surprise|guidance raise|forecast increase|profit|revenue growth|AI|artificial intelligence|launch|product release|breakthrough|innovation|approval|FDA|contract|order|award|expansion|market entry|joint venture|funding|backing|grant|buyback|dividend|surge|upgrade|price target|analyst upgrade|record|milestone|integration|OpenAI|NVIDIA|data center|cloud|semiconductor|chip|automation|robotics|autonomous|defense|space|renewable|battery",
    "i"
  );

  for (const symbol of symbols) {
    console.log(`🔎 Checking ${symbol}...`);
    try {
      // quote
      const { data: q } = await axios.get(`${BASE_URL}/quote`, {
        params: { symbol, token: FINNHUB_API_KEY },
      });
      const current = q.c,
        previous = q.pc;
      console.log(`📊 ${symbol}: current=${current}, previous=${previous}`);

      if (!current || !previous) {
        console.log(`⚠️ Skipping ${symbol}, missing quote data`);
        await delay(500);
        continue;
      }

      const pct = ((current - previous) / previous) * 100;
      console.log(`💹 ${symbol}: ${pct.toFixed(2)}% change`);

      // news (expand window to 7d if you like)
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const to = new Date().toISOString().split("T")[0];

      const { data: news } = await axios.get(`${BASE_URL}/company-news`, {
        params: { symbol, _from: from, to, token: FINNHUB_API_KEY },
      });

      console.log(`📰 ${symbol} returned ${news.length} articles`);

      // find ALL matching headlines (filter, not find)
      const foundNews = news.filter((n) => {
        const text = `${n.headline || ""} ${n.summary || ""}`;
        return catalystRegex.test(text);
      });

      if (foundNews.length === 0) {
        console.log(`❌ No catalyst headlines matched regex for ${symbol}`);
        await delay(500);
        continue;
      }

      // For each matching headline run sentiment (and record it).
      // If pct >= threshold AND sentiment === 'positive', add to qualified list.
      for (const item of foundNews) {
        const headline = item.headline || item.summary || "(no headline)";
        console.log(`🧠 Running sentiment for ${symbol}: "${headline}"`);

        // this pushes into headLineAndVerdict internally
        const sentiment = await checkSentiment(headline);

        console.log(`🧾 Sentiment result for ${symbol}: ${sentiment}`);

        // if stock moved enough AND sentiment positive -> candidate
        if (pct >= pctThreshold && sentiment === "positive") {
          qualified.push({ symbol, pct, newsHeadline: headline });
          console.log(`Spike candidate: ${symbol} (+${pct.toFixed(1)}%)`);
        }

        // small delay between sentiment calls to avoid rate-limits
        await delay(600);
      }
    } catch (err) {
      console.warn(
        `❌ Error scanning ${symbol}:`,
        err?.response?.data || err.message
      );
      // backoff a bit if network/API error
      await delay(1500);
      // continue loop to next symbol
      continue;
    }

    // small delay between symbols to avoid rate limit
    await delay(1200);
  }

  // sort/limit/filter/place orders ... remains the same
  if (qualified.length === 0) {
    console.log("No spikes found today.");
    // Still save any headLineAndVerdict if you want (below)
  } else {
    qualified.sort((a, b) => b.pct - a.pct);
  }

  // Insert all sentiments saved during run (batch)
  if (headLineAndVerdict.length > 0) {
    try {
      const values = headLineAndVerdict
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(",");
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
  } else {
    console.log("No sentiment records captured to save.");
  }

  return qualified.slice(0, 5); // or whatever you want to return
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
