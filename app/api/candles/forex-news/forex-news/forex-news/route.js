// Server-side route — preia calendarul economic săptămânal publicat de Forex Factory
// (sursă: nfs.faireconomy.media, feed-ul JSON oficial folosit de widget-urile lor partenere).
// Cache-uit server-side ca să nu lovim limita lor de ~2 cereri/5min per sursă.

const FF_FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export async function GET() {
  try {
    const res = await fetch(FF_FEED_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 }, // cache 5 minute pe server
    });

    if (!res.ok) {
      return Response.json(
        { error: `Forex Factory feed a răspuns cu status ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.text();

    // Când limita de request-uri e depășită, FF întoarce o pagină HTML "Request Denied"
    // în loc de JSON — verificăm explicit ca să dăm o eroare clară în loc să crape parse-ul.
    if (raw.trim().startsWith("<")) {
      return Response.json(
        { error: "Forex Factory a limitat temporar cererile. Încearcă din nou peste câteva minute." },
        { status: 429 }
      );
    }

    const events = JSON.parse(raw);

    const normalized = events
      .map((e) => ({
        title: e.title,
        country: e.country, // codul valutei: USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD, CNY, All...
        date: e.date, // ISO string cu offset (ora New York)
        impact: e.impact, // "High" | "Medium" | "Low" | "Holiday"
        forecast: e.forecast || "",
        previous: e.previous || "",
        actual: e.actual || "",
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return Response.json({ events: normalized, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: `Fetch failed: ${err.message}` }, { status: 500 });
  }
}
