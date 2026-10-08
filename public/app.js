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
  "softVetoList", "observedAt", "quoteGrid", "newsObservedAt", "newsList", "eventList", "refreshButton"
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
  NEGATIVE_MEMORY_BASKET: "Memory grubu negatif"
};

const scoreLabels = {
  priceVolume: "Hareket",
  volatilityTime: "Hedef süresi",
  sectorBasket: "Memory/sektör",
  newsEvent: "Haber/olay",
  targetStop: "Hedef/stop",
  macro: "Genel piyasa",
  execution: "Giriş kalitesi",
  crowdedRisk: "Yorgunluk riski"
};

function renderPrediction(predictions) {
  const candidate = predictions?.candidates?.find((item) => item.symbol === state.symbol && item.modelKey === state.model);
  if (!candidate) {
    elements.decisionScore.textContent = "—";
    elements.probabilityStatus.textContent = "Kalibrasyon bekliyor";
    elements.signalTime.textContent = "Sinyal bekleniyor";
    elements.scoreGrid.replaceChildren();
    return;
  }
  const decisionText = ({ NO_TRADE: "Uzak dur", WATCH: "İzle", PAPER_RESEARCH: "Kağıt araştırma adayı" })[candidate.finalDecision] ?? candidate.finalDecision;
  elements.decisionTitle.textContent = decisionText;
  elements.decisionReason.textContent = candidate.hardVetos.length
    ? vetoLabels[candidate.hardVetos[0]] ?? candidate.hardVetos[0]
    : candidate.softVetos.length ? vetoLabels[candidate.softVetos[0]] ?? candidate.softVetos[0] : "Araştırma kuralları olumlu.";
  elements.decisionScore.textContent = `${candidate.decisionScore}/100`;
  elements.probabilityStatus.textContent = "Henüz üretilmiyor";
  elements.entryValue.textContent = formatPrice(candidate.entryPrice);
  elements.targetValue.textContent = formatPrice(candidate.targetPrice);
  elements.stopValue.textContent = formatPrice(candidate.stopPrice);
  elements.timeValue.textContent = Number.isFinite(candidate.expectedMinutes) ? `~${candidate.expectedMinutes} dk` : "Belirsiz";
  elements.netTargetValue.textContent = formatPercent(candidate.netTargetPctFeeCaseB * 100);
  elements.vetoText.textContent = candidate.hardVetos.length ? (vetoLabels[candidate.hardVetos[0]] ?? candidate.hardVetos[0]) : "Model henüz doğrulanmadı";
  elements.signalTime.textContent = `Karar zamanı ${formatClock(candidate.decisionAt)}`;
  elements.hardVetoList.textContent = candidate.hardVetos.length ? candidate.hardVetos.map((code) => vetoLabels[code] ?? code).join(" · ") : "Yok";
  elements.softVetoList.textContent = candidate.softVetos.length ? candidate.softVetos.map((code) => vetoLabels[code] ?? code).join(" · ") : "Yok";
  elements.scoreGrid.replaceChildren(...Object.entries(candidate.scores).map(([key, value]) => {
    const item = document.createElement("article");
    item.className = "score-item";
    item.innerHTML = `<div><span>${scoreLabels[key] ?? key}</span><strong>${Math.round(value)}</strong></div><div class="score-track"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>`;
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
  elements.metricVwap.textContent = formatPrice(quote?.vwap);
  elements.metricRange.textContent = `${formatPrice(quote?.sessionHigh)} / ${formatPrice(quote?.sessionLow)}`;
  elements.metricVolume.textContent = formatVolume(quote?.sessionVolume);
  elements.metricBidAsk.textContent = `${formatPrice(execution?.bid)} / ${formatPrice(execution?.ask)}`;
  elements.metricSpread.textContent = Number.isFinite(execution?.spreadBps) ? `${execution.spreadBps.toLocaleString("tr-TR")} bps` : "—";
  elements.memoryState.textContent = `${stateLabel(snapshot.baskets.memory.state)} · ${formatPercent(snapshot.baskets.memory.averageChangePct)}`;
  elements.sectorState.textContent = `${stateLabel(snapshot.baskets.sector.state)} · ${formatPercent(snapshot.baskets.sector.averageChangePct)}`;
  elements.vetoText.textContent = connectedAll ? "Model henüz doğrulanmadı" : "Eksik veri katmanları";
  elements.priceLayer.textContent = ready ? "Hazır" : "Eksik";
  elements.priceLayer.className = ready ? "positive" : "warning-text";
  layerState(elements.executionLayer, execution?.qualityStatus === "VALID", execution?.isRealTime ? "Bağlı · gerçek zamanlı" : "Bağlı");
  elements.observedAt.textContent = `Son toplama: ${formatClock(snapshot.observedAt)}`;
  renderQuoteGrid(snapshot);
  renderContext(snapshot.context);
  renderPrediction(snapshot.predictions);
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
