// Server-side route — Twelve Data pentru XAUUSD (forex, gratuit pe orice plan).
// Twelve Data NU oferă gratuit nici indici (SPX), nici ETF-uri (SPY) — necesită plan
// plătit (Grow+). Pentru S&P 500 folosim în schimb endpoint-ul public Yahoo Finance
// (neoficial, fără cheie, fără cost) — întoarce date reale ale indicelui ^GSPC.

const YAHOO_SYMBOLS = new Set(["SPX", "SPY", "^GSPC"]);

function intervalToYahoo(interval) {
  if (interval === "5min") return "5m";
  return "60m"; // atât pentru 1h cât și pentru 4h (4h se agregă local din 60m, Yahoo nu are 4h nativ)
}

function rangeForYahoo(interval) {
  if (interval === "5min") return "5d";
  if (interval === "4h") return "3mo"; // istoric suficient ca să rezulte destule candle-uri de 4h după agregare
  return "3mo";
}

async function fetchYahooCandles(interval, outputsize) {
  const yInterval = intervalToYahoo(interval);
  const range = rangeForYahoo(interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=${yInterval}&range=${range}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Yahoo Finance a răspuns cu status ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error(json?.chart?.error?.description || "Yahoo Finance nu a returnat date pentru ^GSPC");
  }

  const ts = result.timestamp;
  const q = result.indicators?.quote?.[0] || {};
  let bars = ts
    .map((t, i) => ({
      datetime: new Date(t * 1000).toISOString(),
      open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i],
      volume: q.volume?.[i] || 0,
    }))
    .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null);

  if (interval === "4h") {
    // Yahoo nu are interval 4h nativ — agregăm 4 candle-uri de 1h în ferestre fixe (00-04, 04-08 UTC etc.)
    const grouped = new Map();
    bars.forEach((b) => {
      const d = new Date(b.datetime);
      const bucketHour = Math.floor(d.getUTCHours() / 4) * 4;
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${bucketHour}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          datetime: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), bucketHour)).toISOString(),
          open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        });
      } else {
        const g = grouped.get(key);
        g.high = Math.max(g.high, b.high);
        g.low = Math.min(g.low, b.low);
        g.close = b.close;
        g.volume += b.volume;
      }
    });
    bars = Array.from(grouped.values());
  }

  bars.sort((a, b) => new Date(b.datetime) - new Date(a.datetime)); // cele mai noi primele, ca la Twelve Data
  return bars.slice(0, outputsize);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const outputsize = searchParams.get("outputsize") || "200";
  const interval = searchParams.get("interval") || "1h";

  if (!symbol) {
    return Response.json({ error: "Missing symbol parameter" }, { status: 400 });
  }

  const safeOutputsize = Math.min(parseInt(outputsize, 10) || 200, 5000);

  if (YAHOO_SYMBOLS.has(symbol)) {
    try {
      const values = await fetchYahooCandles(interval, safeOutputsize);
      if (!values.length) throw new Error("0 candle-uri întoarse");
      return Response.json({ values });
    } catch (err) {
      return Response.json({ error: `Yahoo Finance: ${err.message}` }, { status: 502 });
    }
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing TWELVE_DATA_API_KEY environment variable" },
      { status: 500 }
    );
  }

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=${encodeURIComponent(interval)}&outputsize=${safeOutputsize}&apikey=${apiKey}`;

    const res = await fetch(url, { next: { revalidate: 0 } });
    const data = await res.json();

    if (data.status === "error" || data.code) {
      return Response.json(
        { error: data.message || "Twelve Data API error", code: data.code },
        { status: 502 }
      );
    }

    return Response.json(data);
  } catch (err) {
    return Response.json({ error: `Fetch failed: ${err.message}` }, { status: 500 });
  }
}
