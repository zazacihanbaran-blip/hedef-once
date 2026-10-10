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
  const requiredMinutes = Math.max(1, Math.floor(seconds / 60));
  return [...buckets.values()].filter((bar) => bar.minuteCount >= requiredMinutes).sort((a, b) => a.timestamp - b.timestamp);
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

function exponentialAverage(values, periods) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  const alpha = 2 / (periods + 1);
  return usable.slice(1).reduce((ema, value) => alpha * value + (1 - alpha) * ema, usable[0]);
}

export function classifyEntryTiming(bars5m, vwap, targetPct = 0.01) {
  const current = bars5m.at(-1) ?? null;
  const previous = bars5m.at(-2) ?? null;
  const beforePrevious = bars5m.at(-3) ?? null;
  if (!current || bars5m.length < 6) return { state: "INSUFFICIENT", score: 0, reasons: [] };

  const closes = bars5m.map((bar) => bar.close);
  const ema3 = exponentialAverage(closes.slice(-8), 3);
  const ema8 = exponentialAverage(closes.slice(-16), 8);
  const previousEma3 = exponentialAverage(closes.slice(-9, -1), 3);
  const ret5m = current.open ? current.close / current.open - 1 : null;
  const ret15m = bars5m.at(-4)?.close ? current.close / bars5m.at(-4).close - 1 : null;
  const priorRet5m = previous?.open ? previous.close / previous.open - 1 : null;
  const range = current.high - current.low;
  const closeLocation = range > 0 ? (current.close - current.low) / range : 0.5;
  const recentLow = Math.min(...bars5m.slice(-6).map((bar) => bar.low).filter(Number.isFinite));
  const reboundFromRecentLowPct = Number.isFinite(recentLow) && recentLow > 0 ? current.close / recentLow - 1 : null;
  const distanceFromEma8Pct = Number.isFinite(ema8) && ema8 > 0 ? current.close / ema8 - 1 : null;
  const higherLow = Boolean(previous && beforePrevious && current.low > previous.low && previous.low >= beforePrevious.low);
  const priorHigh3 = Math.max(...bars5m.slice(-4, -1).map((bar) => bar.high).filter(Number.isFinite));
  const breakout3 = Number.isFinite(priorHigh3) && current.close > priorHigh3;
  const emaAligned = Number.isFinite(ema3) && Number.isFinite(ema8) && ema3 > ema8;
  const emaRising = Number.isFinite(ema3) && Number.isFinite(previousEma3) && ema3 > previousEma3;
  const aboveVwap = Number.isFinite(vwap) && current.close > vwap;
  const reversalCloseConfirmed = closeLocation >= 0.62 || (ret5m >= 0.0025 && reboundFromRecentLowPct >= 0.003);
  const reversalTrigger = ret5m >= 0.0015 && (priorRet5m <= 0 || ret15m < 0) && reversalCloseConfirmed && reboundFromRecentLowPct >= 0.002;
  const momentumTrigger = ret5m > 0 && ret15m > 0 && emaAligned && emaRising && closeLocation >= 0.55 && (higherLow || breakout3);
  const chasing = distanceFromEma8Pct > targetPct * 0.7 || ret15m > targetPct * 0.9 || reboundFromRecentLowPct > targetPct * 0.8;

  const reasons = [];
  if (reversalTrigger) reasons.push("5 dakikalık satış sonrası güçlü dönüş oluştu");
  if (momentumTrigger) reasons.push("kısa ortalama ve yükselen dip momentumu doğruluyor");
  if (breakout3) reasons.push("fiyat son üç mumun tepesini geçti");
  if (aboveVwap) reasons.push("fiyat VWAP üzerinde");
  if (chasing) return { state: "CHASING", score: 48, reasons: [...reasons, "fiyat kısa ortalamadan fazla uzaklaştı"], ema3: round(ema3), ema8: round(ema8), distanceFromEma8Pct: round(distanceFromEma8Pct, 6), reboundFromRecentLowPct: round(reboundFromRecentLowPct, 6), higherLow, breakout3, closeLocation: round(closeLocation, 3) };
  if (reversalTrigger) return { state: "REVERSAL_TRIGGER", score: 88, reasons, ema3: round(ema3), ema8: round(ema8), distanceFromEma8Pct: round(distanceFromEma8Pct, 6), reboundFromRecentLowPct: round(reboundFromRecentLowPct, 6), higherLow, breakout3, closeLocation: round(closeLocation, 3) };
  if (momentumTrigger) return { state: "MOMENTUM_TRIGGER", score: 92, reasons, ema3: round(ema3), ema8: round(ema8), distanceFromEma8Pct: round(distanceFromEma8Pct, 6), reboundFromRecentLowPct: round(reboundFromRecentLowPct, 6), higherLow, breakout3, closeLocation: round(closeLocation, 3) };
  if (ret5m > 0 && (emaRising || higherLow)) return { state: "PREPARE", score: 64, reasons: ["kısa vadeli toparlanma var, tetik henüz tamamlanmadı"], ema3: round(ema3), ema8: round(ema8), distanceFromEma8Pct: round(distanceFromEma8Pct, 6), reboundFromRecentLowPct: round(reboundFromRecentLowPct, 6), higherLow, breakout3, closeLocation: round(closeLocation, 3) };
  return { state: "WAIT", score: 28, reasons: ["5 dakikalık yön henüz yukarı dönmedi"], ema3: round(ema3), ema8: round(ema8), distanceFromEma8Pct: round(distanceFromEma8Pct, 6), reboundFromRecentLowPct: round(reboundFromRecentLowPct, 6), higherLow, breakout3, closeLocation: round(closeLocation, 3) };
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
  const atrPeriods = Math.min(14, bars5m.length - 1);
  const atr5m = atrPeriods >= 5 ? averageTrueRange(bars5m, atrPeriods) : null;
  const recentSix = bars5m.slice(-7, -1);
  const low6 = recentSix.length === 6 ? Math.min(...recentSix.map((bar) => bar.low).filter(Number.isFinite)) : null;
  const tacticalBars = bars5m.slice(-3);
  const tacticalLow3 = tacticalBars.length === 3 ? Math.min(...tacticalBars.map((bar) => bar.low).filter(Number.isFinite)) : null;
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
  const entryTiming = classifyEntryTiming(bars5m, marketQuote?.vwap, 0.01);

  return {
    decisionAt: current ? new Date((current.timestamp + 300) * 1000).toISOString() : null,
    current5m: current,
    previous5m: previous,
    completed5mBars: bars5m.length,
    atr5m: round(atr5m),
    atrPeriods,
    atr5mPct: Number.isFinite(atr5m) && Number.isFinite(current?.close) && current.close > 0 ? round(atr5m / current.close, 6) : null,
    structureLow6: round(low6),
    tacticalLow3: round(tacticalLow3),
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
    boundedVolumeScore: Number.isFinite(volumeRatio) ? clamp(volumeRatio * 50) : null,
    entryTiming
  };
}
