// ---------- SMART MONEY DIVERGENCE (vs USDX) ----------
// XAUUSD and USDX normally move inversely (negative correlation): dollar strength usually
// pressures gold lower, dollar weakness usually lifts gold. Same logic loosely applies to
// other USD-denominated risk assets. When USDX makes a new swing high but the instrument
// does NOT make the corresponding new swing low (or vice versa), the expected inverse
// relationship has broken down — a divergence that can flag exhaustion or a coming reversal.

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

// Aligns two candle series (instrument + USDX) by matching timestamps, since they may not
// have identical bar counts/gaps.
function alignByTime(candlesA, candlesB) {
  const mapB = new Map(candlesB.map((c) => [c.time, c]));
  const aligned = [];
  for (const a of candlesA) {
    const b = mapB.get(a.time);
    if (b) aligned.push({ time: a.time, a, b });
  }
  return aligned;
}

/**
 * Detects divergence between the instrument and USDX.
 * instrumentCandles, usdxCandles: 1h OHLC candles, oldest -> newest.
 */
export function detectUsdxDivergence(instrumentCandles, usdxCandles, lookback = 40) {
  const results = [];
  if (!instrumentCandles || !usdxCandles || instrumentCandles.length < 20 || usdxCandles.length < 20) {
    return results;
  }

  const aligned = alignByTime(instrumentCandles, usdxCandles);
  if (aligned.length < 20) return results;

  const recentAligned = aligned.slice(-lookback);
  const instrSeries = recentAligned.map((p) => p.a);
  const usdxSeries = recentAligned.map((p) => p.b);

  const instrSwings = findSwingPoints(instrSeries);
  const usdxSwings = findSwingPoints(usdxSeries);

  if (usdxSwings.highs.length < 2 || usdxSwings.lows.length < 2) return results;
  if (instrSwings.highs.length < 2 || instrSwings.lows.length < 2) return results;

  // Case 1: USDX makes a Higher-High, but instrument fails to make a corresponding Lower-Low
  // (expected: USD up -> instrument down). If instrument instead makes a Higher-Low or
  // Higher-High too, that's bullish divergence for the instrument (USD strength not confirmed).
  const usdxLastTwoHighs = usdxSwings.highs.slice(-2);
  const usdxMadeHigherHigh = usdxLastTwoHighs.length === 2 && usdxLastTwoHighs[1].price > usdxLastTwoHighs[0].price;

  if (usdxMadeHigherHigh) {
    const instrLastTwoLows = instrSwings.lows.slice(-2);
    if (instrLastTwoLows.length === 2) {
      const instrMadeLowerLow = instrLastTwoLows[1].price < instrLastTwoLows[0].price;
      if (!instrMadeLowerLow) {
        results.push({
          type: "usdxdivergence",
          direction: "bullish", // bullish for the instrument
          time: instrLastTwoLows[1].time,
          usdxLevel: usdxLastTwoHighs[1].price,
          instrumentLevel: instrLastTwoLows[1].price,
          detail: `USDX Higher-High (${usdxLastTwoHighs[1].price.toFixed(2)}) neconfirmat de instrument — nu a făcut Lower-Low corespunzător`,
        });
      }
    }
  }

  // Case 2: USDX makes a Lower-Low, but instrument fails to make a corresponding Higher-High
  // (expected: USD down -> instrument up). If not confirmed, that's bearish divergence for
  // the instrument (USD weakness not being capitalized on — possible underlying weakness).
  const usdxLastTwoLows = usdxSwings.lows.slice(-2);
  const usdxMadeLowerLow = usdxLastTwoLows.length === 2 && usdxLastTwoLows[1].price < usdxLastTwoLows[0].price;

  if (usdxMadeLowerLow) {
    const instrLastTwoHighs = instrSwings.highs.slice(-2);
    if (instrLastTwoHighs.length === 2) {
      const instrMadeHigherHigh = instrLastTwoHighs[1].price > instrLastTwoHighs[0].price;
      if (!instrMadeHigherHigh) {
        results.push({
          type: "usdxdivergence",
          direction: "bearish", // bearish for the instrument
          time: instrLastTwoHighs[1].time,
          usdxLevel: usdxLastTwoLows[1].price,
          instrumentLevel: instrLastTwoHighs[1].price,
          detail: `USDX Lower-Low (${usdxLastTwoLows[1].price.toFixed(2)}) neconfirmat de instrument — nu a făcut Higher-High corespunzător`,
        });
      }
    }
  }

  return results.reverse();
}
