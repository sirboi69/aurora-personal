// ---------- GRAN BOX STRATEGY LOGIC ----------

export const DEFAULT_PARAMS = {
  displacementBodyMultiplier: 2,
  displacementMinBodyRatio: 0.55,
  sweepMinPenetration: 0.5,
  targetLevel: 0.5,
  levelToleranceFraction: 0.08,
  boxValidDays: 7,
  noTradeAfterHourNY: 15,
};

function body(c) { return Math.abs(c.close - c.open); }
function range(c) { return c.high - c.low; }
function isBullish(c) { return c.close > c.open; }
function avgBody(candles) {
  if (!candles.length) return 0;
  return candles.reduce((s, c) => s + body(c), 0) / candles.length;
}

export function detectDisplacements(candles, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const boxes = [];
  if (!candles || candles.length < 20) return boxes;

  for (let i = 5; i < candles.length; i++) {
    const candle = candles[i];
    const lookback = candles.slice(Math.max(0, i - 15), i);
    const baseline = avgBody(lookback);
    if (baseline === 0) continue;

    const b = body(candle);
    const r = range(candle);
    const isStrong = b >= baseline * p.displacementBodyMultiplier && b / Math.max(r, 1e-9) >= p.displacementMinBodyRatio;
    if (!isStrong) continue;

    const direction = isBullish(candle) ? "bullish" : "bearish";
    const zoneHigh = Math.max(candle.open, candle.close);
    const zoneLow = Math.min(candle.open, candle.close);
    const zoneSize = zoneHigh - zoneLow;
    if (zoneSize <= 0) continue;

    const levelPrice = (lvl) => {
      if (direction === "bullish") return zoneHigh - lvl * zoneSize;
      return zoneLow + lvl * zoneSize;
    };
    const levels = { 0: levelPrice(0), 0.25: levelPrice(0.25), 0.5: levelPrice(0.5), 0.75: levelPrice(0.75), 1: levelPrice(1) };

    const prevCandle = candles[i - 1];
    const prevRange = range(prevCandle);
    let penetration = 0;
    if (prevRange > 0) {
      const overlap = Math.min(prevCandle.high, candle.high) - Math.max(prevCandle.low, candle.low);
      penetration = Math.max(0, overlap) / prevRange;
    }
    const sweepValid = penetration >= p.sweepMinPenetration;

    boxes.push({ index: i, time: candle.time, direction, zoneHigh, zoneLow, zoneSize, levels, sweepValid, penetration, candle });
  }
  return boxes.reverse();
}

export function markTestedLevels(boxes, candles, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const targetLevel = p.targetLevel;

  return boxes.map((box) => {
    const futureCandles = candles.slice(box.index + 1);
    const targetPrice = box.levels[targetLevel];
    const tolerance = box.zoneSize * p.levelToleranceFraction;

    let testedAt = null;
    for (const c of futureCandles) {
      const touchesLevel = c.low - tolerance <= targetPrice && c.high + tolerance >= targetPrice;
      if (touchesLevel) { testedAt = c.time; break; }
    }

    let expired = false;
    if (!testedAt && box.time) {
      const ageMs = Date.now() - new Date(box.time).getTime();
      expired = ageMs > p.boxValidDays * 24 * 60 * 60 * 1000;
    }

    return { ...box, tested: !!testedAt, testedAt, expired, live: box.sweepValid && !testedAt && !expired };
  });
}

export function suggestTradeFromBox(box, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const entry = box.levels[p.targetLevel];
  const direction = box.direction === "bullish" ? "LONG" : "SHORT";
  return { entry, direction, box };
}
