// ---------- LIQUIDITY ----------
// Swing highs/lows that haven't yet been swept (price hasn't traded through them) are
// resting liquidity — pools where stop orders likely sit. These are treated as a
// priority overlay: any other signal (FVG, Order Block, Rejection Block, Gran Box) that
// sits near unswept liquidity gets flagged as higher-confidence.

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

export function detectLiquidityPools(candles) {
  const { highs, lows } = findSwingPoints(candles);
  const pools = [];

  for (const h of highs) {
    const futureCandles = candles.slice(h.index + 1);
    const swept = futureCandles.some((c) => c.high > h.price);
    if (!swept) {
      pools.push({ type: "liquidity", direction: "sell-side-above", index: h.index, time: h.time, price: h.price, swept: false });
    }
  }
  for (const l of lows) {
    const futureCandles = candles.slice(l.index + 1);
    const swept = futureCandles.some((c) => c.low < l.price);
    if (!swept) {
      pools.push({ type: "liquidity", direction: "buy-side-below", index: l.index, time: l.time, price: l.price, swept: false });
    }
  }

  return pools.sort((a, b) => b.index - a.index);
}

// Checks whether a given price zone sits near (within toleranceFraction of price) an
// unswept liquidity pool — used to flag other signals as higher-confidence.
export function isNearLiquidity(zonePrice, pools, toleranceFraction = 0.002) {
  return pools.some((p) => {
    const tolerance = p.price * toleranceFraction;
    return Math.abs(zonePrice - p.price) <= tolerance;
  });
}
