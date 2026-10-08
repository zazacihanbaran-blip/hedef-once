import { REQUEST_TIMEOUT_MS } from "./config.mjs";

const COMPANIES = {
  MU: { cik: "0000723125", name: "Micron Technology" },
  SNDK: { cik: "0002023554", name: "Sandisk" }
};

const RELEVANT_FORMS = new Set(["8-K", "10-Q", "10-K", "6-K", "20-F", "DEF 14A", "SC 13D", "SC 13G"]);

export async function fetchRecentFilings(symbol, observedAt = new Date().toISOString()) {
  const company = COMPANIES[symbol];
  if (!company) throw new Error(`SEC CIK bulunamadı: ${symbol}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://data.sec.gov/submissions/CIK${company.cik}.json`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "HedefOnce/0.1 local-research"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    const payload = await response.json();
    const recent = payload.filings?.recent ?? {};
    return (recent.form ?? []).map((form, index) => ({
      symbol,
      company: company.name,
      form,
      filingDate: recent.filingDate?.[index] ?? null,
      reportDate: recent.reportDate?.[index] ?? null,
      acceptedAt: recent.acceptanceDateTime?.[index] ?? null,
      accessionNumber: recent.accessionNumber?.[index] ?? null,
      description: recent.primaryDocDescription?.[index] ?? null,
      items: recent.items?.[index] ?? null,
      source: "sec_edgar",
      firstSeenAt: observedAt,
      availableAt: recent.acceptanceDateTime?.[index] ?? observedAt,
      availabilityBasis: "OFFICIAL_ACCEPTANCE_TIME",
      url: recent.accessionNumber?.[index]
        ? `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${recent.accessionNumber[index].replaceAll("-", "")}/${recent.primaryDocument[index]}`
        : null
    })).filter((filing) => RELEVANT_FORMS.has(filing.form)).slice(0, 12);
  } finally {
    clearTimeout(timeout);
  }
}

