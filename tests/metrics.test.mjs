import test from "node:test";
import assert from "node:assert/strict";
import { buildDataReadiness, summarizeBasket, summarizeChart } from "../lib/metrics.mjs";
import { parseMarketNumber } from "../lib/nasdaq.mjs";
import { parseRss } from "../lib/news.mjs";

test("chart özeti kapanmış barlardan VWAP üretir", () => {
  const observedAt = "2026-10-08T15:00:00.000Z";
  const chart = {
    symbol: "MU",
    source: "test",
    meta: {
      currency: "USD",
      chartPreviousClose: 100,
      currentTradingPeriod: {
        regular: { start: 1791464400, end: 1791487800 }
      }
    },
    bars: [
      { timestamp: 1791464400, open: 100, high: 102, low: 99, close: 101, volume: 100 },
      { timestamp: 1791464460, open: 101, high: 103, low: 100, close: 102, volume: 200 }
    ]
  };
  const result = summarizeChart(chart, observedAt);
  assert.equal(result.price, 102);
  assert.equal(result.changePct, 2);
  assert.equal(result.sessionVolume, 300);
  assert.equal(result.qualityStatus, "VALID");
});

test("sepet kapsaması ve yönü görünür kalır", () => {
  const result = summarizeBasket({ MU: { changePct: 1.2 }, WDC: { changePct: 0.4 } }, ["MU", "WDC", "STX"]);
  assert.equal(result.state, "POSITIVE");
  assert.equal(result.validCount, 2);
  assert.equal(result.requestedCount, 3);
  assert.equal(result.coverage, 0.667);
});

test("eksik zorunlu seri skoru açmaz", () => {
  const result = buildDataReadiness({ MU: { qualityStatus: "VALID" } }, [], ["MU", "SNDK"]);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.scoringAllowed, false);
  assert.deepEqual(result.missingMarketSymbols, ["SNDK"]);
});

test("Nasdaq para ve yüzde alanları güvenli sayıya dönüşür", () => {
  assert.equal(parseMarketNumber("$1,063.71"), 1063.71);
  assert.equal(parseMarketNumber("-2.22%"), -2.22);
  assert.equal(parseMarketNumber("N/A"), null);
});

test("RSS haberi yayın ve ilk görülme zamanını ayırır", () => {
  const xml = `<rss><channel><item><title>MU &amp; memory</title><link>https://example.test/a</link><pubDate>Thu, 08 Oct 2026 15:00:00 GMT</pubDate><source>Example</source></item></channel></rss>`;
  const [item] = parseRss(xml, "MU", "2026-10-08T15:10:00.000Z");
  assert.equal(item.title, "MU & memory");
  assert.equal(item.publishedAt, "2026-10-08T15:00:00.000Z");
  assert.equal(item.availableAt, "2026-10-08T15:10:00.000Z");
  assert.equal(item.availabilityBasis, "FIRST_SEEN_LIVE");
});
