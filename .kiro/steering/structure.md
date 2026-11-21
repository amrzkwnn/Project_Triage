# Structure

## Current repo
```
problem_statement.md, proposal.md, proposal_approach.md   # background and product proposal
.kiro/
  specs/senior-digital-companion/   # requirements.md, design.md, tasks.md
  steering/                         # these steering files
```
No application code exists yet. Follow `tasks.md` for implementation order.

## Planned layout (from design.md)
```
src/
  app/                  # Next.js App Router
    layout.tsx, manifest.ts, page.tsx     # page.tsx = Home Hub
    my-data/            # consent vault
    scam-shield/  photo-helper/  inbox/  media-check/  calendar/
    api/
      decide/route.ts
      ingest/route.ts, ingest/email/route.ts, ingest/pull/route.ts, ingest/ack/route.ts
  lib/
    vault/      # store, settings, consent, audit, export, import, schema
    ai/         # engine, rules, tiering, proxyClient, summary
    inbox/      # parse, print, classify, dedup, order, events
    calendar/   # dates, ocr, snap, views, reminders, categories
    scam/       # verdict, links, habits
    media/      # provenance, result
    photo/      # presets, filename
    actions/    # executor, confirmation
    errors/     # plainMessage
    server/     # auth, rateLimit, relay (server-only)
  components/   # shared senior-friendly UI (SeniorButton, StepWizard, TrafficLightCard, SourceBadge, DecisionConfirmCard, PriorityPill, StatusLive, BackToHome, PrivacyPill)
public/sw.js    # service worker
tests/
  unit/  property/  integration/  a11y/
```

## Conventions
- One folder per feature section under `src/app/` and a matching module under `src/lib/`.
- Keep `lib/server/**` out of client bundles. Everything else in `lib/` runs in the browser.
- Put pure, testable logic in `lib/`. Keep screens thin.
- Every non-home screen includes `BackToHome`.
- Property tests go in `tests/property/`, and example tests in `tests/unit/`.
- When the layout changes, update `design.md` and this file.
