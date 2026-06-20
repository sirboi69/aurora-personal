// ---------- ORDER FLOW (basic, candle-derived approximation) ----------
// No real bid/ask or volume-at-price data is available from Twelve Data, so this is an
// approximation from price action:
// 1. Market structure: identify swing highs/lows and classify as Higher-High/Higher-Low
//    (bullish structure) or Lower-High/Lower-Low (bearish structure).
// 2. Momentum: count consecutive same-direction candles and their relative size to gauge
//    which side currently has control.

function isBullish(c) { return c.close > c.open; }
function body(c) { return Math.abs(c.close - c.open); }

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

export function analyzeMarketStructure(candles) {
  const { highs, lows } = findSwingPoints(candles);
  if (highs.length < 2 || lows.length < 2) {
    return { structure: "unclear", highs, lows };
  }

  const lastTwoHighs = highs.slice(-2);
  const lastTwoLows = lows.slice(-2);

  const higherHigh = lastTwoHighs[1].price > lastTwoHighs[0].price;
  const higherLow = lastTwoLows[1].price > lastTwoLows[0].price;
  const lowerHigh = lastTwoHighs[1].price < lastTwoHighs[0].price;
  const lowerLow = lastTwoLows[1].price < lastTwoLows[0].price;

  let structure = "ranging";
  if (higherHigh && higherLow) structure = "bullish"; // HH + HL
  else if (lowerHigh && lowerLow) structure = "bearish"; // LH + LL

  return { structure, highs, lows, lastTwoHighs, lastTwoLows };
}

export function analyzeMomentum(candles, lookback = 10) {
  const recent = candles.slice(-lookback);
  if (recent.length === 0) return { bias: "neutral", consecutiveCount: 0, avgBodyBias: 0 };

  // Consecutive same-direction streak ending at the most recent candle
  let consecutiveCount = 0;
  let lastDir = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const dir = isBullish(recent[i]) ? "up" : "down";
    if (lastDir === null) { lastDir = dir; consecutiveCount = 1; continue; }
    if (dir === lastDir) consecutiveCount++;
    else break;
  }

  const bullBody = recent.filter(isBullish).reduce((s, c) => s + body(c), 0);
  const bearBody = recent.filter((c) => !isBullish(c)).reduce((s, c) => s + body(c), 0);
  const totalBody = bullBody + bearBody;
  const avgBodyBias = totalBody > 0 ? (bullBody - bearBody) / totalBody : 0; // -1 (all bearish) to +1 (all bullish)

  const bias = avgBodyBias > 0.15 ? "bullish" : avgBodyBias < -0.15 ? "bearish" : "neutral";

  return { bias, consecutiveDirection: lastDir, consecutiveCount, avgBodyBias };
}

export function getOrderFlowSnapshot(candles) {
  const structureInfo = analyzeMarketStructure(candles);
  const momentumInfo = analyzeMomentum(candles);
  const prevMomentum = analyzeMomentum(candles.slice(0, -3));
  const accelerating = Math.abs(momentumInfo.avgBodyBias) > Math.abs(prevMomentum.avgBodyBias);

  return {
    type: "orderflow",
    time: candles[candles.length - 1]?.time,
    structure: structureInfo.structure,
    structureBias: structureInfo.structure,
    momentum: momentumInfo,
    consecutiveCount: momentumInfo.consecutiveCount,
    accelerating,
    swingHighs: structureInfo.highs?.slice(-3) ?? [],
    swingLows: structureInfo.lows?.slice(-3) ?? [],
  };
}
