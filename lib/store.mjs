import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    this.state = null;
  }

  async init() {
    await ensureDir(this.dataDir);
    this.state = await readJson(this.statePath, { lastBarTimestamp: {} });
  }

  async loadLatest() {
    return readJson(this.latestPath, null);
  }

  async loadLatestContext() {
    return readJson(this.latestContextPath, null);
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

    await atomicJson(this.latestPath, snapshot);
    await atomicJson(this.statePath, this.state);
  }
}
