import { REQUEST_TIMEOUT_MS } from "./config.mjs";

const SOURCE = "yahoo_chart_public";

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function zipBars(result) {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  return timestamps.map((timestamp, index) => ({
    timestamp,
    open: numberOrNull(quote.open?.[index]),
    high: numberOrNull(quote.high?.[index]),
    low: numberOrNull(quote.low?.[index]),
    close: numberOrNull(quote.close?.[index]),
    volume: numberOrNull(quote.volume?.[index])
  })).filter((bar) => bar.close !== null);
}

export async function fetchYahooChart(symbol, options = {}) {
  const interval = options.interval ?? "1m";
  const range = options.range ?? "5d";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const params = new URLSearchParams({
    interval,
    range,
    includePrePost: "true",
    events: "div,splits"
  });
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "HedefOnce/0.1 local-research"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const result = payload.chart?.result?.[0];
    if (!result) {
      throw new Error(payload.chart?.error?.description ?? "Boş piyasa yanıtı");
    }
    return {
      source: SOURCE,
      symbol,
      meta: result.meta ?? {},
      bars: zipBars(result)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const yahooSourceName = SOURCE;

