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

  const matured = signals.filter((signal) => signal.deadlineAt && new Date(signal.deadlineAt) <= now && !existing.has(signal.candidateId));
  const labels = [];
  for (const signal of matured) {
    if (!barsBySymbol.has(signal.symbol)) {
      const barLines = await lines(path.join(dataDir, "bars", `${safeSymbol(signal.symbol)}.ndjson`));
      barsBySymbol.set(signal.symbol, barLines.map((line) => JSON.parse(line)));
    }
    const futureBars = barsBySymbol.get(signal.symbol).filter((bar) => bar.availabilityBasis === "OBSERVED_LIVE" && new Date(bar.availableAt) >= new Date(signal.entryAt));
    const result = evaluateTargetBeforeStop({
      entryAt: signal.entryAt,
      entryPrice: signal.entryPrice,
      targetPrice: signal.targetPrice,
      stopPrice: signal.stopPrice,
      deadlineAt: signal.deadlineAt
    }, futureBars);
    if (result.outcome === "TIMEOUT" && !Number.isFinite(result.exitPrice)) continue;
    labels.push({
      candidateId: signal.candidateId,
      engineVersion: signal.engineVersion,
      symbol: signal.symbol,
      modelKey: signal.modelKey,
      entryAt: signal.entryAt,
      deadlineAt: signal.deadlineAt,
      outcome: result.outcome,
      outcomeAt: result.outcomeAt,
      exitPrice: result.exitPrice,
      grossReturn: round(result.exitPrice / signal.entryPrice - 1, 6),
      mae: round(result.mae, 6),
      mfe: round(result.mfe, 6),
      intrabarAmbiguous: result.intrabarAmbiguous,
      evaluatedAt: now.toISOString(),
      evaluationVersion: "0.1.0-conservative"
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
  return { evaluated: labels.length, labels };
}
