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

// Main function to detect and buy hidden spikes
export default async function runGoodNewsStrategy() {
  return checkSentiment("test");
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
      message: `Do a quick analysis of the SFM stock (Sprouts Farmers Market, Inc.), and tell me if the outlook is positive or negative, give it on a scale 1-10, 1 being very negative and 10 being very positive, support the claim with reasons.`,
      temperature: 0,
      max_tokens: 5, // same behavior as before
    });

    return response;
  } catch (err) {
    console.error("Cohere sentiment check failed:", err.message);
    return "neutral";
  }
}

//module.exports = runHiddenSpikeStrategy;
