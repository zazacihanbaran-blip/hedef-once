import { CORE_SYMBOLS } from "./config.mjs";
import { fetchEarningsCalendar, fetchEconomicCalendar } from "./nasdaq.mjs";
import { fetchNewsFeed } from "./news.mjs";
import { fetchRecentFilings } from "./sec.mjs";

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function futureDates(days) {
  const dates = [];
  const base = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + offset);
    dates.push(isoDate(date));
  }
  return dates;
}

async function settle(name, task, errors) {
  try {
    return await task;
  } catch (error) {
    errors.push({ layer: name, message: error.message });
    return [];
  }
}

export async function collectContextSnapshot(store) {
  const observedAt = new Date().toISOString();
  const errors = [];
  const dates = futureDates(8);

  const [muNews, sndkNews, sectorNews, muFilings, sndkFilings, economicByDay, earningsByDay] = await Promise.all([
    settle("news_mu", fetchNewsFeed("MU", '"Micron Technology" OR MU semiconductor', observedAt), errors),
    settle("news_sndk", fetchNewsFeed("SNDK", '"Sandisk Corporation" OR "SNDK stock"', observedAt), errors),
    settle("news_memory", fetchNewsFeed("MEMORY", 'DRAM OR NAND OR HBM memory semiconductor', observedAt), errors),
    settle("sec_mu", fetchRecentFilings("MU", observedAt), errors),
    settle("sec_sndk", fetchRecentFilings("SNDK", observedAt), errors),
    Promise.all(dates.map((date) => settle(`economic_${date}`, fetchEconomicCalendar(date), errors))),
    Promise.all(dates.map((date) => settle(`earnings_${date}`, fetchEarningsCalendar(date, CORE_SYMBOLS), errors)))
  ]);

  const context = {
    schemaVersion: "0.1.0",
    observedAt,
    sourceProfile: "NO_KEY_PUBLIC_CONTEXT",
    news: [...muNews, ...sndkNews, ...sectorNews]
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    filings: [...muFilings, ...sndkFilings]
      .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? "")),
    events: [...economicByDay.flat(), ...earningsByDay.flat()]
      .sort((a, b) => `${a.date} ${a.timeGmt ?? "99:99"}`.localeCompare(`${b.date} ${b.timeGmt ?? "99:99"}`)),
    readiness: {
      newsConnected: muNews.length + sndkNews.length + sectorNews.length > 0,
      filingsConnected: muFilings.length + sndkFilings.length > 0,
      calendarConnected: errors.every((error) => !error.layer.startsWith("economic_") && !error.layer.startsWith("earnings_")),
      historicalPitReady: false,
      notice: "Canlı haber point-in-time arşivi bugün başlar; geçmiş RSS sonuçları tarihsel PIT kanıtı değildir.",
      errors
    }
  };

  await store.saveContext(context);
  return context;
}
