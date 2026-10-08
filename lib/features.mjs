import { round } from "./metrics.mjs";

export function aggregateBars(bars, seconds = 300, cutoffEpoch = Math.floor(Date.now() / 1000)) {
  const buckets = new Map();
  for (const bar of bars) {
    if (!Number.isFinite(bar.timestamp) || bar.timestamp + 60 > cutoffEpoch) continue;
    const bucketStart = Math.floor(bar.timestamp / seconds) * seconds;
    if (bucketStart + seconds > cutoffEpoch) continue;
    const current = buckets.get(bucketStart) ?? {
      timestamp: bucketStart,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: 0,
      minuteCount: 0
    };
    if (Number.isFinite(bar.open) && current.minuteCount === 0) current.open = bar.open;
    if (Number.isFinite(bar.high)) current.high = Number.isFinite(current.high) ? Math.max(current.high, bar.high) : bar.high;
    if (Number.isFinite(bar.low)) current.low = Number.isFinite(current.low) ? Math.min(current.low, bar.low) : bar.low;
    if (Number.isFinite(bar.close)) current.close = bar.close;
    if (Number.isFinite(bar.volume)) current.volume += bar.volume;
    current.minuteCount += 1;
    buckets.set(bucketStart, current);
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function averageTrueRange(bars, periods = 14) {
  if (bars.length < periods + 1) return null;
  const sample = bars.slice(-(periods + 1));
  const ranges = [];
  for (let index = 1; index < sample.length; index += 1) {
    const bar = sample[index];
    const previousClose = sample[index - 1].close;
    if (![bar.high, bar.low, previousClose].every(Number.isFinite)) continue;
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }
  return ranges.length === periods ? ranges.reduce((sum, value) => sum + value, 0) / periods : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function buildMarketFeatures(chart, marketQuote, executionQuote, observedAt) {
  const observedEpoch = Math.floor(new Date(observedAt).getTime() / 1000);
  const regular = chart.meta?.currentTradingPeriod?.regular ?? null;
  const regularBars = regular
    ? chart.bars.filter((bar) => bar.timestamp >= regular.start && bar.timestamp <= regular.end)
    : chart.bars;
  const bars5m = aggregateBars(regularBars, 300, observedEpoch);
  const current = bars5m.at(-1) ?? null;
  const previous = bars5m.at(-2) ?? null;
  const atr5m = averageTrueRange(bars5m, 14);
  const recentSix = bars5m.slice(-7, -1);
  const low6 = recentSix.length === 6 ? Math.min(...recentSix.map((bar) => bar.low).filter(Number.isFinite)) : null;
  const previousTenVolumes = bars5m.slice(-11, -1).map((bar) => bar.volume).filter(Number.isFinite);
  const averageVolume10 = previousTenVolumes.length
    ? previousTenVolumes.reduce((sum, value) => sum + value, 0) / previousTenVolumes.length
    : null;
  const ret5m = current && Number.isFinite(current.open) && current.open !== 0 ? current.close / current.open - 1 : null;
  const ret15m = bars5m.length >= 4 && Number.isFinite(bars5m.at(-4).close)
    ? current.close / bars5m.at(-4).close - 1
    : null;
  const volumeRatio = current && Number.isFinite(averageVolume10) && averageVolume10 > 0
    ? current.volume / averageVolume10
    : null;
  const vwapDistancePct = Number.isFinite(current?.close) && Number.isFinite(marketQuote?.vwap) && marketQuote.vwap > 0
    ? current.close / marketQuote.vwap - 1
    : null;
  const minutesSinceOpen = regular ? Math.floor((observedEpoch - regular.start) / 60) : null;

  return {
    decisionAt: current ? new Date((current.timestamp + 300) * 1000).toISOString() : null,
    current5m: current,
    previous5m: previous,
    completed5mBars: bars5m.length,
    atr5m: round(atr5m),
    atr5mPct: Number.isFinite(atr5m) && Number.isFinite(current?.close) && current.close > 0 ? round(atr5m / current.close, 6) : null,
    structureLow6: round(low6),
    ret5m: round(ret5m, 6),
    ret15m: round(ret15m, 6),
    volumeRatio: round(volumeRatio, 3),
    vwap: marketQuote?.vwap ?? null,
    vwapDistancePct: round(vwapDistancePct, 6),
    reclaim: Boolean(previous && Number.isFinite(marketQuote?.vwap) && previous.close <= marketQuote.vwap && current.close > marketQuote.vwap),
    minutesSinceOpen,
    entryAsk: executionQuote?.ask ?? null,
    spreadBps: executionQuote?.spreadBps ?? null,
    quoteQuality: executionQuote?.qualityStatus ?? "MISSING",
    marketState: marketQuote?.marketState ?? "UNKNOWN",
    regularSessionEnd: regular?.end ? new Date(regular.end * 1000).toISOString() : null,
    priceScoreInputsReady: [current?.close, atr5m, low6, marketQuote?.vwap].every(Number.isFinite),
    boundedVolumeScore: Number.isFinite(volumeRatio) ? clamp(volumeRatio * 50) : null
  };
}
