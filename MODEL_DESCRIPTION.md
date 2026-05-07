# Ledger — what this model does, in plain English

**Ledger** is a stylised economic scenario engine for the UK. It asks one question: given choices about how aggressively AI is adopted and how much the state redistributes, what kind of country do we get in 2035?

You move two sliders. The first sets how much productivity AI delivers and how fast it diffuses through the economy. The second sets how much basic income (if any) the state pays every adult, and where that money comes from. Six other parameters sit behind an "advanced" panel for users who want to tune the engine — capital tax rate, automation ceiling, the elasticity of substitution between capital and labour, and so on.

The model then runs a ten-year simulation. Every year, eight things happen in sequence. AI adoption follows a logistic S-curve toward whatever ceiling you set. Productivity rises in proportion to adoption. GDP responds via a Cobb-Douglas production function. The capital share of national income drifts upward as AI deepens — this is the core inequality engine, drawn from the IMF's heterogeneous-agent framework. Employment shifts as displacement and reinstatement effects compete. Median wages move on a different curve from headline productivity, capturing the labour-share decoupling that the OECD has documented. The Gini coefficient updates, with UBI providing compression. Government revenues and spending tally up against debt.

Finally, a composite social stability index is computed from inequality, unemployment, labour-share decline, wage stagnation duration, and a legitimacy-gap proxy. This is the part of the model most directly inspired by Peter Turchin's structural-demographic work and the West Point CTC framework on AI-driven grievance. When the index drops below 0.35, an unrest flag fires. Two other flags watch for fiscal collapse (debt past 120% of GDP) and labour-share floor breach (below 50%).

Outputs animate as a multi-line trajectory chart. End-state cards show final-year values. Regime-shift flags appear as warnings. A short narrative summary describes what kind of scenario you've just run — reproducing, depending on your settings, something close to PwC's optimistic vision, Acemoglu's skeptical floor, or a disruption scenario where high AI productivity meets thin redistribution and the stability index breaks.

The model is deliberately transparent. Every equation is documented, every parameter sourced. It is a thinking tool — designed to make the trade-offs visible, not to predict the future. Its honest claim is narrower than it looks: *under these assumptions, here is the shape of the trade-off space*.

What you cannot get from it is a forecast. The model has no exogenous shocks, no spatial detail, no sectoral disaggregation, no geopolitics, no climate. The unrest index is a heuristic, not a measurement. The behavioural responses to UBI use literature midpoints that are themselves contested. None of this is hidden — limitations are flagged in the UI and in the requirements document.

What you do get is a single, honest, manipulable picture of how AI productivity, capital deepening, and redistribution interact over ten years. Move the sliders. Watch the trajectories diverge. Notice which combinations push the stability index past its threshold. The point is not to find the right answer. The point is to internalise the structure of the problem.
