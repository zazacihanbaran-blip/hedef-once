import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { evaluateTargetBeforeStop } from "./evaluator.mjs";
import { resolveDeadline, validSignalGeometry } from "./labeler.mjs";
import { round } from "./metrics.mjs";
import { generatePredictions } from "./predictor.mjs";

const CORE = ["MU", "SNDK"];

async function lines(filePath) {
  try { return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function records(directory) {
  try {
    const output = [];
    for (const file of (await readdir(directory)).sort()) {
      for (const line of await lines(path.join(directory, file))) output.push(JSON.parse(line));
    }
    return output.sort((a, b) => new Date(a.observedAt ?? a.eventAt) - new Date(b.observedAt ?? b.eventAt));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function safeSymbol(symbol) {
  return symbol.replaceAll("^", "IDX_").replaceAll("=", "_").replaceAll(".", "_");
}

function newYorkDay(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function latestAtOrBefore(items, asOf) {
  const limit = new Date(asOf).getTime();
  let selected = null;
  for (const item of items) {
    if (new Date(item.observedAt).getTime() <= limit) selected = item;
    else break;
  }
  return selected;
}

export function contextReady(context, asOf) {
  if (!context) return { ready: false, reason: "CONTEXT_NOT_CAPTURED", ageMinutes: null };
  const ageMinutes = (new Date(asOf) - new Date(context.observedAt)) / 60_000;
  const connected = context.readiness?.newsConnected && context.readiness?.filingsConnected && context.readiness?.calendarConnected;
  if (!connected) return { ready: false, reason: "CONTEXT_LAYER_INCOMPLETE", ageMinutes: round(ageMinutes, 1) };
  if (ageMinutes < 0 || ageMinutes > 45) return { ready: false, reason: "CONTEXT_TOO_OLD", ageMinutes: round(ageMinutes, 1) };
  return { ready: true, reason: null, ageMinutes: round(ageMinutes, 1) };
}

function snapshotReady(snapshot) {
  if (!snapshot || snapshot.readiness?.status !== "MARKET_LAYER_READY") return { ready: false, reason: "MARKET_LAYER_INCOMPLETE" };
  if (!CORE.every((symbol) => snapshot.quotes?.[symbol]?.marketState === "REGULAR")) return { ready: false, reason: "OUTSIDE_REGULAR_SESSION" };
  if (!CORE.every((symbol) => snapshot.execution?.[symbol]?.qualityStatus === "VALID")) return { ready: false, reason: "EXECUTION_LAYER_INCOMPLETE" };
  return { ready: true, reason: null };
}

function sessionBounds(allBars, day) {
  const regular = allBars.filter((bar) => bar.extendedHours === false && newYorkDay(bar.eventAt) === day);
  if (!regular.length) return null;
  const times = regular.map((bar) => new Date(bar.eventAt).getTime());
  return { start: Math.min(...times) / 1000, end: (Math.max(...times) + 60_000) / 1000 };
}

export function chartAt(symbol, allBars, asOf) {
  const asOfTime = new Date(asOf).getTime();
  const visible = allBars.filter((bar) => new Date(bar.eventAt).getTime() <= asOfTime && new Date(bar.availableAt).getTime() <= asOfTime && bar.qualityStatus === "VALID");
  const bounds = sessionBounds(allBars, newYorkDay(asOf));
  if (!visible.length || !bounds) return null;
  return {
    symbol,
    source: "point_in_time_replay",
    meta: { currentTradingPeriod: { regular: bounds } },
    bars: visible.map((bar) => ({
      timestamp: Math.floor(new Date(bar.eventAt).getTime() / 1000),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume
    }))
  };
}

function outcomeBars(allBars, entryAt) {
  const entryTime = new Date(entryAt).getTime();
  return allBars.filter((bar) => bar.availabilityBasis === "OBSERVED_LIVE" && bar.qualityStatus === "VALID"
    && bar.extendedHours !== true && new Date(bar.eventAt).getTime() > entryTime && new Date(bar.availableAt).getTime() >= entryTime);
}

function evaluateCandidate(candidate, allBars, latestObservedAt) {
  if (!validSignalGeometry(candidate)) return { status: "EXCLUDED", outcome: null, reason: "INVALID_OR_BLOCKED_POINT_IN_TIME_INPUT" };
  const bars = outcomeBars(allBars, candidate.entryAt);
  const deadlineAt = resolveDeadline(candidate, bars, new Date(latestObservedAt));
  if (!deadlineAt) return { status: "PENDING", outcome: null, reason: "OUTCOME_WINDOW_NOT_MATURE" };
  const result = evaluateTargetBeforeStop({ ...candidate, deadlineAt }, bars);
  if (result.outcome === "INVALID" || !Number.isFinite(result.exitPrice)) return { status: "EXCLUDED", outcome: null, reason: result.reason ?? "NO_EXECUTABLE_EXIT" };
  const grossReturn = result.exitPrice / candidate.entryPrice - 1;
  return {
    status: "MATURED", outcome: result.outcome, outcomeAt: result.outcomeAt, deadlineAt,
    exitPrice: result.exitPrice, grossReturn: round(grossReturn, 6), netReturn: round(grossReturn - candidate.frictionPct, 6),
    timeToOutcomeMinutes: round((new Date(result.outcomeAt) - new Date(candidate.entryAt)) / 60_000, 1),
    mae: round(result.mae, 6), mfe: round(result.mfe, 6), intrabarAmbiguous: result.intrabarAmbiguous
  };
}

export function primaryRows(rows) {
  const accepted = [];
  const blockedUntil = new Map();
  for (const row of rows.filter((item) => item.signalWindow === "NOW" && item.result.status === "MATURED").sort((a, b) => new Date(a.entryAt) - new Date(b.entryAt))) {
    const key = `${row.symbol}|${row.modelKey}`;
    const entry = new Date(row.entryAt).getTime();
    if (entry <= (blockedUntil.get(key) ?? -Infinity)) continue;
    accepted.push(row);
    blockedUntil.set(key, new Date(row.result.outcomeAt).getTime());
  }
  return accepted;
}

function summarize(rows) {
  const target = rows.filter((row) => row.result.outcome === "TARGET_FIRST").length;
  const stop = rows.filter((row) => row.result.outcome === "STOP_FIRST").length;
  const timeout = rows.filter((row) => row.result.outcome === "TIMEOUT").length;
  const returns = rows.map((row) => row.result.netReturn).filter(Number.isFinite);
  return {
    independentSignals: rows.length, targetFirst: target, stopFirst: stop, timeout,
    targetFirstRate: rows.length ? round(target / rows.length, 4) : null,
    averageNetReturn: returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length, 6) : null
  };
}

async function loadBars(dataDir) {
  return Object.fromEntries(await Promise.all(CORE.map(async (symbol) => [symbol, (await lines(path.join(dataDir, "bars", `${safeSymbol(symbol)}.ndjson`))).map(JSON.parse)])));
}

export async function getReplayAvailability(dataDir) {
  const snapshots = (await records(path.join(dataDir, "snapshots"))).filter((item) => Object.keys(item.quotes ?? {}).length);
  const contexts = await records(path.join(dataDir, "context"));
  const full = snapshots.filter((snapshot) => snapshotReady(snapshot).ready && contextReady(latestAtOrBefore(contexts, snapshot.observedAt), snapshot.observedAt).ready);
  return {
    timezone: "Europe/Istanbul",
    capturedStart: snapshots.at(0)?.observedAt ?? null,
    capturedEnd: snapshots.at(-1)?.observedAt ?? null,
    fullPitStart: full.at(0)?.observedAt ?? null,
    fullPitEnd: full.at(-1)?.observedAt ?? null,
    fullPitSnapshots: full.length,
    notice: "Yalnızca kolektörün o anda gerçekten gördüğü bütün katmanlar test edilebilir. Daha eski tarih için sonuç üretilmez. Replay sonuçları resmî forward sayacına eklenmez ve ağırlıkları otomatik değiştirmez."
  };
}

export async function runPointInTimeReplay(dataDir, strategy, { startAt, endAt }) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Başlangıç ve bitiş zamanı geçerli, sıralı bir aralık olmalı.");
  if (end - start > 31 * 24 * 60 * 60 * 1000) throw new Error("Tek test aralığı en fazla 31 gün olabilir.");

  const [allSnapshots, contexts, barsBySymbol] = await Promise.all([
    records(path.join(dataDir, "snapshots")), records(path.join(dataDir, "context")), loadBars(dataDir)
  ]);
  const latestObservedAt = [allSnapshots.at(-1)?.observedAt, ...Object.values(barsBySymbol).flat().map((bar) => bar.availableAt)].filter(Boolean).sort().at(-1);
  const capturedSnapshots = allSnapshots.filter((snapshot) => {
    const time = new Date(snapshot.observedAt);
    return time >= start && time <= end && Object.keys(snapshot.quotes ?? {}).length;
  });
  const firstByFiveMinuteDecision = new Map();
  for (const snapshot of capturedSnapshots) {
    const bucket = Math.floor(new Date(snapshot.observedAt).getTime() / 300_000) * 300_000;
    if (!firstByFiveMinuteDecision.has(bucket)) firstByFiveMinuteDecision.set(bucket, snapshot);
  }
  const snapshots = [...firstByFiveMinuteDecision.values()];
  const diagnostics = {
    capturedSnapshots: capturedSnapshots.length,
    consideredSnapshots: snapshots.length,
    fullPointInTimeSnapshots: 0,
    excludedByReason: {},
    duplicateDecisionBars: capturedSnapshots.length - snapshots.length
  };
  const candidates = new Map();

  for (const snapshot of snapshots) {
    const marketCheck = snapshotReady(snapshot);
    const context = latestAtOrBefore(contexts, snapshot.observedAt);
    const contextCheck = contextReady(context, snapshot.observedAt);
    const reason = marketCheck.reason ?? contextCheck.reason;
    if (reason) {
      diagnostics.excludedByReason[reason] = (diagnostics.excludedByReason[reason] ?? 0) + 1;
      continue;
    }
    const charts = CORE.map((symbol) => chartAt(symbol, barsBySymbol[symbol], snapshot.observedAt)).filter(Boolean);
    if (charts.length !== CORE.length) {
      diagnostics.excludedByReason.FEATURE_BARS_INCOMPLETE = (diagnostics.excludedByReason.FEATURE_BARS_INCOMPLETE ?? 0) + 1;
      continue;
    }
    diagnostics.fullPointInTimeSnapshots += 1;
    const prediction = await generatePredictions(snapshot, charts, context, strategy);
    for (const candidate of prediction.candidates) {
      if (candidates.has(candidate.candidateId)) diagnostics.duplicateDecisionBars += 1;
      else candidates.set(candidate.candidateId, { ...candidate, replayContextObservedAt: context.observedAt, replayContextAgeMinutes: contextCheck.ageMinutes });
    }
  }

  const rows = [...candidates.values()].map((candidate) => ({ ...candidate, result: evaluateCandidate(candidate, barsBySymbol[candidate.symbol], latestObservedAt) }));
  const primary = primaryRows(rows);
  const integrityChecks = [
    { name: "Gelecek bağlam kullanılmadı", passed: rows.every((row) => new Date(row.replayContextObservedAt) <= new Date(row.entryAt)) },
    { name: "Karar mumu girişten önce kapandı", passed: rows.every((row) => new Date(row.decisionAt) <= new Date(row.entryAt)) },
    { name: "Her karar kimliği tekil", passed: rows.length === new Set(rows.map((row) => row.candidateId)).size },
    { name: "Skor denetim toplamı tutarlı", passed: rows.every((row) => Math.abs(row.scoreAuditTotal - row.decisionScore) <= 0.11) },
    { name: "Sonuç zamanı girişten sonra", passed: rows.every((row) => row.result.status !== "MATURED" || new Date(row.result.outcomeAt) > new Date(row.entryAt)) }
  ];
  if (integrityChecks.some((check) => !check.passed)) throw new Error("Replay bütünlük kontrolü başarısız; sonuç yayımlanmadı.");
  return {
    generatedAt: new Date().toISOString(), engineVersion: strategy.version, mode: "STRICT_POINT_IN_TIME_REPLAY",
    requested: { startAt: start.toISOString(), endAt: end.toISOString() }, diagnostics,
    candidates: rows.length, maturedCandidates: rows.filter((row) => row.result.status === "MATURED").length,
    pendingCandidates: rows.filter((row) => row.result.status === "PENDING").length,
    actionableCandidates: rows.filter((row) => row.signalWindow === "NOW").length,
    summary: summarize(primary), integrityChecks,
    rows: rows.sort((a, b) => new Date(a.entryAt) - new Date(b.entryAt)),
    integrity: {
      featureBars: "5 dakikalık, eksiksiz ve karar anında erişilebilir",
      outcomeBars: "1 dakikalık, sonradan canlı gözlenmiş",
      context: "Karar anından önceki en yakın ve en fazla 45 dakikalık haber/SEC/takvim görüntüsü",
      duplicatePolicy: "Aynı tamamlanmış 5 dakikalık karar mumu bir kez",
      primaryPolicy: "Yalnızca NOW ve aynı sembol/modelde çakışmayan sinyaller"
    }
  };
}
