// ---------- POWER 3 (ICT) ----------
// Accumulation: Asian session range (low/high) — a tight consolidation.
// Manipulation: London session takes out one side of the Asian range (a false break /
//   liquidity sweep) then reverses.
// Distribution/Expansion: New York session drives the real directional move, typically
//   in the opposite direction of the London manipulation.
//
// Sessions are defined in UTC. Asian: 00:00-07:00 UTC. London: 07:00-12:00 UTC.
// NY: 12:00-17:00 UTC (core NY trading hours, simplified).

function getUtcHour(isoTime) {
  const d = new Date(isoTime + (isoTime.includes("Z") || isoTime.includes("+") ? "" : "Z"));
  return d.getUTCHours();
}
function getUtcDateKey(isoTime) {
  const d = new Date(isoTime + (isoTime.includes("Z") || isoTime.includes("+") ? "" : "Z"));
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

const ASIA_START = 0, ASIA_END = 7;
const LONDON_START = 7, LONDON_END = 12;
const NY_START = 12, NY_END = 17;

export function detectPower3Setups(candles) {
  const setups = [];
  if (!candles || candles.length < 24) return setups;

  // Group candles by UTC calendar day
  const byDay = {};
  for (const c of candles) {
    const key = getUtcDateKey(c.time);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(c);
  }

  const days = Object.keys(byDay).sort();

  for (const day of days) {
    const dayCandles = byDay[day];
    const asia = dayCandles.filter((c) => { const h = getUtcHour(c.time); return h >= ASIA_START && h < ASIA_END; });
    const london = dayCandles.filter((c) => { const h = getUtcHour(c.time); return h >= LONDON_START && h < LONDON_END; });
    const ny = dayCandles.filter((c) => { const h = getUtcHour(c.time); return h >= NY_START && h < NY_END; });

    if (asia.length === 0 || london.length === 0) continue;

    const asiaHigh = Math.max(...asia.map((c) => c.high));
    const asiaLow = Math.min(...asia.map((c) => c.low));

    // Manipulation: did London sweep above asiaHigh or below asiaLow, then close back inside?
    let manipulation = null;
    for (let i = 0; i < london.length; i++) {
      const c = london[i];
      if (c.high > asiaHigh && c.close < asiaHigh) {
        manipulation = { direction: "bearish", sweptLevel: asiaHigh, time: c.time, index: i };
        break;
      }
      if (c.low < asiaLow && c.close > asiaLow) {
        manipulation = { direction: "bullish", sweptLevel: asiaLow, time: c.time, index: i };
        break;
      }
    }

    if (!manipulation) continue;

    // Expansion check (only if NY data is already available for this day)
    let expansion = { active: false, moveSoFar: null };
    let stage = "manipulation";
    if (ny.length > 0) {
      const nyClose = ny[ny.length - 1].close;
      const expansionActive = manipulation.direction === "bullish" ? nyClose > asiaHigh : nyClose < asiaLow;
      const moveSoFar = manipulation.direction === "bullish" ? nyClose - manipulation.sweptLevel : manipulation.sweptLevel - nyClose;
      expansion = { active: expansionActive, moveSoFar };
      stage = expansionActive ? "expansion" : "manipulation";
    }

    setups.push({
      type: "power3",
      day,
      time: manipulation.time,
      direction: manipulation.direction,
      asiaHigh,
      asiaLow,
      sweptLevel: manipulation.sweptLevel,
      manipulation: { side: manipulation.direction === "bullish" ? "low" : "high", direction: manipulation.direction },
      stage,
      expansion,
      expansionConfirmed: ny.length > 0 ? expansion.active : null,
      live: ny.length === 0,
    });
  }

  return setups.reverse();
}
