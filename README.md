# Ledger — UK AI Economic Scenario Engine

Ledger is a stylised economic scenario engine for the UK. It asks one question: given choices about how aggressively AI is adopted and how much the state redistributes, what kind of country do we get in 2035? Move two sliders — AI productivity and UBI level — and a ten-year simulation runs in real time: GDP, wages, inequality (Gini), unemployment, debt/GDP, and a composite social stability index all animate as trajectories. Preset scenarios reproduce PwC's optimistic vision, Acemoglu's sceptical floor, and a disruption case where high AI productivity meets thin redistribution and the stability index breaks. It is a thinking tool designed to make the trade-offs visible, not to predict the future.

## Run locally

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build → dist/
```

## Deploy to Vercel

```bash
# First push to GitHub (see below), then:
npx vercel
# Follow prompts: framework = Vite, output directory = dist
```

Vercel will auto-deploy on every push to `main` once connected.

## Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/AIFutureModel.git
git push -u origin main
```

## Full specification

See [REQUIREMENTS.md](./REQUIREMENTS.md) for the complete model spec: equations, calibration, variable definitions, and source citations.
