import React, { useState, useMemo, useContext, createContext } from 'react'

// ---------- theme ----------
const LIGHT = {
  bg: '#faf8f4',
  card: '#fff',
  text: '#1a1815',
  textSub: '#3a3631',
  textMuted: '#6b6660',
  textFaint: '#8c857c',
  border: '#e3ddd2',
  borderFaint: '#ece7df',
  accent: '#3a5e8c',
  chartDot: '#faf8f4',
  chartGrid: '#ece7df',
  baselineLine: '#b8b1a4',
  presetActiveBg: '#1a1815',
  presetActiveText: '#faf8f4',
  presetActiveBlurb: '#d8d3cb',
  sliderTrack: '#e3ddd2',
  sliderThumb: '#3a5e8c',
};

const DARK = {
  bg: '#1c1a17',
  card: '#252220',
  text: '#f0ece5',
  textSub: '#ccc5bb',
  textMuted: '#9c9590',
  textFaint: '#7a7570',
  border: '#3a3631',
  borderFaint: '#2e2b28',
  accent: '#6a9fd4',
  chartDot: '#1c1a17',
  chartGrid: '#2e2b28',
  baselineLine: '#5a5550',
  presetActiveBg: '#f0ece5',
  presetActiveText: '#1c1a17',
  presetActiveBlurb: '#7a7570',
  sliderTrack: '#3a3631',
  sliderThumb: '#6a9fd4',
};

const ThemeContext = createContext(LIGHT);
const useTheme = () => useContext(ThemeContext);

// ---------- simulation engine ----------
const SEGMENTS = {
  junior: {
    label: 'Junior / Entry-level',
    plainLabel: 'Young & entry-level',
    description: 'Under-25 and early career. AI can do many of their starter tasks. Minimum-wage floors mean the shock shows up as lost jobs more than lower pay.',
    workforceShare: 0.235,
    initialWage: 0.55,
    naturalRate: 0.080,
    exposure: 0.55,
    complementarity: 0.10,
    productivityBoost: 0.34,
    labourSupplyElasticity: 0.40,
  },
  mid: {
    label: 'Mid-career / Skilled',
    plainLabel: 'Mid-career',
    description: 'The bulk of the workforce. AI replaces some tasks, helps with others. The hit lands roughly half on jobs, half on pay.',
    workforceShare: 0.555,
    initialWage: 1.0,
    naturalRate: 0.040,
    exposure: 0.30,
    complementarity: 0.30,
    productivityBoost: 0.18,
    labourSupplyElasticity: 0.60,
  },
  senior: {
    label: 'Senior / Specialised',
    plainLabel: 'Senior & specialised',
    description: 'Judgement-heavy roles where AI mostly amplifies what they do. They tend to keep their jobs and capture a wage premium.',
    workforceShare: 0.210,
    initialWage: 2.10,
    naturalRate: 0.025,
    exposure: 0.10,
    complementarity: 0.55,
    productivityBoost: 0.05,
    labourSupplyElasticity: 0.85,
  },
};

const PRESETS = {
  baseline: {
    name: 'No AI',
    blurb: 'A world where AI never takes off. The current trajectory continues.',
    aiProd: 0, adoption: 10, ubi: 0, ubiMix: 0, capTax: 25,
  },
  moderate: {
    name: 'Steady helper',
    blurb: 'AI is real but modest — like a useful assistant for most jobs.',
    aiProd: 1.0, adoption: 8, ubi: 0, ubiMix: 0, capTax: 30,
  },
  aggressive: {
    name: 'Productivity boom',
    blurb: 'AI delivers a major economic boost. Growth accelerates, but unevenly.',
    aiProd: 1.5, adoption: 5, ubi: 0, ubiMix: 0, capTax: 25,
  },
  disruption: {
    name: 'Rapid disruption',
    blurb: 'AI rolls out fast and capable. Big winners, big losers, fragile politics.',
    aiProd: 1.8, adoption: 4, ubi: 0, ubiMix: 0, capTax: 18,
  },
  ubiResponse: {
    name: 'AI + safety net',
    blurb: 'A productivity boom paired with a basic income funded by capital.',
    aiProd: 1.2, adoption: 7, ubi: 600, ubiMix: 75, capTax: 40,
  },
};

function simulate(p, includeAI = true) {
  const T = 11;
  const init = {
    gdp: 2750, tfp: 1.0, labourShare: 0.595, capShare: 0.405,
    debtGdp: 0.95, top10Wealth: 0.43,
    juniorUnemp: SEGMENTS.junior.naturalRate,
    midUnemp: SEGMENTS.mid.naturalRate,
    seniorUnemp: SEGMENTS.senior.naturalRate,
    juniorWage: SEGMENTS.junior.initialWage,
    midWage: SEGMENTS.mid.initialWage,
    seniorWage: SEGMENTS.senior.initialWage,
    realWageStagYears: 0,
    cumulativeAdoption: 0,
  };
  const empShares = {
    junior: SEGMENTS.junior.workforceShare,
    mid: SEGMENTS.mid.workforceShare,
    senior: SEGMENTS.senior.workforceShare,
  };
  const baselineTfpGrowth = (t) => t <= 5 ? 0.003 + (0.008 - 0.003) * (t / 5) : 0.008;
  const baselineLabourGrowth = (t) => 0.005 - (0.005 - 0.003) * (t / 10);
  const aiCostInitial = 0.8;
  const aiCostHalfLife = 4;
  const aiCost = (t) => aiCostInitial * Math.pow(0.5, t / aiCostHalfLife);
  const lambdaUBI = 0.18;
  const baselineRevRatio = 0.405;
  const baselineSpendRatio = 0.405;
  const interestRate = 0.020;
  const unempReversion = 0.25;
  const baselineLabourDrift = 0.0008;

  const initialEmployedShares = {
    junior: (1 - SEGMENTS.junior.naturalRate) * empShares.junior,
    mid: (1 - SEGMENTS.mid.naturalRate) * empShares.mid,
    senior: (1 - SEGMENTS.senior.naturalRate) * empShares.senior,
  };
  const initialWageBillIndex = initialEmployedShares.junior * SEGMENTS.junior.initialWage
                              + initialEmployedShares.mid * SEGMENTS.mid.initialWage
                              + initialEmployedShares.senior * SEGMENTS.senior.initialWage;
  const nominalWageScale = init.labourShare / initialWageBillIndex;

  const series = [];
  let s = { ...init }, prev = { ...init };
  let preUbiGini = 0.329;

  for (let t = 0; t < T; t++) {
    const aiProdFrac = (p.aiProd / 100);
    const technologyAvailable = aiProdFrac > 0 && includeAI;
    const ai_c = aiCost(t);
    let weightedAdoptionPressure = 0;
    for (const [name, seg] of Object.entries(SEGMENTS)) {
      const wageVal = name === 'junior' ? prev.juniorWage : (name === 'mid' ? prev.midWage : prev.seniorWage);
      const labourCostPerTask = wageVal * seg.exposure / (1 + seg.complementarity);
      const adoptionPressure = labourCostPerTask > ai_c ? (labourCostPerTask - ai_c) / labourCostPerTask : 0;
      weightedAdoptionPressure += empShares[name] * seg.exposure * adoptionPressure;
    }
    const maxDiffusion = technologyAvailable
      ? 1 / (1 + Math.exp(-8 * (t / p.adoption - 0.5)))
      : 0;
    const techPressureFactor = technologyAvailable ? Math.min(1, weightedAdoptionPressure * 3) : 0;
    const A = technologyAvailable
      ? Math.min(maxDiffusion, prev.cumulativeAdoption + (maxDiffusion - prev.cumulativeAdoption) * Math.min(1, techPressureFactor + 0.2))
      : 0;
    s.cumulativeAdoption = A;
    const Aprev = t > 0 ? prev.cumulativeAdoption : 0;
    const dA = Math.max(0, A - Aprev);

    s.tfp = prev.tfp * (1 + baselineTfpGrowth(t) + (technologyAvailable ? aiProdFrac * A : 0));
    const capTaxAdj = technologyAvailable ? (p.capTax - 25) * 0.0006 : 0;
    const aiCapDeepening = technologyAvailable ? 0.035 * aiProdFrac * dA * 100 * (1 - prev.capShare) : 0;
    const dAlpha = aiCapDeepening - baselineLabourDrift - capTaxAdj;
    s.capShare = Math.max(0.30, Math.min(0.65, prev.capShare + dAlpha));
    s.labourShare = 1 - s.capShare;

    function applySegmentShock(name, prevU, prevW, segNaturalRate) {
      const seg = SEGMENTS[name];
      const substitutionShock = technologyAvailable ? seg.exposure * dA * aiProdFrac * 12.0 : 0;
      const complementarityShock = technologyAvailable ? seg.complementarity * A * aiProdFrac * 0.8 : 0;
      const netDemandShock = complementarityShock - substitutionShock;
      const eps = seg.labourSupplyElasticity;
      const fracQuantity = 1 / (1 + eps);
      const fracWage = eps / (1 + eps);
      const dU_demand = -netDemandShock * fracQuantity;
      const dW_demand = netDemandShock * fracWage;
      const reversion = unempReversion * (prevU - segNaturalRate);
      const ageingDrift = 0.0003;
      const newU = Math.max(0.020, Math.min(0.30, prevU + dU_demand - reversion + ageingDrift));
      const baselineWageGrowth = 0.003;
      const newW = prevW * (1 + baselineWageGrowth + dW_demand);
      return { u: newU, w: newW };
    }

    const jr = applySegmentShock('junior', prev.juniorUnemp, prev.juniorWage, SEGMENTS.junior.naturalRate);
    const md = applySegmentShock('mid', prev.midUnemp, prev.midWage, SEGMENTS.mid.naturalRate);
    const sr = applySegmentShock('senior', prev.seniorUnemp, prev.seniorWage, SEGMENTS.senior.naturalRate);
    s.juniorUnemp = jr.u; s.midUnemp = md.u; s.seniorUnemp = sr.u;
    let juniorWageRaw = jr.w, midWageRaw = md.w, seniorWageRaw = sr.w;
    const aggUnemp = empShares.junior * s.juniorUnemp + empShares.mid * s.midUnemp + empShares.senior * s.seniorUnemp;
    const labGrowth = baselineLabourGrowth(t);
    const populationFactor = 1 + labGrowth * t;
    const L = (1 - aggUnemp) * 42 * populationFactor;
    const K = 1 + 0.025 * t;
    s.gdp = init.gdp * s.tfp * Math.pow(K, s.capShare) * Math.pow(L / 42, s.labourShare);
    const gdpGrowth = (s.gdp / prev.gdp) - 1;

    const employedShares = {
      junior: (1 - s.juniorUnemp) * empShares.junior,
      mid: (1 - s.midUnemp) * empShares.mid,
      senior: (1 - s.seniorUnemp) * empShares.senior,
    };
    const rawWageBillIndex = employedShares.junior * juniorWageRaw
                           + employedShares.mid * midWageRaw
                           + employedShares.senior * seniorWageRaw;
    const requiredWageBillIndex = (s.labourShare * s.gdp / init.gdp) / nominalWageScale;
    const wageScaleFactor = requiredWageBillIndex / rawWageBillIndex;
    s.juniorWage = juniorWageRaw * wageScaleFactor;
    s.midWage = midWageRaw * wageScaleFactor;
    s.seniorWage = seniorWageRaw * wageScaleFactor;

    const medianWage = empShares.junior * s.juniorWage + empShares.mid * s.midWage + empShares.senior * s.seniorWage;
    const prevMedian = empShares.junior * prev.juniorWage + empShares.mid * prev.midWage + empShares.senior * prev.seniorWage;
    s.realWageStagYears = (medianWage / prevMedian - 1) < 0.001 ? prev.realWageStagYears + 1 : 0;

    const wageRatioChange = (s.seniorWage / s.juniorWage) - (init.seniorWage / init.juniorWage);
    preUbiGini = Math.max(0.20, Math.min(0.55,
      preUbiGini + 0.6 * Math.max(0, aiCapDeepening)
      + 0.04 * wageRatioChange
      + 0.3 * (s.juniorUnemp - prev.juniorUnemp)));
    const ubiAsShareOfMedian = technologyAvailable ? (p.ubi * 12) / (medianWage * 35000) : 0;
    const ubiCompression = lambdaUBI * Math.min(0.6, ubiAsShareOfMedian);
    const gini = Math.max(0.20, preUbiGini - ubiCompression);

    s.top10Wealth = Math.min(0.85, prev.top10Wealth + 0.4 * Math.max(0, aiCapDeepening) + 0.0002);

    const capTaxBoost = technologyAvailable ? (p.capTax - 25) / 100 * s.capShare : 0;
    const aiRentRev = technologyAvailable ? (p.ubiMix / 100) * 0.04 * A : 0;
    const revRatio = baselineRevRatio + capTaxBoost + aiRentRev;
    const ubiCostBn = technologyAvailable ? (p.ubi * 12 * 52e6) / 1e9 : 0;
    const spendRatio = baselineSpendRatio + ubiCostBn / s.gdp;
    const primaryBalance = revRatio - spendRatio;
    s.debtGdp = prev.debtGdp * (1 + interestRate) / (1 + Math.max(gdpGrowth, 0.001)) - primaryBalance;

    const giniNorm = Math.min(1, Math.max(0, (gini - 0.32) / 0.15));
    const unempNorm = Math.min(1, Math.max(0, (aggUnemp - 0.05) / 0.06));
    const youthNorm = Math.min(1, Math.max(0, (s.juniorUnemp - 0.08) / 0.10));
    const labourNorm = Math.max(0, (0.59 - s.labourShare) / 0.10);
    const stagNorm = Math.min(1, s.realWageStagYears / 7);
    const legitimacy = Math.min(1, Math.max(0, (s.top10Wealth - 0.43) / 0.12));
    const stress = 0.18 * giniNorm + 0.12 * unempNorm + 0.20 * youthNorm
                 + 0.15 * labourNorm + 0.15 * stagNorm + 0.20 * legitimacy;
    const stability = Math.max(0, 1 - stress);

    series.push({
      year: 2025 + t,
      gdp: +(s.gdp).toFixed(0),
      gdpIdx: +(s.gdp / init.gdp * 100).toFixed(1),
      labourShare: +(s.labourShare * 100).toFixed(1),
      gini: +(gini).toFixed(3),
      giniPct: +(gini * 100).toFixed(1),
      aggUnemp: +(aggUnemp * 100).toFixed(2),
      juniorUnemp: +(s.juniorUnemp * 100).toFixed(1),
      midUnemp: +(s.midUnemp * 100).toFixed(1),
      seniorUnemp: +(s.seniorUnemp * 100).toFixed(1),
      juniorWage: +(s.juniorWage * 100).toFixed(1),
      midWage: +(s.midWage * 100).toFixed(1),
      seniorWage: +(s.seniorWage * 100).toFixed(1),
      seniorJuniorRatio: +(s.seniorWage / s.juniorWage).toFixed(2),
      medianWage: +(medianWage * 100).toFixed(1),
      debtGdp: +(s.debtGdp * 100).toFixed(0),
      top10: +(s.top10Wealth * 100).toFixed(1),
      stability: +(stability).toFixed(3),
      stabilityPct: +(stability * 100).toFixed(1),
      adoption: +(A * 100).toFixed(1),
      maxDiffusion: +(maxDiffusion * 100).toFixed(1),
      adoptionPressure: +(weightedAdoptionPressure * 100).toFixed(1),
      aiCost: +(ai_c).toFixed(3),
    });
    prev = { ...s };
  }

  let peakJunior = { value: 0, year: 0 };
  series.forEach(d => { if (d.juniorUnemp > peakJunior.value) peakJunior = { value: d.juniorUnemp, year: d.year }; });

  const flags = {
    unrest: series.some(d => d.stability < 0.55),
    unrestYear: series.find(d => d.stability < 0.55)?.year,
    fiscal: series.some(d => d.debtGdp > 130),
    fiscalYear: series.find(d => d.debtGdp > 130)?.year,
    labourCollapse: series.some(d => d.labourShare < 55),
    labourYear: series.find(d => d.labourShare < 55)?.year,
    youthCrisis: series.some(d => d.juniorUnemp > 12),
    youthCrisisYear: series.find(d => d.juniorUnemp > 12)?.year,
    wageStag: series[T-1].medianWage < 102,
    adoptionConstrained: series[T-1].adoption < series[T-1].maxDiffusion - 1,
  };

  return { series, flags, final: series[T-1], peakJunior };
}

// ---------- helpers ----------
const fmtPct = (n, d = 0) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;

function statusOf(metric, scenario, baseline) {
  const s = scenario, b = baseline;
  switch (metric) {
    case 'gdp': {
      const d = s.gdpIdx - b.gdpIdx;
      if (d > 5) return 'good';
      if (d < -1) return 'bad';
      return 'neutral';
    }
    case 'wages': {
      const d = s.medianWage - b.medianWage;
      if (d > 2) return 'good';
      if (d < -1) return 'bad';
      return 'neutral';
    }
    case 'youth': {
      if (s.juniorUnemp > 12) return 'bad';
      if (s.juniorUnemp > 10) return 'warn';
      return 'good';
    }
    case 'inequality': {
      if (s.gini > 0.40) return 'bad';
      if (s.gini > 0.36) return 'warn';
      return 'good';
    }
    case 'stability': {
      if (s.stability < 0.55) return 'bad';
      if (s.stability < 0.70) return 'warn';
      return 'good';
    }
    default: return 'neutral';
  }
}

const STATUS_COLOR = {
  good: '#3a7d4f',
  warn: '#b6781f',
  bad:  '#b73a3a',
  neutral: '#6b6660',
};

function buildStory(p, sc, bl) {
  const f = sc.final, b = bl.final;
  const gdpDelta = f.gdpIdx - b.gdpIdx;
  const wageDelta = f.medianWage - b.medianWage;
  const youth = f.juniorUnemp;
  const adoption = f.adoption;
  const sentences = [];

  if (p.aiProd === 0) {
    sentences.push("In this scenario AI never really takes off. The UK economy follows its current path — slow productivity growth, broadly stable inequality, no big shocks to young workers.");
  } else {
    if (gdpDelta > 8) {
      sentences.push(`By 2035 the UK economy is roughly ${fmtPct(gdpDelta - (b.gdpIdx - 100), 0)} larger than it would be without AI — a meaningful productivity boom.`);
    } else if (gdpDelta > 2) {
      sentences.push(`By 2035 AI adds about ${fmtPct(gdpDelta, 0)} to the economy on top of the no-AI path — useful but not transformative.`);
    } else {
      sentences.push(`AI is available, but adoption stays slow (only ${adoption.toFixed(0)}% diffusion) and the GDP boost is modest at ${fmtPct(gdpDelta, 1)}.`);
    }
    if (youth > 12) {
      sentences.push(`But it lands hard on young workers: junior unemployment peaks at ${sc.peakJunior.value.toFixed(1)}% — well above the youth-crisis threshold.`);
    } else if (youth > 9.5) {
      sentences.push(`Young workers feel it most: junior unemployment climbs to ${youth.toFixed(1)}% as entry-level tasks are automated.`);
    } else {
      sentences.push(`Young workers feel only mild pressure — junior unemployment stays near ${youth.toFixed(1)}%.`);
    }
    if (wageDelta > 2) {
      sentences.push(`Median wages end up ${fmtPct(wageDelta, 1)} higher than the no-AI path${p.ubi > 0 ? `, helped by the £${p.ubi}/month basic income` : ''}.`);
    } else if (wageDelta < -1) {
      sentences.push(`Median wages slip ${fmtPct(wageDelta, 1)} versus the no-AI path — the gains accrue to capital, not pay packets.`);
    } else {
      sentences.push(`Median wages barely move from the no-AI baseline — productivity gains flow mostly to capital owners.`);
    }
    if (f.stability < 0.55) {
      sentences.push(`Social stability drops below the unrest threshold around ${sc.flags.unrestYear}.`);
    }
  }
  return sentences.join(' ');
}

// ---------- chart ----------
function LineChart({ width = 540, height = 180, series, baseline, label, unit = '', domain, threshold, color = '#3a5e8c' }) {
  const t = useTheme();
  const pad = { l: 38, r: 14, t: 14, b: 24 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const years = series.map(d => d.x);
  const allY = [...series, ...(baseline || [])].map(d => d.y);
  const yMin = domain ? domain[0] : Math.min(...allY) * 0.96;
  const yMax = domain ? domain[1] : Math.max(...allY) * 1.04;
  const xScale = i => pad.l + (i / (series.length - 1)) * W;
  const yScale = v => pad.t + H - ((v - yMin) / (yMax - yMin)) * H;
  const path = pts => pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.y)}`).join(' ');
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yMax - yMin) * (i / ticks));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: t.text, fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={yScale(tick)} y2={yScale(tick)}
              stroke={t.chartGrid} strokeWidth="1" strokeDasharray={i === 0 ? '' : '2 4'} />
            <text x={pad.l - 6} y={yScale(tick) + 3} fontSize="10" fill={t.textFaint} textAnchor="end" fontFamily="ui-monospace, monospace">
              {tick.toFixed(unit === '%' ? 0 : 0)}{unit}
            </text>
          </g>
        ))}
        {threshold != null && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={yScale(threshold)} y2={yScale(threshold)}
              stroke="#b73a3a" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
            <text x={width - pad.r - 4} y={yScale(threshold) - 3} fontSize="9" fill="#b73a3a" textAnchor="end" fontFamily="ui-monospace, monospace">
              warning
            </text>
          </g>
        )}
        {[0, Math.floor(years.length / 2), years.length - 1].map(i => (
          <text key={i} x={xScale(i)} y={height - 6} fontSize="10" fill={t.textFaint} textAnchor="middle" fontFamily="ui-monospace, monospace">
            {years[i]}
          </text>
        ))}
        {baseline && (
          <path d={path(baseline)} stroke={t.baselineLine} strokeWidth="1.4" fill="none" strokeDasharray="4 3" />
        )}
        <path d={path(series)} stroke={color} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((d, i) => i === series.length - 1 && (
          <circle key={i} cx={xScale(i)} cy={yScale(d.y)} r="3.5" fill={color} stroke={t.chartDot} strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

// ---------- atomic UI ----------
function Slider({ label, hint, value, onChange, min, max, step, format }) {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <label style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{label}</label>
        <span style={{ fontSize: 14, color: t.accent, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', '--slider-track': t.sliderTrack, '--slider-thumb': t.sliderThumb }}
        className="ledger-slider" />
      {hint && <div style={{ fontSize: 12, color: t.textFaint, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function ScenarioCard({ active, name, blurb, onClick }) {
  const t = useTheme();
  return (
    <button onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        background: active ? t.presetActiveBg : t.card,
        color: active ? t.presetActiveText : t.text,
        border: `1px solid ${active ? t.presetActiveBg : t.border}`,
        borderRadius: 10,
        cursor: 'pointer',
        flex: '1 1 180px',
        minWidth: 0,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = t.text; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = t.border; }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 12.5, color: active ? t.presetActiveBlurb : t.textMuted, lineHeight: 1.4 }}>{blurb}</div>
    </button>
  );
}

function StatCard({ title, value, suffix, status, subtitle }) {
  const t = useTheme();
  return (
    <div style={{
      padding: '14px 16px',
      background: t.card,
      border: `1px solid ${t.border}`,
      borderLeft: `3px solid ${STATUS_COLOR[status] || t.border}`,
      borderRadius: 6,
    }}>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: t.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}<span style={{ fontSize: 14, color: t.textFaint, marginLeft: 2 }}>{suffix}</span>
      </div>
      {subtitle && <div style={{ fontSize: 11.5, color: STATUS_COLOR[status] || t.textFaint, marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

function SegmentCard({ name, segment, scenarioFinal, baselineFinal, color }) {
  const t = useTheme();
  const wage = scenarioFinal[name + 'Wage'], baseWage = baselineFinal[name + 'Wage'];
  const unemp = scenarioFinal[name + 'Unemp'], baseUnemp = baselineFinal[name + 'Unemp'];
  const unempStatus = unemp > 12 ? 'bad' : unemp > 9 ? 'warn' : 'good';
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`, borderTop: `3px solid ${color}`,
      borderRadius: 6, padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{segment.plainLabel}</span>
        <span style={{ fontSize: 11, color: t.textFaint, fontVariantNumeric: 'tabular-nums' }}>
          {(segment.workforceShare * 100).toFixed(0)}% of workers
        </span>
      </div>
      <div style={{ fontSize: 13, color: t.textSub, lineHeight: 1.5, marginBottom: 14 }}>
        {segment.description}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 2 }}>Unemployment in 2035</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: STATUS_COLOR[unempStatus], fontVariantNumeric: 'tabular-nums' }}>
            {unemp.toFixed(1)}%
          </div>
          <div style={{ fontSize: 11, color: t.textFaint, fontVariantNumeric: 'tabular-nums' }}>
            was {baseUnemp.toFixed(1)}% without AI
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 2 }}>Wage index in 2035</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: wage >= baseWage ? '#3a7d4f' : '#b73a3a', fontVariantNumeric: 'tabular-nums' }}>
            {wage.toFixed(0)}
          </div>
          <div style={{ fontSize: 11, color: t.textFaint, fontVariantNumeric: 'tabular-nums' }}>
            was {baseWage.toFixed(0)} without AI
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpertRow({ label, scenario, baseline, format = v => v.toFixed(1), unit = '', danger }) {
  const t = useTheme();
  const delta = scenario - baseline;
  const isImprovement = (label.includes('Stab') || label.includes('Median') || label.includes('GDP') || label.includes('Labour share') || label.includes('wage'))
    ? delta > 0 : delta < 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr 3fr 2fr', gap: 8, padding: '6px 0', borderBottom: `1px solid ${t.borderFaint}`, alignItems: 'baseline' }}>
      <div style={{ fontSize: 12, color: t.textSub }}>{label}</div>
      <div style={{ fontSize: 12, color: t.textFaint, fontVariantNumeric: 'tabular-nums' }}>{format(baseline)}{unit}</div>
      <div style={{ fontSize: 13, color: danger ? '#b73a3a' : t.text, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{format(scenario)}{unit}</div>
      <div style={{ fontSize: 12, color: Math.abs(delta) < 0.01 ? t.textFaint : isImprovement ? '#3a7d4f' : '#b73a3a', fontVariantNumeric: 'tabular-nums' }}>
        {delta > 0 ? '+' : ''}{format(Math.abs(delta) < 0.01 ? 0 : delta)}
      </div>
    </div>
  );
}

// ---------- main ----------
export default function App() {
  const [params, setParams] = useState({ aiProd: 1.0, adoption: 8, ubi: 0, ubiMix: 0, capTax: 30 });
  const [activePreset, setActivePreset] = useState('moderate');
  const [expert, setExpert] = useState(false);
  const [chartTab, setChartTab] = useState('story');
  const [dark, setDark] = useState(false);
  const theme = dark ? DARK : LIGHT;

  const baseline = useMemo(() => simulate(params, false), [params]);
  const scenario = useMemo(() => simulate(params, true), [params]);
  const story = useMemo(() => buildStory(params, scenario, baseline), [params, scenario, baseline]);

  const setPreset = (key) => {
    const { name, blurb, ...preset } = PRESETS[key];
    setParams(preset);
    setActivePreset(key);
  };
  const updateParam = (k, v) => { setParams(p => ({ ...p, [k]: v })); setActivePreset(null); };

  const f = scenario.final, b = baseline.final;
  const gdpStatus = statusOf('gdp', f, b);
  const wageStatus = statusOf('wages', f, b);
  const youthStatus = statusOf('youth', f, b);
  const ineqStatus = statusOf('inequality', f, b);
  const stabStatus = statusOf('stability', f, b);

  const seriesXY = (key) => scenario.series.map(d => ({ x: d.year, y: d[key] }));
  const baseXY = (key) => baseline.series.map(d => ({ x: d.year, y: d[key] }));

  const pillStyle = (on) => ({
    padding: '6px 12px', fontSize: 12,
    color: on ? '#fff' : theme.textSub,
    background: on ? theme.text : theme.card,
    border: `1px solid ${theme.text}`,
    borderRadius: 999, cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em',
  });

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
        '--slider-track': theme.sliderTrack,
        '--slider-thumb': theme.sliderThumb,
      }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 24px 64px' }}>

          {/* HEADER */}
          <header style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ maxWidth: 720 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: theme.textFaint, marginBottom: 10, fontFamily: 'ui-monospace, monospace' }}>
                  Ledger · UK economic scenarios · 2025 → 2035
                </div>
                <h1 style={{ fontFamily: '"Source Serif 4", "Source Serif Pro", Georgia, serif', fontSize: 44, lineHeight: 1.05, margin: 0, color: theme.text, fontWeight: 500, letterSpacing: '-0.01em' }}>
                  How might AI reshape the UK economy?
                </h1>
                <p style={{ fontSize: 16, color: theme.textSub, lineHeight: 1.55, marginTop: 12, marginBottom: 0, maxWidth: 640 }}>
                  Pick a scenario below, or move the dials yourself. The model traces the next ten years across jobs, wages, inequality, and political stability — and tells you, in plain English, what changed.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button onClick={() => setDark(!dark)} style={pillStyle(dark)}>
                  {dark ? '☀ Light' : '☾ Dark'}
                </button>
                <button onClick={() => setExpert(!expert)} style={pillStyle(expert)}>
                  {expert ? 'Expert ON' : 'Expert mode'}
                </button>
              </div>
            </div>
          </header>

          {/* SCENARIO PICKER */}
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontFamily: 'ui-monospace, monospace' }}>
              Start with a scenario
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <ScenarioCard key={key} active={activePreset === key} name={p.name} blurb={p.blurb} onClick={() => setPreset(key)} />
              ))}
            </div>
          </section>

          {/* MAIN GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', gap: 24, alignItems: 'start' }} className="ledger-grid">

            {/* CONTROLS */}
            <aside>
              <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, fontFamily: 'ui-monospace, monospace' }}>
                Adjust the dials
              </div>
              <Slider label="AI productivity boost" hint="How much extra growth AI adds each year, at full diffusion."
                value={params.aiProd} onChange={v => updateParam('aiProd', v)} min={0} max={2} step={0.1}
                format={v => `+${v.toFixed(1)}% / yr`} />
              <Slider label="How fast it spreads" hint="Years to widespread use. Lower = faster rollout."
                value={params.adoption} onChange={v => updateParam('adoption', v)} min={3} max={20} step={1}
                format={v => `${v} yrs`} />
              <Slider label="Universal Basic Income" hint="Monthly payment to every adult, in pounds."
                value={params.ubi} onChange={v => updateParam('ubi', v)} min={0} max={1500} step={50}
                format={v => v === 0 ? 'none' : `£${v}/mo`} />
              <Slider label="Funded by AI / capital tax" hint="0% = paid for from labour tax. 100% = paid for by taxing AI profits."
                value={params.ubiMix} onChange={v => updateParam('ubiMix', v)} min={0} max={100} step={5}
                format={v => `${v}%`} />
              {expert && (
                <Slider label="Capital tax rate" hint="UK current ~25%. Higher rate preserves labour share but slows AI rollout."
                  value={params.capTax} onChange={v => updateParam('capTax', v)} min={15} max={50} step={1}
                  format={v => `${v}%`} />
              )}
            </aside>

            {/* CENTER: STORY + CHARTS */}
            <main>
              <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.textFaint, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
                  The story · 2035
                </div>
                <p style={{ fontFamily: '"Source Serif 4", "Source Serif Pro", Georgia, serif', fontSize: 19, lineHeight: 1.45, color: theme.text, margin: 0 }}>
                  {story}
                </p>
              </div>

              {/* tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { k: 'story', label: 'Headline charts' },
                  { k: 'segments', label: 'By workforce segment' },
                  { k: 'adoption', label: 'AI rollout' },
                ].map(tab => (
                  <button key={tab.k} onClick={() => setChartTab(tab.k)}
                    style={{
                      padding: '8px 14px', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
                      color: chartTab === tab.k ? theme.text : theme.textFaint,
                      fontWeight: chartTab === tab.k ? 600 : 400,
                      borderBottom: chartTab === tab.k ? `2px solid ${theme.text}` : '2px solid transparent',
                      marginBottom: -1,
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {chartTab === 'story' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <LineChart label="How big is the economy? (2025 = 100)" series={seriesXY('gdpIdx')} baseline={baseXY('gdpIdx')} color="#3a5e8c" />
                  <LineChart label="What about typical wages?" series={seriesXY('medianWage')} baseline={baseXY('medianWage')} color="#3a7d4f" />
                  <LineChart label="Inequality (Gini × 100)" series={seriesXY('giniPct')} baseline={baseXY('giniPct')} color="#b6781f" domain={[28, 45]} />
                  <LineChart label="Social stability (100 = healthy)" series={seriesXY('stabilityPct')} baseline={baseXY('stabilityPct')} color={theme.text} domain={[40, 100]} threshold={55} />
                </div>
              )}

              {chartTab === 'segments' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  <LineChart label="Junior unemployment (%)" series={seriesXY('juniorUnemp')} baseline={baseXY('juniorUnemp')} color="#b73a3a" unit="%" threshold={12} />
                  <LineChart label="Mid-career unemployment (%)" series={seriesXY('midUnemp')} baseline={baseXY('midUnemp')} color="#b6781f" unit="%" />
                  <LineChart label="Senior wages vs junior wages (ratio)" series={seriesXY('seniorJuniorRatio')} baseline={baseXY('seniorJuniorRatio')} color="#3a5e8c" domain={[3.5, 4.5]} />
                </div>
              )}

              {chartTab === 'adoption' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  <LineChart label="AI adoption: realised vs maximum possible (%)"
                    series={seriesXY('adoption')} baseline={scenario.series.map(d => ({ x: d.year, y: d.maxDiffusion }))}
                    color="#3a5e8c" unit="%" domain={[0, 100]} />
                  <div style={{ fontSize: 13, color: theme.textSub, fontStyle: 'italic', lineHeight: 1.55, padding: '0 4px' }}>
                    The dashed line is the maximum diffusion the "speed" dial allows. The solid line is what actually happens — bounded above by the dashed line, but slower if AI is more expensive than the labour it would replace. The gap is firm-level cost discipline.
                  </div>
                  <LineChart label="Labour share of national income (%)" series={seriesXY('labourShare')} baseline={baseXY('labourShare')} color="#3a7d4f" unit="%" domain={[50, 70]} threshold={55} />
                </div>
              )}
            </main>

            {/* RIGHT: KEY NUMBERS */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2, fontFamily: 'ui-monospace, monospace' }}>
                Key numbers · 2035
              </div>
              <StatCard title="Economy size" value={fmtPct(f.gdpIdx - 100, 0)} suffix=" vs 2025" status={gdpStatus} subtitle={`${fmtPct(f.gdpIdx - b.gdpIdx, 1)} vs no-AI`} />
              <StatCard title="Typical wages" value={fmtPct(f.medianWage - 100, 1)} suffix=" vs 2025" status={wageStatus} subtitle={`${fmtPct(f.medianWage - b.medianWage, 1)} vs no-AI`} />
              <StatCard title="Young people out of work" value={f.juniorUnemp.toFixed(1)} suffix="%" status={youthStatus}
                subtitle={youthStatus === 'bad' ? 'Above youth-crisis level' : youthStatus === 'warn' ? 'Elevated' : 'Within normal range'} />
              <StatCard title="Inequality (Gini)" value={f.gini.toFixed(2)} suffix="" status={ineqStatus}
                subtitle={ineqStatus === 'bad' ? 'High by UK standards' : ineqStatus === 'warn' ? 'Climbing' : 'Stable'} />
              <StatCard title="Social stability" value={(f.stability * 100).toFixed(0)} suffix="/100" status={stabStatus}
                subtitle={stabStatus === 'bad' ? `Unrest threshold breached ${scenario.flags.unrestYear}` : stabStatus === 'warn' ? 'Strained' : 'Healthy'} />
            </aside>
          </div>

          {/* WORKFORCE */}
          <section style={{ marginTop: 36 }}>
            <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, fontFamily: 'ui-monospace, monospace' }}>
              Who feels what — by age &amp; role
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <SegmentCard name="junior" segment={SEGMENTS.junior} scenarioFinal={f} baselineFinal={b} color="#b73a3a" />
              <SegmentCard name="mid" segment={SEGMENTS.mid} scenarioFinal={f} baselineFinal={b} color="#b6781f" />
              <SegmentCard name="senior" segment={SEGMENTS.senior} scenarioFinal={f} baselineFinal={b} color="#3a7d4f" />
            </div>
          </section>

          {/* EXPERT TABLE */}
          {expert && (
            <section style={{ marginTop: 36, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '20px 24px' }}>
              <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14, fontFamily: 'ui-monospace, monospace' }}>
                Full metric table · 2035
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr 3fr 2fr', gap: 8, paddingBottom: 8, borderBottom: `1px solid ${theme.text}` }}>
                <div style={{ fontSize: 11, color: theme.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Metric</div>
                <div style={{ fontSize: 11, color: theme.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>No AI</div>
                <div style={{ fontSize: 11, color: theme.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Scenario</div>
                <div style={{ fontSize: 11, color: theme.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Δ</div>
              </div>
              <ExpertRow label="GDP index" scenario={f.gdpIdx} baseline={b.gdpIdx} />
              <ExpertRow label="Median wage index" scenario={f.medianWage} baseline={b.medianWage} />
              <ExpertRow label="Junior wage" scenario={f.juniorWage} baseline={b.juniorWage} />
              <ExpertRow label="Senior wage" scenario={f.seniorWage} baseline={b.seniorWage} />
              <ExpertRow label="Senior / junior wage ratio" scenario={f.seniorJuniorRatio} baseline={b.seniorJuniorRatio} format={v => v.toFixed(2)} danger={f.seniorJuniorRatio > 4.2} />
              <ExpertRow label="Junior unemployment" scenario={f.juniorUnemp} baseline={b.juniorUnemp} unit="%" danger={f.juniorUnemp > 10} />
              <ExpertRow label="Labour share of income" scenario={f.labourShare} baseline={b.labourShare} unit="%" danger={f.labourShare < 55} />
              <ExpertRow label="Gini coefficient" scenario={f.gini} baseline={b.gini} format={v => v.toFixed(3)} danger={f.gini > 0.38} />
              <ExpertRow label="AI adoption" scenario={f.adoption} baseline={b.adoption} unit="%" format={v => v.toFixed(0)} />
              <ExpertRow label="Debt / GDP" scenario={f.debtGdp} baseline={b.debtGdp} unit="%" format={v => v.toFixed(0)} danger={f.debtGdp > 130} />
              <ExpertRow label="Stability index" scenario={f.stability} baseline={b.stability} format={v => v.toFixed(2)} danger={f.stability < 0.55} />
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${theme.borderFaint}`, fontSize: 11.5, color: theme.textMuted, lineHeight: 1.6, fontFamily: 'ui-monospace, monospace' }}>
                <div style={{ marginBottom: 6 }}><strong style={{ color: theme.text }}>Method · </strong>Three-segment workforce. Each AI demand shock is split between unemployment and wage adjustment using Hamermesh-style labour-supply elasticities. AI adoption is endogenous — actual rollout is the lower of (a) the user's max diffusion rate and (b) the cost-pulled rate where AI is cheaper than the labour it would replace. National accounting identity Σ(employed × wage) = labour share × GDP holds exactly each period.</div>
                <div><strong style={{ color: theme.text }}>Sources · </strong>OBR Nov 2025 · ONS FYE 2024 · ONS LFS Apr 2026 · Acemoglu 2024 · Aghion · Brynjolfsson-Li QJE 2025 · Hamermesh 1993 · IMF WP 2025/068 · Turchin (stability index).</div>
              </div>
            </section>
          )}

          {/* DETAILS DISCLOSURE */}
          <section style={{ marginTop: 36, paddingTop: 18, borderTop: `1px solid ${theme.border}` }}>
            <details>
              <summary style={{ fontSize: 13, color: theme.textSub, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: theme.textFaint }}>›</span>
                How is this calculated, and what should I trust?
              </summary>
              <div style={{ marginTop: 12, fontSize: 13.5, color: theme.textSub, lineHeight: 1.6, maxWidth: 760 }}>
                <p>Ledger is a stylised macro model, not a forecast. It treats the UK as a single economy with three workforce segments (junior, mid-career, senior) and traces ten years from 2025. AI shows up as a productivity gain that has to actually diffuse — and only diffuses when it&rsquo;s cheaper than the labour it replaces.</p>
                <p>Each year, the model checks: where is AI cost-competitive? It applies the resulting demand shock to each segment, splits it between &ldquo;fewer jobs&rdquo; and &ldquo;lower pay&rdquo; using each segment&rsquo;s wage flexibility, and then rebalances so the wage bill plus capital income still adds up to GDP. Inequality, debt, and a Turchin-style stability index follow from those primitives.</p>
                <p>It&rsquo;s a tool for thinking about the structure of the trade-off — not a prediction of any particular year. Turn on Expert mode to see every metric, every assumption, and the calibration sources.</p>
              </div>
            </details>
          </section>

        </div>
      </div>
    </ThemeContext.Provider>
  );
}
