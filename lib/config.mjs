export const MARKET_SYMBOLS = [
  { symbol: "MU", label: "Micron", group: "core" },
  { symbol: "SNDK", label: "Sandisk", group: "core" },
  { symbol: "WDC", label: "Western Digital", group: "memory" },
  { symbol: "STX", label: "Seagate", group: "memory" },
  { symbol: "NVDA", label: "Nvidia", group: "semiconductor" },
  { symbol: "AMD", label: "AMD", group: "semiconductor" },
  { symbol: "AVGO", label: "Broadcom", group: "semiconductor" },
  { symbol: "AMAT", label: "Applied Materials", group: "equipment" },
  { symbol: "LRCX", label: "Lam Research", group: "equipment" },
  { symbol: "ASML", label: "ASML", group: "equipment" },
  { symbol: "SMH", label: "VanEck Semiconductor ETF", group: "sector" },
  { symbol: "SOXX", label: "iShares Semiconductor ETF", group: "sector" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF", group: "market" },
  { symbol: "SPY", label: "S&P 500 ETF", group: "market" },
  { symbol: "^VIX", label: "VIX", group: "macro" },
  { symbol: "^TNX", label: "US 10Y proxy", group: "macro" },
  { symbol: "DX-Y.NYB", label: "DXY proxy", group: "macro" },
  { symbol: "NQ=F", label: "Nasdaq futures", group: "futures" },
  { symbol: "ES=F", label: "S&P futures", group: "futures" }
];

export const CORE_SYMBOLS = ["MU", "SNDK"];
export const MEMORY_SYMBOLS = ["MU", "SNDK", "WDC", "STX"];
export const SECTOR_SYMBOLS = ["SMH", "SOXX"];
export const MARKET_CONTEXT_SYMBOLS = ["QQQ", "SPY", "^VIX", "^TNX", "DX-Y.NYB", "NQ=F", "ES=F"];

export const COLLECTION_INTERVAL_MS = 60_000;
export const CONTEXT_INTERVAL_MS = 30 * 60_000;
export const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_PARALLEL_REQUESTS = 4;
