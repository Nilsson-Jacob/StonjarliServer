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

const MARKETAUX_KEY = process.env.MARKETAUX_API_KEY;

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

const pharmaSymbols = [
  "MRNA",
  "BNTX",
  "NVAX",
  "CRSP",
  "VRTX",
  "REGN",
  "GILD",
  "BIIB",
  "ILMN",
  "AMGN",
  "MRK",
  "PFE",
  "LLY",
  "BMY",
  "AZN",
  "SGEN",
  "BMRN",
  "TWST",
  "NTLA",
  "EDIT",
  "RARE",
  "SRPT",
  "ALXN",
  "ACAD",
  "SNY",
  "BHC",
  "JAZZ",
  "INO",
  "BEAM",
  "ZLAB",
  "NBIX",
];

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

// Main function to detect and buy hidden spikes
export default async function runGoodNewsStrategy() {
  /* Add here the call to marketaux, my api key is in .env file as MARKETAUX_API_KEY  */
  // ---- NEW: pull latest news from Marketaux ----
  //const news = await fetchLatestNews(); // <-- add this
  // Make sure sentiments table exists
  await pool.query(`
      CREATE TABLE IF NOT EXISTS GOODNEWS (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        headline TEXT NOT NULL,
        event VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

  const news = await fetchLatestNews();
  if (!news.length) return "no news";

  const top = news[0].title; // use latest headline

  let array = [];

  for (let i = 0; i < news.length; i++) {
    let temp = await classifyHeadlineWithCohere(
      news[i].title,
      news[i].entities,
      news[i].snippet,
      news[i].description
    );

    array.push({
      answer: temp,
      news: news[i].title,
      entities: news[i].entities,
      snippet: news[i].snippet,
      description: news[i].description,
    });

    await pool.query(
      `INSERT INTO GOODNEWS (symbol, headline, event) VALUES ($1, $2, $3)`,
      [news[i].entities[0].symbol, news[i].title, temp]
    );
  }

  //let a = await Promise.all(array);

  return array;
  //return checkSentiment(top);
}

// classify headline with Cohere — request JSON-like output
async function classifyHeadlineWithCohere(
  headline,
  entities = [],
  snippet = "",
  description = ""
) {
  const systemPrompt = `
You are an assistant that classifies pharma headlines, snippet and description for trading decisions.
Return JSON ONLY with keys: event_type, polarity, confidence.
event_type ∈ ["fda_approval","fda_rejection","trial_result","earnings","safety_issue","partnership","other"].
polarity ∈ ["positive","neutral","negative"].
confidence: float between 0 and 1.
`;
  const userPrompt = `Headline: "${headline}"\nEntities: ${JSON.stringify(
    entities
  )}\n snippet: ${snippet}\n description: ${description}`;

  try {
    const resp = await cohere.chat({
      model: "command-r7b-12-2024",
      message: `${systemPrompt}\n${userPrompt}`,
      temperature: 0,
    });

    let raw = resp.text || "{}";

    // strip code fences
    raw = raw.replace(/```json\s*|```/g, "").trim();

    try {
      return JSON.parse(raw);
    } catch (err) {
      console.log("Failed to parse Cohere output:", raw);
      return { event_type: "other", polarity: "neutral", confidence: 0.0 };
    }
  } catch (err) {
    console.error("Cohere error:", err.message || err);
    return { event_type: "other", polarity: "neutral", confidence: 0.5 };
  }
}

// ---- NEW helper ----
async function fetchLatestNews() {
  try {
    const r = await axios.get("https://api.marketaux.com/v1/news/all", {
      params: {
        language: "en",
        filter_entities: true,
        limit: 10,
        symbols: pharmaSymbols.join(","), // <<< pass list here
        // you can add symbols: "AAPL" etc.
        api_token: MARKETAUX_KEY,
      },
    });
    return r.data?.data ?? [];
  } catch (err) {
    console.error("Marketaux err:", err.message);
    return [];
  }
}

//module.exports = runHiddenSpikeStrategy;
