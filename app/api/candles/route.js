// Server-side route — the Twelve Data API key never reaches the browser.
// The key is read from the Vercel environment variable TWELVE_DATA_API_KEY.

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return Response.json({ error: "Missing symbol parameter" }, { status: 400 });
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
    )}&interval=1h&outputsize=200&apikey=${apiKey}`;

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
