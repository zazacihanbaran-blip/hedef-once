import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarketFeatures } from "./features.mjs";
import { round } from "./metrics.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.join(moduleDir, "..", "config", "strategy-v0.1.json");

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scoreLabel(score) {
  if (score < 50) return "NO_TRADE";
  if (score < 60) return "WATCH";
  if (score < 70) return "PAPER";
  if (score < 75) return "WEAK_LONG_CANDIDATE";
  if (score < 80) return "SMALL_LONG";
  if (score < 88) return "STANDARD_LONG";
  return "HIGH_CONVICTION";
}

function researchDecision(baseDecision, hardVetos) {
  if (hardVetos.length || baseDecision === "NO_TRADE") return "NO_TRADE";
  if (baseDecision === "WATCH") return "WATCH";
  return "PAPER_RESEARCH";
}

const guidanceByCode = {
  INSUFFICIENT_HISTORY: "Yeterli veri birikene kadar bekle.",
  STALE_OR_MISSING_QUOTE: "Güncel alıcı ve satıcı fiyatı gelmeden işlem düşünme.",
  OUTSIDE_REGULAR_SESSION: "Normal ABD seansının açılmasını bekle.",
  OPEN_CHAOS_WINDOW: "Açılışın ilk 10 dakikasının tamamlanmasını bekle.",
  SPREAD_TOO_WIDE: "Alış ve satış fiyatı birbirine yaklaşmadan işlem düşünme.",
  INVALID_STOP: "Fikrin bozulacağı net bir seviye oluşmasını bekle.",
  STOP_TOO_WIDE: "Daha yakın ve mantıklı bir stop seviyesi oluşmasını bekle.",
  RISK_REWARD_TOO_LOW: "Hedefe göre alınan risk küçülmeden işlem düşünme.",
  SECTOR_BREAKDOWN: "SMH ve SOXX toparlanmadan long düşünme.",
  NONPOSITIVE_NET_TARGET: "Masraflar çıktıktan sonra anlamlı kazanç kalmasını bekle.",
  CONTEXT_DATA_MISSING: "Haber ve takvim verisi tamamlanana kadar bekle.",
  NEWS_SENTIMENT_UNCLASSIFIED: "Yeni haberin olumlu mu olumsuz mu olduğu netleşsin.",
  HIGH_IMPACT_EVENT_TODAY: "Yüksek etkili olayın geçmesini ve fiyatın sakinleşmesini bekle.",
  MIXED_MEMORY_BASKET: "MU, SNDK, WDC ve STX aynı yönde güçlenmeye başlasın.",
  NO_VWAP_RECLAIM: "Fiyat VWAP üzerine çıkıp tamamlanmış 5 dakikalık kapanış yapsın.",
  NEGATIVE_MEMORY_BASKET: "Memory grubundaki satış baskısının zayıflamasını bekle.",
  NO_ENTRY_TRIGGER: "5 dakikalık fiyat yönü yukarı dönüp yakın giriş tetiği oluştursun.",
  ENTRY_TRIGGER_FORMING: "Toparlanma başladı; bir sonraki 5 dakikalık mumun teyidini bekle.",
  CHASING_PRICE: "Fiyatı kovalamadan kısa ortalamaya doğru kontrollü geri çekilmeyi bekle."
};

function buildUserGuidance(finalDecision, hardVetos, softVetos, timingReasons = [], riskLevel = null, riskReward = null) {
  const codes = [...hardVetos, ...softVetos];
  const waitFor = [...new Set(codes.map((code) => guidanceByCode[code]).filter(Boolean))];
  if (finalDecision === "NO_TRADE") {
    return { action: "İşlem açma", tone: "STOP", summary: waitFor[0] ?? "Koşullar stratejiye uygun değil.", waitFor };
  }
  if (finalDecision === "WATCH") {
    return { action: "Şimdilik bekle", tone: "WAIT", summary: waitFor[0] ?? "Bir sonraki tamamlanmış 5 dakikalık mumu bekle.", waitFor };
  }
  return {
    action: "Yakın pencere · paper takip et",
    tone: "PAPER",
    summary: `Kısa vadeli giriş tetiği oluştu. Risk ${riskLevel === "LOW" ? "düşük" : riskLevel === "MEDIUM" ? "orta" : "yüksek"}; hedef/stop oranı ${Number.isFinite(riskReward) ? riskReward.toFixed(2) : "—"}. Gerçek emir verme.`,
    waitFor: timingReasons.length ? timingReasons : ["Paper sonucunun hedef, stop veya timeout ile tamamlanmasını izle."]
  };
}

function newsEventScore(context, symbol, observedAt) {
  if (!context?.readiness?.newsConnected || !context?.readiness?.calendarConnected) {
    return { score: 0, softVetos: ["CONTEXT_DATA_MISSING"], recentNewsCount: 0, highImpactEventCount: 0 };
  }
  const now = new Date(observedAt).getTime();
  const recentNews = context.news.filter((item) => (item.topic === symbol || item.topic === "MEMORY") && item.publishedAt && now - new Date(item.publishedAt).getTime() >= 0 && now - new Date(item.publishedAt).getTime() <= 2 * 60 * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(observedAt)).map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const highImpactEvents = context.events.filter((event) => event.impact === "HIGH" && event.date === today);
  let score = 72;
  const softVetos = [];
  if (recentNews.length) {
    score -= 12;
    softVetos.push("NEWS_SENTIMENT_UNCLASSIFIED");
  }
  if (highImpactEvents.length) {
    score -= 10;
    softVetos.push("HIGH_IMPACT_EVENT_TODAY");
  }
  return { score: clamp(score), softVetos, recentNewsCount: recentNews.length, highImpactEventCount: highImpactEvents.length };
}

function groupScores(features, snapshot, context, symbol, model, stopPct, riskReward, netTargetPct) {
  const priceVolume = clamp(
    features.entryTiming.score +
    (features.volumeRatio >= 1.2 ? 6 : features.volumeRatio >= 0.7 ? 3 : 0) +
    (features.vwapDistancePct > 0 ? 3 : 0)
  );
  const expectedMinutes = Number.isFinite(features.atr5mPct) && features.atr5mPct > 0
    ? Math.ceil((model.targetPct / features.atr5mPct) * 5)
    : null;
  let volatilityTime = 0;
  if (Number.isFinite(expectedMinutes)) {
    if (model.targetPct === 0.01) volatilityTime = expectedMinutes <= 90 ? 95 : expectedMinutes <= 180 ? 75 : expectedMinutes <= 240 ? 55 : 25;
    else volatilityTime = expectedMinutes <= 240 ? 90 : expectedMinutes <= 780 ? 72 : expectedMinutes <= 1170 ? 55 : 25;
  }
  const memory = snapshot.baskets.memory;
  const sector = snapshot.baskets.sector;
  const symbolChange = snapshot.quotes[symbol]?.changePct;
  const relativeToMemory = Number.isFinite(symbolChange) && Number.isFinite(memory.averageChangePct) ? symbolChange - memory.averageChangePct : null;
  const sectorBasket = clamp(
    (memory.state === "POSITIVE" ? 45 : memory.state === "MIXED" ? 28 : 10) +
    (sector.state === "POSITIVE" ? 25 : sector.state === "MIXED" ? 15 : 5) +
    (relativeToMemory > 0 ? 20 : 5) +
    (memory.coverage === 1 && sector.coverage === 1 ? 10 : 0)
  );
  const event = newsEventScore(context, symbol, snapshot.observedAt);
  const targetStop = clamp((riskReward >= model.minRiskReward ? 55 : 10) + (netTargetPct > 0.0075 ? 30 : 12) + (stopPct <= model.maxStopPct ? 15 : 0));
  const qqq = snapshot.quotes.QQQ?.changePct;
  const spy = snapshot.quotes.SPY?.changePct;
  const vix = snapshot.quotes["^VIX"]?.changePct;
  const macro = clamp(50 + (qqq > 0 ? 15 : -15) + (spy > 0 ? 10 : -10) + (vix < 2 ? 10 : -10));
  const execution = clamp(features.quoteQuality === "VALID" ? 80 - Math.max(0, features.spreadBps - 2) * 5 : 0);
  const crowdedRisk = clamp(55 - (Math.abs(symbolChange ?? 0) > 8 ? 25 : Math.abs(symbolChange ?? 0) > 4 ? 12 : 0));
  return {
    scores: { priceVolume: round(priceVolume, 1), volatilityTime: round(volatilityTime, 1), sectorBasket: round(sectorBasket, 1), newsEvent: round(event.score, 1), targetStop: round(targetStop, 1), macro: round(macro, 1), execution: round(execution, 1), crowdedRisk: round(crowdedRisk, 1) },
    expectedMinutes,
    event
  };
}

function candidateId(symbol, modelKey, decisionAt, version) {
  return createHash("sha256").update(`${symbol}|${modelKey}|${decisionAt}|${version}`).digest("hex").slice(0, 20);
}

function buildCandidate(symbol, modelKey, model, features, snapshot, context, config) {
  const hardVetos = [];
  const softVetos = [];
  const entry = features.entryAsk;
  if (!features.priceScoreInputsReady) hardVetos.push("INSUFFICIENT_HISTORY");
  if (features.quoteQuality !== "VALID" || !Number.isFinite(entry)) hardVetos.push("STALE_OR_MISSING_QUOTE");
  if (features.marketState !== "REGULAR") hardVetos.push("OUTSIDE_REGULAR_SESSION");
  if (Number.isFinite(features.minutesSinceOpen) && features.minutesSinceOpen < config.openChaosMinutes) hardVetos.push("OPEN_CHAOS_WINDOW");
  if (Number.isFinite(features.spreadBps) && features.spreadBps > config.maxSpreadBps) hardVetos.push("SPREAD_TOO_WIDE");

  const timingTriggered = ["REVERSAL_TRIGGER", "MOMENTUM_TRIGGER"].includes(features.entryTiming.state);
  const atrFloor = Number.isFinite(features.atr5m) && Number.isFinite(entry) ? (0.5 * features.atr5m) / entry : null;
  const supportLevel = modelKey === "quick" ? features.tacticalLow3 : features.structureLow6;
  const structureStopPrice = Number.isFinite(supportLevel) && Number.isFinite(features.atr5m)
    ? supportLevel - 0.1 * features.atr5m
    : null;
  const structureRiskPct = Number.isFinite(entry) && Number.isFinite(structureStopPrice) && entry > structureStopPrice
    ? (entry - structureStopPrice) / entry
    : null;
  const requiredStopPct = [structureRiskPct, atrFloor].filter(Number.isFinite).length
    ? Math.max(...[structureRiskPct, atrFloor].filter(Number.isFinite), model.minStopPct)
    : null;
  if (!Number.isFinite(requiredStopPct)) hardVetos.push("INVALID_STOP");
  if (Number.isFinite(requiredStopPct) && requiredStopPct > model.maxStopPct) hardVetos.push("STOP_TOO_WIDE");
  const stopPct = Number.isFinite(requiredStopPct) ? requiredStopPct : model.maxStopPct;
  const riskReward = model.targetPct / stopPct;
  if (riskReward < model.minRiskReward) hardVetos.push("RISK_REWARD_TOO_LOW");
  if (!timingTriggered && snapshot.baskets.sector.state === "NEGATIVE" && snapshot.baskets.sector.averageChangePct <= -0.5) hardVetos.push("SECTOR_BREAKDOWN");

  const feeDragPct = config.feeCasesUsd[1] / config.researchNotionalUsd;
  const frictionPct = feeDragPct + 2 * config.slippageStressBpsPerSide / 10_000;
  const netTargetPct = model.targetPct - frictionPct;
  if (netTargetPct <= 0) hardVetos.push("NONPOSITIVE_NET_TARGET");
  const groups = groupScores(features, snapshot, context, symbol, model, stopPct, riskReward, netTargetPct);
  softVetos.push(...groups.event.softVetos);
  if (features.entryTiming.state === "WAIT" || features.entryTiming.state === "INSUFFICIENT") softVetos.unshift("NO_ENTRY_TRIGGER");
  if (features.entryTiming.state === "PREPARE") softVetos.unshift("ENTRY_TRIGGER_FORMING");
  if (features.entryTiming.state === "CHASING") softVetos.unshift("CHASING_PRICE");
  if (!timingTriggered && !features.reclaim) softVetos.push("NO_VWAP_RECLAIM");
  if (!timingTriggered && snapshot.baskets.memory.state === "NEGATIVE") softVetos.push("NEGATIVE_MEMORY_BASKET");

  const decisionScore = Object.entries(config.weights).reduce((sum, [key, weight]) => sum + (groups.scores[key] ?? 0) * weight / 100, 0);
  const baseDecision = scoreLabel(decisionScore);
  const adjustedDecision = timingTriggered
    ? baseDecision
    : baseDecision === "NO_TRADE" ? "NO_TRADE" : "WATCH";
  const finalDecision = researchDecision(adjustedDecision, hardVetos);
  const uniqueHardVetos = [...new Set(hardVetos)];
  const uniqueSoftVetos = [...new Set(softVetos)];
  const targetPrice = Number.isFinite(entry) ? entry * (1 + model.targetPct) : null;
  const stopPrice = Number.isFinite(entry) ? entry * (1 - stopPct) : null;
  const riskLevel = stopPct <= model.minStopPct * 1.15 ? "LOW" : stopPct <= model.maxStopPct * 0.78 ? "MEDIUM" : "HIGH";
  const signalWindow = hardVetos.length ? "BLOCKED" : timingTriggered ? "NOW" : features.entryTiming.state === "PREPARE" ? "PREPARE" : "WAIT";
  const userGuidance = buildUserGuidance(finalDecision, uniqueHardVetos, uniqueSoftVetos, features.entryTiming.reasons, riskLevel, riskReward);
  return {
    candidateId: candidateId(symbol, modelKey, features.decisionAt, config.version),
    generatedAt: snapshot.observedAt,
    entryAt: snapshot.observedAt,
    decisionAt: features.decisionAt,
    symbol,
    modelKey,
    modelLabel: model.label,
    engineVersion: config.version,
    mode: config.mode,
    baseDecision,
    adjustedDecision,
    finalDecision,
    signalWindow,
    timingState: features.entryTiming.state,
    timingReasons: features.entryTiming.reasons,
    decisionScore: round(decisionScore, 1),
    probabilityStatus: "NOT_CALIBRATED",
    pTargetFirst: null,
    pStopFirst: null,
    pTimeout: null,
    entryPrice: round(entry),
    targetPrice: round(targetPrice),
    stopPrice: round(stopPrice),
    targetPct: model.targetPct,
    stopPct: round(stopPct, 6),
    riskReward: round(riskReward, 3),
    riskLevel,
    expectedMinutes: groups.expectedMinutes,
    deadlineAt: model.maxHoldingSessions === 1 ? features.regularSessionEnd : null,
    deadlinePolicy: model.maxHoldingSessions === 1 ? "ENTRY_SESSION_CLOSE" : "THIRD_RTH_CLOSE",
    netTargetPctFeeCaseB: round(netTargetPct, 6),
    scores: groups.scores,
    hardVetos: uniqueHardVetos,
    softVetos: uniqueSoftVetos,
    userGuidance,
    evidence: {
      completed5mBars: features.completed5mBars,
      vwap: features.vwap,
      vwapDistancePct: features.vwapDistancePct,
      ret5m: features.ret5m,
      ret15m: features.ret15m,
      volumeRatio: features.volumeRatio,
      atr5m: features.atr5m,
      atrPeriods: features.atrPeriods,
      atr5mPct: features.atr5mPct,
      spreadBps: features.spreadBps,
      memoryState: snapshot.baskets.memory.state,
      sectorState: snapshot.baskets.sector.state,
      recentNewsCount: groups.event.recentNewsCount,
      highImpactEventCount: groups.event.highImpactEventCount,
      ema3: features.entryTiming.ema3,
      ema8: features.entryTiming.ema8,
      distanceFromEma8Pct: features.entryTiming.distanceFromEma8Pct,
      reboundFromRecentLowPct: features.entryTiming.reboundFromRecentLowPct,
      higherLow: features.entryTiming.higherLow,
      breakout3: features.entryTiming.breakout3,
      closeLocation: features.entryTiming.closeLocation
    }
  };
}

export async function loadStrategyConfig(configPath = defaultConfigPath) {
  return JSON.parse(await readFile(configPath, "utf8"));
}

export async function generatePredictions(snapshot, charts, context, config = null) {
  const strategy = config ?? await loadStrategyConfig();
  const bySymbol = Object.fromEntries(charts.map((chart) => [chart.symbol, chart]));
  const candidates = [];
  for (const symbol of ["MU", "SNDK"]) {
    const chart = bySymbol[symbol];
    if (!chart) continue;
    const features = buildMarketFeatures(chart, snapshot.quotes[symbol], snapshot.execution?.[symbol], snapshot.observedAt);
    if (!features.decisionAt) continue;
    for (const [modelKey, model] of Object.entries(strategy.models)) {
      candidates.push(buildCandidate(symbol, modelKey, model, features, snapshot, context, strategy));
    }
  }
  return {
    schemaVersion: "0.1.0",
    engineVersion: strategy.version,
    mode: strategy.mode,
    generatedAt: snapshot.observedAt,
    probabilityNotice: "Olasılıklar walk-forward kalibrasyonu tamamlanana kadar üretilmez.",
    candidates
  };
}
