import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReplayAvailability, runPointInTimeReplay } from "../lib/replay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const strategy = JSON.parse(await readFile(path.join(root, "config", "strategy-v0.1.json"), "utf8"));
const availability = await getReplayAvailability(dataDir);

if (!availability.fullPitStart || !availability.fullPitEnd) {
  console.log(JSON.stringify({ status: "WAITING_FOR_FULL_POINT_IN_TIME_RANGE", availability }, null, 2));
  process.exit(0);
}

const report = await runPointInTimeReplay(dataDir, strategy, { startAt: availability.fullPitStart, endAt: availability.fullPitEnd });
const failed = report.integrityChecks.filter((check) => !check.passed);
const audit = {
  status: failed.length ? "FAIL" : "PASS",
  engineVersion: report.engineVersion,
  range: report.requested,
  fullPointInTimeSnapshots: report.diagnostics.fullPointInTimeSnapshots,
  uniqueCandidates: report.candidates,
  maturedCandidates: report.maturedCandidates,
  actionableCandidates: report.actionableCandidates,
  independentActionableSignals: report.summary.independentSignals,
  integrityChecks: report.integrityChecks
};
console.log(JSON.stringify(audit, null, 2));
if (failed.length) process.exitCode = 1;
