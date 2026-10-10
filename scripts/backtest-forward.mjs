import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildForwardBacktestReport } from "../lib/backtest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "config", "strategy-v0.1.json"), "utf8"));
console.log(JSON.stringify(await buildForwardBacktestReport(path.join(root, "data"), config.version), null, 2));
