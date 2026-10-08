import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTION_INTERVAL_MS, CONTEXT_INTERVAL_MS } from "./lib/config.mjs";
import { collectMarketSnapshot } from "./lib/collector.mjs";
import { collectContextSnapshot } from "./lib/context.mjs";
import { generatePredictions } from "./lib/predictor.mjs";
import { labelMaturedSignals } from "./lib/labeler.mjs";
import { PointInTimeStore } from "./lib/store.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const store = new PointInTimeStore(dataDir);
await store.init();

let latest = await store.loadLatest();
let latestContext = await store.loadLatestContext();
let latestPredictions = await store.loadLatestPredictions();
let latestCharts = null;
let collecting = null;
let collectingContext = null;

async function refresh() {
  if (collecting) return collecting;
  collecting = collectMarketSnapshot(store)
    .then(({ snapshot, charts }) => {
      latest = snapshot;
      latestCharts = charts;
      console.log(`[${snapshot.observedAt}] ${Object.keys(snapshot.quotes).length} piyasa serisi güncellendi.`);
      return snapshot;
    })
    .catch((error) => {
      console.error(`[${new Date().toISOString()}] Veri toplama hatası:`, error.message);
      throw error;
    })
    .finally(() => {
      collecting = null;
    });
  return collecting;
}

async function refreshPredictions() {
  if (!latest || !latestCharts) return latestPredictions;
  latestPredictions = await generatePredictions(latest, latestCharts, latestContext);
  await store.savePredictions(latestPredictions);
  await labelMaturedSignals(dataDir);
  return latestPredictions;
}

async function refreshContext() {
  if (collectingContext) return collectingContext;
  collectingContext = collectContextSnapshot(store)
    .then((context) => {
      latestContext = context;
      console.log(`[${context.observedAt}] Haber, SEC ve olay katmanları güncellendi.`);
      return context;
    })
    .catch((error) => {
      console.error(`[${new Date().toISOString()}] Bağlam toplama hatası:`, error.message);
      throw error;
    })
    .finally(() => {
      collectingContext = null;
    });
  return collectingContext;
}

if (process.argv.includes("--collect-once")) {
  await Promise.all([refresh(), refreshContext()]);
  await refreshPredictions();
  process.exit(0);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function serveStatic(requestPath, response) {
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const resolved = path.resolve(publicDir, relative);
  if (!resolved.startsWith(`${path.resolve(publicDir)}${path.sep}`) && resolved !== path.join(publicDir, "index.html")) {
    sendJson(response, 403, { error: "Yasak yol" });
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("Dosya değil");
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(resolved)] ?? "application/octet-stream" });
    response.end(await readFile(resolved));
  } catch {
    sendJson(response, 404, { error: "Bulunamadı" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: latest ? "running" : "starting",
      observedAt: latest?.observedAt ?? null,
      collecting: Boolean(collecting),
      collectingContext: Boolean(collectingContext),
      readiness: latest?.readiness ?? null,
      contextReadiness: latestContext?.readiness ?? null
    });
    return;
  }
  if (url.pathname === "/api/snapshot") {
    if (!latest) {
      try { await refresh(); } catch {}
    }
    if (!latest) {
      sendJson(response, 503, { error: "Henüz piyasa verisi alınamadı." });
      return;
    }
    sendJson(response, 200, { ...latest, context: latestContext, predictions: latestPredictions });
    return;
  }
  if (url.pathname === "/api/collect" && request.method === "POST") {
    try {
      const [market, context] = await Promise.all([refresh(), refreshContext()]);
      const predictions = await refreshPredictions();
      sendJson(response, 200, { ...market, context, predictions });
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return;
  }
  await serveStatic(url.pathname, response);
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`Hedef Önce: http://127.0.0.1:${port}`);
  Promise.all([refresh(), refreshContext()]).then(refreshPredictions).catch(() => {});
  setInterval(() => refresh().then(refreshPredictions).catch(() => {}), COLLECTION_INTERVAL_MS).unref();
  setInterval(() => refreshContext().then(refreshPredictions).catch(() => {}), CONTEXT_INTERVAL_MS).unref();
});
