# AI Economic Scenario Model — Requirements & Framework

**Codename:** *Ledger* — a stylised macroeconomic scenario engine for AI futures
**Scope:** UK economy, 10-year horizon, stylised linked-equation model
**User:** HR analytics / strategy professionals modelling AI futures for workforce planning

---

## 1. Purpose

A browser-based, interactive scenario engine that lets a non-economist explore how AI productivity gains and redistribution policy interact to produce different 10-year futures for the UK. Two primary levers, six outcome variables, animated trajectories, and a calculated social-stability index that flags regime shifts (civil unrest threshold, fiscal collapse, labour-share floor breach).

The model is deliberately **stylised** — it sacrifices empirical precision for transparency and interactivity. Every equation is visible, every parameter is justified, every output is traceable. It is a thinking tool, not a forecast.

---

## 2. Conceptual model

### 2.1 The four chains

The model implements four causal chains drawn from the literature, linked together:

**Chain A — Production & growth (Acemoglu task-based)**
AI adoption raises total factor productivity (TFP) by automating a share of tasks. Output rises. This is the headline-positive channel.

**Chain B — Distribution (IMF Gen-AI heterogeneous-agent logic, simplified)**
AI shifts the capital-labour split. As capital share rises, wage growth decouples from productivity growth. Wealth inequality compounds because returns to capital concentrate among existing capital holders.

**Chain C — Fiscal & redistribution**
Government taxes labour, capital, and (optionally) AI rents. It spends on standard public services plus an optional UBI. Fiscal balance constrains everything.

**Chain D — Social stability**
A composite index drawing on Turchin-style structural-demographic logic: rising inequality + falling labour share + youth unemployment + perceived legitimacy gap → instability. Crosses thresholds trigger regime-shift flags.

### 2.2 Why two user levers, not six

The user requested AI productivity/adoption and UBI as the two adjustable scenario levers. The other four conceptual scenarios from the brief (capital share dynamics, immigration, civil unrest, meaning) are **endogenised** — they emerge from the model rather than being controlled. This is deliberate: it makes the model a discovery tool. You don't set the unrest level; the model tells you whether unrest happens given your AI and UBI choices.

---

## 3. Variables

### 3.1 User-controlled inputs (sliders)

| Lever | Range | Default | Notes |
|---|---|---|---|
| **AI productivity gain** (annual TFP boost from AI, pp) | 0.0 – 2.0 | 0.6 | Acemoglu floor ~0.05pp, Aghion ~1.0pp, Goldman ~1.5pp |
| **AI adoption speed** (years to reach saturation) | 3 – 20 | 10 | S-curve diffusion parameter |
| **Task automation ceiling** (% of tasks automatable) | 10 – 60 | 25 | Eloundou et al. ~20%, Svanberg ~23% profitably |
| **UBI level** (£/month per adult) | 0 – 1500 | 0 | Stockton-style up to high-end Stanford BIL scenarios |
| **UBI funding mix** (% from AI/capital tax vs general taxation) | 0 – 100 | 50 | 0 = all from labour tax, 100 = all from capital/AI rents |
| **Capital tax rate** (%) | 15 – 50 | 25 | Current UK corp tax ~25%, top of range = aggressive redistribution |

### 3.2 Hidden / structural parameters (exposed in "advanced" panel)

| Parameter | Default | Source |
|---|---|---|
| Initial GDP (£bn, 2025) | 2,750 | ONS |
| Initial labour share | 0.58 | ONS productivity bulletin, declining trend |
| Initial Gini (post-tax income) | 0.34 | ONS |
| Initial unemployment | 0.043 | ONS LFS |
| Population (working-age, m) | 42 | ONS projections |
| Capital-labour elasticity of substitution (σ) | 1.2 | IMF calibration; >1 means capital can replace labour |
| Skill-biased automation parameter (φ) | 0.6 | Share of automation hitting low/mid-skill first |
| Trickle-down coefficient (τ) | 0.15 | How much capital gains flow to wages |
| Unrest threshold (composite index) | 0.65 | Turchin/Goldstone calibration |
| Fiscal cliff threshold (debt/GDP) | 1.20 | UK historical comfort zone |

### 3.3 Outputs (animated, year by year)

1. **Real GDP** (£bn, indexed)
2. **Labour share** (% of national income)
3. **Gini coefficient** (post-tax, post-transfer)
4. **Unemployment rate** (%)
5. **Fiscal balance** (% of GDP)
6. **Social stability index** (0–1, with unrest threshold marked)
7. **Median real wage** (indexed)
8. **Capital-owner wealth concentration** (top 10% share)

### 3.4 Regime-shift flags (binary, time-stamped)

- 🔥 **Unrest threshold breached** — stability index crosses 0.65
- 💸 **Fiscal cliff** — debt/GDP exceeds 1.20
- 📉 **Labour share collapse** — drops below 0.50
- 🏚️ **Wage stagnation lock** — median wage flat or declining for 5+ consecutive years

---

## 4. Equations

All equations operate on annual time-step *t* ∈ {0, 1, …, 10}.

### 4.1 AI diffusion (logistic adoption curve)

```
A(t) = A_max / (1 + exp(-k·(t - t_mid)))
```

Where `A_max` = task automation ceiling, `t_mid` = adoption_speed / 2, `k` = 4 / adoption_speed.

### 4.2 Productivity (Acemoglu task-based, simplified)

```
TFP(t) = TFP(t-1) · (1 + g_base + g_AI · A(t)/A_max)
```

`g_base` = 0.005 (baseline UK TFP growth), `g_AI` = user's AI productivity gain.

### 4.3 Output

```
GDP(t) = TFP(t) · K(t)^α · L(t)^(1-α)
```

Cobb-Douglas with α (capital share) endogenous — see 4.4.

### 4.4 Capital share evolution (the inequality engine)

```
α(t) = α(t-1) + δ · A(t)/A_max · (1 - α(t-1)) - τ_K · capital_tax
```

`δ` = 0.04 (capital deepening rate from AI), `τ_K` = capital tax adjustment. Higher AI adoption pushes capital share up; capital tax pushes it back down.

### 4.5 Employment

```
U(t) = U_natural + β · (A(t)-A(t-1))/A_max · φ - γ · g_AI · (1-A(t)/A_max)
```

Displacement effect (β=0.3) minus reinstatement/complementarity effect (γ=0.15). Net employment effect depends on which dominates.

### 4.6 Wages

```
w_median(t) = w_median(t-1) · (1 + g_AI · (1 - φ) · (1 - A(t)/A_max) + τ · Δα(t))
```

Median wage rises with non-automation productivity; trickle-down coefficient τ captures spillover from capital gains.

### 4.7 Inequality (Gini)

```
Gini(t) = Gini(t-1) + λ_α · Δα(t) + λ_U · ΔU(t) - λ_UBI · UBI_level/median_wage(t)
```

Three drivers: capital share shift, unemployment shift, UBI compression effect.

### 4.8 Fiscal balance

```
Revenue(t) = labour_tax · w_median · L(t) + capital_tax · α(t) · GDP(t) + AI_rent_tax · A(t) · GDP(t) · 0.1
Spending(t) = baseline_spending · GDP(t) + UBI_level · 12 · adult_population
Balance(t) = Revenue(t) - Spending(t)
Debt(t) = Debt(t-1) - Balance(t) + interest · Debt(t-1)
```

### 4.9 Social stability index (composite, Turchin-inspired)

```
S(t) = 1 - [w1·Gini_normalised + w2·U_normalised + w3·(1-labour_share) + w4·wage_stagnation_yrs/5 + w5·legitimacy_gap]
```

Weights: w1=0.25, w2=0.20, w3=0.20, w4=0.15, w5=0.20.

`legitimacy_gap` = function of (perceived) unfairness — proxy: top 10% wealth share growth rate.

When S(t) drops below 0.35 (= unrest_threshold flipped), the unrest flag fires.

---

## 5. Calibration & validation

Defaults reproduce a "muddle-through" baseline trajectory consistent with:
- OECD UK forecast 2025–2035 productivity range
- IMF Gen-AI calibration for UK (Cazzaniga et al. WP 2025/068)
- ONS labour-share trend extrapolation

The **PwC optimistic scenario** is reproducible by setting AI productivity = 1.5pp, adoption = 5 years, capital tax = 30%, UBI = 0.
The **Acemoglu skeptical scenario** is reproducible by setting AI productivity = 0.3pp, adoption = 15 years.
The **disruption scenario** is reproducible by setting AI productivity = 1.8pp, adoption = 4 years, capital tax = 18%, UBI = 0 — and observing the unrest flag fire.

---

## 6. UI requirements

### 6.1 Layout

- **Left panel (30%)**: lever controls — two primary sliders prominent, six secondary collapsed into "Advanced parameters"
- **Centre panel (45%)**: animated trajectory chart, multi-line, year-by-year scrub bar
- **Right panel (25%)**: outcome cards (final-year values), regime flags, scenario summary
- **Footer band**: AI-generated one-page narrative summary of the current scenario, regenerated when sliders change (lite version: template-filled; serious version: would call an LLM)

### 6.2 Interaction model

- Sliders update model in real time (debounced ~150ms)
- "Run scenario" button triggers full 10-year animation (1.5s playback)
- "Compare" mode pins current scenario as ghost line, allows running a second
- Preset buttons: *Acemoglu floor*, *PwC optimistic*, *Disruption*, *Nordic redistributive*, *Status quo*

### 6.3 Aesthetic

- Editorial / instrument-panel hybrid
- Dark navy ground, parchment text, single signal colour for danger states
- Serif display type for headline numbers (gravitas)
- Monospace for parameters (instrument feel)
- Restrained motion — line trajectories animate in once, no decorative animation

---

## 7. Limitations (state these prominently in the UI)

1. **Stylised, not predictive** — no claim of forecast accuracy
2. **No spatial/sectoral detail** — UK as one homogeneous economy
3. **Linear feedbacks where reality is non-linear** — particularly for unrest dynamics
4. **No exogenous shocks** — climate, geopolitics, pandemics absent
5. **Behavioural responses simplified** — labour supply elasticity to UBI uses literature midpoint (~0.05)
6. **The unrest index is a heuristic, not a measurement** — Turchin's structural-demographic model itself is contested

---

## 8. Authoritative sources underpinning each equation

- §4.1–4.2 productivity: Acemoglu 2024 NBER WP 32487
- §4.4 capital share: IMF WP 2025/068 (Cazzaniga et al.)
- §4.5 employment: Acemoglu & Restrepo 2018, OECD AI Papers
- §4.7 inequality: Stanford Basic Income Lab umbrella review for UBI compression
- §4.8 fiscal: IMF SDN/2024/002 robot-tax design framework
- §4.9 stability: Turchin *End Times* 2023; CTC West Point grievance framework

---

## 9. Build target

Single-file React component, no external API calls, runs in any modern browser. Estimated <800 lines incl. simulation engine and presentation layer.
