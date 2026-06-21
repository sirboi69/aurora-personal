// ---------- ORB (Opening Range Breakout) — Value Area variant ----------
// Built from the 5-minute candles 09:30-09:45 NY (the first 3 five-minute bars).
// Twelve Data doesn't expose true tick-level volume-at-price, so the Value Area here is
// an APPROXIMATION: each candle's traded "weight" is distributed across its price range,
// with the body (open->close) weighted heavier than the wicks (price tends to spend more
// time/volume in the body than in the wick extremes). POC = price level with the most
// accumulated weight. VAH/VAL = symmetric expansion from POC until 70% of total weight
// is enclosed. This is NOT real Volume Profile — it's the closest approximation possible
// without tick data.

const BODY_WEIGHT = 3; // body price levels get 3x the weight of wick-only levels
const VALUE_AREA_PCT = 0.7;
const HISTOGRAM_BUCKETS = 40; // resolution of the approximated price histogram

function getNyHourMinute(isoTime) {
  const d = new Date(isoTime + (isoTime.includes("Z") || isoTime.includes("+") ? "" : "Z"));
  const nyFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = nyFormatter.formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
  return { hour: h, minute: m };
}

function getNyDateKey(isoTime) {
  const d = new Date(isoTime + (isoTime.includes("Z") || isoTime.includes("+") ? "" : "Z"));
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(d);
}

// Builds an approximated volume-weighted price histogram from 3 candles and derives POC/VAH/VAL.
function buildApproxValueArea(candles) {
  const allHighs = candles.map((c) => c.high);
  const allLows = candles.map((c) => c.low);
  const rangeHigh = Math.max(...allHighs);
  const rangeLow = Math.min(...allLows);
  const totalRange = rangeHigh - rangeLow;
  if (totalRange <= 0) return null;

  const bucketSize = totalRange / HISTOGRAM_BUCKETS;
  const buckets = new Array(HISTOGRAM_BUCKETS).fill(0);

  const bucketIndexForPrice = (price) => {
    const idx = Math.floor((price - rangeLow) / bucketSize);
    return Math.min(HISTOGRAM_BUCKETS - 1, Math.max(0, idx));
  };

  for (const c of candles) {
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);
    const candleVolume = c.volume && c.volume > 0 ? c.volume : 1; // fall back to equal weighting if no volume

    // Distribute weight across buckets this candle spans, body weighted heavier
    const startBucket = bucketIndexForPrice(c.low);
    const endBucket = bucketIndexForPrice(c.high);
    for (let b = startBucket; b <= endBucket; b++) {
      const bucketPriceLow = rangeLow + b * bucketSize;
      const bucketPriceHigh = bucketPriceLow + bucketSize;
      const isBodyBucket = bucketPriceHigh > bodyLow && bucketPriceLow < bodyHigh;
      const weight = (isBodyBucket ? BODY_WEIGHT : 1) * candleVolume;
      buckets[b] += weight;
    }
  }

  const totalWeight = buckets.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return null;

  let pocIndex = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] > buckets[pocIndex]) pocIndex = i;
  }
  const poc = rangeLow + (pocIndex + 0.5) * bucketSize;

  // Expand symmetrically from POC until >=70% of weight is enclosed
  let enclosedWeight = buckets[pocIndex];
  let lo = pocIndex;
  let hi = pocIndex;
  while (enclosedWeight / totalWeight < VALUE_AREA_PCT && (lo > 0 || hi < buckets.length - 1)) {
    const nextLoWeight = lo > 0 ? buckets[lo - 1] : -1;
    const nextHiWeight = hi < buckets.length - 1 ? buckets[hi + 1] : -1;
    if (nextHiWeight >= nextLoWeight) {
      hi++;
      enclosedWeight += buckets[hi];
    } else {
      lo--;
      enclosedWeight += buckets[lo];
    }
  }

  const val = rangeLow + lo * bucketSize;
  const vah = rangeLow + (hi + 1) * bucketSize;

  return { poc, vah, val, rangeHigh, rangeLow, approximated: true };
}

/**
 * Finds today's (most recent) ORB setup from 5-minute candles.
 * candles: 5-minute OHLCV candles, oldest -> newest.
 */
export function detectOrbSetup(candles5m, tickSize = 0.1) {
  if (!candles5m || candles5m.length < 10) return null;

  // Find the most recent NY trading day present in the data
  const lastCandle = candles5m[candles5m.length - 1];
  const todayKey = getNyDateKey(lastCandle.time);

  const todayCandles = candles5m.filter((c) => getNyDateKey(c.time) === todayKey);

  // The opening range candles: 09:30, 09:35, 09:40 NY (first 3 bars of the session)
  const orCandles = todayCandles.filter((c) => {
    const { hour, minute } = getNyHourMinute(c.time);
    const totalMin = hour * 60 + minute;
    return totalMin >= 9 * 60 + 30 && totalMin < 9 * 60 + 45;
  });

  if (orCandles.length < 3) return null;

  const valueArea = buildApproxValueArea(orCandles.slice(0, 3));
  if (!valueArea) return null;

  // Candles after the opening range, same day, for evaluating fakeout/breakout
  const afterOrCandles = todayCandles.filter((c) => {
    const { hour, minute } = getNyHourMinute(c.time);
    const totalMin = hour * 60 + minute;
    return totalMin >= 9 * 60 + 45;
  });

  return {
    type: "orb",
    day: todayKey,
    valueArea,
    orCandles: orCandles.slice(0, 3),
    afterOrCandles,
    tickSize,
  };
}

// Detects a swing high/low near the OR zone within the broader candle set (for fakeout setup context)
function findNearbyLiquidity(allCandles, valueArea, lookback = 30) {
  const recent = allCandles.slice(-lookback);
  const aboveVAH = recent.filter((c) => c.high > valueArea.vah);
  const belowVAL = recent.filter((c) => c.low < valueArea.val);
  const nearestHighAbove = aboveVAH.length ? Math.max(...aboveVAH.map((c) => c.high)) : null;
  const nearestLowBelow = belowVAL.length ? Math.min(...belowVAL.map((c) => c.low)) : null;
  return { nearestHighAbove, nearestLowBelow };
}

/**
 * Evaluates the two setup types (Fakeout / Breakout) against candles after the OR formed.
 * allCandles5m: full 5m candle history (for liquidity context before the OR).
 */
export function evaluateOrbSetups(orbSetup, allCandles5m) {
  if (!orbSetup) return [];
  const { valueArea, afterOrCandles, tickSize } = orbSetup;
  const { vah, val, poc } = valueArea;
  const results = [];

  const liquidity = findNearbyLiquidity(allCandles5m, valueArea);

  // --- FAKEOUT SETUP ---
  // Look for: price breaks above VAH or below VAL, touches nearby liquidity, then a 5m
  // candle closes back inside the Value Area.
  for (let i = 0; i < afterOrCandles.length; i++) {
    const c = afterOrCandles[i];
    const brokeAbove = c.high > vah;
    const brokeBelow = c.low < val;
    if (!brokeAbove && !brokeBelow) continue;

    // Look forward for a candle closing back inside VA
    for (let j = i; j < afterOrCandles.length; j++) {
      const confirmCandle = afterOrCandles[j];
      const closedBackInside = confirmCandle.close <= vah && confirmCandle.close >= val;
      if (!closedBackInside) continue;

      const direction = brokeAbove ? "bearish" : "bullish"; // fakeout up -> short; fakeout down -> long
      const sl = brokeAbove ? confirmCandle.high + tickSize * 2 : confirmCandle.low - tickSize * 2;
      const entry = confirmCandle.close;
      const tp = direction === "bullish" ? vah : val; // opposite side of the OR as a first target

      results.push({
        setupType: "fakeout",
        direction,
        time: confirmCandle.time,
        entry,
        sl,
        tp,
        vah,
        val,
        poc,
        sweptLevel: brokeAbove ? liquidity.nearestHighAbove ?? c.high : liquidity.nearestLowBelow ?? c.low,
        detail: `Fakeout ${brokeAbove ? "sus" : "jos"} → închidere înapoi în Value Area`,
      });
      break; // only first confirmation per breakout
    }
  }

  // --- BREAKOUT SETUP ---
  // A clean 5m close outside the Value Area, in the direction of trend or after a prior sweep.
  for (const c of afterOrCandles) {
    const closedAboveVAH = c.close > vah;
    const closedBelowVAL = c.close < val;
    if (!closedAboveVAH && !closedBelowVAL) continue;

    const direction = closedAboveVAH ? "bullish" : "bearish";
    const sl = direction === "bullish" ? poc - tickSize * 2 : poc + tickSize * 2;
    const entry = c.close;
    const riskDist = Math.abs(entry - sl);
    const tp = direction === "bullish" ? entry + riskDist * 2 : entry - riskDist * 2; // fixed 2R

    results.push({
      setupType: "breakout",
      direction,
      time: c.time,
      entry,
      sl,
      tp,
      vah,
      val,
      poc,
      detail: `Închidere 5m ${direction === "bullish" ? "peste VAH" : "sub VAL"} · target 2R`,
    });
  }

  return results;
}
