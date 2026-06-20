// ---------- BACKTEST ENGINE ----------
// Walk forward through historical candles, find gran boxes, and for each one that gets
// tested (price reaches the target level), simulate a trade: entry at the level, SL/TP
// set in pips, then scan forward candle-by-candle to see whether SL or TP is hit first.

import { detectDisplacements, markTestedLevels, DEFAULT_PARAMS } from "./granBoxLogic";

const DEFAULT_BACKTEST_PARAMS = {
  slPips: 15,
  tpPips: 20,
  pipSize: 0.1, // for XAUUSD, 1 pip ≈ 0.1; for SPX, treat 1 pip ≈ 1 point (override per symbol)
  maxHoldCandles: 48, // give up and mark "no result" after this many candles (~2 days on 1h)
};

const PIP_SIZE_BY_SYMBOL = {
  XAUUSD: 0.1,
  SPX: 1,
};

export function runBacktest(candles, strategyParams = {}, backtestParams = {}, symbolKey = "XAUUSD") {
  const sParams = { ...DEFAULT_PARAMS, ...strategyParams };
  const bParams = {
    ...DEFAULT_BACKTEST_PARAMS,
    pipSize: PIP_SIZE_BY_SYMBOL[symbolKey] ?? DEFAULT_BACKTEST_PARAMS.pipSize,
    ...backtestParams,
  };

  if (!candles || candles.length < 30) {
    return { trades: [], summary: emptySummary() };
  }

  const rawBoxes = detectDisplacements(candles, sParams);
  const boxesWithStatus = markTestedLevels(rawBoxes, candles, sParams);

  // We need boxes in chronological order to walk forward correctly.
  const chronoBoxes = [...boxesWithStatus].sort((a, b) => a.index - b.index);

  const trades = [];

  for (const box of chronoBoxes) {
    if (!box.sweepValid) continue; // only trade validated sweeps, same as live scanner

    const targetPrice = box.levels[sParams.targetLevel];
    const tolerance = box.zoneSize * sParams.levelToleranceFraction;
    const direction = box.direction === "bullish" ? "LONG" : "SHORT";

    // Find the first candle after the box where price touches the target level
    let entryIndex = null;
    for (let i = box.index + 1; i < candles.length; i++) {
      const c = candles[i];
      const touches = c.low - tolerance <= targetPrice && c.high + tolerance >= targetPrice;
      if (touches) { entryIndex = i; break; }
    }
    if (entryIndex === null) continue; // never got tested within available data

    const entry = targetPrice;
    const pipDist = bParams.pipSize;
    const sl = direction === "LONG" ? entry - bParams.slPips * pipDist : entry + bParams.slPips * pipDist;
    const tp = direction === "LONG" ? entry + bParams.tpPips * pipDist : entry - bParams.tpPips * pipDist;

    // Walk forward from entry candle to see which hits first: SL or TP
    let result = "open"; // "win" | "loss" | "open" (ran out of data / maxHold)
    let exitIndex = null;
    let exitPrice = null;

    const endIndex = Math.min(entryIndex + bParams.maxHoldCandles, candles.length - 1);
    for (let i = entryIndex; i <= endIndex; i++) {
      const c = candles[i];
      if (direction === "LONG") {
        const hitSl = c.low <= sl;
        const hitTp = c.high >= tp;
        if (hitSl && hitTp) {
          // ambiguous same-candle hit; assume SL first (conservative)
          result = "loss"; exitIndex = i; exitPrice = sl; break;
        } else if (hitSl) {
          result = "loss"; exitIndex = i; exitPrice = sl; break;
        } else if (hitTp) {
          result = "win"; exitIndex = i; exitPrice = tp; break;
        }
      } else {
        const hitSl = c.high >= sl;
        const hitTp = c.low <= tp;
        if (hitSl && hitTp) {
          result = "loss"; exitIndex = i; exitPrice = sl; break;
        } else if (hitSl) {
          result = "loss"; exitIndex = i; exitPrice = sl; break;
        } else if (hitTp) {
          result = "win"; exitIndex = i; exitPrice = tp; break;
        }
      }
    }

    const pipsResult = result === "win" ? bParams.tpPips : result === "loss" ? -bParams.slPips : 0;

    trades.push({
      boxTime: box.time,
      entryTime: candles[entryIndex].time,
      exitTime: exitIndex !== null ? candles[exitIndex].time : null,
      direction,
      entry,
      sl,
      tp,
      exitPrice,
      result,
      pips: pipsResult,
      sweepPenetration: box.penetration,
    });
  }

  return { trades, summary: summarize(trades) };
}

function emptySummary() {
  return { totalTrades: 0, wins: 0, losses: 0, open: 0, winRate: 0, totalPips: 0, avgPips: 0 };
}

function summarize(trades) {
  const closed = trades.filter((t) => t.result !== "open");
  const wins = trades.filter((t) => t.result === "win").length;
  const losses = trades.filter((t) => t.result === "loss").length;
  const open = trades.filter((t) => t.result === "open").length;
  const totalPips = trades.reduce((s, t) => s + t.pips, 0);
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const avgPips = closed.length > 0 ? totalPips / closed.length : 0;

  return {
    totalTrades: trades.length,
    wins,
    losses,
    open,
    winRate,
    totalPips,
    avgPips,
  };
}

export { DEFAULT_BACKTEST_PARAMS, PIP_SIZE_BY_SYMBOL };
