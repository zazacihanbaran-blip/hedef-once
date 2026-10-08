import {
  MARKET_SYMBOLS,
  MARKET_CONTEXT_SYMBOLS,
  MAX_PARALLEL_REQUESTS,
  MEMORY_SYMBOLS,
  SECTOR_SYMBOLS
} from "./config.mjs";
import { fetchYahooChart } from "./yahoo.mjs";
import { fetchNasdaqQuote } from "./nasdaq.mjs";
import { buildDataReadiness, summarizeBasket, summarizeChart } from "./metrics.mjs";

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function collectMarketSnapshot(store) {
  const observedAt = new Date().toISOString();
  const errors = [];
  const charts = [];
  const execution = {};

  await mapLimit(MARKET_SYMBOLS, MAX_PARALLEL_REQUESTS, async (instrument) => {
    try {
      charts.push(await fetchYahooChart(instrument.symbol));
    } catch (error) {
      errors.push({ symbol: instrument.symbol, message: error.message, observedAt });
    }
  });

  await Promise.all(["MU", "SNDK"].map(async (symbol) => {
    try {
      execution[symbol] = await fetchNasdaqQuote(symbol, observedAt);
    } catch (error) {
      errors.push({ symbol, layer: "execution", message: error.message, observedAt });
    }
  }));

  const quotes = Object.fromEntries(charts.map((chart) => [chart.symbol, summarizeChart(chart, observedAt)]));
  const required = MARKET_SYMBOLS.map((instrument) => instrument.symbol);
  const snapshot = {
    schemaVersion: "0.1.0",
    observedAt,
    sourceProfile: "NO_KEY_PUBLIC_RESEARCH",
    sourceNotice: "Anahtarsız ve garanti edilmeyen kamu erişimi. Gecikme ile eksikler arayüzde gösterilir.",
    quotes,
    execution,
    baskets: {
      memory: summarizeBasket(quotes, MEMORY_SYMBOLS),
      sector: summarizeBasket(quotes, SECTOR_SYMBOLS),
      marketContext: summarizeBasket(quotes, MARKET_CONTEXT_SYMBOLS)
    },
    readiness: buildDataReadiness(quotes, errors, required)
  };

  await store.saveCollection(snapshot, charts);
  return snapshot;
}
