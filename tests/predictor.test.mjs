import test from "node:test";
import assert from "node:assert/strict";
import { aggregateBars } from "../lib/features.mjs";
import { evaluateTargetBeforeStop } from "../lib/evaluator.mjs";
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
});
