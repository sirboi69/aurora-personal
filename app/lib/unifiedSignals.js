// ---------- UNIFIED SIGNALS ----------
// Reduced set, per the trader's choice: Gran Box, Power 3, Order Flow — all run on the
// same 1h candle set, so only ONE API request per instrument is needed. Liquidity is a
// transversal overlay (not a strategy of its own) applied to every signal.
//
// FVG, Order Block, Rejection Block, ORB, ChoCh, and USDX Divergence were removed to cut
// API cost — they required extra timeframes (4h, 5min) or an extra symbol (DXY).

import { detectDisplacements, markTestedLevels as markGranBoxTested } from "./granBoxLogic";
import { detectPower3Setups } from "./power3Logic";
import { getOrderFlowSnapshot } from "./orderFlowLogic";
import { detectLiquidityPools, isNearLiquidity } from "./liquidityLogic";

export const STRATEGY_META = {
  granbox: { label: "Gran Box", color: "#D4AF37" },
  power3: { label: "Power 3", color: "#34D399" },
  orderflow: { label: "Order Flow", color: "#F472B6" },
};

export function buildUnifiedSignals(candles, granBoxParams = {}) {
  if (!candles || candles.length < 30) {
    return [];
  }

  const liquidityPools = detectLiquidityPools(candles);

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

  let allSignals = [...granBoxes, ...power3Setups, ...orderFlowSignals];

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
