import { REQUEST_TIMEOUT_MS } from "./config.mjs";

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (compatible; HedefOnce/0.1; local research)",
  "Referer": "https://www.nasdaq.com/"
};

export function parseMarketNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(",", "").replaceAll("$", "").replaceAll("%", "").trim();
  if (!normalized || normalized === "N/A" || normalized === "--") return null;
  const number = Number(normalized.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(number) ? number : null;
}

async function fetchNasdaqJson(pathname, allowEmpty = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.nasdaq.com${pathname}`, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.data) {
      if (allowEmpty) return null;
      throw new Error("Nasdaq boş yanıt");
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchNasdaqQuote(symbol, observedAt = new Date().toISOString()) {
  const data = await fetchNasdaqJson(`/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`);
  const primary = data.primaryData ?? {};
  const bid = parseMarketNumber(primary.bidPrice);
  const ask = parseMarketNumber(primary.askPrice);
  const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null;
  const spreadBps = Number.isFinite(mid) && mid > 0 ? ((ask - bid) / mid) * 10_000 : null;
  return {
    symbol,
    source: "nasdaq_public_quote",
    observedAt,
    availableAt: observedAt,
    availabilityBasis: "OBSERVED_LIVE",
    marketStatus: data.marketStatus ?? null,
    isRealTime: primary.isRealTime === true,
    last: parseMarketNumber(primary.lastSalePrice),
    bid,
    ask,
    bidSize: parseMarketNumber(primary.bidSize),
    askSize: parseMarketNumber(primary.askSize),
    spreadBps: Number.isFinite(spreadBps) ? Math.round(spreadBps * 100) / 100 : null,
    lastTradeTimestamp: primary.lastTradeTimestamp ?? null,
    qualityStatus: Number.isFinite(bid) && Number.isFinite(ask) && ask >= bid ? "VALID" : "MISSING"
  };
}

export async function fetchEconomicCalendar(date) {
  const data = await fetchNasdaqJson(`/api/calendar/economicevents?date=${encodeURIComponent(date)}`, true);
  const highImpact = /(cpi|consumer price|ppi|producer price|nonfarm|payroll|fomc|fed |interest rate|gdp|retail sales|unemployment|jobless|pce|employment change)/i;
  return (data?.rows ?? [])
    .filter((row) => row.country === "United States")
    .map((row) => ({
      type: "ECONOMIC",
      source: "nasdaq_public_calendar",
      date,
      timeGmt: row.gmt?.trim() || null,
      country: row.country,
      name: row.eventName,
      actual: row.actual?.trim() || null,
      consensus: row.consensus?.trim() || null,
      previous: row.previous?.trim() || null,
      impact: highImpact.test(row.eventName ?? "") ? "HIGH" : "NORMAL"
    }));
}

export async function fetchEarningsCalendar(date, symbols) {
  const data = await fetchNasdaqJson(`/api/calendar/earnings?date=${encodeURIComponent(date)}`, true);
  const wanted = new Set(symbols);
  return (data?.rows ?? [])
    .filter((row) => wanted.has(row.symbol))
    .map((row) => ({
      type: "EARNINGS",
      source: "nasdaq_public_calendar",
      date,
      symbol: row.symbol,
      name: row.name,
      timing: row.time,
      fiscalQuarterEnding: row.fiscalQuarterEnding,
      epsForecast: row.epsForecast?.trim() || null,
      estimateCount: parseMarketNumber(row.noOfEsts),
      impact: "HIGH"
    }));
}
