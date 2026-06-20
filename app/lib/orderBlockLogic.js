// ---------- ORDER BLOCK (ICT classic, 7-point validity checklist) ----------
// 1. Fresh — zone not touched again since formation
// 2. Impulsive — at least 3 of next 5 candles have strong bodies
// 3. Sweeps prior candle's liquidity
// 4. Strong first candle (the displacement candle right after the OB)
// 5. Break of Structure (BOS) confirmed
// 6. Supply/Demand zone origin (not mid-trend)
// 7. Not in a ranging market

const STRONG_BODY_RATIO = 0.55;
const IMPULSE_BODY_MULTIPLIER = 2;
const RANGE_LOOKBACK = 20;

function body(c) { return Math.abs(c.close - c.open); }
function range(c) { return c.high - c.low; }
function isBullish(c) { return c.close > c.open; }
function avgBody(candles) {
  if (!candles.length) return 0;
  return candles.reduce((s, c) => s + body(c), 0) / candles.length;
}

function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const c = candles[i];
    if (c.high === Math.max(...window.map((w) => w.high))) highs.push({ index: i, price: c.high });
    if (c.low === Math.min(...window.map((w) => w.low))) lows.push({ index: i, price: c.low });
  }
  return { highs, lows };
}

function isRangingMarket(candles, atEndIndex) {
  const lookStart = Math.max(0, atEndIndex - RANGE_LOOKBACK);
  const window = candles.slice(lookStart, atEndIndex + 1);
  if (window.length < 5) return false;
  const highestHigh = Math.max(...window.map((c) => c.high));
  const lowestLow = Math.min(...window.map((c) => c.low));
  const totalRange = highestHigh - lowestLow;
  const avgCandleRange = window.reduce((s, c) => s + range(c), 0) / window.length;
  if (avgCandleRange === 0) return true;
  const expansionRatio = totalRange / (avgCandleRange * window.length);
  return expansionRatio < 0.35;
}

export function detectOrderBlocks(candles) {
  const results = [];
  if (!candles || candles.length < 30) return results;

  const { highs, lows } = findSwingPoints(candles);
  const recentAvgBody = avgBody(candles.slice(-30));

  for (let i = 5; i < candles.length - 5; i++) {
    const candle = candles[i];
    const next5 = candles.slice(i + 1, i + 6);
    if (next5.length < 5) continue;
    const prevCandle = candles[i - 1];

    const moveUp = next5[next5.length - 1].close > candle.close;
    const direction = moveUp ? "bullish" : "bearish";

    const correctColor = direction === "bullish" ? !isBullish(candle) : isBullish(candle);
    if (!correctColor) continue;

    const zoneHigh = Math.max(candle.open, candle.close);
    const zoneLow = Math.min(candle.open, candle.close);
    const zoneSize = zoneHigh - zoneLow;
    if (zoneSize <= 0) continue;

    const checklist = {};

    const impulseCandle = next5[0];
    const impulseBody = body(impulseCandle);
    checklist.strongFirstCandle =
      impulseBody >= recentAvgBody * IMPULSE_BODY_MULTIPLIER &&
      impulseBody / Math.max(range(impulseCandle), 1e-9) >= STRONG_BODY_RATIO;

    const strongCount = next5.filter((c) => {
      const b = body(c);
      return b >= recentAvgBody * IMPULSE_BODY_MULTIPLIER && b / Math.max(range(c), 1e-9) >= STRONG_BODY_RATIO;
    }).length;
    checklist.impulsive = strongCount >= 3;

    checklist.sweepsLiquidity =
      direction === "bullish" ? candle.low <= prevCandle.low : candle.high >= prevCandle.high;

    let bos = false;
    if (direction === "bullish") {
      const relevantHighs = highs.filter((h) => h.index < i);
      const lastSwingHigh = relevantHighs[relevantHighs.length - 1];
      if (lastSwingHigh) bos = next5.some((c) => c.close > lastSwingHigh.price);
    } else {
      const relevantLows = lows.filter((l) => l.index < i);
      const lastSwingLow = relevantLows[relevantLows.length - 1];
      if (lastSwingLow) bos = next5.some((c) => c.close < lastSwingLow.price);
    }
    checklist.bos = bos;

    const priorTrendCandles = candles.slice(Math.max(0, i - 4), i);
    const priorDirection = priorTrendCandles.filter((c) => (direction === "bullish" ? isBullish(c) : !isBullish(c))).length;
    checklist.zoneOrigin = priorDirection <= 2;

    checklist.notRanging = !isRangingMarket(candles, i);

    const laterCandles = candles.slice(i + 6);
    const touched = laterCandles.some((c) => c.low <= zoneHigh && c.high >= zoneLow);
    checklist.fresh = !touched;

    const passCount = Object.values(checklist).filter(Boolean).length;
    const valid = passCount === 7;

    if (passCount >= 4) {
      results.push({
        type: "orderblock",
        index: i,
        time: candle.time,
        direction,
        zoneHigh,
        zoneLow,
        zoneSize,
        checklist,
        passCount,
        valid,
        live: valid,
      });
    }
  }

  return results.reverse();
}
