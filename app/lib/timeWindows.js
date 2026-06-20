// ---------- TIME WINDOWS (Romania / NY) ----------

function nyHourToRoHour(nyHour, referenceDate = new Date()) {
  const nyFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  const roFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", hour: "numeric", hour12: false });
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const test = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), utcHour, 0, 0));
    const nyStr = nyFormatter.format(test);
    if (parseInt(nyStr, 10) === nyHour) {
      return parseInt(roFormatter.format(test), 10);
    }
  }
  return (nyHour + 7) % 24;
}

export const TIME_WINDOWS = [
  { id: "gold-1", market: "XAUUSD", tz: "RO", startHour: 11, endHour: 13, label: "11:00–13:00 RO", note: "Fereastră principală Gold" },
  { id: "gold-2", market: "XAUUSD", tz: "RO", startHour: 17, endHour: 19, label: "17:00–19:00 RO", note: "Intrare ~18:00, ieșire ~19:00" },
  { id: "gold-3", market: "XAUUSD", tz: "RO", startHour: 14, endHour: 15, label: "14:00 RO", note: "Doar pe riscul tău" },
  { id: "entry-ny", market: "ALL", tz: "NY", startHour: 9.5, endHour: 12.75, label: "9:30–12:45 NY", note: "Fereastră de entry validată" },
];

export function getCurrentWindowStatus(referenceDate = new Date()) {
  const roFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", hour: "numeric", minute: "numeric", hour12: false });
  const parts = roFormatter.formatToParts(referenceDate);
  const roHour = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const roMinute = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const roDecimalHour = roHour + roMinute / 60;

  const windows = TIME_WINDOWS.map((w) => {
    let startRo, endRo;
    if (w.tz === "RO") {
      startRo = w.startHour; endRo = w.endHour;
    } else {
      const startWhole = Math.floor(w.startHour);
      const startFrac = w.startHour - startWhole;
      const endWhole = Math.floor(w.endHour);
      const endFrac = w.endHour - endWhole;
      startRo = nyHourToRoHour(startWhole, referenceDate) + startFrac;
      endRo = nyHourToRoHour(endWhole, referenceDate) + endFrac;
    }
    const isActive = endRo > startRo
      ? roDecimalHour >= startRo && roDecimalHour < endRo
      : roDecimalHour >= startRo || roDecimalHour < endRo;
    return { ...w, startRo, endRo, isActive };
  });

  return { roHour, roMinute, roDecimalHour, windows };
}

export function fmtHourRo(decHour) {
  const h = Math.floor(decHour) % 24;
  const m = Math.round((decHour - Math.floor(decHour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export { nyHourToRoHour };
