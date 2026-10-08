import { REQUEST_TIMEOUT_MS } from "./config.mjs";

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

export function parseRss(xml, topic, observedAt) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => {
    const published = tag(item, "pubDate");
    const publishedAt = published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null;
    return {
      topic,
      title: tag(item, "title"),
      link: tag(item, "link"),
      sourceName: tag(item, "source"),
      publishedAt,
      firstSeenAt: observedAt,
      availableAt: observedAt,
      availabilityBasis: "FIRST_SEEN_LIVE",
      source: "google_news_rss"
    };
  }).filter((item) => item.title && item.link);
}

export async function fetchNewsFeed(topic, query, observedAt = new Date().toISOString()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const params = new URLSearchParams({ q: `${query} when:2d`, hl: "en-US", gl: "US", ceid: "US:en" });
  try {
    const response = await fetch(`https://news.google.com/rss/search?${params}`, {
      headers: { "User-Agent": "HedefOnce/0.1 local-research" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`News RSS HTTP ${response.status}`);
    return parseRss(await response.text(), topic, observedAt).slice(0, 12);
  } finally {
    clearTimeout(timeout);
  }
}

