function finite(values) {
  return values.filter(Number.isFinite);
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function average(values) {
  const usable = finite(values);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

export function summarizeChart(chart, observedAt) {
  const bars = chart.bars ?? [];
  const latest = bars.at(-1) ?? null;
  const meta = chart.meta ?? {};
  const marketTimestamp = latest?.timestamp ?? meta.regularMarketTime ?? null;
  const previousClose = Number.isFinite(meta.chartPreviousClose)
    ? meta.chartPreviousClose
    : Number.isFinite(meta.previousClose) ? meta.previousClose : null;
  const price = latest?.close ?? (Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null);
  const regular = meta.currentTradingPeriod?.regular ?? null;
  const pre = meta.currentTradingPeriod?.pre ?? null;
  const post = meta.currentTradingPeriod?.post ?? null;
  const nowSec = Math.floor(new Date(observedAt).getTime() / 1000);

  let marketState = "CLOSED";
  if (pre && nowSec >= pre.start && nowSec < pre.end) marketState = "PRE";
  if (regular && nowSec >= regular.start && nowSec <= regular.end) marketState = "REGULAR";
  if (post && nowSec > post.start && nowSec <= post.end) marketState = "POST";

  const sessionBars = regular
    ? bars.filter((bar) => bar.timestamp >= regular.start && bar.timestamp <= regular.end)
    : [];
  let priceVolume = 0;
  let totalVolume = 0;
  for (const bar of sessionBars) {
    if (![bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.volume <= 0) continue;
    priceVolume += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    totalVolume += bar.volume;
  }

  const changePct = Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0
    ? ((price / previousClose) - 1) * 100
    : null;
  const staleSeconds = marketTimestamp
    ? Math.max(0, Math.floor((new Date(observedAt).getTime() - marketTimestamp * 1000) / 1000))
    : null;

  return {
    symbol: chart.symbol,
    source: chart.source,
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    timezone: meta.exchangeTimezoneName ?? null,
    marketState,
    price: round(price),
    previousClose: round(previousClose),
    changePct: round(changePct, 3),
    marketTimestamp: marketTimestamp ? new Date(marketTimestamp * 1000).toISOString() : null,
    staleSeconds,
    sessionHigh: round(sessionBars.length ? Math.max(...finite(sessionBars.map((bar) => bar.high))) : null),
    sessionLow: round(sessionBars.length ? Math.min(...finite(sessionBars.map((bar) => bar.low))) : null),
    sessionVolume: round(sessionBars.reduce((sum, bar) => sum + (Number.isFinite(bar.volume) ? bar.volume : 0), 0), 0),
    vwap: totalVolume > 0 ? round(priceVolume / totalVolume) : null,
    barCount: bars.length,
    regularBarCount: sessionBars.length,
    qualityStatus: price === null || marketTimestamp === null ? "MISSING" : "VALID"
  };
}

export function summarizeBasket(quotes, symbols) {
  const members = symbols.map((symbol) => quotes[symbol]).filter(Boolean);
  const changes = members.map((quote) => quote.changePct).filter(Number.isFinite);
  const averageChangePct = average(changes);
  const positiveCount = changes.filter((value) => value > 0).length;
  const validCount = changes.length;
  let state = "UNKNOWN";
  if (validCount) {
    if (averageChangePct >= 0.4 && positiveCount / validCount >= 0.5) state = "POSITIVE";
    else if (averageChangePct <= -0.4 && positiveCount / validCount <= 0.5) state = "NEGATIVE";
    else state = "MIXED";
  }
  return {
    state,
    averageChangePct: round(averageChangePct, 3),
    positiveCount,
    validCount,
    requestedCount: symbols.length,
    coverage: symbols.length ? round(validCount / symbols.length, 3) : 0
  };
}

export function buildDataReadiness(quotes, errors, requiredSymbols) {
  const missing = requiredSymbols.filter((symbol) => !quotes[symbol] || quotes[symbol].qualityStatus !== "VALID");
  return {
    status: missing.length === 0 ? "MARKET_LAYER_READY" : "INCOMPLETE",
    scoringAllowed: missing.length === 0,
    reason: missing.length === 0
      ? "Fiyat katmanı hazır; haber, takvim ve execution katmanları ayrıca kontrol edilir."
      : "Zorunlu piyasa serilerinin bir bölümü eksik.",
    missingMarketSymbols: missing,
    requestErrors: errors,
    priceLayerCoverage: requiredSymbols.length
      ? round((requiredSymbols.length - missing.length) / requiredSymbols.length, 3)
      : 0
  };
}
