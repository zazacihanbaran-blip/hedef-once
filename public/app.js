const state = {
  symbol: "MU",
  model: "quick",
  snapshot: null,
  loading: false
};

const elements = Object.fromEntries([
  "connectionDot", "marketState", "sourceNotice", "decisionTitle", "decisionReason", "selectedSymbol",
  "livePrice", "dayChange", "lastMarketTime", "dataDelay", "dataCoverage", "entryValue", "targetValue",
  "timeValue", "decisionScore", "probabilityStatus", "quoteSubtitle", "metricChange", "metricVwap", "metricRange", "metricVolume", "memoryState",
  "metricBidAsk", "metricSpread", "sectorState", "vetoText", "priceLayer", "newsLayer", "calendarLayer",
  "executionLayer", "stopValue", "netTargetValue", "modelLayer", "signalTime", "scoreGrid", "hardVetoList",
  "softVetoList", "observedAt", "quoteGrid", "newsObservedAt", "newsList", "eventList", "refreshButton",
  "guidancePanel", "guidanceTitle", "guidanceSummary", "guidanceWaitFor", "metricChangeMeaning",
  "metricVwapMeaning", "metricRangeMeaning", "metricVolumeMeaning", "metricBidAskMeaning",
  "metricSpreadMeaning", "stopMeaning", "netTargetMeaning", "memoryMeaning", "sectorMeaning",
  "timingStatus", "riskStatus", "cycleNumber", "cyclePhaseSummary", "cycleRail", "cycleEvidence",
  "cycleNext", "cycleInvalidation", "motorEvidence"
].map((id) => [id, document.getElementById(id)]));

function formatPrice(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " $"
    : "—";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
}

function formatVolume(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatClock(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

function stateLabel(value) {
  return ({ POSITIVE: "Pozitif", NEGATIVE: "Negatif", MIXED: "Karışık", UNKNOWN: "Bilinmiyor" })[value] ?? value ?? "—";
}

function layerState(element, connected, readyLabel = "Bağlı") {
  element.textContent = connected ? readyLabel : "Eksik";
  element.className = connected ? "positive" : "warning-text";
}

const vetoLabels = {
  INSUFFICIENT_HISTORY: "Yeterli 5 dk geçmişi yok",
  STALE_OR_MISSING_QUOTE: "Bid/ask eksik veya eski",
  OUTSIDE_REGULAR_SESSION: "Normal seans dışında",
  OPEN_CHAOS_WINDOW: "Açılışın ilk 10 dakikası",
  SPREAD_TOO_WIDE: "Spread fazla geniş",
  INVALID_STOP: "Geçerli stop kurulamadı",
  STOP_TOO_WIDE: "Gerekli stop fazla uzak",
  RISK_REWARD_TOO_LOW: "Risk/getiri yetersiz",
  SECTOR_BREAKDOWN: "Sektör ETF'leri kırılıyor",
  NONPOSITIVE_NET_TARGET: "Maliyet sonrası hedef anlamsız",
  CONTEXT_DATA_MISSING: "Haber/takvim verisi eksik",
  NEWS_SENTIMENT_UNCLASSIFIED: "Yeni haberin yönü henüz sınıflanmadı",
  HIGH_IMPACT_EVENT_TODAY: "Bugün yüksek etkili olay var",
  MIXED_MEMORY_BASKET: "Memory grubu karışık",
  NO_VWAP_RECLAIM: "VWAP geri alımı yok",
  NEGATIVE_MEMORY_BASKET: "Memory grubu negatif",
  NO_ENTRY_TRIGGER: "Yakın giriş tetiği oluşmadı",
  ENTRY_TRIGGER_FORMING: "Yakın giriş tetiği hazırlanıyor",
  CHASING_PRICE: "Fiyat giriş için fazla uzadı"
};

const scoreLabels = {
  priceVolume: "Giriş zamanlaması",
  volatilityTime: "Hedef süresi",
  sectorBasket: "Memory/sektör",
  newsEvent: "Haber/olay",
  targetStop: "Hedef/stop",
  macro: "Genel piyasa",
  execution: "Giriş kalitesi",
  crowdedRisk: "Yorgunluk riski"
};

const scoreQuestions = {
  priceVolume: "Önümüzdeki kısa pencere için tetik oluştu mu?",
  volatilityTime: "Hedef beklenen sürede gelebilir mi?",
  sectorBasket: "Benzer hisseler destekliyor mu?",
  newsEvent: "Haber ve olay ortamı güvenli mi?",
  targetStop: "Alınan riske değer mi?",
  macro: "Genel piyasa long için uygun mu?",
  execution: "Giriş maliyeti uygun mu?",
  crowdedRisk: "Hisse fazla yorulmuş mu?"
};

function basketMeaning(stateValue, subject) {
  if (stateValue === "POSITIVE") return `${subject} bu long fikrini destekliyor.`;
  if (stateValue === "NEGATIVE") return `${subject} şu anda long fikrine karşı.`;
  if (stateValue === "MIXED") return `${subject} ortak bir yön göstermiyor; temkinli ol.`;
  return `${subject} için yeterli veri yok.`;
}

function renderGuidance(candidate) {
  const guidance = candidate?.userGuidance;
  const tone = (guidance?.tone ?? "WAIT").toLowerCase();
  elements.guidancePanel.className = `guidance-panel ${tone}`;
  elements.guidanceTitle.textContent = guidance?.action ?? "Verinin tamamlanmasını bekle";
  elements.guidanceSummary.textContent = guidance?.summary ?? "Karar motoru hazır bir yön üretmedi; şu anda işlem açma.";
  const items = guidance?.waitFor?.length ? guidance.waitFor : ["Canlı veri ve karar motoru bekleniyor."];
  elements.guidanceWaitFor.replaceChildren(...items.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
}

function renderCycle(candidate) {
  const cycle = candidate?.cycleAnalysis;
  elements.cycleNumber.textContent = cycle?.phase === "DATA_BUILDING" ? "…" : Number.isInteger(cycle?.phaseIndex) ? String(cycle.phaseIndex + 1) : "—";
  document.getElementById("cycleTitle").textContent = cycle?.label ?? "Döngü hesaplanıyor";
  elements.cyclePhaseSummary.textContent = cycle?.summary ?? "Tamamlanmış 5 dakikalık mumlar bekleniyor.";
  elements.cycleNext.textContent = cycle?.nextCondition ?? "—";
  elements.cycleInvalidation.textContent = cycle?.invalidation ?? "—";
  elements.cycleEvidence.replaceChildren(...((cycle?.evidence?.length ? cycle.evidence : ["Veri bekleniyor."]).map((message) => {
    const chip = document.createElement("small");
    chip.textContent = message;
    return chip;
  })));
  elements.cycleRail.querySelectorAll("[data-cycle-index]").forEach((step) => {
    const index = Number(step.dataset.cycleIndex);
    step.classList.toggle("active", cycle?.phase !== "DATA_BUILDING" && index === cycle?.phaseIndex);
    step.classList.toggle("passed", cycle?.phase !== "DATA_BUILDING" && index < cycle?.phaseIndex);
  });
}

function evidenceMeaning(key, value, candidate) {
  const meanings = {
    ret5m: Number.isFinite(value) ? (value > 0 ? "Son mum yukarı kapandı." : value < 0 ? "Son mum aşağı kapandı." : "Son mum yatay.") : "Ölçülemedi.",
    ret15m: Number.isFinite(value) ? (value > 0 ? "Kısa yön yukarı." : value < 0 ? "Kısa yön aşağı." : "Kısa yön dengede.") : "Ölçülemedi.",
    ema: Number.isFinite(candidate?.evidence?.ema3) && Number.isFinite(candidate?.evidence?.ema8)
      ? candidate.evidence.ema3 > candidate.evidence.ema8 ? "Hızlı ortalama önde; momentum olumlu." : "Hızlı ortalama geride; dönüş tamamlanmadı."
      : "Ölçülemedi.",
    rebound: Number.isFinite(value) ? (value > 0.008 ? "Hedefin büyük bölümü geçmiş; kovalamaya dikkat." : value >= 0.002 ? "Dipten anlamlı tepki var." : "Dipten tepki zayıf.") : "Ölçülemedi.",
    higherLow: value ? "Son dip bir öncekinden yukarıda." : "Yükselen dip henüz yok.",
    breakout3: value ? "Fiyat yakın tepeyi geçti." : "Yakın tepe henüz aşılmadı.",
    vwap: Number.isFinite(value) ? (value > 0 ? "Fiyat seans ortalamasının üzerinde." : "Fiyat seans ortalamasının altında.") : "Ölçülemedi.",
    volume: Number.isFinite(value) ? (value >= 1.2 ? "Son mum olağandan hacimli." : value >= 0.7 ? "Hacim normal aralıkta." : "Katılım zayıf.") : "Hacim oranı ölçülemedi.",
    atr: Number.isFinite(value) ? "Bir 5 dakikalık mumun olağan hareket kapasitesi." : "Ölçülemedi.",
    spread: Number.isFinite(value) ? (value <= 3 ? "Giriş maliyeti düşük." : value <= 10 ? "Maliyet kabul edilebilir." : "Giriş maliyeti fazla yüksek.") : "Ölçülemedi.",
    riskReward: Number.isFinite(value) ? (value >= 1.5 ? "Hedef stopa göre avantajlı." : value >= 1.2 ? "Asgari oran sağlanıyor." : "Alınan risk ödüle göre yüksek.") : "Ölçülemedi."
  };
  return meanings[key];
}

function renderMotorEvidence(candidate) {
  elements.motorEvidence.querySelectorAll(".evidence-row, .empty-state").forEach((item) => item.remove());
  if (!candidate) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aday verisi bekleniyor.";
    elements.motorEvidence.append(empty);
    return;
  }
  const evidence = candidate.evidence ?? {};
  const rows = [
    ["Son 5 dakika", formatPercent(evidence.ret5m * 100), evidenceMeaning("ret5m", evidence.ret5m, candidate), "Dönüş mumunun ilk işareti"],
    ["Son 15 dakika", formatPercent(evidence.ret15m * 100), evidenceMeaning("ret15m", evidence.ret15m, candidate), "Satış mı toparlanma mı?"],
    ["EMA 3 / EMA 8", `${formatPrice(evidence.ema3)} / ${formatPrice(evidence.ema8)}`, evidenceMeaning("ema", null, candidate), "Kısa momentum teyidi"],
    ["Yakın dipten tepki", formatPercent(evidence.reboundFromRecentLowPct * 100), evidenceMeaning("rebound", evidence.reboundFromRecentLowPct, candidate), "Erken miyiz, geç mi kaldık?"],
    ["Yükselen dip", evidence.higherLow ? "Var" : "Yok", evidenceMeaning("higherLow", evidence.higherLow, candidate), "Dönüş yapısının teyidi"],
    ["3 mumluk tepe aşımı", evidence.breakout3 ? "Var" : "Yok", evidenceMeaning("breakout3", evidence.breakout3, candidate), "Yakın direnç kırılımı"],
    ["VWAP uzaklığı", formatPercent(evidence.vwapDistancePct * 100), evidenceMeaning("vwap", evidence.vwapDistancePct, candidate), "Seans ortalamasına göre konum"],
    ["Göreli hacim", Number.isFinite(evidence.volumeRatio) ? `${evidence.volumeRatio.toLocaleString("tr-TR")}×` : "—", evidenceMeaning("volume", evidence.volumeRatio, candidate), "Harekete katılım var mı?"],
    ["5 dk ATR", Number.isFinite(evidence.atr5mPct) ? formatPercent(evidence.atr5mPct * 100) : "—", evidenceMeaning("atr", evidence.atr5mPct, candidate), `Hedef süresi · ${evidence.atrPeriods ?? "—"} mum`],
    ["Spread", Number.isFinite(evidence.spreadBps) ? `${evidence.spreadBps.toLocaleString("tr-TR")} bps` : "—", evidenceMeaning("spread", evidence.spreadBps, candidate), "Uygulanabilir giriş maliyeti"],
    ["Hedef / stop oranı", Number.isFinite(candidate.riskReward) ? candidate.riskReward.toLocaleString("tr-TR") : "—", evidenceMeaning("riskReward", candidate.riskReward, candidate), "Hedef önce senaryosunun matematiği"]
  ];
  elements.motorEvidence.append(...rows.map(([name, current, meaning, role]) => {
    const row = document.createElement("div");
    row.className = "evidence-row";
    for (const value of [name, current, meaning, role]) {
      const cell = document.createElement("span");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
}

function renderPrediction(predictions) {
  const candidate = predictions?.candidates?.find((item) => item.symbol === state.symbol && item.modelKey === state.model);
  if (!candidate) {
    elements.decisionScore.textContent = "—";
    elements.probabilityStatus.textContent = "Kalibrasyon bekliyor";
    elements.signalTime.textContent = "Sinyal bekleniyor";
    elements.timingStatus.textContent = "Bekleniyor";
    elements.riskStatus.textContent = "—";
    elements.scoreGrid.replaceChildren();
    renderGuidance(null);
    renderCycle(null);
    renderMotorEvidence(null);
    return;
  }
  const decisionText = ({ NO_TRADE: "Uzak dur", WATCH: "İzle", PAPER_RESEARCH: "Kağıt araştırma adayı" })[candidate.finalDecision] ?? candidate.finalDecision;
  elements.decisionTitle.textContent = decisionText;
  elements.decisionReason.textContent = candidate.hardVetos.length
    ? vetoLabels[candidate.hardVetos[0]] ?? candidate.hardVetos[0]
    : candidate.signalWindow === "NOW" ? candidate.timingReasons?.[0] ?? "Kısa vadeli giriş tetiği oluştu."
      : candidate.softVetos.length ? vetoLabels[candidate.softVetos[0]] ?? candidate.softVetos[0] : "Araştırma kuralları olumlu.";
  elements.decisionScore.textContent = `${candidate.decisionScore}/100`;
  elements.probabilityStatus.textContent = "Henüz üretilmiyor";
  elements.timingStatus.textContent = ({ NOW: "Açık", PREPARE: "Hazırlanıyor", WAIT: "Kapalı", BLOCKED: "Engelli" })[candidate.signalWindow] ?? "—";
  elements.riskStatus.textContent = ({ LOW: "Düşük", MEDIUM: "Orta", HIGH: "Yüksek" })[candidate.riskLevel] ?? "—";
  elements.timingStatus.className = candidate.signalWindow === "NOW" ? "positive" : candidate.signalWindow === "BLOCKED" ? "negative" : "warning-text";
  elements.riskStatus.className = candidate.riskLevel === "LOW" ? "positive" : candidate.riskLevel === "HIGH" ? "negative" : "warning-text";
  elements.entryValue.textContent = formatPrice(candidate.entryPrice);
  elements.targetValue.textContent = formatPrice(candidate.targetPrice);
  elements.stopValue.textContent = formatPrice(candidate.stopPrice);
  elements.timeValue.textContent = Number.isFinite(candidate.expectedMinutes) ? `~${candidate.expectedMinutes} dk` : "Belirsiz";
  elements.netTargetValue.textContent = formatPercent(candidate.netTargetPctFeeCaseB * 100);
  elements.vetoText.textContent = candidate.hardVetos.length ? (vetoLabels[candidate.hardVetos[0]] ?? candidate.hardVetos[0]) : "Model henüz doğrulanmadı";
  elements.signalTime.textContent = `Karar zamanı ${formatClock(candidate.decisionAt)}`;
  elements.hardVetoList.textContent = candidate.hardVetos.length ? candidate.hardVetos.map((code) => vetoLabels[code] ?? code).join(" · ") : "Yok";
  elements.softVetoList.textContent = candidate.softVetos.length ? candidate.softVetos.map((code) => vetoLabels[code] ?? code).join(" · ") : "Yok";
  renderGuidance(candidate);
  renderCycle(candidate);
  renderMotorEvidence(candidate);
  elements.scoreGrid.replaceChildren(...Object.entries(candidate.scores).map(([key, value]) => {
    const item = document.createElement("article");
    item.className = "score-item";
    item.innerHTML = `<div><span>${scoreLabels[key] ?? key}</span><strong>${Math.round(value)}</strong></div><small>${scoreQuestions[key] ?? "Bu katmanın katkısı."}</small><div class="score-track"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>`;
    return item;
  }));
}

function renderContext(context) {
  const connected = context?.readiness ?? {};
  layerState(elements.newsLayer, connected.newsConnected && connected.filingsConnected);
  layerState(elements.calendarLayer, connected.calendarConnected);
  elements.newsObservedAt.textContent = context?.observedAt ? `Son kontrol ${formatClock(context.observedAt)}` : "—";

  if (!context) {
    elements.newsList.innerHTML = '<p class="empty-state">Haber verisi alınamadı.</p>';
    elements.eventList.innerHTML = '<p class="empty-state">Takvim verisi alınamadı.</p>';
    return;
  }

  const selectedNews = context.news.filter((item) => item.topic === state.symbol || item.topic === "MEMORY").slice(0, 4);
  const selectedFilings = context.filings.filter((item) => item.symbol === state.symbol).slice(0, 2);
  const combined = [
    ...selectedNews.map((item) => ({ kind: "HABER", time: item.publishedAt, title: item.title, meta: `${item.sourceName ?? "Haber"} · ilk görülme ${formatClock(item.firstSeenAt)}`, url: item.link })),
    ...selectedFilings.map((item) => ({ kind: `SEC ${item.form}`, time: item.acceptedAt, title: item.description || `${item.symbol} ${item.form} bildirimi`, meta: `Resmi kabul: ${item.acceptedAt ? new Date(item.acceptedAt).toLocaleDateString("tr-TR") : "—"}`, url: item.url }))
  ].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")).slice(0, 6);
  elements.newsList.replaceChildren(...(combined.length ? combined.map((item) => {
    const row = document.createElement("article");
    row.className = "context-item";
    const time = document.createElement("span");
    time.textContent = item.time ? formatClock(item.time) : item.kind;
    const body = document.createElement("div");
    const title = item.url ? document.createElement("a") : document.createElement("strong");
    title.textContent = item.title;
    if (item.url) { title.href = item.url; title.target = "_blank"; title.rel = "noreferrer"; }
    const meta = document.createElement("small");
    meta.textContent = `${item.kind} · ${item.meta}`;
    body.append(title, meta);
    row.append(time, body);
    return row;
  }) : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Son iki günde eşleşen haber bulunamadı." })]));

  const events = context.events.filter((item) => item.type === "EARNINGS" ? item.symbol === state.symbol : item.impact === "HIGH").slice(0, 7);
  elements.eventList.replaceChildren(...(events.length ? events.map((item) => {
    const row = document.createElement("article");
    row.className = "context-item";
    const date = document.createElement("span");
    date.textContent = new Date(`${item.date}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.type === "EARNINGS" ? `${item.symbol} bilançosu` : item.name;
    if (item.impact === "HIGH") title.className = "high-impact";
    const meta = document.createElement("small");
    meta.textContent = item.type === "EARNINGS" ? (item.timing ?? "Saat açıklanmadı") : `${item.timeGmt ?? "—"} GMT · Beklenti ${item.consensus ?? "—"}`;
    body.append(title, meta);
    row.append(date, body);
    return row;
  }) : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Önümüzdeki 8 günde yüksek etkili eşleşme bulunamadı." })]));
}

function setDirectionClass(element, value) {
  element.classList.remove("positive", "negative", "warning-text", "muted-text");
  if (Number.isFinite(value)) element.classList.add(value > 0 ? "positive" : value < 0 ? "negative" : "muted-text");
}

function renderSelection() {
  document.querySelectorAll("[data-symbol]").forEach((button) => button.classList.toggle("active", button.dataset.symbol === state.symbol));
  document.querySelectorAll("[data-model]").forEach((button) => button.classList.toggle("active", button.dataset.model === state.model));
  elements.selectedSymbol.textContent = state.symbol;
  elements.targetValue.textContent = state.model === "quick" ? "+%1" : "+%1,5";
  elements.timeValue.textContent = state.model === "quick" ? "Aynı seans" : "1–3 seans";
}

function renderQuoteGrid(snapshot) {
  const order = ["MU", "SNDK", "WDC", "STX", "SMH", "SOXX", "QQQ", "SPY", "^VIX", "^TNX", "DX-Y.NYB", "NQ=F", "ES=F"];
  elements.quoteGrid.replaceChildren(...order.map((symbol) => {
    const quote = snapshot.quotes[symbol];
    const card = document.createElement("article");
    card.className = "quote-card";
    if (!quote) {
      card.innerHTML = `<div><b>${symbol}</b><em class="warning-text">Eksik</em></div><strong>—</strong><small>Veri alınamadı</small>`;
      return card;
    }
    const directionClass = quote.changePct > 0 ? "positive" : quote.changePct < 0 ? "negative" : "muted-text";
    card.innerHTML = `<div><b>${symbol}</b><em class="${directionClass}">${formatPercent(quote.changePct)}</em></div><strong>${formatPrice(quote.price)}</strong><small>${quote.marketState} · ${formatClock(quote.marketTimestamp)}</small>`;
    return card;
  }));
}

function render() {
  renderSelection();
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const quote = snapshot.quotes[state.symbol];
  const execution = snapshot.execution?.[state.symbol];
  const ready = snapshot.readiness.status === "MARKET_LAYER_READY";
  const contextReady = Boolean(snapshot.context?.readiness?.newsConnected && snapshot.context?.readiness?.filingsConnected && snapshot.context?.readiness?.calendarConnected);
  const executionReady = execution?.qualityStatus === "VALID";
  const connectedAll = ready && contextReady && executionReady;
  elements.connectionDot.className = `status-dot${ready ? "" : " warning"}`;
  elements.marketState.textContent = quote ? `${state.symbol} · ${quote.marketState}` : "Veri eksik";
  elements.sourceNotice.querySelector("span").textContent = snapshot.sourceNotice;
  elements.decisionTitle.textContent = connectedAll ? "Canlı veri bağlantıları hazır" : "Veri eksik";
  elements.decisionReason.textContent = connectedAll
    ? "Skor motoru, objektif backtest ve kalibrasyon tamamlanana kadar kilitli."
    : snapshot.readiness.reason;
  elements.livePrice.textContent = formatPrice(quote?.price);
  elements.dayChange.textContent = formatPercent(quote?.changePct);
  setDirectionClass(elements.dayChange, quote?.changePct);
  elements.lastMarketTime.textContent = `Piyasa zamanı: ${formatClock(quote?.marketTimestamp)}`;
  elements.dataDelay.textContent = `Gecikme: ${Number.isFinite(quote?.staleSeconds) ? quote.staleSeconds + " sn" : "—"}`;
  elements.dataCoverage.textContent = `Fiyat kapsamı: ${Math.round(snapshot.readiness.priceLayerCoverage * 100)}%`;
  elements.quoteSubtitle.textContent = `${state.symbol} için son erişilebilir veri`;
  elements.metricChange.textContent = formatPercent(quote?.changePct);
  setDirectionClass(elements.metricChange, quote?.changePct);
  elements.metricChangeMeaning.textContent = Number.isFinite(quote?.changePct)
    ? quote.changePct > 0.15 ? "Hisse bugün yükseliyor; yön long fikrine yardımcı olabilir."
      : quote.changePct < -0.15 ? "Hisse bugün düşüyor; long için ekstra teyit gerekir."
        : "Hisse bugün belirgin bir yön göstermiyor."
    : "Hissenin bugünkü yönü henüz bilinmiyor.";
  elements.metricVwap.textContent = formatPrice(quote?.vwap);
  elements.metricVwapMeaning.textContent = Number.isFinite(quote?.price) && Number.isFinite(quote?.vwap)
    ? quote.price >= quote.vwap ? "Fiyat gün içi ortalama maliyetin üzerinde; alıcılar daha güçlü."
      : "Fiyat gün içi ortalama maliyetin altında; VWAP geri alınmadan dikkat."
    : "Gün içindeki ortalama maliyet seviyesi hesaplanamadı.";
  elements.metricRange.textContent = `${formatPrice(quote?.sessionHigh)} / ${formatPrice(quote?.sessionLow)}`;
  const rangePosition = Number.isFinite(quote?.price) && Number.isFinite(quote?.sessionHigh) && Number.isFinite(quote?.sessionLow) && quote.sessionHigh > quote.sessionLow
    ? (quote.price - quote.sessionLow) / (quote.sessionHigh - quote.sessionLow) : null;
  elements.metricRangeMeaning.textContent = rangePosition === null ? "Fiyatın gün içindeki yeri hesaplanamadı."
    : rangePosition > 0.67 ? "Fiyat günün üst bölgesinde; güçlü fakat yorulmuş olabilir."
      : rangePosition < 0.33 ? "Fiyat günün alt bölgesinde; alıcı teyidi henüz zayıf."
        : "Fiyat günün orta bölgesinde; belirgin uç noktada değil.";
  elements.metricVolume.textContent = formatVolume(quote?.sessionVolume);
  elements.metricVolumeMeaning.textContent = "Bugünkü toplam işlem miktarı; tek başına yükseliş ya da düşüş sinyali değildir.";
  elements.metricBidAsk.textContent = `${formatPrice(execution?.bid)} / ${formatPrice(execution?.ask)}`;
  elements.metricBidAskMeaning.textContent = "Soldaki alıcıların verdiği, sağdaki satıcıların istediği fiyattır.";
  elements.metricSpread.textContent = Number.isFinite(execution?.spreadBps) ? `${execution.spreadBps.toLocaleString("tr-TR")} bps` : "—";
  elements.metricSpreadMeaning.textContent = !Number.isFinite(execution?.spreadBps) ? "Giriş maliyeti ölçülemiyor."
    : execution.spreadBps <= 3 ? "Alış-satış farkı dar; giriş maliyeti düşük."
      : execution.spreadBps <= 10 ? "Alış-satış farkı kabul edilebilir ama maliyet yaratır."
        : "Alış-satış farkı fazla geniş; işlem için uygun değil.";
  elements.memoryState.textContent = `${stateLabel(snapshot.baskets.memory.state)} · ${formatPercent(snapshot.baskets.memory.averageChangePct)}`;
  elements.sectorState.textContent = `${stateLabel(snapshot.baskets.sector.state)} · ${formatPercent(snapshot.baskets.sector.averageChangePct)}`;
  elements.memoryMeaning.textContent = basketMeaning(snapshot.baskets.memory.state, "Benzer memory hisseleri");
  elements.sectorMeaning.textContent = basketMeaning(snapshot.baskets.sector.state, "Çip sektörü");
  elements.vetoText.textContent = connectedAll ? "Model henüz doğrulanmadı" : "Eksik veri katmanları";
  elements.priceLayer.textContent = ready ? "Hazır" : "Eksik";
  elements.priceLayer.className = ready ? "positive" : "warning-text";
  layerState(elements.executionLayer, execution?.qualityStatus === "VALID", execution?.isRealTime ? "Bağlı · gerçek zamanlı" : "Bağlı");
  elements.observedAt.textContent = `Son toplama: ${formatClock(snapshot.observedAt)}`;
  renderQuoteGrid(snapshot);
  renderContext(snapshot.context);
  renderPrediction(snapshot.predictions);
  const selectedCandidate = snapshot.predictions?.candidates?.find((item) => item.symbol === state.symbol && item.modelKey === state.model);
  elements.stopMeaning.textContent = Number.isFinite(selectedCandidate?.stopPrice)
    ? "Fiyat buranın altına inerse işlem fikri geçersiz sayılır."
    : "Geçerli bir korunma seviyesi henüz kurulamadı.";
  elements.netTargetMeaning.textContent = Number.isFinite(selectedCandidate?.netTargetPctFeeCaseB)
    ? "3 USD ücret ve stres kayması çıktıktan sonra kalan tahmini hareket."
    : "Ücret ve kayma sonrası kalan hareket henüz hesaplanamadı.";
}

async function loadSnapshot(force = false) {
  if (state.loading) return;
  state.loading = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = "…";
  try {
    const response = await fetch(force ? "/api/collect" : "/api/snapshot", { method: force ? "POST" : "GET" });
    if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
    state.snapshot = await response.json();
    render();
  } catch (error) {
    elements.connectionDot.className = "status-dot error";
    elements.marketState.textContent = "Bağlantı hatası";
    elements.decisionTitle.textContent = "Veri alınamadı";
    elements.decisionReason.textContent = error.message;
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "↻";
  }
}

document.addEventListener("click", (event) => {
  const symbol = event.target.closest("[data-symbol]");
  if (symbol) { state.symbol = symbol.dataset.symbol; render(); }
  const model = event.target.closest("[data-model]");
  if (model) { state.model = model.dataset.model; render(); }
});

elements.refreshButton.addEventListener("click", () => loadSnapshot(true));
renderSelection();
await loadSnapshot();
setInterval(() => loadSnapshot(), 60_000);
