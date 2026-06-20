"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { Scan, History, Briefcase, BookOpen, RefreshCw, Settings2, Clock } from "lucide-react";
import { detectDisplacements, markTestedLevels, suggestTradeFromBox, DEFAULT_PARAMS } from "./lib/granBoxLogic";
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

function BoxCard({ box, params, accent, highlighted }) {
  const trade = suggestTradeFromBox(box, params);
  const dirColor = box.direction === "bullish" ? "#4ADE80" : "#F87171";
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
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9A9DA8" }}>
        <span>Entry sugerat: <b style={{ color: "#E8E6E0" }}>{trade.direction}</b> @ {fmt(trade.entry, 2)}</span>
      </div>
    </div>
  );
}

function ScannerTab({ params, setParams }) {
  const [data, setData] = useState({ XAUUSD: null, SPX: null });
  const [boxes, setBoxes] = useState({ XAUUSD: [], SPX: [] });
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
          {activeSignals.map((box, i) => <BoxCard key={i} box={box} params={params} accent={cfg.accent} highlighted />)}
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
        {liveBoxes.slice(0, 8).map((box, i) => <BoxCard key={i} box={box} params={params} accent={cfg.accent} />)}
      </div>
    </div>
  );
}

function BacktestTab() {
  const [running, setRunning] = useState(false);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [period, setPeriod] = useState("90");
  return (
    <div>
      <div style={{ background: "#101218", border: "1px solid #1E2128", borderRadius: 10, padding: 20, marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: "#6B6F7B", marginBottom: 14, letterSpacing: "0.06em", textTransform: "uppercase" }}>Configurare backtest</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>Simbol</div>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={selectStyle}>
              <option value="XAUUSD">XAUUSD</option>
              <option value="SPX">S&P 500</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#9A9DA8", marginBottom: 4 }}>Perioadă (zile)</div>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={selectStyle}>
              <option value="30">30 zile</option>
              <option value="90">90 zile</option>
              <option value="180">180 zile</option>
            </select>
          </div>
        </div>
        <button onClick={() => setRunning(true)} style={{ background: "#D4AF37", color: "#0A0B0D", border: "none", borderRadius: 6, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          Run Backtest
        </button>
      </div>
      <div style={{ textAlign: "center", color: "#54575F", fontSize: 13, padding: "40px 20px" }}>
        {running ? "Motorul de backtest urmează în pasul următor." : "Configurează parametrii și rulează un backtest. (În lucru.)"}
      </div>
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
        {activeTab === "backtest" && <BacktestTab />}
        {activeTab === "trades" && <MyTradesTab />}
        {activeTab === "strategy" && <StrategyTab params={params} />}
        <div style={{ marginTop: 28, fontSize: 11, color: "#54575F", lineHeight: 1.6, textAlign: "center" }}>
          Educational personal dashboard — not financial advice.
        </div>
      </div>
    </div>
  );
}
