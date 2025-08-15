const axios = require("axios");
const BASE_URL = "https://finnhub.io/api/v1";

const alpaca = axios.create({
  baseURL: process.env.ALPACA_BASE_URL,
  headers: {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET,
  },
});

const createOrder = async ({
  symbol,
  qty,
  side = "sell",
  type = "market",
  time_in_force = "gtc",
}) => {
  try {
    const response = await alpaca.post("/v2/orders", {
      symbol,
      qty,
      side,
      type,
      time_in_force,
    });

    console.log(`✅ Order placed: ${side.toUpperCase()} ${qty} ${symbol}`);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Failed to place order:",
      error?.response?.data || error.message
    );
  }
};

// Utility: Get latest buy order fill date for a symbol
async function getBuyDate() {
  const BASE_URL = process.env.ALPACA_BASE_URL;

  try {
    const response = await alpaca.get(`${BASE_URL}/v2/orders?status=closed`);

    return response.data;
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    throw err;
  }
}

async function runSellStocks() {
  let aSold = [];

  try {
    const aClosedOrders = await getBuyDate();
    const response = await alpaca.get("/v2/positions");

    const aPositions = response.data;

    if (aClosedOrders) {
      symbolMap = new Map(aClosedOrders.map((item) => [item.symbol, item]));
    }

    let buyDate;
    const todaysDate = new Date();

    aPositions.forEach(async (stock) => {
      const oMatch = symbolMap.get(stock.symbol);
      if (oMatch) {
        buyDate = oMatch.filled_at.substring(0, 10);

        // Create sellDate = buyDate + 5 days
        const sellDate = new Date(buyDate);
        sellDate.setDate(sellDate.getDate() + 5);

        // Create sellDate = buyDate + 5 days
        const getMeOutDate = new Date(buyDate);
        getMeOutDate.setDate(sellDate.getDate() + 60);

        if (getMeOutDate < todaysDate) {
          // Sell ASAP
          await createOrder({
            symbol: stock.symbol,
            qty: stock.qty,
            side: "sell",
            type: "market",
            time_in_force: "gtc",
          });

          console.log(`Emergency sell ${stock.symbol} (held > 60 days)`);
          aSold.push(`Emergency sell ${stock.symbol} (held > 60 days)`);
        } else if (sellDate < todaysDate) {
          // Sell if profit by 5%
          const buyPrice = parseFloat(oMatch.filled_avg_price);
          const currentPrice = parseFloat(stock.current_price);

          const percentGain = ((currentPrice - buyPrice) / buyPrice) * 100;

          if (percentGain >= 5) {
            await createOrder({
              symbol: stock.symbol,
              qty: stock.qty,
              side: "sell",
              type: "market",
              time_in_force: "gtc",
            });

            console.log(`Selling ${stock.symbol} for profit`);
            aSold.push(
              `Selling ${stock.symbol} for profit. Gain: ${percentGain}%`
            );
          } else {
            console.log(`Holding ${stock.symbol} - not profitable yet`);
          }
        } else {
          // date limit do not sell?'
          console.log(`Hold ${stock.symbol} - still within holding period`);
        }
      }
    });

    return aSold;
  } catch (error) {
    return "there was error during sell";
  }
}

module.exports = runSellStocks;
