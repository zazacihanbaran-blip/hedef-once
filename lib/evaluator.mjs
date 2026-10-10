export function evaluateTargetBeforeStop({ entryAt, entryPrice, targetPrice, stopPrice, deadlineAt }, bars) {
  const entryTime = new Date(entryAt).getTime();
  const deadline = new Date(deadlineAt).getTime();
  const validGeometry = Number.isFinite(entryTime) && Number.isFinite(deadline) && deadline > entryTime
    && [entryPrice, targetPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)
    && targetPrice > entryPrice && stopPrice < entryPrice;
  if (!validGeometry) {
    return { outcome: "INVALID", reason: "INVALID_SIGNAL_GEOMETRY", outcomeAt: null, exitPrice: null, intrabarAmbiguous: false, mae: null, mfe: null };
  }
  let mae = 0;
  let mfe = 0;
  for (const bar of bars) {
    const time = new Date(bar.eventAt ?? bar.timestamp).getTime();
    if (!Number.isFinite(time) || time <= entryTime || time > deadline) continue;
    const targetHit = Number.isFinite(bar.high) && bar.high >= targetPrice;
    const stopHit = Number.isFinite(bar.low) && bar.low <= stopPrice;
    if (Number.isFinite(bar.low)) mae = Math.min(mae, bar.low / entryPrice - 1);
    if (Number.isFinite(bar.high)) mfe = Math.max(mfe, bar.high / entryPrice - 1);
    if (targetHit && stopHit) return { outcome: "STOP_FIRST", outcomeAt: new Date(time).toISOString(), exitPrice: stopPrice, intrabarAmbiguous: true, mae, mfe };
    if (stopHit) return { outcome: "STOP_FIRST", outcomeAt: new Date(time).toISOString(), exitPrice: stopPrice, intrabarAmbiguous: false, mae, mfe };
    if (targetHit) return { outcome: "TARGET_FIRST", outcomeAt: new Date(time).toISOString(), exitPrice: targetPrice, intrabarAmbiguous: false, mae, mfe };
  }
  const lastBar = bars.filter((bar) => {
    const time = new Date(bar.eventAt ?? bar.timestamp).getTime();
    return Number.isFinite(time) && time > entryTime && time <= deadline && Number.isFinite(bar.close);
  }).at(-1);
  return { outcome: "TIMEOUT", outcomeAt: new Date(deadline).toISOString(), exitPrice: lastBar?.close ?? null, intrabarAmbiguous: false, mae, mfe };
}
