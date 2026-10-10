import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { evaluateTargetBeforeStop } from "./evaluator.mjs";
import { round } from "./metrics.mjs";

async function lines(filePath) {
  try {
    return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function files(directory) {
  try { return await readdir(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function safeSymbol(symbol) {
  return symbol.replaceAll("^", "IDX_").replaceAll("=", "_").replaceAll(".", "_");
}

function newYorkDay(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function validSignalGeometry(signal) {
  const timingValid = !signal.timePolicy || (
    Number.isFinite(signal.timePolicy.decisionDelaySeconds)
    && signal.timePolicy.decisionDelaySeconds >= 0
    && signal.timePolicy.decisionDelaySeconds <= signal.timePolicy.maximumDecisionDelaySeconds
    && signal.timePolicy.minutesToSessionClose >= signal.timePolicy.minimumMinutesToSessionClose
  );
  return timingValid && [signal.entryPrice, signal.targetPrice, signal.stopPrice].every((value) => Number.isFinite(value) && value > 0)
    && signal.targetPrice > signal.entryPrice && signal.stopPrice < signal.entryPrice
    && Number.isFinite(new Date(signal.entryAt).getTime())
    && signal.dataLineage?.marketState === "REGULAR"
    && signal.dataLineage?.quoteQuality === "VALID";
}

export function resolveDeadline(signal, bars, now = new Date()) {
  if (signal.deadlineAt) return new Date(signal.deadlineAt) <= now ? signal.deadlineAt : null;
  if (signal.deadlinePolicy !== "THIRD_RTH_CLOSE") return null;
  const entryTime = new Date(signal.entryAt).getTime();
  const sessions = new Map();
  for (const bar of bars) {
    const time = new Date(bar.eventAt ?? bar.timestamp).getTime();
    if (bar.availabilityBasis !== "OBSERVED_LIVE" || bar.extendedHours === true || !Number.isFinite(time) || time <= entryTime) continue;
    const day = newYorkDay(time);
    sessions.set(day, Math.max(sessions.get(day) ?? 0, time));
  }
  const ordered = [...sessions.entries()].sort(([a], [b]) => a.localeCompare(b));
  const holdingSessions = signal.maxHoldingSessions ?? 3;
  if (ordered.length < holdingSessions) return null;
  const deadline = ordered[holdingSessions - 1][1];
  return deadline <= now.getTime() ? new Date(deadline).toISOString() : null;
}

export async function labelMaturedSignals(dataDir, now = new Date()) {
  const signalDir = path.join(dataDir, "signals");
  const labelDir = path.join(dataDir, "labels");
  await mkdir(labelDir, { recursive: true });
  const existing = new Set();
  for (const file of await files(labelDir)) {
    for (const line of await lines(path.join(labelDir, file))) existing.add(JSON.parse(line).candidateId);
  }

  const barsBySymbol = new Map();
  const signals = [];
  for (const file of await files(signalDir)) {
    for (const line of await lines(path.join(signalDir, file))) signals.push(JSON.parse(line));
  }

  const labels = [];
  let excludedInvalid = 0;
  for (const signal of signals.filter((item) => !existing.has(item.candidateId))) {
    if (!validSignalGeometry(signal)) { excludedInvalid += 1; continue; }
    if (!barsBySymbol.has(signal.symbol)) {
      const barLines = await lines(path.join(dataDir, "bars", `${safeSymbol(signal.symbol)}.ndjson`));
      barsBySymbol.set(signal.symbol, barLines.map((line) => JSON.parse(line)));
    }
    const sourceBars = barsBySymbol.get(signal.symbol);
    const deadlineAt = resolveDeadline(signal, sourceBars, now);
    if (!deadlineAt) continue;
    const futureBars = sourceBars.filter((bar) => bar.availabilityBasis === "OBSERVED_LIVE"
      && bar.qualityStatus === "VALID" && bar.extendedHours !== true
      && new Date(bar.availableAt) >= new Date(signal.entryAt));
    const result = evaluateTargetBeforeStop({
      entryAt: signal.entryAt,
      entryPrice: signal.entryPrice,
      targetPrice: signal.targetPrice,
      stopPrice: signal.stopPrice,
      deadlineAt
    }, futureBars);
    if (result.outcome === "INVALID") { excludedInvalid += 1; continue; }
    if (result.outcome === "TIMEOUT" && !Number.isFinite(result.exitPrice)) continue;
    const grossReturn = result.exitPrice / signal.entryPrice - 1;
    labels.push({
      candidateId: signal.candidateId,
      engineVersion: signal.engineVersion,
      symbol: signal.symbol,
      modelKey: signal.modelKey,
      entryAt: signal.entryAt,
      deadlineAt,
      outcome: result.outcome,
      outcomeAt: result.outcomeAt,
      exitPrice: result.exitPrice,
      grossReturn: round(grossReturn, 6),
      netReturn: round(grossReturn - (signal.frictionPct ?? 0), 6),
      timeToOutcomeMinutes: round((new Date(result.outcomeAt) - new Date(signal.entryAt)) / 60_000, 2),
      mae: round(result.mae, 6),
      mfe: round(result.mfe, 6),
      intrabarAmbiguous: result.intrabarAmbiguous,
      evaluatedAt: now.toISOString(),
      labelQualityStatus: "VALID",
      evaluationVersion: "0.2.0-conservative"
    });
  }

  if (labels.length) {
    const groups = new Map();
    for (const label of labels) {
      const day = label.deadlineAt.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), label]);
    }
    for (const [day, dayLabels] of groups) {
      await appendFile(path.join(labelDir, `${day}.ndjson`), `${dayLabels.map((label) => JSON.stringify(label)).join("\n")}\n`, "utf8");
    }
  }
  return { evaluated: labels.length, excludedInvalid, labels };
}
