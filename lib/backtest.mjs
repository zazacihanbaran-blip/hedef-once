import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { average, round } from "./metrics.mjs";
import { validSignalGeometry } from "./labeler.mjs";

async function lines(filePath) {
  try { return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function records(directory) {
  try {
    const result = [];
    for (const file of await readdir(directory)) {
      for (const line of await lines(path.join(directory, file))) result.push(JSON.parse(line));
    }
    return result;
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(rows) {
  const counts = { TARGET_FIRST: 0, STOP_FIRST: 0, TIMEOUT: 0 };
  for (const row of rows) if (counts[row.outcome] !== undefined) counts[row.outcome] += 1;
  const returns = rows.map((row) => row.netReturn).filter(Number.isFinite);
  return {
    matured: rows.length,
    ...counts,
    targetFirstRate: rows.length ? round(counts.TARGET_FIRST / rows.length, 4) : null,
    decisiveTargetFirstRate: counts.TARGET_FIRST + counts.STOP_FIRST ? round(counts.TARGET_FIRST / (counts.TARGET_FIRST + counts.STOP_FIRST), 4) : null,
    averageNetReturn: round(average(returns), 6),
    medianNetReturn: round(median(returns), 6),
    averageTimeMinutes: round(average(rows.map((row) => row.timeToOutcomeMinutes)), 2),
    averageMae: round(average(rows.map((row) => row.mae)), 6),
    averageMfe: round(average(rows.map((row) => row.mfe)), 6)
  };
}

function group(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key] ?? "unknown"))].sort().map((value) => [value, summarize(rows.filter((row) => (row[key] ?? "unknown") === value))]));
}

function nonOverlappingActionable(rows) {
  const accepted = [];
  const blockedUntil = new Map();
  for (const row of [...rows].filter((item) => item.signalWindow === "NOW").sort((a, b) => new Date(a.entryAt) - new Date(b.entryAt))) {
    const key = `${row.symbol}|${row.modelKey}`;
    const entry = new Date(row.entryAt).getTime();
    if (entry <= (blockedUntil.get(key) ?? -Infinity)) continue;
    accepted.push(row);
    blockedUntil.set(key, new Date(row.outcomeAt).getTime());
  }
  return accepted;
}

export async function buildForwardBacktestReport(dataDir, engineVersion, now = new Date()) {
  const allSignals = await records(path.join(dataDir, "signals"));
  const allLabels = await records(path.join(dataDir, "labels"));
  const signals = allSignals.filter((signal) => signal.engineVersion === engineVersion);
  const eligible = signals.filter(validSignalGeometry);
  const signalById = new Map(eligible.map((signal) => [signal.candidateId, signal]));
  const invalidHistoricLabels = allLabels.filter((label) => !Number.isFinite(label.exitPrice) || !Number.isFinite(label.grossReturn));
  const rows = allLabels
    .filter((label) => label.engineVersion === engineVersion && label.labelQualityStatus === "VALID" && signalById.has(label.candidateId))
    .map((label) => ({ ...signalById.get(label.candidateId), ...label }));
  const days = new Set(eligible.map((signal) => newYorkDay(signal.decisionAt)));
  const actionableRows = nonOverlappingActionable(rows);
  const modelCounts = Object.fromEntries(["quick", "extended"].map((model) => [model, rows.filter((row) => row.modelKey === model).length]));
  const orderedDays = [...days].sort();
  const developmentEnd = Math.floor(orderedDays.length * 0.6);
  const validationEnd = Math.floor(orderedDays.length * 0.8);
  const embargoSessions = 3;
  const developmentDays = orderedDays.slice(0, Math.max(0, developmentEnd - embargoSessions));
  const validationDays = orderedDays.slice(developmentEnd, Math.max(developmentEnd, validationEnd - embargoSessions));
  const lockedTestDays = orderedDays.slice(validationEnd);
  const rowsForDays = (selectedDays) => rows.filter((row) => selectedDays.includes(newYorkDay(row.decisionAt)));
  const gate = {
    forwardTradingDays: { current: days.size, required: 60 },
    maturedValidLabels: { current: rows.length, required: 1000 },
    maturedActionableLabels: { current: actionableRows.length, required: 100 },
    perModelLabels: { current: modelCounts, requiredEach: 300 }
  };
  const ready = days.size >= 60 && rows.length >= 1000 && actionableRows.length >= 100
    && Object.values(modelCounts).every((count) => count >= 300);
  const lockedPrimaryRows = nonOverlappingActionable(rowsForDays(lockedTestDays));
  return {
    generatedAt: now.toISOString(),
    engineVersion,
    protocol: "FORWARD_ONLY_V0_2",
    status: ready ? "READY_FOR_LOCKED_TEST" : "COLLECTING",
    plainStatus: ready ? "Kilitli test için asgari veri tamamlandı" : "Tarafsız ileri test verisi birikiyor",
    legacy: { totalSignals: allSignals.length, totalLabels: allLabels.length, invalidLabelsExcluded: invalidHistoricLabels.length },
    current: { capturedSignals: signals.length, eligibleSignals: eligible.length, excludedSignals: signals.length - eligible.length, tradingDays: days.size, maturedLabels: rows.length, actionableMatured: actionableRows.length },
    gate,
    resultsHiddenUntilGate: !ready,
    scoreStatus: "WEIGHTS_ARE_FROZEN_HYPOTHESES_NOT_PROBABILITIES",
    scoreRisks: ["GROUP_SCALE_DIFFERENCES", "CORRELATED_INPUTS", "VETO_AND_SCORE_DOUBLE_COUNTING", "NEUTRAL_BASELINE_INFLATION"],
    split: {
      method: "CHRONOLOGICAL_60_20_20_WITH_3_SESSION_EMBARGO",
      development: { days: developmentDays.length, labels: rowsForDays(developmentDays).length },
      validation: { days: validationDays.length, labels: rowsForDays(validationDays).length },
      lockedTest: { days: lockedTestDays.length, labels: rowsForDays(lockedTestDays).length }
    },
    summary: ready ? summarize(lockedPrimaryRows) : null,
    byModel: ready ? group(lockedPrimaryRows, "modelKey") : {},
    bySymbol: ready ? group(lockedPrimaryRows, "symbol") : {},
    note: "Eski motor sürümleri, kapalı seans kayıtları ve geçersiz fiyat geometrisi bu sürümün sonucuna katılmaz. Sonuç oranları asgari kapı tamamlanana kadar gösterilmez."
  };
}

function newYorkDay(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
