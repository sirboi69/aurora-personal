// ---------- ChoCh (Change of Character) ----------
// Distinct from BOS (Break of Structure, which confirms trend CONTINUATION): ChoCh marks
// the moment market structure flips — a bullish sequence of Higher-Highs/Higher-Lows
// breaks down into a Lower-Low (first crack), or a bearish Lower-High/Lower-Low sequence
// breaks into a Higher-High. This is the earliest objective signal of a potential trend
// reversal.

function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const c = candles[i];
    if (c.high === Math.max(...window.map((w) => w.high))) highs.push({ index: i, price: c.high, time: c.time });
    if (c.low === Math.min(...window.map((w) => w.low))) lows.push({ index: i, price: c.low, time: c.time });
  }
  return { highs, lows };
}

/**
 * Walks through swing points chronologically, tracking the prevailing structure
 * (bullish/bearish/unclear) and flags the candle where structure flips.
 */
export function detectChoCh(candles) {
  const { highs, lows } = findSwingPoints(candles);
  if (highs.length < 3 || lows.length < 3) return [];

  // Merge highs and lows into one chronological sequence of swing points
  const allSwings = [
    ...highs.map((h) => ({ ...h, kind: "high" })),
    ...lows.map((l) => ({ ...l, kind: "low" })),
  ].sort((a, b) => a.index - b.index);

  const results = [];
  let prevailingStructure = null; // "bullish" | "bearish"
  let lastHigh = null;
  let lastLow = null;

  for (const swing of allSwings) {
    if (swing.kind === "high") {
      if (lastHigh !== null) {
        const isHigherHigh = swing.price > lastHigh.price;
        if (prevailingStructure === "bearish" && isHigherHigh) {
          // Bearish structure just broke upward -> ChoCh to bullish
          results.push({
            type: "choch",
            direction: "bullish",
            index: swing.index,
            time: swing.time,
            brokenLevel: lastHigh.price,
            newPrice: swing.price,
            detail: `Higher-High rupe structura bearish anterioară (peste ${lastHigh.price.toFixed(2)})`,
          });
          prevailingStructure = "bullish";
        } else if (isHigherHigh) {
          prevailingStructure = "bullish";
        }
      }
      lastHigh = swing;
    } else {
      if (lastLow !== null) {
        const isLowerLow = swing.price < lastLow.price;
        if (prevailingStructure === "bullish" && isLowerLow) {
          // Bullish structure just broke downward -> ChoCh to bearish
          results.push({
            type: "choch",
            direction: "bearish",
            index: swing.index,
            time: swing.time,
            brokenLevel: lastLow.price,
            newPrice: swing.price,
            detail: `Lower-Low rupe structura bullish anterioară (sub ${lastLow.price.toFixed(2)})`,
          });
          prevailingStructure = "bearish";
        } else if (isLowerLow) {
          prevailingStructure = "bearish";
        }
      }
      lastLow = swing;
    }
  }

  return results.reverse(); // most recent first
}

// Only the most recent ChoCh is usually actionable; older ones are historical context.
export function getMostRecentChoCh(candles, maxAgeCandles = 30) {
  const all = detectChoCh(candles);
  if (all.length === 0) return null;
  const mostRecent = all[0];
  const ageInCandles = candles.length - 1 - mostRecent.index;
  if (ageInCandles > maxAgeCandles) return null;
  return { ...mostRecent, ageInCandles, live: true };
}
