// ---------- REJECTION BLOCK ----------
// On a higher timeframe candle, when the body (|open - close|) is small relative to the
// wicks (strong rejection / near-doji with long wicks), the level where open ≈ close
// becomes a line projected forward in time. We watch for future candles reacting at that
// exact level (touching it and reversing, or at least pausing there).

const MAX_BODY_TO_RANGE_RATIO = 0.25; // body must be <=25% of full range to count as rejection
const MIN_WICK_TO_RANGE_RATIO = 0.5; // wicks together must be >=50% of range

function body(c) { return Math.abs(c.close - c.open); }
function range(c) { return c.high - c.low; }

export function detectRejectionBlocks(candles) {
  const blocks = [];
  if (!candles || candles.length < 5) return blocks;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const r = range(c);
    if (r <= 0) continue;
    const b = body(c);
    const bodyRatio = b / r;
    const wickRatio = 1 - bodyRatio;

    if (bodyRatio <= MAX_BODY_TO_RANGE_RATIO && wickRatio >= MIN_WICK_TO_RANGE_RATIO) {
      const level = (c.open + c.close) / 2; // the open≈close level
      // Direction guess: which side has the longer wick tells us which way price was rejected from
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const direction = lowerWick > upperWick ? "bullish" : "bearish"; // rejected off the lows -> bullish reaction zone

      blocks.push({
        type: "rejectionblock",
        index: i,
        time: c.time,
        direction,
        level,
        bodyRatio,
        candleHigh: c.high,
        candleLow: c.low,
        candle: c,
      });
    }
  }
  return blocks.reverse();
}

export function markRejectionStatus(blocks, candles, toleranceFraction = 0.0015, validDays = 14) {
  return blocks.map((rb) => {
    const futureCandles = candles.slice(rb.index + 1);
    const tolerance = rb.level * toleranceFraction; // tiny price-relative tolerance band around the line
    let testedAt = null;
    for (const c of futureCandles) {
      if (c.low - tolerance <= rb.level && c.high + tolerance >= rb.level) { testedAt = c.time; break; }
    }
    let expired = false;
    if (!testedAt && rb.time) {
      const ageMs = Date.now() - new Date(rb.time).getTime();
      expired = ageMs > validDays * 24 * 60 * 60 * 1000;
    }
    return { ...rb, tested: !!testedAt, testedAt, reacted: !!testedAt, expired, live: !testedAt && !expired };
  });
}
