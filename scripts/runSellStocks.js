//const axios = require("axios");
import axios from "axios";
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
  trail_percent = "1",
}) => {
  try {
    const response = await alpaca.post("/v2/orders", {
      symbol,
      qty,
      side,
      type,
      time_in_force,
      trail_percent,
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
    //const response = await alpaca.get(`${BASE_URL}/v2/orders?status=closed`);
    const response = await alpaca.get("/v2/orders?status=filled");
    const aClosedOrders = response.data.filter(
      (order) => order.side === "buy" && order.filled_at
    );

    return aClosedOrders;
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    throw err;
  }
}

export default async function runSellStocks() {
  let aVerdict = [];
  let symbolMap;

  try {
    const aClosedOrders = await getBuyDate();
    const response = await alpaca.get("/v2/positions");
    const aPositions = response.data;

    if (aClosedOrders) {
      symbolMap = new Map(aClosedOrders.map((item) => [item.symbol, item]));
    }

    const todaysDate = new Date();

    // ✅ Use map instead of forEach
    const promises = aPositions.map(async (stock) => {
      const oMatch = symbolMap.get(stock.symbol);
      if (!oMatch) return;

      let buyDate = "";
      if (!oMatch.filled_at) {
        return;
      }

      buyDate = new Date(oMatch.filled_at);

      const sellDate = new Date(buyDate);
      sellDate.setDate(sellDate.getDate() + 5);

      const getMeOutDate = new Date(buyDate);
      getMeOutDate.setDate(getMeOutDate.getDate() + 60);

      const buyPrice = parseFloat(oMatch.filled_avg_price);
      const currentPrice = parseFloat(stock.current_price);
      const percentGain = ((currentPrice - buyPrice) / buyPrice) * 100;

      console.log("symbol going through the map: " + stock.symbol);

      if (getMeOutDate < todaysDate) {
        // Emergency sell
        await createOrder({
          symbol: stock.symbol,
          qty: Number(stock.qty),
          side: "sell",
          type: "market",
          time_in_force: "gtc",
        });

        console.log(
          `Emergency sell ${
            stock.symbol
          } (held > 60 days) - gain??: ${percentGain.toFixed(2)}%`
        );
        aVerdict.push(
          `Emergency sell ${
            stock.symbol
          } (held > 60 days) - gain??: ${percentGain.toFixed(2)}%`
        );
      } else if (sellDate < todaysDate) {
        // Sell if profit
        console.log("selldate < todaysDate: " + stock.symbol);

        if (percentGain >= 4) {
          await createOrder({
            symbol: stock.symbol,
            qty: Number(stock.qty),
            side: "sell",
            type: "trailing_stop",
            trail_percent: 2,
            time_in_force: "gtc",
          });

          console.log(`Set trailing stop for ${stock.symbol}`);
          aVerdict.push(
            `Trailing stop set for ${
              stock.symbol
            } - gain: ${percentGain.toFixed(2)}%`
          );
        } else {
          aVerdict.push(
            `Holding ${
              stock.symbol
            } - not enough profitable yet - gain?: ${percentGain.toFixed(2)}%`
          );
        }
      } else {
        aVerdict.push(
          `Hold ${
            stock.symbol
          } - still within holding period - gain:) ${percentGain.toFixed(2)}%`
        );
      }
    });

    await Promise.all(promises); // ✅ Now this works correctly

    return aVerdict;
  } catch (error) {
    console.error("Sell strategy failed:", error);
    return "there was error during sell";
  }
}

//module.exports = runSellStocks;
