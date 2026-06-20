"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { Scan, History, Briefcase, BookOpen, RefreshCw, Settings2, Clock } from "lucide-react";
import { detectDisplacements, markTestedLevels, suggestTradeFromBox, DEFAULT_PARAMS } from "./lib/granBoxLogic";
import { runBacktest, PIP_SIZE_BY_SYMBOL } from "./lib/backtestEngine";
import { getCurrentWindowStatus, fmtHourRo } from "./lib/timeWindows";

const INSTRUMENTS = {
  XAUUSD: { symbol: "XAU/USD", label: "Gold Spot", short: "XAUUSD", accent: "#D4AF37", accentDim: "rgba(212,175,55,0.14)", decimals: 2 },
  SPX: { symbol: "SPX", label: "S&P 500", short: "S&P 500", accent: "#4F8DFD", accentDim: "rgba(79,141,253,0.14)", decimals: 2 },
};

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtSigned(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmt(n, d)}`;
}

function ChartTooltip({ active, payload, accent }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#13151A", border: "1px solid #2A2D35", borderRadius: 4, padding: "6px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: accent }}>
      {fmt(payload[0].value, 2)}
    </div>
  );
}

const TABS = [
  { id: "scanner", label: "Scanner", icon: Scan },
  { id: "backtest", label: "Backtest", icon: History },
  { id: "trades", label: "My Trades", icon: Briefcase },
  { id: "strategy", label: "Strategy", icon: BookOpen },
];

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #1E2128", marginBottom: 22, overflowX: "auto" }}>
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", border: "none",
              borderBottom: isActive ? "2px solid #D4AF37" : "2px solid transparent",
              color: isActive ? "#E8E6E0" : "#6B6F7B",
              padding: "10px 16px 12px", fontSize: 13.5, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            <Icon size={15} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const iconBtnStyle = {
  background: "#13151A", border: "1px solid #2A2D35", borderRadius: 6,
  padding: "7px 9px", color: "#9A9DA8", cursor: "pointer", display: "flex", alignItems: "center",
};

const selectStyle = {
  width: "100%", background: "#13151A", border: "1px solid #2A2D35", borderRadius: 5,
  padding: "7px 9px", color: "#E8E6E0", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace",
};

function ParamsPanel({ params, setParams }) {
  const fields = [
    { key: "targetLevel", label: "Nivel țintă", type: "select", options: [0.25, 0.5, 0.75] },
    { key: "displacementBodyMultiplier", label: "Mult. body impuls", type: "number", step: 0.1 },
    { key: "sweepMinPenetration", label: "Min. penetrare sweep", type: "number", step: 0.05 },
    { key: "levelToleranceFraction", label: "Toleranță nivel (%box)", type: "number", step: 0.01 },
    { key: "boxValidDays", label: "Valabilitate box (zile)", type: "number", step: 1 },
  ];
  return (
    <div style={{ background: "#0D0F14", border: "1px solid #1E2128", borderRadius: 8, padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: "#6B6F7B", marginBottom: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Parametri strategie
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {fields.map((f) => (
          <div key={f.key}>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>{f.label}</div>
            {f.type === "select" ? (
              <select value={params[f.key]} onChange={(e) => setParams((p) => ({ ...p, [f.key]: parseFloat(e.target.value) }))} style={selectStyle}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type="number" step={f.step} value={params[f.key]} onChange={(e) => setParams((p) => ({ ...p, [f.key]: parseFloat(e.target.value) }))} style={selectStyle} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BoxCard({ box, params, accent, highlighted, candles, instrumentLabel, decimals, windowStatus }) {
  const trade = suggestTradeFromBox(box, params);
  const dirColor = box.direction === "bullish" ? "#4ADE80" : "#F87171";
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const runAnalysis = async () => {
    if (!candles || candles.length === 0) return;
    setLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      // Give Claude the 40 candles surrounding the box (before + after) so it can see
      // real swing highs/lows, wicks, and structure — not just the box in isolation.
      const contextStart = Math.max(0, box.index - 25);
      const contextEnd = Math.min(candles.length, box.index + 15);
      const contextCandles = candles.slice(contextStart, contextEnd);
      const candlesText = contextCandles
        .map((c, i) => `${i}: ${c.time} O:${c.open} H:${c.high} L:${c.low} C:${c.close}`)
        .join("\n");

      const activeWindowsText = windowStatus
        ? windowStatus.windows.filter((w) => w.isActive).map((w) => w.note).join(", ") || "în afara ferestrelor principale"
        : "necunoscut";

      const prompt = `Ești un trader experimentat care analizează un setup "Gran Box" pe ${instrumentLabel}.

Strategia: pe un candle de displacement (impuls puternic) se marchează o zonă ("gran box") folosind doar body-ul candle-ului (open-close). Se trasează niveluri Fibonacci 0/0.25/0.5/0.75/1 peste acea zonă. Prețul a revenit/revine la nivelul țintă (${params.targetLevel}) pentru o posibilă intrare.

Date despre acest box:
- Direcție: ${box.direction === "bullish" ? "bullish (impuls în sus)" : "bearish (impuls în jos)"}
- Box format la: ${box.time}
- Zonă body: ${box.zoneLow} - ${box.zoneHigh}
- Nivel țintă (entry candidat): ${box.levels[params.targetLevel]}
- Sweep/penetrare în candle-ul anterior: ${(box.penetration * 100).toFixed(0)}%
- Box testat deja: ${box.tested ? "da" : "nu"}

Fereastra orară activă acum: ${activeWindowsText}

Candle-uri din jur (index, ora, open, high, low, close), pentru context de structură/swing-uri:
${candlesText}

Analizează acest setup ca un trader uman: nu folosi o formulă fixă de SL/TP. Uită-te la swing high/low-urile reale din candle-urile de mai sus, la fitile, la structura din jurul box-ului, și decide unde ar sta logic un Stop Loss (unde setup-ul ar fi clar invalidat) și un Take Profit (următoarea zonă reală de lichiditate/structură), ținând cont de orice altceva relevant (impuls, context, fereastra orară).

Scrie 4-6 propoziții explicând raționamentul ca un trader, apoi încheie STRICT cu acest bloc, completat cu valorile tale (fără alte adăugiri după el):

ENTRY: [preț]
SL: [preț] ([motiv scurt])
TP: [preț] ([motiv scurt])
ORA: [recomandare oră intrare, ținând cont de fereastra strategiei]
VERDICT: [INTRU ACUM / AȘTEPT / EVIT]`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const result = await response.json();
      const text = result.content?.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
      setAnalysis(text || "Niciun răspuns generat.");
    } catch (err) {
      setAnalysisError(err.message || "Analiza a eșuat");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: highlighted ? "rgba(74,222,128,0.06)" : "#101218",
      border: `1px solid ${highlighted ? "rgba(74,222,128,0.35)" : "#1E2128"}`,
      borderRadius: 8, padding: 14, marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: dirColor, textTransform: "uppercase" }}>
            {box.direction === "bullish" ? "▲ Bullish box" : "▼ Bearish box"}
          </span>
          <span style={{ fontSize: 11, color: "#54575F" }}>{box.time}</span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#6B6F7B" }}>
          sweep {(box.penetration * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 10 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((lvl) => (
          <div key={lvl} style={{
            textAlign: "center", padding: "5px 2px", borderRadius: 4,
            background: lvl === params.targetLevel ? `${accent}22` : "transparent",
            border: lvl === params.targetLevel ? `1px solid ${accent}` : "1px solid #1E2128",
          }}>
            <div style={{ fontSize: 9, color: "#6B6F7B" }}>{lvl}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#C8CAD3" }}>{fmt(box.levels[lvl], 2)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 12, color: "#9A9DA8" }}>
        <span>Entry sugerat: <b style={{ color: "#E8E6E0" }}>{trade.direction}</b> @ {fmt(trade.entry, decimals ?? 2)}</span>
      </div>

      <button
        onClick={runAnalysis}
        disabled={loading || !candles || candles.length === 0}
        style={{
          width: "100%", background: "transparent", border: `1px solid ${accent}`, color: accent,
          borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Analizez setup-ul..." : "🔍 Analizează setup"}
      </button>

      {analysisError && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "#E0664A", fontFamily: "'JetBrains Mono', monospace" }}>
          {analysisError}
        </div>
      )}

      {analysis && <AnalysisBlock text={analysis} accent={accent} />}
    </div>
  );
}

function AnalysisBlock({ text, accent }) {
  // Split the free-text reasoning from the structured ENTRY/SL/TP/ORA/VERDICT block.
  const splitIndex = text.search(/ENTRY:/i);
  const reasoning = splitIndex >= 0 ? text.slice(0, splitIndex).trim() : text.trim();
  const structured = splitIndex >= 0 ? text.slice(splitIndex).trim() : null;

  const rows = structured
    ? structured.split("\n").map((line) => {
        const m = line.match(/^([A-ZĂÎȘȚ]+):\s*(.+)$/i);
        return m ? { key: m[1].toUpperCase(), value: m[2] } : null;
      }).filter(Boolean)
    : [];

  const verdictColor = (val) => {
    if (/INTRU/i.test(val)) return "#4ADE80";
    if (/EVIT/i.test(val)) return "#F87171";
    return "#FBBF24";
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1A1C22" }}>
      <p style={{ fontSize: 12.5, lineHeight: 1.65, color: "#C8CAD3", margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
        {reasoning}
      </p>
      {rows.length > 0 && (
        <div style={{ background: "#0D0F14", border: `1px solid ${accent}33`, borderRadius: 6, padding: 12 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "#6B6F7B", fontWeight: 600, flexShrink: 0 }}>{r.key}</span>
              <span style={{ color: r.key === "VERDICT" ? verdictColor(r.value) : "#E8E6E0", fontWeight: r.key === "VERDICT" ? 700 : 400, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScannerTab({ params, setParams }) {
  const [data, setData] = useState({ XAUUSD: null, SPX: null });
  const [boxes, setBoxes] = useState({ XAUUSD: [], SPX: [] });
  const [candleHistory, setCandleHistory] = useState({ XAUUSD: [], SPX: [] });
  const [status, setStatus] = useState({ XAUUSD: "idle", SPX: "idle" });
  const [errorMsg, setErrorMsg] = useState({ XAUUSD: null, SPX: null });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedInstrument, setSelectedInstrument] = useState("XAUUSD");
  const [showSettings, setShowSettings] = useState(false);
  const [windowStatus, setWindowStatus] = useState(null);
  const intervalRef = useRef(null);
  const clockRef = useRef(null);

  useEffect(() => {
    setWindowStatus(getCurrentWindowStatus());
    clockRef.current = setInterval(() => setWindowStatus(getCurrentWindowStatus()), 30000);
    return () => clearInterval(clockRef.current);
  }, []);

  const fetchInstrument = useCallback(async (instrumentKey) => {
    const cfg = INSTRUMENTS[instrumentKey];
    setStatus((s) => ({ ...s, [instrumentKey]: "loading" }));
    try {
      const res = await fetch(`/api/candles?symbol=${encodeURIComponent(cfg.symbol)}`);
      const ts = await res.json();
      if (!res.ok || ts.error) throw new Error(ts.error || "API error");
      if (!ts.values || !ts.values.length) throw new Error("No data returned");

      const candles = ts.values
        .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }))
        .reverse();

      const closes = candles.map((c) => c.close);
      const latest = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2] ?? latest;
      const change = latest - prevClose;
      const changePct = (change / prevClose) * 100;
      const sparkline = closes.slice(-40).map((c, i) => ({ i, v: c }));

      const rawBoxes = detectDisplacements(candles, params);
      const liveBoxes = markTestedLevels(rawBoxes, candles, params);

      setBoxes((b) => ({ ...b, [instrumentKey]: liveBoxes }));
      setCandleHistory((h) => ({ ...h, [instrumentKey]: candles }));
      setData((d) => ({ ...d, [instrumentKey]: { price: latest, change, changePct, sparkline } }));
      setStatus((s) => ({ ...s, [instrumentKey]: "ok" }));
      setErrorMsg((e) => ({ ...e, [instrumentKey]: null }));
    } catch (err) {
      setStatus((s) => ({ ...s, [instrumentKey]: "error" }));
      setErrorMsg((e) => ({ ...e, [instrumentKey]: err.message || "Failed to fetch" }));
    }
  }, [params]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchInstrument("XAUUSD"), fetchInstrument("SPX")]);
    setLastUpdated(new Date());
  }, [fetchInstrument]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => refreshAll(), 60000);
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, refreshAll]);

  const cfg = INSTRUMENTS[selectedInstrument];
  const d = data[selectedInstrument];
  const instrumentBoxes = boxes[selectedInstrument] || [];
  const liveBoxes = instrumentBoxes.filter((b) => b.live);
  const activeSignals = useMemo(() => {
    if (!d) return [];
    return liveBoxes.filter((b) => {
      const targetPrice = b.levels[params.targetLevel];
      const tolerance = b.zoneSize * params.levelToleranceFraction;
      return Math.abs(d.price - targetPrice) <= tolerance;
    });
  }, [liveBoxes, d, params]);

  const activeWindows = windowStatus ? windowStatus.windows.filter((w) => w.isActive && (w.market === "ALL" || w.market === selectedInstrument)) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {Object.keys(INSTRUMENTS).map((key) => {
            const c = INSTRUMENTS[key];
            const isSel = selectedInstrument === key;
            return (
              <button key={key} onClick={() => setSelectedInstrument(key)} style={{
                background: isSel ? c.accentDim : "transparent",
                border: `1px solid ${isSel ? c.accent : "#2A2D35"}`,
                color: isSel ? c.accent : "#9A9DA8",
                borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}>
                {c.short}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#6B6F7B" }}>
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Fetching..."}
          </span>
          <button onClick={refreshAll} style={iconBtnStyle}><RefreshCw size={14} /></button>
          <button onClick={() => setShowSettings((s) => !s)} style={iconBtnStyle}><Settings2 size={14} /></button>
        </div>
      </div>

      {windowStatus && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, marginBottom: 18,
          background: activeWindows.length ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${activeWindows.length ? "rgba(74,222,128,0.3)" : "#1E2128"}`,
        }}>
          <Clock size={15} color={activeWindows.length ? "#4ADE80" : "#6B6F7B"} />
          <div style={{ fontSize: 12.5, color: activeWindows.length ? "#A8F0C0" : "#9A9DA8", flex: 1 }}>
            {activeWindows.length > 0
              ? `Fereastră activă acum: ${activeWindows.map((w) => w.note).join(" · ")}`
              : `Acum: ${fmtHourRo(windowStatus.roDecimalHour)} RO — în afara ferestrelor principale`}
          </div>
        </div>
      )}

      {showSettings && <ParamsPanel params={params} setParams={setParams} />}

      <div style={{ background: "#101218", border: "1px solid #1E2128", borderRadius: 10, padding: 22, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: cfg.accent, fontWeight: 600, marginBottom: 4 }}>{cfg.short}</div>
            <div style={{ fontSize: 13, color: "#6B6F7B" }}>{cfg.label}</div>
          </div>
          {status[selectedInstrument] === "error" && (
            <div style={{ fontSize: 11.5, color: "#E0664A", maxWidth: 320, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, wordBreak: "break-word" }}>
              {errorMsg[selectedInstrument]}
            </div>
          )}
          {d && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 600 }}>{fmt(d.price, cfg.decimals)}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: d.change >= 0 ? "#4ADE80" : "#F87171", marginTop: 3 }}>
                {fmtSigned(d.change, cfg.decimals)} ({fmtSigned(d.changePct, 2)}%)
              </div>
            </div>
          )}
        </div>
        {d && d.sparkline.length > 1 && (
          <div style={{ height: 64 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.sparkline}>
                <YAxis domain={["auto", "auto"]} hide />
                <Tooltip content={<ChartTooltip accent={cfg.accent} />} />
                <Line type="monotone" dataKey="v" stroke={cfg.accent} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {activeSignals.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4ADE80", marginBottom: 10, letterSpacing: "0.04em" }}>
            ● SEMNAL ACTIV ({activeSignals.length})
          </div>
          {activeSignals.map((box, i) => (
            <BoxCard key={i} box={box} params={params} accent={cfg.accent} highlighted
              candles={candleHistory[selectedInstrument]} instrumentLabel={cfg.short} decimals={cfg.decimals}
              windowStatus={windowStatus} />
          ))}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9DA8", marginBottom: 10, letterSpacing: "0.04em" }}>
          GRAN BOXES ACTIVE ({liveBoxes.length})
        </div>
        {status[selectedInstrument] === "loading" && !d && (
          <div style={{ color: "#6B6F7B", fontSize: 13, padding: "20px 0", textAlign: "center" }}>Se încarcă...</div>
        )}
        {liveBoxes.length === 0 && status[selectedInstrument] === "ok" && (
          <div style={{ color: "#54575F", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
            Niciun gran box activ momentan pentru {cfg.short}.
          </div>
        )}
        {liveBoxes.slice(0, 8).map((box, i) => (
          <BoxCard key={i} box={box} params={params} accent={cfg.accent}
            candles={candleHistory[selectedInstrument]} instrumentLabel={cfg.short} decimals={cfg.decimals}
            windowStatus={windowStatus} />
        ))}
      </div>
    </div>
  );
}

function BacktestTab({ params: strategyParams }) {
  const [running, setRunning] = useState(false);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [outputsize, setOutputsize] = useState("500");
  const [slPips, setSlPips] = useState(15);
  const [tpPips, setTpPips] = useState(20);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedTrade, setExpandedTrade] = useState(null);

  const cfg = INSTRUMENTS[symbol];

  const runIt = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/candles?symbol=${encodeURIComponent(cfg.symbol)}&interval=1h&outputsize=${outputsize}`);
      const ts = await res.json();
      if (!res.ok || ts.error) throw new Error(ts.error || "API error");
      if (!ts.values || !ts.values.length) throw new Error("Nu s-au returnat date pentru acest simbol/perioadă");

      const candles = ts.values
        .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }))
        .reverse();

      const backtestParams = { slPips, tpPips, pipSize: PIP_SIZE_BY_SYMBOL[symbol] };
      const { trades, summary } = runBacktest(candles, strategyParams, backtestParams, symbol);
      setResult({ trades, summary, candleCount: candles.length });
    } catch (err) {
      setError(err.message || "Backtest failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#101218", border: "1px solid #1E2128", borderRadius: 10, padding: 20, marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "#6B6F7B", marginBottom: 14, letterSpacing: "0.06em", textTransform: "uppercase" }}>Configurare backtest</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>Simbol</div>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={selectStyle}>
              <option value="XAUUSD">XAUUSD</option>
              <option value="SPX">S&P 500</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>Nr. candle-uri 1h istorice</div>
            <select value={outputsize} onChange={(e) => setOutputsize(e.target.value)} style={selectStyle}>
              <option value="200">200 (~8 zile)</option>
              <option value="500">500 (~20 zile)</option>
              <option value="1000">1000 (~42 zile)</option>
              <option value="2500">2500 (~100 zile)</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>SL (pips)</div>
            <input type="number" value={slPips} onChange={(e) => setSlPips(parseFloat(e.target.value))} style={selectStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>TP (pips)</div>
            <input type="number" value={tpPips} onChange={(e) => setTpPips(parseFloat(e.target.value))} style={selectStyle} />
          </div>
        </div>
        <button
          onClick={runIt}
          disabled={running}
          style={{ background: "#D4AF37", color: "#0A0B0D", border: "none", borderRadius: 6, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.6 : 1 }}
        >
          {running ? "Se rulează..." : "Run Backtest"}
        </button>
        <div style={{ fontSize: 11, color: "#54575F", marginTop: 10, lineHeight: 1.5 }}>
          Notă: planul gratuit Twelve Data limitează cantitatea de istoric disponibilă — un volum mare de candle-uri poate eșua sau consuma rapid limita zilnică.
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(224,102,74,0.08)", border: "1px solid rgba(224,102,74,0.3)", borderRadius: 8, padding: 14, marginBottom: 18, color: "#E0664A", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <SummaryGrid summary={result.summary} candleCount={result.candleCount} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9DA8", margin: "20px 0 10px", letterSpacing: "0.04em" }}>
            TRANZACȚII SIMULATE ({result.trades.length})
          </div>
          {result.trades.length === 0 && (
            <div style={{ color: "#54575F", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
              Niciun gran box testat în perioada selectată. Încearcă mai mult istoric.
            </div>
          )}
          {result.trades.map((t, i) => (
            <TradeRow key={i} trade={t} cfg={cfg} expanded={expandedTrade === i} onToggle={() => setExpandedTrade(expandedTrade === i ? null : i)} />
          ))}
        </>
      )}
    </div>
  );
}

function SummaryGrid({ summary, candleCount }) {
  const cards = [
    { label: "Win rate", value: `${summary.winRate.toFixed(1)}%`, color: summary.winRate >= 50 ? "#4ADE80" : "#F87171" },
    { label: "Trades", value: `${summary.totalTrades}`, color: "#E8E6E0" },
    { label: "Win / Loss", value: `${summary.wins} / ${summary.losses}`, color: "#E8E6E0" },
    { label: "Pips total", value: fmtSigned(summary.totalPips, 1), color: summary.totalPips >= 0 ? "#4ADE80" : "#F87171" },
  ];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: "#101218", border: "1px solid #1E2128", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: "#6B6F7B", marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 19, fontWeight: 600, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#54575F", marginTop: 8, textAlign: "right" }}>
        bazat pe {candleCount} candle-uri 1h · {summary.open} tranzacții încă deschise la finalul datelor
      </div>
    </div>
  );
}

function TradeRow({ trade, cfg, expanded, onToggle }) {
  const resultColor = trade.result === "win" ? "#4ADE80" : trade.result === "loss" ? "#F87171" : "#9A9DA8";
  const resultLabel = trade.result === "win" ? "WIN" : trade.result === "loss" ? "LOSS" : "OPEN";
  return (
    <div onClick={onToggle} style={{ background: "#101218", border: "1px solid #1E2128", borderRadius: 8, padding: 12, marginBottom: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: trade.direction === "LONG" ? "#4ADE80" : "#F87171" }}>{trade.direction}</span>
          <span style={{ fontSize: 11.5, color: "#9A9DA8" }}>{trade.entryTime}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: resultColor, fontWeight: 700 }}>{resultLabel}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: trade.pips >= 0 ? "#4ADE80" : "#F87171" }}>{fmtSigned(trade.pips, 1)}p</span>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1A1C22", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5 }}>
          <DetailItem label="Entry" value={fmt(trade.entry, cfg.decimals)} />
          <DetailItem label="SL" value={fmt(trade.sl, cfg.decimals)} />
          <DetailItem label="TP" value={fmt(trade.tp, cfg.decimals)} />
          <DetailItem label="Exit" value={trade.exitPrice ? fmt(trade.exitPrice, cfg.decimals) : "—"} />
          <DetailItem label="Box format la" value={trade.boxTime} />
          <DetailItem label="Exit la" value={trade.exitTime || "—"} />
          <DetailItem label="Sweep penetrare" value={`${(trade.sweepPenetration * 100).toFixed(0)}%`} />
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <div style={{ color: "#6B6F7B", fontSize: 10.5, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#C8CAD3", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function MyTradesTab() {
  return (
    <div style={{ textAlign: "center", color: "#54575F", fontSize: 13, padding: "60px 20px" }}>
      <Briefcase size={28} color="#2A2D35" style={{ marginBottom: 12 }} />
      <div>Niciun trade înregistrat încă.</div>
      <div style={{ fontSize: 12, marginTop: 6, color: "#3F424A" }}>Jurnalul de tranzacții vine în pasul următor.</div>
    </div>
  );
}

function SectionCard({ title, accentColor, children }) {
  return (
    <div style={{ background: "#101218", border: "1px solid #1E2128", borderLeft: `2px solid ${accentColor}`, borderRadius: 8, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#E8E6E0", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function RuleRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid #1A1C22", fontSize: 12.5 }}>
      <span style={{ color: "#9A9DA8", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#C8CAD3", textAlign: "right" }}>{value}</span>
    </div>
  );
}

const pStyle = { fontSize: 13.5, lineHeight: 1.7, color: "#C8CAD3", margin: "0 0 10px" };

function StrategyTab({ params }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionCard title="Gran Box Strategy" accentColor="#D4AF37">
        <p style={pStyle}>Pe timeframe-ul de 1h, identificăm un candle de <b>displacement</b>. Marcăm o zonă ("gran box") folosind <b>doar body-ul candle-ului</b>.</p>
        <p style={pStyle}>Trasăm niveluri Fibonacci: 0, 0.25, 0.5, 0.75, 1. Așteptăm reacție la nivelul țintă (implicit <b>0.5</b>) pe TF mai mic.</p>
      </SectionCard>
      <SectionCard title="Validarea unui Box (Sweep)" accentColor="#4F8DFD">
        <p style={pStyle}>Box valid doar dacă displacement-ul penetrează ≥<b>{(params.sweepMinPenetration * 100).toFixed(0)}%</b> din candle-ul anterior.</p>
      </SectionCard>
      <SectionCard title="Fereastra de timp" accentColor="#A78BFA">
        <RuleRow label="Gold — fereastră principală" value="11:00–13:00 RO și 17:00–19:00 RO" />
        <RuleRow label="Gold — ora 14 RO" value="Permis doar pe riscul propriu" />
        <RuleRow label="Entry validat" value="9:30–12:45 NY" />
        <RuleRow label="Fără trade-uri noi" value="După ora 15 NY" />
        <RuleRow label="Atenție specială" value="Miercuri — zi „killzone”" />
        <RuleRow label="Poziții peste noapte" value="Evitate, mai ales vineri" />
      </SectionCard>
      <SectionCard title="Invalidare & Expirare" accentColor="#F87171">
        <RuleRow label="Nivel testat o dată" value="Devine invalid" />
        <RuleRow label="Box netestat" value={`Valabil max ${params.boxValidDays} zile`} />
      </SectionCard>
      <SectionCard title="Risk Management" accentColor="#FB923C">
        <RuleRow label="Risc per trade" value="~1.3% din capitalul activ" />
        <RuleRow label="Target mediu" value="~20 pips" />
      </SectionCard>
      <div style={{ fontSize: 11.5, color: "#54575F", textAlign: "center", padding: "8px 16px 20px", lineHeight: 1.6 }}>
        Document de lucru personal. Nu este sfat financiar.
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("scanner");
  const [params, setParams] = useState(DEFAULT_PARAMS);

  return (
    <div style={{ minHeight: "100vh", background: "#0A0B0D", color: "#E8E6E0", fontFamily: "'Inter', -apple-system, sans-serif", padding: "24px 18px 60px" }}>
      <style>{`
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #D4AF37; outline-offset: 2px; }
        select { -webkit-appearance: none; appearance: none; }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", color: "#6B6F7B", textTransform: "uppercase", marginBottom: 4 }}>
            Personal Trading Desk
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Aurora — Gran Box</h1>
        </div>
        <div style={{ height: 18 }} />
        <TabBar active={activeTab} onChange={setActiveTab} />
        {activeTab === "scanner" && <ScannerTab params={params} setParams={setParams} />}
        {activeTab === "backtest" && <BacktestTab params={params} />}
        {activeTab === "trades" && <MyTradesTab />}
        {activeTab === "strategy" && <StrategyTab params={params} />}
        <div style={{ marginTop: 28, fontSize: 11, color: "#54575F", lineHeight: 1.6, textAlign: "center" }}>
          Educational personal dashboard — not financial advice.
        </div>
      </div>
    </div>
  );
}
