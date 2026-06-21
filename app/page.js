"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { Scan, History, Briefcase, BookOpen, RefreshCw, Settings2, Clock } from "lucide-react";
import { DEFAULT_PARAMS } from "./lib/granBoxLogic";
import { buildUnifiedSignals, STRATEGY_META } from "./lib/unifiedSignals";
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

function describeSignalForPrompt(signal) {
  const r = signal.raw;
  switch (signal.strategy) {
    case "granbox":
      return `Strategia "Gran Box": pe un candle de displacement (impuls puternic) se marchează o zonă folosind doar body-ul candle-ului. Se trasează niveluri Fibonacci 0/0.25/0.5/0.75/1 peste zonă. Prețul a revenit la nivelul țintă pentru o posibilă intrare.
Zonă body: ${r.zoneLow} - ${r.zoneHigh}
Sweep/penetrare în candle-ul anterior: ${(r.penetration * 100).toFixed(0)}%
Box testat deja: ${r.tested ? "da" : "nu"}`;
    case "fvg":
      return `Strategia "Fair Value Gap" (ICT): un gap de imbalance pe 3 candle-uri consecutive, unde candle 1 nu se suprapune cu candle 3. Prețul tinde să revină și să reacționeze la umplerea gap-ului.
Zonă gap: ${r.zoneLow} - ${r.zoneHigh}
Gap umplut deja: ${r.filled ? "da" : "nu"}`;
    case "orderblock":
      return `Strategia "Order Block" (ICT clasic, checklist 7 puncte): ultimul candle opus culorii înainte de un impuls puternic care a spart structura.
Zonă body: ${r.zoneLow} - ${r.zoneHigh}
Reguli valide: ${r.passCount}/7
Checklist detaliat: ${JSON.stringify(r.checklist)}`;
    case "rejectionblock":
      return `Strategia "Rejection Block": pe timeframe mare (4h), un candle cu body foarte mic (open≈close) și fitile mari arată o respingere puternică. Nivelul (open≈close) e proiectat în timp ca linie de reacție viitoare.
Nivel: ${r.level}
Body/range ratio: ${(r.bodyRatio * 100).toFixed(0)}%
Candle high/low: ${r.candleHigh} / ${r.candleLow}
Reacționat deja: ${r.reacted ? "da" : "nu"}`;
    case "power3":
      return `Strategia "Power 3" (ICT): Accumulation (range Asia) → Manipulation (fals breakout, de obicei London) → Distribution/Expansion (mișcarea reală, de obicei NY).
Asia range: ${r.asiaLow} - ${r.asiaHigh}
Manipulare detectată: ${r.manipulation ? `da, pe partea ${r.manipulation.side}, direcție așteptată ${r.manipulation.direction}` : "nu încă"}
Stadiu curent: ${r.stage}
Expansion: ${r.expansion ? `${r.expansion.active ? "activă" : "în așteptare"}, mișcare până acum ${r.expansion.moveSoFar?.toFixed(2)}` : "n/a"}`;
    case "orderflow":
      return `Strategia "Order Flow basic": structură de piață (swing highs/lows clasificate HH/HL bullish sau LH/LL bearish) combinată cu momentum din candle-uri consecutive.
Bias structură: ${r.structureBias}
Candle-uri consecutive în aceeași direcție: ${r.consecutiveCount}
Accelerare momentum: ${r.accelerating ? "da" : "nu"}`;
    case "orb":
      return `Strategia "ORB" (Opening Range Breakout, varianta Value Area): pe primele 3 candle-uri de 5m ale sesiunii (9:30-9:45 NY) se calculează o Value Area aproximată (VAH/VAL/POC) — NOTĂ: aproximare din OHLC, nu Volume Profile real cu tick data.
Setup: ${r.setupType === "fakeout" ? "FAKEOUT (reversal) — prețul a spart range-ul, a luat lichiditate, apoi a revenit în Value Area" : "BREAKOUT (continuare) — închidere clară în afara Value Area"}
VAH: ${r.valueArea?.vah?.toFixed(2)} · VAL: ${r.valueArea?.val?.toFixed(2)} · POC: ${r.valueArea?.poc?.toFixed(2)}
Entry: ${r.entry?.toFixed(2)} · SL sugerat de logică: ${r.sl?.toFixed(2)} · TP sugerat de logică: ${r.tp?.toFixed(2)}`;
  
    case "usdxdivergence":
      return `Strategia "Smart Money Divergence vs USDX": XAUUSD/instrumentul și USDX (indicele dolarului) se mișcă normal invers (corelație negativă). Când USDX face un nou swing high/low dar instrumentul NU confirmă cu mișcarea inversă așteptată, relația normală s-a rupt — semnal de epuizare sau întoarcere posibilă.
${r.detail}
Nivel USDX: ${r.usdxLevel?.toFixed(2)} · Nivel instrument: ${r.instrumentLevel?.toFixed(2)}`;
    default:
      return "";
  }
}

function SignalCard({ signal, params, decimals, candles, instrumentLabel, windowStatus }) {
  const meta = STRATEGY_META[signal.strategy];
  const dirColor = signal.direction === "bullish" ? "#4ADE80" : "#F87171";
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const runAnalysis = async () => {
    if (!candles || candles.length === 0) return;
    setLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const boxIndex = signal.raw.index ?? candles.length - 1;
      const contextStart = Math.max(0, boxIndex - 25);
      const contextEnd = Math.min(candles.length, boxIndex + 15);
      const contextCandles = candles.slice(contextStart, contextEnd);
      const candlesText = contextCandles
        .map((c, i) => `${i}: ${c.time} O:${c.open} H:${c.high} L:${c.low} C:${c.close}`)
        .join("\n");

      const activeWindowsText = windowStatus
        ? windowStatus.windows.filter((w) => w.isActive).map((w) => w.note).join(", ") || "în afara ferestrelor principale"
        : "necunoscut";

      const prompt = `Ești un trader experimentat care analizează un setup pe ${instrumentLabel}.

${describeSignalForPrompt(signal)}

Direcție semnal: ${signal.direction === "bullish" ? "bullish (în sus)" : "bearish (în jos)"}
Format/detectat la: ${signal.time}
Fereastra orară activă acum: ${activeWindowsText}

Candle-uri din jur (index, ora, open, high, low, close), pentru context de structură/swing-uri/lichiditate:
${candlesText}

Analizează acest setup ca un trader uman, ținând cont mai presus de toate de lichiditate (unde sunt stop-loss-urile altora, unde s-ar lua lichiditate înainte de mișcarea reală). Nu folosi o formulă fixă de SL/TP. Uită-te la swing high/low-urile reale, la fitile, la structura din jur, și decide unde ar sta logic un Stop Loss (unde setup-ul ar fi clar invalidat) și un Take Profit (următoarea zonă reală de lichiditate/structură).

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
    <div style={{ background: "#101218", border: "1px solid #1E2128", borderLeft: `2px solid ${meta?.color || "#2A2D35"}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: meta?.color, textTransform: "uppercase", background: `${meta?.color}1A`, padding: "2px 8px", borderRadius: 4 }}>
            {meta?.label}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: dirColor }}>
            {signal.direction === "bullish" ? "▲" : "▼"}
          </span>
          <span style={{ fontSize: 11, color: "#54575F" }}>{signal.time}</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#9A9DA8", marginBottom: 10 }}>{signal.detail}</div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 12, color: "#9A9DA8" }}>
        <span>Entry referință: <b style={{ color: "#E8E6E0" }}>{fmt(signal.entry, decimals ?? 2)}</b></span>
      </div>

      <button
        onClick={runAnalysis}
        disabled={loading || !candles || candles.length === 0}
        style={{
          width: "100%", background: "transparent", border: `1px solid ${meta?.color || "#2A2D35"}`, color: meta?.color || "#9A9DA8",
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

      {analysis && <AnalysisBlock text={analysis} accent={meta?.color || "#9A9DA8"} />}
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
  const [signals, setSignals] = useState({ XAUUSD: [], SPX: [] });
  const [candleHistory, setCandleHistory] = useState({ XAUUSD: [], SPX: [] });
  const [status, setStatus] = useState({ XAUUSD: "idle", SPX: "idle" });
  const [errorMsg, setErrorMsg] = useState({ XAUUSD: null, SPX: null });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedInstrument, setSelectedInstrument] = useState("XAUUSD");
  const [showSettings, setShowSettings] = useState(false);
  const [windowStatus, setWindowStatus] = useState(null);
  const [strategyFilter, setStrategyFilter] = useState("all");
  const intervalRef = useRef(null);
  const clockRef = useRef(null);

  useEffect(() => {
    setWindowStatus(getCurrentWindowStatus());
    clockRef.current = setInterval(() => setWindowStatus(getCurrentWindowStatus()), 30000);
    return () => clearInterval(clockRef.current);
  }, []);

  const fetchInstrument = useCallback(async (instrumentKey, usdxCandles) => {
    const cfg = INSTRUMENTS[instrumentKey];
    setStatus((s) => ({ ...s, [instrumentKey]: "loading" }));
    try {
      // 1h candles for most strategies, 4h for Rejection Block, 5m (today) for ORB
      const [res1h, res4h, res5m] = await Promise.all([
        fetch(`/api/candles?symbol=${encodeURIComponent(cfg.symbol)}&interval=1h&outputsize=200`),
        fetch(`/api/candles?symbol=${encodeURIComponent(cfg.symbol)}&interval=4h&outputsize=120`),
        fetch(`/api/candles?symbol=${encodeURIComponent(cfg.symbol)}&interval=5min&outputsize=100`),
      ]);
      const ts = await res1h.json();
      const ts4h = await res4h.json();
      const ts5m = await res5m.json();
      if (!res1h.ok || ts.error) throw new Error(ts.error || "API error");
      if (!ts.values || !ts.values.length) throw new Error("No data returned");

      const candles = ts.values
        .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }))
        .reverse();

      const htfCandles = (ts4h.values || [])
        .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }))
        .reverse();

      const candles5m = (ts5m.values || [])
        .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close), volume: v.volume ? parseFloat(v.volume) : 0 }))
        .reverse();

      const closes = candles.map((c) => c.close);
      const latest = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2] ?? latest;
      const change = latest - prevClose;
      const changePct = (change / prevClose) * 100;
      const sparkline = closes.slice(-40).map((c, i) => ({ i, v: c }));

      const unified = buildUnifiedSignals(candles, htfCandles, params, candles5m, usdxCandles || []);

      setSignals((s) => ({ ...s, [instrumentKey]: unified }));
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
    // Fetch USDX (DXY) once and share it across both instruments for divergence comparison
    let usdxCandles = [];
    try {
      const resDxy = await fetch(`/api/candles?symbol=DXY&interval=1h&outputsize=200`);
      const tsDxy = await resDxy.json();
      if (resDxy.ok && tsDxy.values && tsDxy.values.length) {
        usdxCandles = tsDxy.values
          .map((v) => ({ time: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }))
          .reverse();
      }
    } catch (e) {
      // USDX fetch failing shouldn't block the rest of the scanner — divergence signals just won't appear
    }

    await Promise.all([fetchInstrument("XAUUSD", usdxCandles), fetchInstrument("SPX", usdxCandles)]);
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
  const allSignals = signals[selectedInstrument] || [];
  const filteredSignals = strategyFilter === "all" ? allSignals : allSignals.filter((s) => s.strategy === strategyFilter);

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

      {/* Strategy filter chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <FilterChip label={`Toate (${allSignals.length})`} active={strategyFilter === "all"} onClick={() => setStrategyFilter("all")} color="#9A9DA8" />
        {Object.entries(STRATEGY_META).map(([key, meta]) => {
          const count = allSignals.filter((s) => s.strategy === key).length;
          return (
            <FilterChip key={key} label={`${meta.label} (${count})`} active={strategyFilter === key} onClick={() => setStrategyFilter(key)} color={meta.color} />
          );
        })}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9DA8", marginBottom: 10, letterSpacing: "0.04em" }}>
          SEMNALE ACTIVE ({filteredSignals.length})
        </div>
        {status[selectedInstrument] === "loading" && !d && (
          <div style={{ color: "#6B6F7B", fontSize: 13, padding: "20px 0", textAlign: "center" }}>Se încarcă...</div>
        )}
        {filteredSignals.length === 0 && status[selectedInstrument] === "ok" && (
          <div style={{ color: "#54575F", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
            Niciun semnal activ momentan pentru {cfg.short}{strategyFilter !== "all" ? ` (${STRATEGY_META[strategyFilter]?.label})` : ""}.
          </div>
        )}
        {filteredSignals.slice(0, 15).map((signal, i) => (
          <SignalCard key={i} signal={signal} params={params} decimals={cfg.decimals}
            candles={candleHistory[selectedInstrument]} instrumentLabel={cfg.short}
            windowStatus={windowStatus} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${color}22` : "transparent",
      border: `1px solid ${active ? color : "#2A2D35"}`,
      color: active ? color : "#6B6F7B",
      borderRadius: 999, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
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
        <p style={pStyle}>Box valid doar dacă displacement-ul penetrează ≥<b>{(params.sweepMinPenetration * 100).toFixed(0)}%</b> din candle-ul anterior.</p>
      </SectionCard>

      <SectionCard title="Fair Value Gap (FVG)" accentColor="#4F8DFD">
        <p style={pStyle}>Definiția ICT clasică: pe 3 candle-uri consecutive, dacă high-ul primului candle nu se suprapune cu low-ul celui de-al treilea (mișcare bullish), sau invers (bearish), zona dintre ele e un <b>imbalance</b>. Așteptăm ca prețul să revină și să reacționeze la umplerea gap-ului.</p>
      </SectionCard>

      <SectionCard title="Order Block" accentColor="#A78BFA">
        <p style={pStyle}>Ultimul candle opus culorii înainte de un impuls puternic care sparge structura. Validat doar dacă trece toate cele <b>7 condiții</b>: fresh, impulsiv, sweep lichiditate anterioară, prim candle puternic, Break of Structure, origine zonă supply/demand, piață ne-ranging.</p>
      </SectionCard>

      <SectionCard title="Rejection Block" accentColor="#FB923C">
        <p style={pStyle}>Pe timeframe mare (4h), un candle unde open-ul și close-ul sunt aproape identice (corp mic, fitile mari) arată o respingere puternică. Acel nivel exact (open≈close) e proiectat în timp ca linie de reacție pentru candle-urile viitoare — pozitiv (reacție în sus) sau negativ (reacție în jos).</p>
      </SectionCard>

      <SectionCard title="Power 3 (ICT)" accentColor="#34D399">
        <p style={pStyle}>Modelul clasic de sesiune: <b>Accumulation</b> (range-ul sesiunii Asia) → <b>Manipulation</b> (London ia lichiditate de pe o parte a range-ului, fals breakout) → <b>Distribution/Expansion</b> (mișcarea reală, de obicei în sesiunea New York, în direcția opusă manipulării).</p>
      </SectionCard>

      <SectionCard title="Order Flow (basic)" accentColor="#F472B6">
        <p style={pStyle}>Fără date reale de volum/bid-ask, aproximăm: structură de piață din swing highs/lows (Higher-High + Higher-Low = bullish; Lower-High + Lower-Low = bearish) combinată cu momentum din mărimea și direcția candle-urilor consecutive.</p>
      </SectionCard>

      <SectionCard title="ORB — Opening Range Breakout (Value Area)" accentColor="#22D3EE">
        <p style={pStyle}>Opening Range marcat pe primele 3 candle-uri de 5m (09:30–09:45 NY). În loc de simplul high/low, se calculează o <b>Value Area aproximată</b> (VAH/VAL/POC) — zona unde s-ar fi tranzacționat ~70% din volum.</p>
        <p style={pStyle}><b>Notă:</b> Twelve Data nu oferă volum real pe niveluri de preț (tick data), deci VAH/VAL/POC sunt o aproximare calculată din OHLC (body ponderat mai greu decât fitilele), nu Volume Profile exact.</p>
        <RuleRow label="Fakeout (reversal)" value="Spargere range → atinge lichiditate → închidere 5m înapoi în VA → intrare inversă" />
        <RuleRow label="Fakeout SL" value="Peste/sub lumânarea de confirmare" />
        <RuleRow label="Fakeout TP" value="Partea opusă a range-ului / următoarea lichiditate" />
        <RuleRow label="Breakout (continuare)" value="Trend clar sau sweep anterior + închidere 5m în afara VA" />
        <RuleRow label="Breakout SL" value="2 ticks peste/sub POC" />
        <RuleRow label="Breakout TP" value="2R fix" />
      </SectionCard>

   

      <SectionCard title="Smart Money Divergence (vs USDX)" accentColor="#F59E0B">
        <p style={pStyle}>XAUUSD (și, mai slab, alte active denominate în USD) se mișcă în mod normal invers față de USDX (indicele dolarului). Când USDX face un nou swing high dar instrumentul nu confirmă cu Lower-Low corespunzător (sau invers), corelația așteptată s-a rupt — semnal de epuizare a mișcării sau posibilă întoarcere.</p>
      </SectionCard>

      <SectionCard title="Lichiditate — peste toate" accentColor="#EAB308">
        <p style={pStyle}>Swing highs/lows nelichidate (neatinse încă de preț) sunt tratate ca zone prioritare — acolo stau probabil stop-loss-urile altora. Orice semnal (Gran Box, FVG, Order Block, Rejection Block) care se află aproape de o astfel de zonă e marcat ca <b>lângă lichiditate</b>, semn de confluență mai puternică.</p>
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
        <RuleRow label="SL / TP" value="Stabilite contextual de analiza AI, nu formulă fixă" />
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
          <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Aurora — Multi-Strategy Desk</h1>
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
