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
  const news = await fetchLatestNews(); // <-- add this
  if (!news.length) return "no news";

  const top = news[0].title; // use latest headline

  let array = [];
  for (let i = 0; i < news.length; i++) {
    array.push(checkSentiment[news[i].title]);
  }

  return array;
  //return checkSentiment(top);
}

async function checkSentiment(headline) {
  try {
    /*const response = await cohere.chat({
      model: "command-r7b-12-2024", // Cohere’s best reasoning model
      message: `Classify the sentiment of this headline as "positive", "negative" or "neutral": "${headline}"`,
      temperature: 0,
    });*/

    const response = await cohere.chat({
      model: "command-r7b-12-2024", // replaces "command-r"
      message: `Do you think this headline will have a positive effect on stock price: ${headline} `,
      temperature: 0,
      //max_tokens: 5, // same behavior as before
    });

    return { AI: response, headline: headline };
  } catch (err) {
    return "err in sentiment check" + err.message;
  }
}

// ---- NEW helper ----
async function fetchLatestNews() {
  try {
    const r = await axios.get("https://api.marketaux.com/v1/news/all", {
      params: {
        language: "en",
        filter_entities: true,
        limit: 3,
        symbols: symbols.join(","), // <<< pass list here
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
