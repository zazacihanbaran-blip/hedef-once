import test from "node:test";
import assert from "node:assert/strict";
import { aggregateBars, classifyEntryTiming } from "../lib/features.mjs";
import { evaluateTargetBeforeStop } from "../lib/evaluator.mjs";
import { resolveDeadline, validSignalGeometry } from "../lib/labeler.mjs";
import { chartAt, contextReady, latestAtOrBefore, primaryRows } from "../lib/replay.mjs";
import { generatePredictions } from "../lib/predictor.mjs";

test("tamamlanmamış 5 dakikalık bar feature'a girmez", () => {
  const bars = Array.from({ length: 11 }, (_, index) => ({
    timestamp: 1_000 + index * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10
  }));
  const grouped = aggregateBars(bars, 300, 1_601);
  assert.ok(grouped.every((bar) => bar.timestamp + 300 <= 1_601));
});

test("satış sonrası güçlü 5 dakikalık dönüş yakın giriş tetiği sayılır", () => {
  const closes = [100.1, 100.05, 100, 99.96, 99.93, 99.9, 99.86];
  const bars = closes.map((close, index) => ({
    timestamp: 1_000 + index * 300,
    open: index === closes.length - 1 ? 99.92 : close + 0.03,
    high: close + 0.08,
    low: close - 0.08,
    close,
    volume: 1_000
  }));
  bars.push({ timestamp: 3_100, open: 99.86, high: 100.28, low: 99.82, close: 100.24, volume: 1_500 });
  const timing = classifyEntryTiming(bars, 100.4, 0.01);
  assert.equal(timing.state, "REVERSAL_TRIGGER");
  assert.ok(timing.score >= 80);
});

test("aynı barda hedef ve stop teması konservatif olarak stop sayılır", () => {
  const result = evaluateTargetBeforeStop({
    entryAt: "2026-10-08T14:00:00.000Z",
    entryPrice: 100,
    targetPrice: 101,
    stopPrice: 99.4,
    deadlineAt: "2026-10-08T20:00:00.000Z"
  }, [{ eventAt: "2026-10-08T14:01:00.000Z", high: 101.2, low: 99.2 }]);
  assert.equal(result.outcome, "STOP_FIRST");
  assert.equal(result.intrabarAmbiguous, true);
});

test("timeout sıfır getiri varsaymak yerine son uygulanabilir kapanışı taşır", () => {
  const result = evaluateTargetBeforeStop({
    entryAt: "2026-10-08T14:00:00.000Z",
    entryPrice: 100,
    targetPrice: 101,
    stopPrice: 99.4,
    deadlineAt: "2026-10-08T14:03:00.000Z"
  }, [
    { eventAt: "2026-10-08T14:01:00.000Z", high: 100.4, low: 99.8, close: 100.2 },
    { eventAt: "2026-10-08T14:03:00.000Z", high: 100.5, low: 99.9, close: 100.35 }
  ]);
  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.exitPrice, 100.35);
});

test("boş hedef fiyatı başarı sayılmaz", () => {
  const result = evaluateTargetBeforeStop({
    entryAt: "2026-10-08T14:00:00.000Z", entryPrice: 100, targetPrice: null, stopPrice: 99.4,
    deadlineAt: "2026-10-08T20:00:00.000Z"
  }, [{ eventAt: "2026-10-08T14:01:00.000Z", high: 100.2, low: 99.8 }]);
  assert.equal(result.outcome, "INVALID");
});

test("kapalı seans veya geçersiz fiyat geometrisi backteste girmez", () => {
  assert.equal(validSignalGeometry({ entryAt: "2026-10-08T14:00:00Z", entryPrice: 100, targetPrice: 101, stopPrice: 99, dataLineage: { marketState: "CLOSED", quoteQuality: "VALID" } }), false);
  assert.equal(validSignalGeometry({ entryAt: "2026-10-08T14:00:00Z", entryPrice: 100, targetPrice: 101, stopPrice: 99, dataLineage: { marketState: "REGULAR", quoteQuality: "VALID" } }), true);
  assert.equal(validSignalGeometry({
    entryAt: "2026-10-08T14:00:00Z", entryPrice: 100, targetPrice: 101, stopPrice: 99,
    dataLineage: { marketState: "REGULAR", quoteQuality: "VALID" },
    timePolicy: { decisionDelaySeconds: 91, maximumDecisionDelaySeconds: 90, minutesToSessionClose: 100, minimumMinutesToSessionClose: 60 }
  }), false);
});

test("geniş model üçüncü gözlenen normal seansın sonunda olgunlaşır", () => {
  const signal = { entryAt: "2026-10-08T14:00:00Z", deadlineAt: null, deadlinePolicy: "THIRD_RTH_CLOSE", maxHoldingSessions: 3 };
  const bars = [
    ["2026-10-08T19:59:00Z", "2026-10-08T20:00:00Z"],
    ["2026-10-09T19:59:00Z", "2026-10-09T20:00:00Z"],
    ["2026-10-12T19:59:00Z", "2026-10-12T20:00:00Z"]
  ].flat().map((eventAt) => ({ eventAt, availableAt: eventAt, availabilityBasis: "OBSERVED_LIVE", extendedHours: false }));
  assert.equal(resolveDeadline(signal, bars, new Date("2026-10-12T21:00:00Z")), "2026-10-12T20:00:00.000Z");
});

test("zaman makinesi gelecekte alınan bağlamı ve barı göremez", () => {
  const contexts = [
    { observedAt: "2026-10-08T14:00:00Z", id: "past" },
    { observedAt: "2026-10-08T14:30:00Z", id: "future" }
  ];
  assert.equal(latestAtOrBefore(contexts, "2026-10-08T14:15:00Z").id, "past");
  const bars = [
    { eventAt: "2026-10-08T13:30:00Z", availableAt: "2026-10-08T13:31:00Z", extendedHours: false, qualityStatus: "VALID", open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { eventAt: "2026-10-08T13:31:00Z", availableAt: "2026-10-08T14:20:00Z", extendedHours: false, qualityStatus: "VALID", open: 100, high: 101, low: 99, close: 100, volume: 1 }
  ];
  const chart = chartAt("MU", bars, "2026-10-08T14:15:00Z");
  assert.equal(chart.bars.length, 1);
});

test("eski bağlam reddedilir ve çakışan sinyal ana sonuçta bir kez sayılır", () => {
  const context = { observedAt: "2026-10-08T14:00:00Z", readiness: { newsConnected: true, filingsConnected: true, calendarConnected: true } };
  assert.equal(contextReady(context, "2026-10-08T14:46:00Z").ready, false);
  const base = { symbol: "MU", modelKey: "quick", signalWindow: "NOW", result: { status: "MATURED", outcomeAt: "2026-10-08T15:00:00Z" } };
  const selected = primaryRows([
    { ...base, entryAt: "2026-10-08T14:10:00Z" },
    { ...base, entryAt: "2026-10-08T14:20:00Z", result: { ...base.result, outcomeAt: "2026-10-08T15:10:00Z" } }
  ]);
  assert.equal(selected.length, 1);
});

test("canlı araştırma motoru olasılık uydurmaz", async () => {
  const observed = new Date("2026-10-08T16:00:00.000Z");
  const regularStart = Math.floor(new Date("2026-10-08T13:30:00.000Z").getTime() / 1000);
  const bars = Array.from({ length: 150 }, (_, index) => {
    const close = 100 + index * 0.01;
    return { timestamp: regularStart + index * 60, open: close - 0.01, high: close + 0.06, low: close - 0.06, close, volume: 1000 + index };
  });
  const charts = ["MU", "SNDK"].map((symbol) => ({
    symbol,
    meta: { currentTradingPeriod: { regular: { start: regularStart, end: regularStart + 390 * 60 } } },
    bars
  }));
  const quote = { price: 101.49, vwap: 100.8, changePct: 1, marketState: "REGULAR", qualityStatus: "VALID" };
  const snapshot = {
    observedAt: observed.toISOString(),
    quotes: { MU: quote, SNDK: quote, QQQ: { changePct: 1 }, SPY: { changePct: 0.6 }, "^VIX": { changePct: -2 } },
    execution: { MU: { ask: 101.5, spreadBps: 1, qualityStatus: "VALID" }, SNDK: { ask: 101.5, spreadBps: 1, qualityStatus: "VALID" } },
    baskets: { memory: { state: "POSITIVE", averageChangePct: 0.5, coverage: 1 }, sector: { state: "POSITIVE", averageChangePct: 0.4, coverage: 1 } }
  };
  const context = { news: [], events: [], readiness: { newsConnected: true, calendarConnected: true } };
  const predictions = await generatePredictions(snapshot, charts, context);
  assert.equal(predictions.candidates.length, 4);
  assert.ok(predictions.candidates.every((candidate) => candidate.pTargetFirst === null));
  assert.ok(predictions.candidates.every((candidate) => candidate.mode === "RESEARCH_ONLY"));
  assert.ok(predictions.candidates.every((candidate) => candidate.userGuidance?.action));
  assert.ok(predictions.candidates.every((candidate) => Array.isArray(candidate.userGuidance?.waitFor)));
  assert.ok(predictions.candidates.every((candidate) => candidate.signalWindow));
  assert.ok(predictions.candidates.every((candidate) => candidate.riskLevel));
  assert.ok(predictions.candidates.every((candidate) => candidate.signalWindow === "NOW" || candidate.finalDecision !== "PAPER_RESEARCH"));
  assert.ok(predictions.candidates.every((candidate) => candidate.cycleAnalysis?.label));
  assert.ok(predictions.candidates.every((candidate) => candidate.cycleAnalysis?.nextCondition));
  assert.ok(predictions.candidates.every((candidate) => Array.isArray(candidate.cycleAnalysis?.evidence)));
  assert.ok(predictions.candidates.every((candidate) => Object.keys(candidate.scoreAudit ?? {}).length === 8));
  assert.ok(predictions.candidates.every((candidate) => candidate.riskReward < candidate.grossRiskReward));
  assert.ok(predictions.candidates.every((candidate) => candidate.dataLineage?.pointInTimeOrderValid === true));
  assert.ok(predictions.candidates.every((candidate) => candidate.timePolicy?.featureBarMinutes === 5));
  assert.ok(predictions.candidates.every((candidate) => candidate.timePolicy?.outcomeBarMinutes === 1));
});
