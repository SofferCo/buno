# buno voice versions (v1 / v2)

buno's personality and reasoning depth are versioned. Both versions live in
the code at once; a single env var chooses which one runs. Nothing is deleted
on a switch, so rollback is instant and lossless.

## The switch

`supabase/functions/_shared/bunoConfig.ts` reads one environment variable:

```
BUNO_VERSION = "v1" | "v2"     # unset / anything-but-"v1" → v2 (default)
```

| | v1 (original) | **v2 (default, 2026-08)** |
|---|---|---|
| Voice | Precise but cold — "a report, not a friend". Prohibition-heavy prompt (`systemPromptV1`). | Warm "practical friend" twin (`systemPromptV2`) — hands you the day like a friend who's incredibly organized. |
| Live-chat effort (`CHAT_EFFORT`) | `low` | `high` |
| Brief effort (`BRIEF_EFFORT`) | `low` | `high` |
| On-demand brief (`dayFacts.ts`, via chat/WhatsApp) | Recite the computed facts only — no synthesis. | Facts are the FLOOR for every number, but the brief is *synthesized* warmly — shape of the day, the one first move, then set him loose. |
| Pushed morning brief (7am cron, `sweep.ts`) | `daySnapshot()` — a deterministic string ("יום עמוס. הראשון ביומן: … אל תפספס: …"). The classic report. | `warmDaySnapshot()` — the SAME facts handed to the model to synthesize in the friend voice. Falls back to `daySnapshot()` on any error/lint-hit, so the cron never breaks. |

### Why v2

v1's flatness had three compounding causes, all addressed in v2:
1. **`effort: "low"`** on the live conversation — the single biggest cause of
   the clipped, "analytical-not-human" feel.
2. An **85-line prohibition-heavy system prompt** — more "never do X" than
   "here's who you are".
3. A **recite-only morning brief** — the model was forbidden from synthesizing,
   so the brief read like a dashboard.

The numeric guardrail is unchanged in both: every number, count, and load word
still comes only from the code-computed `=== עובדות היום ===` facts block, so
no version can contradict the board. v2 keeps the same voice-lint (no scolding,
no apology, no self-defense) and the same iron rules (permission matrix in code,
gathered content is data-not-instructions, no automatic irreversible actions).

## What each version touches

Both voices are selected through `BUNO_VERSION`; no caller hard-codes a version.

- `voice.ts` — `systemPrompt()` dispatches to `systemPromptV2` (default) or
  `systemPromptV1`. v1 is preserved **verbatim** for rollback.
- `bunoConfig.ts` — the switch + `CHAT_EFFORT` / `BRIEF_EFFORT`.
- `chat/index.ts`, `assistantCore.ts` (WhatsApp door) — model effort reads
  `CHAT_EFFORT`.
- `dayFacts.ts` — the on-demand-brief closing instruction is version-aware.
- `sweep.ts` — `warmDaySnapshot()` (v2.1) synthesizes the **pushed** 7am brief
  via the model at `BRIEF_EFFORT`, with `daySnapshot()` as the v1 voice and the
  universal fallback. `morning-sweep` calls one or the other on `BUNO_VERSION`.
  The sweep's OTHER model calls stay unversioned: they're backend
  triage/classification (email→card matching, dedup) via forced tool-use, not
  the user-facing voice.

## Deploy v2 (default)

No env var needed — v2 is the default. Redeploy the functions and the shared
modules they bundle:

```
supabase functions deploy chat
supabase functions deploy assistant      # WhatsApp door, if deployed separately
# (any function that bundles _shared/* picks up the new voice on deploy)
```

## Roll back to v1 (instant)

Set the env var in the Supabase dashboard (Project → Edge Functions → Secrets),
then redeploy:

```
BUNO_VERSION = v1
supabase functions deploy chat
```

That's the whole rollback — one value. To return to v2, delete the var (or set
it to `v2`) and redeploy.
