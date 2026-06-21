// ---------- UNIFIED SIGNALS ----------
// Runs every strategy on the same candle set (1h for most, 4h for Rejection Block) and
// merges everything into one chronological feed, tagging each with its source strategy
// and whether it sits near resting liquidity.

import { detectDisplacements, markTestedLevels as markGranBoxTested } from "./granBoxLogic";
import { detectFVGs, markFVGStatus } from "./fvgLogic";
import { detectOrderBlocks } from "./orderBlockLogic";
import { detectRejectionBlocks, markRejectionStatus } from "./rejectionBlockLogic";
import { detectPower3Setups } from "./power3Logic";
import { getOrderFlowSnapshot } from "./orderFlowLogic";
import { detectLiquidityPools, isNearLiquidity } from "./liquidityLogic";
import { detectOrbSetup, evaluateOrbSetups } from "./orbLogic";
import { detectUsdxDivergence } from "./usdxDivergenceLogic";

export const STRATEGY_META = {
  granbox: { label: "Gran Box", color: "#D4AF37" },
  fvg: { label: "Fair Value Gap", color: "#4F8DFD" },
  orderblock: { label: "Order Block", color: "#A78BFA" },
  rejectionblock: { label: "Rejection Block", color: "#FB923C" },
  power3: { label: "Power 3", color: "#34D399" },
  orderflow: { label: "Order Flow", color: "#F472B6" },
  orb: { label: "ORB", color: "#22D3EE" },
  usdxdivergence: { label: "USDX Divergence", color: "#F59E0B" },
};

export function buildUnifiedSignals(candles, htfCandles = [], granBoxParams = {}, candles5m = [], usdxCandles = []) {
  if (!candles || candles.length < 30) {
    return [];
  }

  const liquidityPools = detectLiquidityPools(candles);

  let allSignals = [];

  const rawBoxes = detectDisplacements(candles, granBoxParams);
  const granBoxes = markGranBoxTested(rawBoxes, candles, granBoxParams)
    .filter((b) => b.live)
    .map((b) => ({
      strategy: "granbox",
      direction: b.direction,
      time: b.time,
      entry: b.levels[granBoxParams.targetLevel ?? 0.5],
      detail: `Nivel ${granBoxParams.targetLevel ?? 0.5} · sweep ${(b.penetration * 100).toFixed(0)}%`,
      raw: { ...b, zoneHigh: b.zoneHigh, zoneLow: b.zoneLow, penetration: b.penetration, tested: b.tested },
    }));

  const rawFvgs = detectFVGs(candles);
  const fvgs = markFVGStatus(rawFvgs, candles)
    .filter((g) => g.live)
    .map((g) => ({
      strategy: "fvg",
      direction: g.direction,
      time: g.time,
      entry: (g.zoneHigh + g.zoneLow) / 2,
      detail: `Gap ${g.zoneLow.toFixed(2)}–${g.zoneHigh.toFixed(2)}`,
      raw: { ...g, zoneHigh: g.zoneHigh, zoneLow: g.zoneLow, filled: g.filled },
    }));

  const orderBlocks = detectOrderBlocks(candles)
    .filter((ob) => ob.valid)
    .map((ob) => ({
      strategy: "orderblock",
      direction: ob.direction,
      time: ob.time,
      entry: ob.direction === "bullish" ? ob.zoneHigh : ob.zoneLow,
      detail: `7/7 checklist valid`,
      raw: { ...ob, zoneHigh: ob.zoneHigh, zoneLow: ob.zoneLow, passCount: ob.passCount, checklist: ob.checklist },
    }));

  if (htfCandles && htfCandles.length >= 5) {
    const rawRejections = detectRejectionBlocks(htfCandles);
    const rejectionBlocks = markRejectionStatus(rawRejections, htfCandles)
      .filter((rb) => rb.live)
      .map((rb) => ({
        strategy: "rejectionblock",
        direction: rb.direction,
        time: rb.time,
        entry: rb.level,
        detail: `Body ${(rb.bodyRatio * 100).toFixed(0)}% din range (4h)`,
        raw: { ...rb, level: rb.level, bodyRatio: rb.bodyRatio, candleHigh: rb.candleHigh, candleLow: rb.candleLow, reacted: rb.reacted },
      }));
    allSignals = allSignals.concat(rejectionBlocks);
  }

  const power3Setups = detectPower3Setups(candles).map((p) => ({
    strategy: "power3",
    direction: p.direction,
    time: p.time,
    entry: p.sweptLevel,
    detail: p.stage === "expansion" ? "Expansie confirmată" : "Manipulare — în așteptarea NY",
    raw: { ...p, asiaLow: p.asiaLow, asiaHigh: p.asiaHigh, manipulation: p.manipulation, stage: p.stage, expansion: p.expansion },
  }));

  const flowSnapshot = getOrderFlowSnapshot(candles);
  const orderFlowSignals = [];
  if (flowSnapshot.structure !== "unclear" && flowSnapshot.structure !== "ranging") {
    orderFlowSignals.push({
      strategy: "orderflow",
      direction: flowSnapshot.structure,
      time: flowSnapshot.time,
      entry: candles[candles.length - 1]?.close,
      detail: `Structură ${flowSnapshot.structure} · ${flowSnapshot.consecutiveCount} candle-uri consecutive`,
      raw: { ...flowSnapshot, index: candles.length - 1 },
    });
  }

  // --- ORB (5m, today's session only) ---
  let orbSignals = [];
  if (candles5m && candles5m.length >= 10) {
    const orbSetup = detectOrbSetup(candles5m);
    if (orbSetup) {
      const orbResults = evaluateOrbSetups(orbSetup, candles5m);
      orbSignals = orbResults.map((r) => ({
        strategy: "orb",
        direction: r.direction,
        time: r.time,
        entry: r.entry,
        detail: r.detail,
        raw: { ...r, valueArea: orbSetup.valueArea, day: orbSetup.day },
      }));
    }
  }

  // --- USDX Divergence (1h, requires aligned USDX candles) ---
  let usdxDivergenceSignals = [];
  if (usdxCandles && usdxCandles.length >= 20) {
    const divergences = detectUsdxDivergence(candles, usdxCandles);
    usdxDivergenceSignals = divergences.map((d) => ({
      strategy: "usdxdivergence",
      direction: d.direction,
      time: d.time,
      entry: d.instrumentLevel,
      detail: d.detail,
      raw: d,
    }));
  }

  allSignals = allSignals.concat(granBoxes, fvgs, orderBlocks, power3Setups, orderFlowSignals, orbSignals, usdxDivergenceSignals);

  allSignals = allSignals.map((s) => ({
    ...s,
    nearLiquidity: s.entry != null ? isNearLiquidity(s.entry, liquidityPools) : false,
  }));

  allSignals.sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return tb - ta;
  });

  return allSignals;
}
