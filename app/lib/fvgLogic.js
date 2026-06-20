// ---------- FAIR VALUE GAP (FVG) — classic ICT definition ----------
// Across 3 consecutive candles (c1, c2, c3): if c1's high is below c3's low, the gap
// between them is a bullish FVG (an imbalance). If c1's low is above c3's high, it's a
// bearish FVG. We expect price to return into that gap and react.

export function detectFVGs(candles) {
  const gaps = [];
  if (!candles || candles.length < 3) return gaps;

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    if (c1.high < c3.low) {
      gaps.push({
        type: "fvg",
        direction: "bullish",
        index: i,
        time: c2.time,
        zoneHigh: c3.low,
        zoneLow: c1.high,
        zoneSize: c3.low - c1.high,
      });
    }
    if (c1.low > c3.high) {
      gaps.push({
        type: "fvg",
        direction: "bearish",
        index: i,
        time: c2.time,
        zoneHigh: c1.low,
        zoneLow: c3.high,
        zoneSize: c1.low - c3.high,
      });
    }
  }
  return gaps;
}

export function markFVGStatus(gaps, candles, validDays = 7) {
  return gaps
    .map((gap) => {
      const futureCandles = candles.slice(gap.index + 1);
      let testedAt = null;
      for (const c of futureCandles) {
        const touches = c.low <= gap.zoneHigh && c.high >= gap.zoneLow;
        if (touches) { testedAt = c.time; break; }
      }
      let expired = false;
      if (!testedAt && gap.time) {
        const ageMs = Date.now() - new Date(gap.time).getTime();
        expired = ageMs > validDays * 24 * 60 * 60 * 1000;
      }
      return { ...gap, tested: !!testedAt, testedAt, filled: !!testedAt, expired, live: !testedAt && !expired };
    })
    .reverse();
}
