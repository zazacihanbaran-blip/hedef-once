import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

async function atomicJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function safeSymbol(symbol) {
  return symbol.replaceAll("^", "IDX_").replaceAll("=", "_").replaceAll(".", "_");
}

export class PointInTimeStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, "state.json");
    this.latestPath = path.join(dataDir, "latest.json");
    this.latestContextPath = path.join(dataDir, "latest-context.json");
    this.latestPredictionsPath = path.join(dataDir, "latest-predictions.json");
    this.state = null;
  }

  async init() {
    await ensureDir(this.dataDir);
    this.state = await readJson(this.statePath, { lastBarTimestamp: {} });
  }

  async loadLatest() {
    const latest = await readJson(this.latestPath, null);
    if (latest && Object.keys(latest.quotes ?? {}).length) return latest;
    try {
      const snapshotDir = path.join(this.dataDir, "snapshots");
      const files = (await readdir(snapshotDir)).sort().reverse();
      for (const file of files) {
        const records = (await readFile(path.join(snapshotDir, file), "utf8")).split(/\r?\n/).filter(Boolean).reverse();
        for (const line of records) {
          const snapshot = JSON.parse(line);
          if (Object.keys(snapshot.quotes ?? {}).length) return snapshot;
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return latest;
  }

  async loadLatestContext() {
    return readJson(this.latestContextPath, null);
  }

  async loadLatestPredictions() {
    const latest = await readJson(this.latestPredictionsPath, null);
    if (latest?.candidates?.length) return latest;
    try {
      const signalDir = path.join(this.dataDir, "signals");
      const files = (await readdir(signalDir)).sort().reverse();
      for (const file of files) {
        const signals = (await readFile(path.join(signalDir, file), "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse);
        const generatedAt = signals.at(-1)?.generatedAt;
        if (generatedAt) {
          const candidates = signals.filter((signal) => signal.generatedAt === generatedAt);
          return { generatedAt, engineVersion: candidates[0]?.engineVersion, mode: candidates[0]?.mode, candidates };
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return latest;
  }

  async savePredictions(predictions) {
    const day = predictions.generatedAt.slice(0, 10);
    const predictionDir = path.join(this.dataDir, "signals");
    await ensureDir(predictionDir);
    const seen = new Set(this.state?.signalIds ?? []);
    const fresh = predictions.candidates.filter((candidate) => !seen.has(candidate.candidateId));
    if (fresh.length) {
      await appendFile(path.join(predictionDir, `${day}.ndjson`), `${fresh.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
      this.state.signalIds = [...seen, ...fresh.map((candidate) => candidate.candidateId)].slice(-5000);
      await atomicJson(this.statePath, this.state);
    }
    await atomicJson(this.latestPredictionsPath, predictions);
  }

  async saveContext(context) {
    const day = context.observedAt.slice(0, 10);
    const contextDir = path.join(this.dataDir, "context");
    await ensureDir(contextDir);
    await appendFile(path.join(contextDir, `${day}.ndjson`), `${JSON.stringify(context)}\n`, "utf8");
    await atomicJson(this.latestContextPath, context);
  }

  async saveCollection(snapshot, charts) {
    if (!this.state) await this.init();
    const day = snapshot.observedAt.slice(0, 10);
    const snapshotDir = path.join(this.dataDir, "snapshots");
    await ensureDir(snapshotDir);
    await appendFile(path.join(snapshotDir, `${day}.ndjson`), `${JSON.stringify(snapshot)}\n`, "utf8");

    for (const chart of charts) {
      const lastSaved = this.state.lastBarTimestamp[chart.symbol] ?? 0;
      const newBars = chart.bars.filter((bar) => bar.timestamp > lastSaved);
      if (!newBars.length) continue;
      const barDir = path.join(this.dataDir, "bars");
      await ensureDir(barDir);
      const regular = chart.meta?.currentTradingPeriod?.regular ?? null;
      const lines = newBars.map((bar) => JSON.stringify({
        instrumentId: chart.symbol,
        symbol: chart.symbol,
        sourceId: chart.source,
        eventAt: new Date(bar.timestamp * 1000).toISOString(),
        availableAt: snapshot.observedAt,
        ingestedAt: snapshot.observedAt,
        availabilityBasis: bar.timestamp < Math.floor(new Date(snapshot.observedAt).getTime() / 1000) - 120
          ? "BACKFILL_OBSERVED_NOW"
          : "OBSERVED_LIVE",
        qualityStatus: "VALID",
        extendedHours: regular ? bar.timestamp < regular.start || bar.timestamp > regular.end : null,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      })).join("\n");
      await appendFile(path.join(barDir, `${safeSymbol(chart.symbol)}.ndjson`), `${lines}\n`, "utf8");
      this.state.lastBarTimestamp[chart.symbol] = newBars.at(-1).timestamp;
    }

    if (Object.keys(snapshot.quotes ?? {}).length) await atomicJson(this.latestPath, snapshot);
    await atomicJson(this.statePath, this.state);
  }
}
