import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildForwardBacktestReport } from "../lib/backtest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const config = JSON.parse(await readFile(path.join(root, "config", "strategy-v0.1.json"), "utf8"));

async function readLines(filePath) {
  try {
    return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function listFiles(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const barFiles = await listFiles(path.join(dataDir, "bars"));
let bars = 0;
let liveBars = 0;
let backfilledBars = 0;
for (const file of barFiles) {
  for (const line of await readLines(path.join(dataDir, "bars", file))) {
    bars += 1;
    const record = JSON.parse(line);
    if (record.availabilityBasis === "OBSERVED_LIVE") liveBars += 1;
    if (record.availabilityBasis === "BACKFILL_OBSERVED_NOW") backfilledBars += 1;
  }
}

const signalFiles = await listFiles(path.join(dataDir, "signals"));
let signals = 0;
let calibratedProbabilities = 0;
const signalDays = new Set();
const signalsByVersion = {};
for (const file of signalFiles) {
  for (const line of await readLines(path.join(dataDir, "signals", file))) {
    signals += 1;
    const signal = JSON.parse(line);
    if (signal.decisionAt) signalDays.add(signal.decisionAt.slice(0, 10));
    signalsByVersion[signal.engineVersion ?? "unknown"] = (signalsByVersion[signal.engineVersion ?? "unknown"] ?? 0) + 1;
    if (Number.isFinite(signal.pTargetFirst)) calibratedProbabilities += 1;
  }
}

const contextFiles = await listFiles(path.join(dataDir, "context"));
let contextSnapshots = 0;
for (const file of contextFiles) contextSnapshots += (await readLines(path.join(dataDir, "context", file))).length;

const labelFiles = await listFiles(path.join(dataDir, "labels"));
let maturedLabels = 0;
for (const file of labelFiles) maturedLabels += (await readLines(path.join(dataDir, "labels", file))).length;

const capturePipelineReady = liveBars > 0 && contextSnapshots > 0 && signals > 0;
const forwardBacktest = await buildForwardBacktestReport(dataDir, config.version);
const objectiveBacktestReady = forwardBacktest.status === "READY_FOR_LOCKED_TEST";

const audit = {
  generatedAt: new Date().toISOString(),
  bars: { total: bars, observedLive: liveBars, backfilledObservedNow: backfilledBars },
  contextSnapshots,
  signals,
  signalDays: signalDays.size,
  signalsByVersion,
  maturedLabels,
  calibratedProbabilities,
  capturePipelineReady,
  objectiveBacktestReady,
  activeEngineVersion: config.version,
  forwardBacktest,
  minimumGate: { forwardTradingDays: 60, maturedSignals: 1000, actionableSignals: 100, perModelSignals: 300 },
  caveat: "Veri yakalama hattının çalışması performans kanıtı değildir. FULL_PIT backtest yalnızca kolektör başladıktan sonra canlı gözlenen veri aralığında iddia edilebilir; ilk indirmedeki geçmiş barlar geçmiş haber bilgisiyle birleştirilemez."
};

console.log(JSON.stringify(audit, null, 2));
