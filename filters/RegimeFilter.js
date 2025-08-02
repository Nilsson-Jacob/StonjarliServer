const axios = require("axios");
const FRED_API_KEY = process.env.FRED_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// --- FRED-based regime determination ---
async function fetchFred(seriesId) {
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data } = await axios.get(
    "https://api.stlouisfed.org/fred/series/observations",
    {
      params: {
        series_id: seriesId,
        api_key: FRED_API_KEY,
        file_type: "json",
        observation_start: past,
        observation_end: today,
      },
    }
  );

  const obs = data.observations.filter((o) => o.value !== ".");
  const latest = parseFloat(obs.at(-1).value);
  const previous = parseFloat(obs.at(0).value);
  return { latest, previous };
}

async function getCurrentRegime() {
  const rateData = await fetchFred("DFF");
  const bsData = await fetchFred("WALCL");
  if (!rateData || !bsData) return "Q2";

  const rateUp = rateData.latest > rateData.previous;
  const bsUp = bsData.latest > bsData.previous;

  if (!rateUp && bsUp) return "Q1";
  if (!rateUp && !bsUp) return "Q2";
  if (rateUp && bsUp) return "Q3";
  return "Q4";
}

// --- Finnhub enrichment ---
async function enrichStockMetrics(stock) {
  try {
    const res = await axios.get("https://finnhub.io/api/v1/stock/metric", {
      params: { symbol: stock.symbol, metric: "all", token: FINNHUB_API_KEY },
    });
    const m = res.data.metric;
    return {
      peRatio: m.peNormalizedAnnual || null,
      revenueGrowth: m.revenueGrowthTTMYoy || null,
      debtRatio: m.totalDebt && m.ebitda ? m.totalDebt / m.ebitda : null,
    };
  } catch (err) {
    console.warn("Metric fetch failed for", stock.symbol, err.message);
    return { peRatio: null, revenueGrowth: null, debtRatio: null };
  }
}

// --- Growth classification ---
function classifyGrowthType(stock) {
  if (stock.revenueGrowth > 0.2 && stock.peRatio > 30) return "aggressive";
  if (stock.revenueGrowth > 0.1) return "moderate";
  return "value";
}

// --- Main filter function ---
async function regimeFilter(topPicks) {
  const regime = await getCurrentRegime();
  console.log("Detected regime:", regime);

  // Enrich each pick with metrics and class
  const enrichedList = [];
  for (const pick of topPicks) {
    const metrics = await enrichStockMetrics(pick);
    enrichedList.push({
      ...pick,
      ...metrics,
      growthType: classifyGrowthType(metrics),
    });
  }

  // Filter by regime logic
  let filtered;
  switch (regime) {
    case "Q1":
      filtered = enrichedList.filter((s) => s.growthType === "aggressive");
      break;
    case "Q4":
      filtered = enrichedList.filter((s) => s.debtRatio < 1 && s.peRatio < 15);
      break;
    default:
      filtered = enrichedList.filter(
        (s) => s.growthType === "moderate" || s.growthType === "value"
      );
  }

  console.log(`Filtered ${topPicks.length} → ${filtered.length}`);
  return filtered;
}

module.exports = regimeFilter;
