import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "config", "strategy-v0.1.json"), "utf8"));
const predictions = JSON.parse(await readFile(path.join(root, "data", "latest-predictions.json"), "utf8"));
const checks = [];
const currentCandidates = (predictions.candidates ?? []).filter((candidate) => candidate.engineVersion === config.version);

function check(candidate, name, passed, actual, expected) {
  checks.push({ candidate: `${candidate.symbol}/${candidate.modelKey}`, name, passed: Boolean(passed), actual, expected });
}

const weightTotal = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
for (const candidate of currentCandidates) {
  const auditGroups = candidate.scoreAudit ?? {};
  const recalculated = Object.entries(config.weights).reduce((sum, [key, weight]) => sum + (candidate.scores?.[key] ?? 0) * weight / 100, 0);
  const auditTotal = Object.values(auditGroups).reduce((sum, group) => sum + (group.weightedContribution ?? 0), 0);
  const netRatio = candidate.netStopLossPct > 0 ? candidate.netTargetPctFeeCaseB / candidate.netStopLossPct : null;
  const componentTotalsValid = Object.values(auditGroups).every((group) => {
    const total = (group.components ?? []).reduce((sum, component) => sum + (component.points ?? 0), 0);
    const clamped = Math.max(0, Math.min(100, total));
    return Math.abs(clamped - group.score) <= 0.11;
  });
  const contributionsValid = Object.values(auditGroups).every((group) => Math.abs(group.score * group.weight / 100 - group.weightedContribution) <= 0.002);

  check(candidate, "Ağırlık toplamı", weightTotal === 100, weightTotal, 100);
  check(candidate, "Sekiz skor mevcut", Object.keys(candidate.scores ?? {}).length === 8, Object.keys(candidate.scores ?? {}).length, 8);
  check(candidate, "Skorlar 0–100 aralığında", Object.values(candidate.scores ?? {}).every((value) => Number.isFinite(value) && value >= 0 && value <= 100), candidate.scores, "Her değer 0–100");
  check(candidate, "Ağırlıklı toplam", Math.abs(recalculated - candidate.decisionScore) <= 0.11, Number(recalculated.toFixed(3)), candidate.decisionScore);
  check(candidate, "Denetim izi toplamı", Math.abs(auditTotal - candidate.decisionScore) <= 0.11, Number(auditTotal.toFixed(3)), candidate.decisionScore);
  check(candidate, "Alt kriter denetim izi", Object.keys(auditGroups).length === 8 && Object.values(auditGroups).every((group) => Array.isArray(group.components) && group.components.length > 0), Object.keys(auditGroups).length, 8);
  check(candidate, "Alt kriter toplamları", componentTotalsValid, componentTotalsValid, true);
  check(candidate, "Grup katkıları", contributionsValid, contributionsValid, true);
  check(candidate, "Maliyet sonrası risk/getiri", Number.isFinite(netRatio) && Math.abs(netRatio - candidate.riskReward) <= 0.002, Number.isFinite(netRatio) ? Number(netRatio.toFixed(3)) : null, candidate.riskReward);
  check(candidate, "Point-in-time sırası", candidate.dataLineage?.pointInTimeOrderValid === true, candidate.dataLineage?.pointInTimeOrderValid, true);
  check(candidate, "Sürüm eşleşmesi", candidate.engineVersion === config.version, candidate.engineVersion, config.version);
  check(candidate, "Kapalı pencere paper üretmez", candidate.signalWindow === "NOW" || candidate.finalDecision !== "PAPER_RESEARCH", `${candidate.signalWindow}/${candidate.finalDecision}`, "NOW veya paper değil");
  check(candidate, "Kalibrasyon öncesi olasılık yok", [candidate.pTargetFirst, candidate.pStopFirst, candidate.pTimeout].every((value) => value === null), [candidate.pTargetFirst, candidate.pStopFirst, candidate.pTimeout], [null, null, null]);
}

const failures = checks.filter((item) => !item.passed);
const report = {
  generatedAt: new Date().toISOString(),
  engineVersion: config.version,
  candidates: currentCandidates.length,
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  status: failures.length ? "FAIL" : currentCandidates.length ? "PASS" : "WAITING_FOR_CURRENT_VERSION_SIGNAL",
  failures
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
