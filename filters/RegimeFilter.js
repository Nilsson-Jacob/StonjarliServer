const axios = require("axios");

// Your FRED API key here
const FRED_API_KEY = "YOUR_FRED_API_KEY";

// Fetch latest value and value 3 months ago for a given series
async function fetchFredData(seriesId) {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  // 3 months ago
  const pastDate = new Date(today.setMonth(today.getMonth() - 3))
    .toISOString()
    .slice(0, 10);

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&observation_start=${pastDate}&observation_end=${endDate}`;

  try {
    const response = await axios.get(url);
    const observations = response.data.observations;

    // Find the latest valid observation (most recent non-null value)
    const latest = [...observations].reverse().find((obs) => obs.value !== ".");

    // Find the earliest valid observation (around 3 months ago)
    const earliest = observations.find((obs) => obs.value !== ".");

    return {
      latest: parseFloat(latest.value),
      past: parseFloat(earliest.value),
    };
  } catch (error) {
    console.error(`Failed to fetch FRED data for ${seriesId}`, error.message);
    return null;
  }
}

// Determine regime based on interest rate and balance sheet trends
async function getCurrentRegime() {
  const interestRateData = await fetchFredData("DFF"); // Fed Funds Effective Rate
  const balanceSheetData = await fetchFredData("WALCL"); // Fed Total Assets

  if (!interestRateData || !balanceSheetData) {
    console.warn("Using default regime Q2 due to missing data");
    return "Q2"; // Default fallback regime
  }

  const interestRateUp = interestRateData.latest > interestRateData.past;
  const balanceSheetUp = balanceSheetData.latest > balanceSheetData.past;

  // Regimes explained:
  // Q1: Interest rate down, balance sheet up (easy money, QE on)
  // Q2: Interest rate down, balance sheet down (rate cuts, no QE)
  // Q3: Interest rate up, balance sheet up (rate hikes with QE)
  // Q4: Interest rate up, balance sheet down (tightening)

  if (!interestRateUp && balanceSheetUp) return "Q1";
  if (!interestRateUp && !balanceSheetUp) return "Q2";
  if (interestRateUp && balanceSheetUp) return "Q3";
  if (interestRateUp && !balanceSheetUp) return "Q4";

  // fallback
  return "Q2";
}

// Classify growth type (same as before)
function classifyGrowthType(stock) {
  if (stock.revenueGrowth > 0.2 && stock.peRatio > 30) return "aggressive";
  if (stock.revenueGrowth > 0.1) return "moderate";
  return "value";
}

// Main filter function — async because of API calls
async function regimeFilter(stocks) {
  const regime = await getCurrentRegime();
  console.log(`Current Regime: ${regime}`);

  const enriched = stocks.map((stock) => ({
    ...stock,
    growthType: classifyGrowthType(stock),
  }));

  let filteredStocks;

  if (regime === "Q1") {
    filteredStocks = enriched.filter((s) => s.growthType === "aggressive");
  } else if (regime === "Q4") {
    filteredStocks = enriched.filter((s) => s.debtRatio < 1 && s.peRatio < 15);
  } else {
    filteredStocks = enriched.filter(
      (s) => s.growthType === "moderate" || s.growthType === "value"
    );
  }

  return filteredStocks.slice(0, 5);
}

module.exports = regimeFilter;
