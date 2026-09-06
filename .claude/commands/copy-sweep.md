---
description: Audit every user-facing heading, title and caption in the app against Gaffa's naming rules, in a background agent.
---

Run a whole-app UI copy sweep.

Spawn ONE background subagent (`Agent`, `subagent_type: general-purpose`,
`run_in_background: true`) with this brief:

> Load the `gaffa-ui-copy` skill and read `docs/UI_RULES.md` rules 1–4 before
> starting. Then run `node scripts/extract-ui-copy.mjs --suspect` from the repo
> root and judge every row it prints against those rules.
>
> For each row decide: correct as written, or breaks a rule. Most rows are
> correct — say so rather than inventing changes. A rename must be clearly
> better, not merely different. Empty-state sentences ("No trophies yet") are
> correct in sentence case. `aria-label`, `placeholder` and DOM `title`
> tooltips are prose, not names, and are out of scope for case.
>
> Read enough surrounding code to know what each string actually labels before
> proposing a replacement — a heading can only be judged against the thing it
> sits above.
>
> Change NOTHING. Report a single markdown table: file:line, current, proposed,
> rule broken. Order by how wrong it is. Finish with a one-line count of rows
> judged and rows flagged.

When it reports back, relay the table and ask which rows to apply. Apply only
what is approved, then run `npm run check:ui` and `npm run build`.
