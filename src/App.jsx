import React, { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ============================================================================
// LEDGER v4 — UK AI Economic Scenario Engine
//
// Improvements over v3 (per professorial review):
// 1. ACCOUNTING IDENTITY ENFORCED: Σ(employed_i × wage_i) = labour_share × GDP
//    Segment wages are rescaled each period to satisfy this — preserves
//    relative differentials, eliminates free-lunch artefacts.
// 2. LABOUR-SUPPLY ELASTICITY: Hamermesh-style decomposition splits each
//    AI demand shock between quantity (unemployment) and price (wage).
//    Junior workers have lower elasticity (rigid wage floors), senior
//    higher (career mobility).
// 3. ENDOGENOUS ADOPTION: AI rollout responds to relative AI/labour cost.
//    User's "adoption_speed" sets the maximum diffusion rate; actual
//    rate depends on whether labour is expensive enough to displace.
// ============================================================================

const SEGMENTS = {
  junior: {
    label: 'Junior / Entry-level',
    description: 'Under-25 + early career. High AI exposure (entry tasks routinisable). Rigid wage floor (minimum wage, benefits) means displacement skews toward unemployment rather than wage cuts.',
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
    description: 'Mid-career workers. Mixed exposure: some tasks substituted, some augmented. Moderate elasticity allows shock to absorb in both wages and quantities.',
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
    description: 'Senior judgment-intensive roles. Low displacement, high AI complementarity captures the productivity premium. Career mobility means flexible elasticity — adjustments through wages, not unemployment.',
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
  baseline: { name: 'No AI', aiProd: 0, adoption: 10, ubi: 0, ubiMix: 0, capTax: 25 },
  acemoglu: { name: 'Acemoglu floor', aiProd: 0.3, adoption: 12, ubi: 0, ubiMix: 0, capTax: 25 },
  moderate: { name: 'OECD-style', aiProd: 1.0, adoption: 8, ubi: 0, ubiMix: 0, capTax: 30 },
  aggressive: { name: 'Aghion (1.5%)', aiProd: 1.5, adoption: 5, ubi: 0, ubiMix: 0, capTax: 25 },
  disruption: { name: 'Disruption', aiProd: 1.8, adoption: 4, ubi: 0, ubiMix: 0, capTax: 18 },
  ubiResponse: { name: 'UBI response', aiProd: 1.2, adoption: 7, ubi: 600, ubiMix: 75, capTax: 40 },
};

// ============================================================================
// SIMULATION ENGINE
// ============================================================================
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

  // OBR baseline
  const baselineTfpGrowth = (t) => t <= 5 ? 0.003 + (0.008 - 0.003) * (t / 5) : 0.008;
  const baselineLabourGrowth = (t) => 0.005 - (0.005 - 0.003) * (t / 10);

  // AI cost falls exponentially (Moore-like compute scaling)
  const aiCostInitial = 0.8;
  const aiCostHalfLife = 4;
  const aiCost = (t) => aiCostInitial * Math.pow(0.5, t / aiCostHalfLife);

  // Calibration constants
  const phi = 0.55;
  const lambdaUBI = 0.18;
  const baselineRevRatio = 0.405;
  const baselineSpendRatio = 0.405;
  const interestRate = 0.020;
  const unempReversion = 0.25;
  const baselineLabourDrift = 0.0008;

  // Pre-compute initial wage bill calibration constant for accounting identity
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

    // ============================================================
    // RECOMMENDATION 3: ENDOGENOUS ADOPTION
    // AI rollout depends on relative AI/labour cost
    // ============================================================
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

    // PRODUCTIVITY, CAPITAL SHARE
    s.tfp = prev.tfp * (1 + baselineTfpGrowth(t) + (technologyAvailable ? aiProdFrac * A : 0));
    const capTaxAdj = technologyAvailable ? (p.capTax - 25) * 0.0006 : 0;
    const aiCapDeepening = technologyAvailable ? 0.035 * aiProdFrac * dA * 100 * (1 - prev.capShare) : 0;
    const dAlpha = aiCapDeepening - baselineLabourDrift - capTaxAdj;
    s.capShare = Math.max(0.30, Math.min(0.65, prev.capShare + dAlpha));
    s.labourShare = 1 - s.capShare;

    // ============================================================
    // RECOMMENDATION 2: LABOUR DEMAND SHOCKS SPLIT BY ELASTICITY
    // ============================================================
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

    // ============================================================
    // RECOMMENDATION 1: ACCOUNTING IDENTITY
    // Σ(employed_i × wage_i) × wageScale = labour_share × GDP
    // Rescale segment wages to satisfy identity (preserves relative spread)
    // ============================================================
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

    // Aggregates
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

// ============================================================================
// EXPLAIN PANEL
// ============================================================================
function generateExplanations(p, scenarioResult, baselineResult) {
  const sf = scenarioResult.final;
  const bf = baselineResult.final;
  return {
    gdp: {
      title: 'GDP',
      baseline: `In the no-AI baseline, real GDP grows ${(bf.gdpIdx - 100).toFixed(1)}% over 10 years, driven by 0.8% trend productivity (OBR Nov 2025) plus declining labour supply growth.`,
      scenario: `With ${p.aiProd}pp AI productivity available, AI contributes ${(sf.gdpIdx - bf.gdpIdx).toFixed(1)}pp on top of baseline. Note: actual adoption (${sf.adoption}%) may be below the maximum (${sf.maxDiffusion}%) — AI rolls out only when cost-competitive vs labour.`,
      mechanism: 'TFP_growth = baseline_OBR(t) + aiProd × adoption(t). The full boost arrives only when AI both (a) is cheap enough and (b) has diffused.',
    },
    junior: {
      title: 'Junior workforce',
      baseline: `Junior workers (~24% of workforce) sit at ${bf.juniorUnemp}% unemployment, relative wage ${bf.juniorWage}.`,
      scenario: `Peak unemployment ${scenarioResult.peakJunior.value.toFixed(1)}% in ${scenarioResult.peakJunior.year} (+${(scenarioResult.peakJunior.value - 8.0).toFixed(1)}pp above natural). Settles at ${sf.juniorUnemp}%, wage ${sf.juniorWage}. Low elasticity (0.40) means most of the demand shock falls on quantity (jobs), not price (wages).`,
      mechanism: 'Demand shock = exposure(0.55) × ΔA × aiProd. Hamermesh decomposition: 1/(1+ε) goes to unemployment, ε/(1+ε) goes to wage. Wage floor effects (minimum wage, benefits) make junior labour supply less elastic.',
    },
    mid: {
      title: 'Mid-career workforce',
      baseline: `Mid-career (~56% of workforce) at ${bf.midUnemp}% unemployment, wage ${bf.midWage}.`,
      scenario: `2035 unemployment ${sf.midUnemp}%, wage ${sf.midWage}. Mixed exposure (30% subst., 30% complementarity) — moderate elasticity (0.60) splits shock evenly between jobs and pay.`,
      mechanism: 'AI augments where it can, substitutes where it must. Mid-career captures partial productivity gain through complementarity but loses some employment to substitution.',
    },
    senior: {
      title: 'Senior workforce',
      baseline: `Senior (~21%) at ${bf.seniorUnemp}% unemployment, wage ${bf.seniorWage} (2.1× median).`,
      scenario: `Senior unemployment essentially flat at ${sf.seniorUnemp}%. Wage ${sf.seniorWage} (vs baseline ${bf.seniorWage}). High elasticity (0.85) — adjustments through wages, not unemployment. Senior/Junior ratio: ${sf.seniorJuniorRatio} vs ${bf.seniorJuniorRatio}.`,
      mechanism: 'Senior segment: 10% exposure, 55% complementarity. AI augments senior judgment; productivity gains captured as wage premium. Career mobility allows flexible wage adjustment.',
    },
    adoption: {
      title: 'AI adoption (endogenous)',
      baseline: `No AI in baseline.`,
      scenario: `Realised adoption ${sf.adoption}% (year-by-year: ${scenarioResult.series.map(d => d.adoption).join(' → ')}). Maximum possible was ${sf.maxDiffusion}% — adoption was ${sf.adoption < sf.maxDiffusion - 1 ? 'constrained by AI being more expensive than labour' : 'at full diffusion'}. AI cost path: ${scenarioResult.series.map(d => d.aiCost).join(' → ')}.`,
      mechanism: 'Adoption rate per segment = max(0, labour_cost − AI_cost) / labour_cost × exposure. AI gets cheaper over time (Moore-like). Higher labour costs (e.g., from capital tax preserving labour share) accelerate AI adoption — feedback the user controls indirectly.',
    },
    accounting: {
      title: 'Accounting identity',
      baseline: `Σ(employed × wage) = labour_share × GDP holds exactly (zero error).`,
      scenario: `Identity holds exactly throughout. Segment wages are rescaled at end of each period to enforce Σ(employed_i × wage_i) × wageScale = labour_share × GDP. Relative wage differentials are preserved.`,
      mechanism: 'Without this rescaling, segment wages and labour share would drift apart — a free-lunch artefact. With it, the model satisfies national income accounting at every period.',
    },
    inequality: {
      title: 'Inequality (Gini)',
      baseline: `UK Gini stable at ${bf.gini.toFixed(3)} (ONS FYE 2024).`,
      scenario: `${sf.gini > bf.gini ? `Rises by ${((sf.gini - bf.gini) * 100).toFixed(1)}pp` : `Falls by ${((bf.gini - sf.gini) * 100).toFixed(1)}pp (UBI compression)`} to ${sf.gini.toFixed(3)}.`,
      mechanism: 'Driven by capital share rise + senior/junior wage divergence + junior unemployment. UBI applies a level compression.',
    },
    labourShare: {
      title: 'Labour share',
      baseline: `Continues 25-year UK upward trend, reaching ${bf.labourShare}%.`,
      scenario: `AI capital deepening pulls to ${sf.labourShare}% — a ${(bf.labourShare - sf.labourShare).toFixed(1)}pp gap. ${p.capTax > 25 ? `${p.capTax}% capital tax provides offset.` : ''} ${sf.labourShare < 55 ? '⚠ Below historical floor.' : ''}`,
      mechanism: 'α(t) = α(t-1) + 0.035 × aiProd × ΔA × (1-α) − tax_adj − baseline_drift. Capital share rises with AI deepening; tax pushes it back.',
    },
    stability: {
      title: 'Social stability',
      baseline: `Baseline stability at ${bf.stability.toFixed(2)}.`,
      scenario: `Scenario at ${sf.stability.toFixed(2)}${scenarioResult.flags.unrest ? `, breached 0.55 in ${scenarioResult.flags.unrestYear}` : ''}.`,
      mechanism: 'Composite of Gini, unemployment, youth unemployment (20% weight — empirical political-volatility correlate), labour share, wage stagnation, top-decile wealth. Turchin structural-demographic.',
    },
  };
}

// ============================================================================
// UI COMPONENTS
// ============================================================================
function Slider({ label, value, onChange, min, max, step, unit, hint }) {
  return (
    <div className="mb-5">
      <div className="flex justify-between items-baseline mb-1.5">
        <label className="text-[10px] tracking-[0.15em] uppercase text-stone-400 font-mono">{label}</label>
        <span className="text-amber-200 font-mono text-sm tabular-nums">
          {typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-stone-700 appearance-none cursor-pointer" />
      {hint && <div className="text-[10px] text-stone-500 mt-1 italic leading-tight">{hint}</div>}
    </div>
  );
}

function MetricRow({ label, scenario, baseline, unit, danger, format = (v) => v }) {
  const delta = scenario - baseline;
  const isImprovement = (label.includes('Stab') || label.includes('Median') || label.includes('GDP') || label.includes('Labour share') || label.includes('wage'))
    ? delta > 0 : delta < 0;
  return (
    <div className="grid grid-cols-12 gap-2 py-1.5 border-b border-stone-800/60 items-baseline">
      <div className="col-span-4 text-[10px] tracking-wider uppercase text-stone-400 font-mono">{label}</div>
      <div className="col-span-3 text-stone-500 font-mono text-xs tabular-nums">{format(baseline)}{unit}</div>
      <div className={`col-span-3 font-mono text-sm tabular-nums ${danger ? 'text-red-400' : 'text-stone-100'}`}>
        {format(scenario)}{unit}
      </div>
      <div className={`col-span-2 text-[11px] font-mono tabular-nums ${
        Math.abs(delta) < 0.01 ? 'text-stone-600' : isImprovement ? 'text-emerald-400' : 'text-rose-400'
      }`}>
        {delta > 0 ? '+' : ''}{format(Math.abs(delta) < 0.01 ? 0 : delta)}
      </div>
    </div>
  );
}

function ExplainCard({ title, baseline, scenario, mechanism, expanded, onToggle }) {
  return (
    <div className="border-t border-stone-800/60 py-3">
      <button onClick={onToggle} className="w-full flex items-start justify-between text-left group">
        <span className="text-[11px] tracking-[0.15em] uppercase text-amber-300/80 font-mono group-hover:text-amber-200">{title}</span>
        {expanded ? <ChevronDown size={14} className="text-stone-500 mt-0.5" /> : <ChevronRight size={14} className="text-stone-500 mt-0.5" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2.5"
             style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: '14px', lineHeight: 1.55 }}>
          <div className="text-stone-300">
            <span className="text-stone-500 text-[10px] uppercase tracking-wider mr-2" style={{ fontFamily: '"JetBrains Mono", monospace' }}>Baseline</span>
            {baseline}
          </div>
          <div className="text-stone-300">
            <span className="text-amber-300/80 text-[10px] uppercase tracking-wider mr-2" style={{ fontFamily: '"JetBrains Mono", monospace' }}>Scenario</span>
            {scenario}
          </div>
          <div className="pt-1 text-[11px] text-stone-500 italic" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            <span className="text-stone-600 mr-1">▸</span>{mechanism}
          </div>
        </div>
      )}
    </div>
  );
}

function Flag({ active, label, year, color }) {
  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 border-l-2 ${active ? color : 'border-stone-800'} ${active ? 'opacity-100' : 'opacity-40'}`}>
      <span className="text-[10px] font-mono tracking-wider uppercase">{label}</span>
      {active && year && <span className="text-[10px] font-mono text-stone-500 ml-auto">{year}</span>}
    </div>
  );
}

function SegmentCard({ name, segment, scenarioFinal, baselineFinal, color }) {
  const wageKey = name + 'Wage';
  const unempKey = name + 'Unemp';
  const wage = scenarioFinal[wageKey];
  const baseWage = baselineFinal[wageKey];
  const unemp = scenarioFinal[unempKey];
  const baseUnemp = baselineFinal[unempKey];
  return (
    <div className="border border-stone-800 p-3" style={{ borderLeftWidth: '3px', borderLeftColor: color }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color }}>{segment.label}</span>
        <span className="text-[9px] text-stone-500 font-mono">{(segment.workforceShare * 100).toFixed(0)}% of workforce</span>
      </div>
      <div className="text-[11px] text-stone-400 italic mb-3 leading-snug" style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '13px' }}>
        {segment.description}
      </div>
      <div className="space-y-1.5 text-[11px] font-mono">
        <div className="flex justify-between">
          <span className="text-stone-500">2035 unemp</span>
          <span className="tabular-nums">
            <span className="text-stone-600">{baseUnemp}%</span>
            <span className="mx-1 text-stone-700">→</span>
            <span className="text-stone-100">{unemp}%</span>
            <span className={`ml-2 ${unemp > baseUnemp ? 'text-rose-400' : 'text-emerald-400'}`}>
              {unemp - baseUnemp > 0 ? '+' : ''}{(unemp - baseUnemp).toFixed(1)}
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-stone-500">2035 wage</span>
          <span className="tabular-nums">
            <span className="text-stone-600">{baseWage}</span>
            <span className="mx-1 text-stone-700">→</span>
            <span className="text-stone-100">{wage}</span>
            <span className={`ml-2 ${wage >= baseWage ? 'text-emerald-400' : 'text-rose-400'}`}>
              {wage - baseWage >= 0 ? '+' : ''}{(wage - baseWage).toFixed(1)}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[9px] text-stone-500 mt-2 pt-2 border-t border-stone-800/50">
          <div>exposure<br/><span className="text-stone-300">{(segment.exposure * 100).toFixed(0)}%</span></div>
          <div>complem.<br/><span className="text-stone-300">{(segment.complementarity * 100).toFixed(0)}%</span></div>
          <div>elast.<br/><span className="text-stone-300">{segment.labourSupplyElasticity.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function App() {
  const [params, setParams] = useState({ aiProd: 1.0, adoption: 8, ubi: 0, ubiMix: 0, capTax: 30 });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedExplain, setExpandedExplain] = useState('adoption');
  const [animationProgress, setAnimationProgress] = useState(11);
  const [chartView, setChartView] = useState('macro');

  const baseline = useMemo(() => simulate(params, false), [params]);
  const scenario = useMemo(() => simulate(params, true), [params]);
  const explanations = useMemo(() => generateExplanations(params, scenario, baseline), [params, scenario, baseline]);

  useEffect(() => {
    setAnimationProgress(0);
    const interval = setInterval(() => {
      setAnimationProgress(prev => {
        if (prev >= 11) { clearInterval(interval); return 11; }
        return prev + 1;
      });
    }, 130);
    return () => clearInterval(interval);
  }, [params]);

  const setPreset = (key) => {
    const { name, ...preset } = PRESETS[key];
    setParams(preset);
  };
  const updateParam = (key, value) => setParams(p => ({ ...p, [key]: value }));

  const chartData = scenario.series.slice(0, animationProgress + 1).map((d, i) => ({
    year: d.year,
    gdpAI: d.gdpIdx, gdpBase: baseline.series[i].gdpIdx,
    labourAI: d.labourShare, labourBase: baseline.series[i].labourShare,
    giniAI: d.giniPct, giniBase: baseline.series[i].giniPct,
    wageAI: d.medianWage, wageBase: baseline.series[i].medianWage,
    stabilityAI: d.stabilityPct, stabilityBase: baseline.series[i].stabilityPct,
    juniorUnempAI: d.juniorUnemp, juniorUnempBase: baseline.series[i].juniorUnemp,
    midUnempAI: d.midUnemp, midUnempBase: baseline.series[i].midUnemp,
    seniorUnempAI: d.seniorUnemp, seniorUnempBase: baseline.series[i].seniorUnemp,
    juniorWageAI: d.juniorWage, juniorWageBase: baseline.series[i].juniorWage,
    midWageAI: d.midWage, midWageBase: baseline.series[i].midWage,
    seniorWageAI: d.seniorWage, seniorWageBase: baseline.series[i].seniorWage,
    seniorJuniorAI: d.seniorJuniorRatio, seniorJuniorBase: baseline.series[i].seniorJuniorRatio,
    adoptionAI: d.adoption, maxDiffusionAI: d.maxDiffusion,
  }));

  return (
    <div style={{
      fontFamily: '"Inter", -apple-system, sans-serif',
      backgroundColor: '#0c0e14',
      color: '#e7e5e4',
      minHeight: '100vh',
      padding: '20px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
        input[type="range"]::-webkit-slider-thumb {
          appearance: none; width: 14px; height: 14px;
          background: #fcd34d; border-radius: 50%; cursor: pointer;
          border: 2px solid #0c0e14;
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px; height: 14px;
          background: #fcd34d; border-radius: 50%; cursor: pointer;
          border: 2px solid #0c0e14;
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        <header className="border-b border-stone-700 pb-5 mb-6">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-amber-300/70 font-mono mb-2">
                A UK Macroeconomic Scenario Engine · v4 · Endogenous Adoption · Accounting-Consistent
              </div>
              <h1 className="text-5xl md:text-6xl font-normal tracking-tight"
                  style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
                Ledger
              </h1>
              <div className="text-stone-400 text-sm mt-2 italic max-w-3xl"
                   style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px' }}>
                Three-segment workforce. Labour-supply elasticity splits each AI shock between unemployment and wages. AI adoption is endogenous — it rolls out only when AI is cheaper than labour. National income accounting holds throughout.
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button key={key} onClick={() => setPreset(key)}
                  className="text-[9px] tracking-widest uppercase font-mono px-2.5 py-1.5 border border-stone-700 hover:border-amber-300 hover:text-amber-200 transition-colors text-stone-400">
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="mb-6">
          <div className="text-[10px] tracking-[0.25em] uppercase text-amber-300/70 font-mono mb-3 border-b border-stone-800 pb-2">
            ▸ Workforce Segments — 2035 vs No-AI Baseline
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SegmentCard name="junior" segment={SEGMENTS.junior} scenarioFinal={scenario.final} baselineFinal={baseline.final} color="#fda4af" />
            <SegmentCard name="mid" segment={SEGMENTS.mid} scenarioFinal={scenario.final} baselineFinal={baseline.final} color="#fcd34d" />
            <SegmentCard name="senior" segment={SEGMENTS.senior} scenarioFinal={scenario.final} baselineFinal={baseline.final} color="#86efac" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3">
            <div className="border border-stone-800 p-4 mb-5 bg-stone-950/50">
              <div className="text-[9px] tracking-[0.25em] uppercase text-stone-500 font-mono mb-2">▸ No-AI Baseline (2035)</div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex justify-between"><span className="text-stone-500">GDP idx</span><span className="text-stone-300 tabular-nums">{baseline.final.gdpIdx}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Median wage</span><span className="text-stone-300 tabular-nums">{baseline.final.medianWage}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Gini</span><span className="text-stone-300 tabular-nums">{baseline.final.gini.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Sr/Jr ratio</span><span className="text-stone-300 tabular-nums">{baseline.final.seniorJuniorRatio}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Debt/GDP</span><span className="text-stone-300 tabular-nums">{baseline.final.debtGdp}%</span></div>
              </div>
              <div className="text-[9px] text-stone-600 italic mt-3 leading-snug">
                OBR Nov 2025 · ONS FYE 2024 · ONS LFS Apr 2026
              </div>
            </div>

            <div className="text-[10px] tracking-[0.25em] uppercase text-amber-300/70 font-mono mb-3 border-b border-stone-800 pb-2">▸ Scenario Levers</div>

            <Slider label="AI Productivity Gain" value={params.aiProd}
              onChange={(v) => updateParam('aiProd', v)} min={0} max={2} step={0.1} unit="pp"
              hint="Annual TFP boost. Acemoglu: 0.3 · Aghion: 1.0 · Goldman: 1.5" />

            <Slider label="Max Adoption Speed" value={params.adoption}
              onChange={(v) => updateParam('adoption', v)} min={3} max={20} step={1} unit=" yrs"
              hint="Years to S-curve midpoint (ceiling — actual rate may be slower if AI not cost-competitive)" />

            <Slider label="UBI Level" value={params.ubi}
              onChange={(v) => updateParam('ubi', v)} min={0} max={1500} step={50} unit=" £/mo"
              hint="Per adult/month. Stockton: ~£400 · Stanford BIL high: ~£1000" />

            <Slider label="UBI Funded by AI/Capital" value={params.ubiMix}
              onChange={(v) => updateParam('ubiMix', v)} min={0} max={100} step={5} unit="%"
              hint="0 = labour tax · 100 = AI rent capture" />

            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[10px] tracking-[0.25em] uppercase text-stone-500 hover:text-amber-300 font-mono mt-5 mb-2 transition-colors flex items-center gap-1">
              {showAdvanced ? <ChevronDown size={12}/> : <ChevronRight size={12}/>} Advanced
            </button>
            {showAdvanced && (
              <Slider label="Capital Tax Rate" value={params.capTax}
                onChange={(v) => updateParam('capTax', v)} min={15} max={50} step={1} unit="%"
                hint="UK current ~25%. Higher tax → labour share preserved → wages stay high → adoption pressure rises (feedback)" />
            )}
          </div>

          <div className="lg:col-span-6">
            <div className="text-[10px] tracking-[0.25em] uppercase text-amber-300/70 font-mono mb-3 border-b border-stone-800 pb-2 flex justify-between items-center">
              <span>
                ▸ Trajectories ·
                <button onClick={() => setChartView('macro')}
                  className={`ml-2 mr-1 px-2 py-0.5 ${chartView === 'macro' ? 'text-amber-200 border-b border-amber-300' : 'text-stone-500'}`}>
                  Macro
                </button>
                ·
                <button onClick={() => setChartView('segments')}
                  className={`ml-1 mr-1 px-2 py-0.5 ${chartView === 'segments' ? 'text-amber-200 border-b border-amber-300' : 'text-stone-500'}`}>
                  By Segment
                </button>
                ·
                <button onClick={() => setChartView('adoption')}
                  className={`ml-1 px-2 py-0.5 ${chartView === 'adoption' ? 'text-amber-200 border-b border-amber-300' : 'text-stone-500'}`}>
                  Adoption
                </button>
              </span>
              <span className="text-stone-500 normal-case tracking-normal text-[10px]">{2025 + animationProgress}</span>
            </div>

            {chartView === 'macro' && (
              <>
                <div className="mb-5">
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Real GDP (2025=100)</div>
                  <ResponsiveContainer width="100%" height={130}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[95, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="gdpBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="gdpAI" stroke="#fcd34d" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mb-5 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Labour share %</div>
                    <ResponsiveContainer width="100%" height={110}>
                      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                        <XAxis dataKey="year" stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" />
                        <YAxis stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" domain={[50, 70]} />
                        <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                        <ReferenceLine y={55} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} />
                        <Line type="monotone" dataKey="labourBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="labourAI" stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Gini ×100</div>
                    <ResponsiveContainer width="100%" height={110}>
                      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                        <XAxis dataKey="year" stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" />
                        <YAxis stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" domain={[20, 50]} />
                        <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                        <Line type="monotone" dataKey="giniBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="giniAI" stroke="#fb7185" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Social Stability ×100</div>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={9} fontFamily="JetBrains Mono" domain={[40, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <ReferenceLine y={55} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} label={{ value: 'Unrest', fill: '#ef4444', fontSize: 9, position: 'right' }} />
                      <Line type="monotone" dataKey="stabilityBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="stabilityAI" stroke="#fcd34d" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {chartView === 'segments' && (
              <>
                <div className="mb-5">
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Unemployment by Segment %</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="juniorUnempBase" stroke="#fda4af" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="juniorUnempAI" stroke="#fda4af" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="midUnempBase" stroke="#fcd34d" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="midUnempAI" stroke="#fcd34d" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="seniorUnempBase" stroke="#86efac" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="seniorUnempAI" stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mb-5">
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Wage Levels by Segment</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="seniorWageBase" stroke="#86efac" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="seniorWageAI" stroke="#86efac" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="midWageBase" stroke="#fcd34d" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="midWageAI" stroke="#fcd34d" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="juniorWageBase" stroke="#fda4af" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="juniorWageAI" stroke="#fda4af" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Senior/Junior Wage Ratio</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[3.5, 4.5]} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="seniorJuniorBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="seniorJuniorAI" stroke="#fcd34d" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {chartView === 'adoption' && (
              <>
                <div className="mb-5">
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">AI Adoption: Realised vs Maximum Possible</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[0, 100]} unit="%" />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="maxDiffusionAI" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} name="Maximum (technology-push)" />
                      <Line type="monotone" dataKey="adoptionAI" stroke="#fcd34d" strokeWidth={2.5} dot={false} isAnimationActive={false} name="Realised (cost-pulled)" />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="text-[11px] text-stone-500 italic mt-2 px-2"
                       style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '13px' }}>
                    The dashed line is the maximum diffusion the user's "adoption speed" allows. The solid line is what actually happens — bounded above by the dashed line, but reduced when AI is more expensive than labour. The gap between them is the model's representation of firm-level cost-pull dynamics.
                  </div>
                </div>

                <div className="mb-5">
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Senior/Junior Wage Ratio (the within-labour inequality channel)</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[3.5, 4.5]} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <Line type="monotone" dataKey="seniorJuniorBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="seniorJuniorAI" stroke="#fcd34d" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <div className="text-[11px] text-stone-400 mb-1 font-mono uppercase tracking-wider">Junior Unemployment % (the displacement channel)</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
                      <XAxis dataKey="year" stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" />
                      <YAxis stroke="#78716c" fontSize={10} fontFamily="JetBrains Mono" domain={[5, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                      <ReferenceLine y={12} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} label={{ value: 'Youth crisis', fill: '#ef4444', fontSize: 9, position: 'right' }} />
                      <Line type="monotone" dataKey="juniorUnempBase" stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="juniorUnempAI" stroke="#fda4af" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-3">
            <div className="text-[10px] tracking-[0.25em] uppercase text-amber-300/70 font-mono mb-3 border-b border-stone-800 pb-2">▸ 2035 Comparison</div>
            <div className="grid grid-cols-12 gap-2 pb-2 border-b border-stone-700">
              <div className="col-span-4"></div>
              <div className="col-span-3 text-[9px] uppercase text-stone-600 tracking-wider">No AI</div>
              <div className="col-span-3 text-[9px] uppercase text-amber-300/60 tracking-wider">AI</div>
              <div className="col-span-2 text-[9px] uppercase text-stone-600 tracking-wider">Δ</div>
            </div>

            <MetricRow label="GDP idx" scenario={scenario.final.gdpIdx} baseline={baseline.final.gdpIdx} unit="" format={(v) => v.toFixed(1)} />
            <MetricRow label="Median wage" scenario={scenario.final.medianWage} baseline={baseline.final.medianWage} unit="" format={(v) => v.toFixed(1)} />
            <MetricRow label="Junior wage" scenario={scenario.final.juniorWage} baseline={baseline.final.juniorWage} unit="" format={(v) => v.toFixed(1)} />
            <MetricRow label="Senior wage" scenario={scenario.final.seniorWage} baseline={baseline.final.seniorWage} unit="" format={(v) => v.toFixed(1)} />
            <MetricRow label="Sr/Jr ratio" scenario={scenario.final.seniorJuniorRatio} baseline={baseline.final.seniorJuniorRatio} unit="" danger={scenario.final.seniorJuniorRatio > 4.2} format={(v) => v.toFixed(2)} />
            <MetricRow label="Junior unemp" scenario={scenario.final.juniorUnemp} baseline={baseline.final.juniorUnemp} unit="%" danger={scenario.final.juniorUnemp > 10} format={(v) => v.toFixed(1)} />
            <MetricRow label="Labour share" scenario={scenario.final.labourShare} baseline={baseline.final.labourShare} unit="%" danger={scenario.final.labourShare < 55} format={(v) => v.toFixed(1)} />
            <MetricRow label="Gini" scenario={scenario.final.gini} baseline={baseline.final.gini} unit="" danger={scenario.final.gini > 0.38} format={(v) => v.toFixed(3)} />
            <MetricRow label="AI adoption" scenario={scenario.final.adoption} baseline={baseline.final.adoption} unit="%" format={(v) => v.toFixed(0)} />
            <MetricRow label="Debt/GDP" scenario={scenario.final.debtGdp} baseline={baseline.final.debtGdp} unit="%" danger={scenario.final.debtGdp > 130} format={(v) => v.toFixed(0)} />
            <MetricRow label="Stability" scenario={scenario.final.stability} baseline={baseline.final.stability} unit="" danger={scenario.final.stability < 0.55} format={(v) => v.toFixed(2)} />

            <div className="text-[10px] tracking-[0.25em] uppercase text-amber-300/70 font-mono mt-6 mb-2 border-b border-stone-800 pb-2">▸ Regime Flags</div>
            <div className="space-y-1">
              <Flag active={scenario.flags.unrest} label="Unrest threshold" year={scenario.flags.unrestYear} color="border-red-500" />
              <Flag active={scenario.flags.youthCrisis} label="Youth crisis (Jr>12%)" year={scenario.flags.youthCrisisYear} color="border-rose-500" />
              <Flag active={scenario.flags.fiscal} label="Fiscal cliff" year={scenario.flags.fiscalYear} color="border-orange-500" />
              <Flag active={scenario.flags.labourCollapse} label="Labour collapse" year={scenario.flags.labourYear} color="border-yellow-500" />
              <Flag active={scenario.flags.wageStag} label="Wage stagnation" color="border-amber-500" />
              <Flag active={scenario.flags.adoptionConstrained} label="Adoption cost-constrained" color="border-blue-500" />
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-stone-700">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-amber-300/70 font-mono mb-1">▸ Explain This Model</div>
              <h2 className="text-2xl font-normal text-stone-100" style={{ fontFamily: '"Cormorant Garamond", serif' }}>
                Click any heading to expand
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {Object.entries(explanations).map(([key, exp]) => (
              <ExplainCard key={key}
                title={exp.title}
                baseline={exp.baseline}
                scenario={exp.scenario}
                mechanism={exp.mechanism}
                expanded={expandedExplain === key}
                onToggle={() => setExpandedExplain(expandedExplain === key ? null : key)}
              />
            ))}
          </div>
        </div>

        <div className="mt-10 pt-5 border-t border-stone-800">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-[10px] text-stone-500 font-mono leading-relaxed">
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Baseline calibration</div>
              OBR Nov 2025 · ONS FYE 2024 Gini · ONS LFS Apr 2026 · OECD Outlook 2025/2
            </div>
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Segment & elasticity</div>
              Stanford/ADP entry-level · Brynjolfsson-Li QJE 2025 · Bloom-Prettner skill premium · Hamermesh 1993 (labour demand) · Manning 2021 (elasticities)
            </div>
            <div>
              <div className="text-amber-300/60 uppercase tracking-widest text-[9px] mb-1">Macro & adoption</div>
              Acemoglu 2024 (TFP) · IMF WP 2025/068 (capital share) · Acemoglu-Restrepo task framework (adoption) · Turchin (stability)
            </div>
          </div>
          <div className="mt-4 text-[10px] text-stone-600 font-mono leading-relaxed">
            <span className="uppercase tracking-widest text-stone-500">v4 changes · </span>
            (1) National accounting identity Σ(employed × wage) = labour_share × GDP enforced exactly each period. (2) Each AI demand shock split into quantity (unemployment) and price (wage) effects via Hamermesh-style labour-supply elasticity decomposition, calibrated per segment. (3) AI adoption is endogenous — the user sets a maximum diffusion rate, but actual adoption is constrained by relative AI/labour cost. Adoption accelerates when wages rise.
          </div>
          <div className="mt-3 text-[10px] text-stone-600 font-mono leading-relaxed">
            <span className="uppercase tracking-widest text-stone-500">Caveat · </span>
            Stylised, not predictive. UK as homogeneous economy. Three segments approximate the actual occupational distribution. No exogenous shocks. The unrest index is a heuristic. Use to internalise the structure of the trade-off.
          </div>
        </div>
      </div>
    </div>
  );
}
