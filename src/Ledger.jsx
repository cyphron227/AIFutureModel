import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// ============================================================================
// LEDGER — UK AI Economic Scenario Engine
// Stylised 10-year linked-equation model
// ============================================================================

const PRESETS = {
  baseline: { name: 'Status quo', aiProd: 0.6, adoption: 10, ceiling: 25, ubi: 0, ubiMix: 50, capTax: 25 },
  acemoglu: { name: 'Acemoglu floor', aiProd: 0.3, adoption: 15, ceiling: 20, ubi: 0, ubiMix: 0, capTax: 25 },
  pwc: { name: 'PwC optimistic', aiProd: 1.5, adoption: 5, ceiling: 35, ubi: 0, ubiMix: 0, capTax: 30 },
  disruption: { name: 'Disruption', aiProd: 1.8, adoption: 4, ceiling: 50, ubi: 0, ubiMix: 0, capTax: 18 },
  nordic: { name: 'Nordic redistributive', aiProd: 1.2, adoption: 7, ceiling: 35, ubi: 800, ubiMix: 75, capTax: 40 },
};

// Core simulation engine — pure function, runs in <5ms
// Calibrated against UK ONS, IMF Gen-AI WP 2025/068, Acemoglu 2024, OECD AI Papers
function simulate(p) {
  const T = 11; // years 0..10

  // Initial conditions (UK 2025)
  const init = {
    gdp: 2750, tfp: 1.0, labourShare: 0.58, gini: 0.34, unemp: 0.045,
    medianWage: 1.0, debtGdp: 0.95, top10Wealth: 0.57, capShare: 0.42, wageStagYears: 0,
  };

  // Logistic AI adoption: A(0) ≈ 0.02, A(adoption_speed) ≈ 0.95
  const adoption = (t) => 1 / (1 + Math.exp(-8 * (t / p.adoption - 0.5)));

  // Calibration constants
  const gBase = 0.012;       // baseline UK real GDP growth
  const phi = 0.55;          // skill bias of automation
  const tau = 0.35;          // wage-productivity trickle
  const beta = 0.18;         // displacement
  const gamma = 0.55;        // reinstatement / complementarity
  const lambdaAlpha = 0.9;
  const lambdaU = 0.6;
  const lambdaUBI = 0.18;    // UBI Gini compression (level effect)
  const baselineRevRatio = 0.385;
  const baselineSpendRatio = 0.405;
  const interestRate = 0.025;
  const unempReversion = 0.30;
  const naturalU = 0.045;

  const series = [];
  let s = { ...init }, prev = { ...init };
  let preUbiGini = init.gini; // shadow Gini without UBI compression

  for (let t = 0; t < T; t++) {
    const A = adoption(t);
    const Aprev = t > 0 ? adoption(t - 1) : 0;
    const dA = A - Aprev;

    // Productivity (Acemoglu task-based)
    s.tfp = prev.tfp * (1 + gBase + (p.aiProd / 100) * A);

    // Capital share evolution (the inequality engine)
    const capTaxAdj = (p.capTax - 25) * 0.0006;
    const dAlpha = 0.025 * dA * (1 - prev.capShare) - capTaxAdj;
    s.capShare = Math.max(0.30, Math.min(0.70, prev.capShare + dAlpha));
    s.labourShare = 1 - s.capShare;

    // Employment: displacement, reinstatement, mean reversion
    const dU = beta * dA * phi
             - gamma * (p.aiProd / 100) * 0.01
             - unempReversion * (prev.unemp - naturalU);
    s.unemp = Math.max(0.025, Math.min(0.20, prev.unemp + dU));

    // GDP (Cobb-Douglas)
    const L = (1 - s.unemp) * 42;
    const K = 1 + 0.025 * t;
    s.gdp = init.gdp * s.tfp * Math.pow(K, s.capShare) * Math.pow(L / 42, s.labourShare);
    const gdpGrowth = (s.gdp / prev.gdp) - 1;

    // Median wage (labour-share decoupling)
    const productivityShareToWages = 0.4 + tau * (1 - dA);
    const wageGrowth = (p.aiProd / 100) * A * productivityShareToWages * 0.3
                     + gBase * 0.5 - 0.8 * dAlpha;
    s.medianWage = prev.medianWage * (1 + wageGrowth);
    s.wageStagYears = wageGrowth < 0.005 ? prev.wageStagYears + 1 : 0;
    s.top10Wealth = Math.min(0.85, prev.top10Wealth + 0.4 * dAlpha + 0.001);

    // Inequality — pre-UBI Gini drift, then level UBI compression
    preUbiGini = Math.max(0.20, Math.min(0.55,
      preUbiGini + lambdaAlpha * dAlpha + lambdaU * (s.unemp - prev.unemp)));
    const ubiAsShareOfMedian = (p.ubi * 12) / (s.medianWage * 35000);
    const ubiCompression = lambdaUBI * Math.min(0.6, ubiAsShareOfMedian);
    s.gini = Math.max(0.20, preUbiGini - ubiCompression);

    // Fiscal — debt/GDP dynamics with proper denominator effect
    const capTaxBoost = (p.capTax - 25) / 100 * s.capShare;
    const aiRentRev = (p.ubiMix / 100) * 0.04 * A;
    const revRatio = baselineRevRatio + capTaxBoost + aiRentRev;
    const ubiCostBn = (p.ubi * 12 * 52e6) / 1e9;
    const ubiRatio = ubiCostBn / s.gdp;
    const spendRatio = baselineSpendRatio + ubiRatio;
    const primaryBalance = revRatio - spendRatio;
    s.debtGdp = prev.debtGdp * (1 + interestRate) / (1 + Math.max(gdpGrowth, 0.001))
              - primaryBalance;

    // Stability index (Turchin-inspired composite)
    const giniNorm = Math.min(1, Math.max(0, (s.gini - 0.30) / 0.18));
    const unempNorm = Math.min(1, Math.max(0, (s.unemp - 0.05) / 0.08));
    const labourNorm = Math.max(0, (0.58 - s.labourShare) / 0.12);
    const stagNorm = Math.min(1, s.wageStagYears / 6);
    const legitimacy = Math.min(1, Math.max(0, (s.top10Wealth - 0.57) / 0.15));
    const stress = 0.25 * giniNorm + 0.20 * unempNorm + 0.20 * labourNorm
                 + 0.15 * stagNorm + 0.20 * legitimacy;
    const stability = Math.max(0, 1 - stress);

    series.push({
      year: 2025 + t,
      gdp: +(s.gdp).toFixed(0),
      gdpIdx: +(s.gdp / init.gdp * 100).toFixed(1),
      labourShare: +(s.labourShare * 100).toFixed(1),
      gini: +(s.gini).toFixed(3),
      unemp: +(s.unemp * 100).toFixed(1),
      medianWage: +(s.medianWage * 100).toFixed(1),
      debtGdp: +(s.debtGdp * 100).toFixed(0),
      top10: +(s.top10Wealth * 100).toFixed(1),
      stability: +(stability).toFixed(3),
      adoption: +(A * 100).toFixed(1),
    });

    prev = { ...s };
  }

  // Regime flags — thresholds tuned to actual model output ranges
  const flags = {
    unrest: series.some(d => d.stability < 0.50),
    unrestYear: series.find(d => d.stability < 0.50)?.year,
    fiscal: series.some(d => d.debtGdp > 150),
    fiscalYear: series.find(d => d.debtGdp > 150)?.year,
    labourCollapse: series.some(d => d.labourShare < 53),
    labourYear: series.find(d => d.labourShare < 53)?.year,
    wageStag: series[T-1].medianWage < 102,
  };

  return { series, flags, final: series[T-1] };
}

// Narrative generator — template-based one-paragraph summary
function generateNarrative(p, result) {
  const f = result.final;
  const flags = result.flags;
  const regime = (() => {
    if (flags.unrest && flags.fiscal) return 'a compounded crisis';
    if (flags.unrest) return 'a stability breach';
    if (flags.fiscal) return 'a fiscal cliff';
    if (flags.labourCollapse) return 'a labour-share collapse';
    if (f.gdpIdx > 130 && f.gini < 0.34) return 'a broadly shared expansion';
    if (f.gdpIdx > 130 && f.gini > 0.39) return 'a polarised boom';
    if (f.gdpIdx < 115) return 'a stagnant decade';
    return 'a muddle-through trajectory';
  })();

  const aiText = p.aiProd > 1.2 ? 'aggressive AI deployment'
                : p.aiProd > 0.7 ? 'moderate AI adoption'
                : 'cautious AI uptake';
  const ubiText = p.ubi > 600 ? `a generous UBI of £${p.ubi}/month`
                : p.ubi > 0 ? `a modest UBI of £${p.ubi}/month`
                : 'no basic income';
  const taxText = p.capTax > 35 ? 'high capital taxation'
                : p.capTax > 25 ? 'moderate capital taxation'
                : 'light capital taxation';

  const giniDirection = f.gini > 0.36 ? 'rising' : f.gini < 0.32 ? 'falling' : 'stable';
  const wageDirection = f.medianWage > 115 ? 'real wages climbing meaningfully'
                      : f.medianWage > 108 ? 'real wages rising'
                      : f.medianWage > 103 ? 'real wages near flat'
                      : 'real wages eroding';

  return `By 2035, ${aiText} combined with ${ubiText} and ${taxText} produces ${regime}. GDP reaches ${f.gdpIdx} (2025=100), with the labour share at ${f.labourShare}% — ${f.labourShare < 55 ? 'below' : 'around'} historical norm. Inequality is ${giniDirection} (Gini ${f.gini.toFixed(3)}), ${wageDirection}, and the top decile holds ${f.top10}% of wealth. The stability index ends at ${f.stability.toFixed(2)}${flags.unrest ? `, having breached the unrest threshold in ${flags.unrestYear}` : ', within tolerance'}. Public debt closes at ${f.debtGdp}% of GDP${flags.fiscal ? ` after crossing the fiscal cliff in ${flags.fiscalYear}` : ''}.`;
}

// ============================================================================
// UI Components
// ============================================================================

function Slider({ label, value, onChange, min, max, step, unit, hint }) {
  return (
    <div className="mb-5">
      <div className="flex justify-between items-baseline mb-1.5">
        <label className="text-[11px] tracking-widest uppercase text-stone-400 font-mono">{label}</label>
        <span className="text-amber-200 font-mono text-sm tabular-nums">
          {typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-stone-700 rounded-none appearance-none cursor-pointer accent-amber-300"
        style={{ accentColor: '#fcd34d' }}
      />
      {hint && <div className="text-[10px] text-stone-500 mt-1 italic">{hint}</div>}
    </div>
  );
}

function MetricCard({ label, value, unit, change, danger, large }) {
  return (
    <div className={`border-t border-stone-700 pt-3 pb-2 ${large ? 'col-span-2' : ''}`}>
      <div className="text-[10px] tracking-widest uppercase text-stone-500 font-mono mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={`font-serif tabular-nums ${large ? 'text-4xl' : 'text-2xl'} ${danger ? 'text-red-400' : 'text-stone-100'}`}
              style={{ fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif' }}>
          {value}
        </span>
        {unit && <span className="text-stone-500 text-xs font-mono">{unit}</span>}
      </div>
      {change !== undefined && (
        <div className={`text-[11px] font-mono mt-0.5 ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-stone-500'}`}>
          {change > 0 ? '+' : ''}{change}{unit === '%' ? 'pp' : ''}
        </div>
      )}
    </div>
  );
}

function Flag({ active, label, year, color }) {
  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 border-l-2 ${active ? color : 'border-stone-800'} ${active ? 'opacity-100' : 'opacity-30'}`}>
      <span className="text-xs font-mono tracking-wider uppercase">{label}</span>
      {active && year && <span className="text-[10px] font-mono text-stone-500 ml-auto">{year}</span>}
    </div>
  );
}

export default function LedgerModel() {
  const [params, setParams] = useState(PRESETS.baseline);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(11);
  const [compareGhost, setCompareGhost] = useState(null);
  const animRef = useRef(null);

  const result = useMemo(() => simulate(params), [params]);
  const narrative = useMemo(() => generateNarrative(params, result), [params, result]);

  // Animate trajectory on param change
  useEffect(() => {
    setAnimationProgress(0);
    if (animRef.current) clearInterval(animRef.current);
    let i = 0;
    animRef.current = setInterval(() => {
      i++;
      setAnimationProgress(i);
      if (i >= 11) clearInterval(animRef.current);
    }, 130);
    return () => animRef.current && clearInterval(animRef.current);
  }, [params]);

  const visibleSeries = result.series.slice(0, animationProgress + 1);

  const setPreset = (key) => setParams(PRESETS[key]);
  const updateParam = (key, value) => setParams(p => ({ ...p, [key]: value }));
  const pinGhost = () => setCompareGhost({ series: result.series, params });
  const clearGhost = () => setCompareGhost(null);

  const baseline = useMemo(() => simulate(PRESETS.baseline), []);

  // Combine for comparison rendering
  const chartData = visibleSeries.map((d, i) => ({
    ...d,
    ghostStability: compareGhost ? compareGhost.series[i]?.stability * 100 : null,
    ghostGini: compareGhost ? compareGhost.series[i]?.gini * 100 : null,
    stabilityPct: d.stability * 100,
    giniPct: d.gini * 100,
  }));

  return (
    <div style={{
      fontFamily: '"Inter", -apple-system, sans-serif',
      backgroundColor: '#0c0e14',
      color: '#e7e5e4',
      minHeight: '100vh',
      padding: '24px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');

        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 14px; height: 14px;
          background: #fcd34d;
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #0c0e14;
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px; height: 14px;
          background: #fcd34d;
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #0c0e14;
        }
        .grain {
          background-image: radial-gradient(rgba(255,255,255,0.015) 1px, transparent 1px);
          background-size: 3px 3px;
        }
      `}</style>

      <div className="max-w-7xl mx-auto grain">
        {/* Masthead */}
        <header className="border-b border-stone-700 pb-6 mb-8">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-amber-300/70 font-mono mb-2">
                A Stylised Macroeconomic Scenario Engine
              </div>
              <h1 className="text-5xl md:text-6xl font-normal tracking-tight"
                  style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
                Ledger
              </h1>
              <div className="text-stone-400 text-sm mt-2 italic">
                United Kingdom · 2025–2035 · AI productivity, redistribution, and the structure of the trade-off
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button key={key}
                  onClick={() => setPreset(key)}
                  className="text-[10px] tracking-widest uppercase font-mono px-3 py-1.5 border border-stone-700 hover:border-amber-300 hover:text-amber-200 transition-colors text-stone-400">
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT: Levers */}
          <div className="lg:col-span-3">
            <div className="text-[10px] tracking-[0.3em] uppercase text-amber-300/70 font-mono mb-4 border-b border-stone-800 pb-2">
              ▸ Primary Levers
            </div>

            <Slider label="AI Productivity Gain" value={params.aiProd}
              onChange={(v) => updateParam('aiProd', v)}
              min={0} max={2} step={0.1} unit="pp"
              hint="Annual TFP boost. Acemoglu: 0.05 · Aghion: 1.0 · Goldman: 1.5" />

            <Slider label="Adoption Speed" value={params.adoption}
              onChange={(v) => updateParam('adoption', v)}
              min={3} max={20} step={1} unit=" yrs"
              hint="Years to S-curve midpoint" />

            <Slider label="UBI Level" value={params.ubi}
              onChange={(v) => updateParam('ubi', v)}
              min={0} max={1500} step={50} unit=" £/mo"
              hint="Per adult. Stockton ≈ £400 · Stanford BIL high ≈ £1000" />

            <Slider label="UBI Funding from AI/Capital" value={params.ubiMix}
              onChange={(v) => updateParam('ubiMix', v)}
              min={0} max={100} step={5} unit="%"
              hint="0 = labour-tax funded · 100 = AI-rent funded" />

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[10px] tracking-[0.3em] uppercase text-stone-500 hover:text-amber-300 font-mono mt-6 mb-3 transition-colors">
              {showAdvanced ? '▾' : '▸'} Advanced Parameters
            </button>

            {showAdvanced && (
              <div className="opacity-90">
                <Slider label="Capital Tax Rate" value={params.capTax}
                  onChange={(v) => updateParam('capTax', v)}
                  min={15} max={50} step={1} unit="%" />
                <Slider label="Task Automation Ceiling" value={params.ceiling}
                  onChange={(v) => updateParam('ceiling', v)}
                  min={10} max={60} step={1} unit="%"
                  hint="Eloundou: 20 · Svanberg profitable: 23" />
              </div>
            )}

            <div className="mt-8 pt-4 border-t border-stone-800 flex gap-2">
              {!compareGhost ? (
                <button onClick={pinGhost}
                  className="text-[10px] tracking-widest uppercase font-mono px-3 py-2 border border-stone-700 hover:border-amber-300 hover:text-amber-200 transition-colors text-stone-400 flex-1">
                  Pin as Ghost
                </button>
              ) : (
                <button onClick={clearGhost}
                  className="text-[10px] tracking-widest uppercase font-mono px-3 py-2 border border-amber-300/50 text-amber-200 hover:bg-amber-300/10 transition-colors flex-1">
                  Clear Ghost
                </button>
              )}
            </div>
          </div>

          {/* CENTRE: Trajectories */}
          <div className="lg:col-span-6">
            <div className="text-[10px] tracking-[0.3em] uppercase text-amber-300/70 font-mono mb-4 border-b border-stone-800 pb-2 flex justify-between">
              <span>▸ Ten-Year Trajectory</span>
              <span className="text-stone-500">Year {2025 + animationProgress}</span>
            </div>

            {/* GDP & Wage chart */}
            <div className="mb-6">
              <div className="text-xs text-stone-400 mb-2 font-mono">Output & Wages (2025=100)</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                  <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                  <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[90, 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <Line type="monotone" dataKey="gdpIdx" stroke="#fcd34d" strokeWidth={2} dot={false} name="GDP" />
                  <Line type="monotone" dataKey="medianWage" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Median wage" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Distribution chart */}
            <div className="mb-6">
              <div className="text-xs text-stone-400 mb-2 font-mono">Distribution — Labour Share & Gini ×100</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                  <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                  <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <ReferenceLine y={53} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} label={{ value: 'Labour floor', fill: '#ef4444', fontSize: 9, position: 'right' }} />
                  <Line type="monotone" dataKey="labourShare" stroke="#86efac" strokeWidth={2} dot={false} name="Labour share %" />
                  <Line type="monotone" dataKey="giniPct" stroke="#fb7185" strokeWidth={2} dot={false} name="Gini ×100" />
                  {compareGhost && <Line type="monotone" dataKey="ghostGini" stroke="#fb7185" strokeWidth={1} strokeDasharray="3 3" dot={false} opacity={0.4} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Stability chart */}
            <div>
              <div className="text-xs text-stone-400 mb-2 font-mono">Social Stability Index ×100</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                  <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                  <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} label={{ value: 'Unrest threshold', fill: '#ef4444', fontSize: 9, position: 'right' }} />
                  <Line type="monotone" dataKey="stabilityPct" stroke="#fcd34d" strokeWidth={2.5} dot={false} name="Stability" />
                  {compareGhost && <Line type="monotone" dataKey="ghostStability" stroke="#fcd34d" strokeWidth={1} strokeDasharray="3 3" dot={false} opacity={0.4} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT: End-state & flags */}
          <div className="lg:col-span-3">
            <div className="text-[10px] tracking-[0.3em] uppercase text-amber-300/70 font-mono mb-4 border-b border-stone-800 pb-2">
              ▸ 2035 End-State
            </div>

            <div className="grid grid-cols-2 gap-x-4">
              <MetricCard label="GDP Index" value={result.final.gdpIdx} unit="" large />
              <MetricCard label="Labour share" value={result.final.labourShare} unit="%"
                danger={result.final.labourShare < 53} />
              <MetricCard label="Gini" value={result.final.gini.toFixed(3)} unit=""
                danger={result.final.gini > 0.39} />
              <MetricCard label="Unemployment" value={result.final.unemp} unit="%"
                danger={result.final.unemp > 8} />
              <MetricCard label="Median wage" value={result.final.medianWage} unit=""
                danger={result.final.medianWage < 102} />
              <MetricCard label="Top 10% wealth" value={result.final.top10} unit="%" />
              <MetricCard label="Debt/GDP" value={result.final.debtGdp} unit="%"
                danger={result.final.debtGdp > 150} />
              <MetricCard label="Stability" value={result.final.stability.toFixed(2)} unit=""
                danger={result.final.stability < 0.55} />
            </div>

            <div className="text-[10px] tracking-[0.3em] uppercase text-amber-300/70 font-mono mt-8 mb-3 border-b border-stone-800 pb-2">
              ▸ Regime Flags
            </div>
            <div className="space-y-1">
              <Flag active={result.flags.unrest} label="Unrest threshold" year={result.flags.unrestYear} color="border-red-500" />
              <Flag active={result.flags.fiscal} label="Fiscal cliff" year={result.flags.fiscalYear} color="border-orange-500" />
              <Flag active={result.flags.labourCollapse} label="Labour collapse" year={result.flags.labourYear} color="border-yellow-500" />
              <Flag active={result.flags.wageStag} label="Wage stagnation" color="border-amber-500" />
            </div>
          </div>
        </div>

        {/* Footer narrative band */}
        <div className="mt-12 pt-8 border-t border-stone-700">
          <div className="text-[10px] tracking-[0.3em] uppercase text-amber-300/70 font-mono mb-3">
            ▸ Scenario Narrative
          </div>
          <p className="text-stone-300 leading-relaxed text-base"
             style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: '1.15rem', lineHeight: '1.7' }}>
            {narrative}
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] text-stone-500 font-mono">
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Productivity engine</div>
              Acemoglu task-based · Hulten's theorem
            </div>
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Distribution engine</div>
              IMF heterogeneous-agent · OECD labour-share series
            </div>
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Stability engine</div>
              Turchin structural-demographic · CTC West Point grievance framework
            </div>
          </div>
        </div>

        {/* Limitations footer */}
        <div className="mt-8 pt-4 border-t border-stone-800 text-[10px] text-stone-600 font-mono leading-relaxed">
          <span className="uppercase tracking-widest text-stone-500">Limitations · </span>
          Stylised, not predictive. UK as homogeneous economy. Linear feedbacks where reality is non-linear.
          No exogenous shocks. The unrest index is a heuristic, not a measurement. Behavioural elasticities at literature midpoints.
        </div>
      </div>
    </div>
  );
}
