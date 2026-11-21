# Tech

Status: the repo currently holds docs and specs only. The stack below comes from `.kiro/specs/senior-digital-companion/design.md`. Check `package.json` once it exists, and re-verify library choices at implementation time.

## Stack
- Next.js 15 (App Router), React, TypeScript, Tailwind CSS v4
- PWA: typed `app/manifest.ts` plus a hand-written `public/sw.js` for offline shell caching
- Storage: IndexedDB (items, images) and localStorage (small settings), all in the browser
- Dates: `Temporal.PlainDate` / `Temporal.PlainTime` via `temporal-polyfill`, serialized as `YYYY-MM-DD` and `HH:mm`. Do not use `Date` or UTC conversion for calendar events.
- In-browser processing: `c2pa` (provenance), `exifr` (EXIF), Tesseract.js (OCR), canvas filters (photo presets)
- Tests: Vitest, fast-check (property-based), a11y tests

## Architecture rules
- **Local-first**: the server holds no senior data except an encrypted ingest relay queue (deleted on ack or after 7 days).
- **ConsentGate**: every path that stores an item or sends content to AI goes through the single `ConsentGate` module. Never bypass it from UI code. It runs client-side at pull time.
- **ActionExecutor**: the only code allowed to perform side effects (save event, share, send, delete). It requires a `Confirmation` token created by a Confirm tap.
- **Rules first, AI second**: deterministic on-device rules are the baseline engine. `/api/decide` only refines results. AI OFF must work with zero network calls, and the same path is the fallback on timeout or error.
- Photos, OCR, and provenance checks stay on the device. Only Scam Shield and the `/api/decide` text path may call AI, and only with consent.
- Write to the audit log before any AI call.
- Fallible vault and store functions return `Result<T, E>` instead of throwing. User-facing errors go through `lib/errors/plainMessage.ts` in plain language.
- API route handlers (`app/api/**/route.ts`) do auth, rate limiting, and validation. `middleware.ts` is used only to force HTTPS.

## Code style
- TypeScript strict. Keep pure logic in `src/lib/**` and separate from I/O so it can be property-tested.
- Reuse shared components (`SeniorButton`, `TrafficLightCard`, `SourceBadge`, etc.) rather than raw buttons or ad hoc status colors.
- Follow ARIA best practice. Use `StatusLive` for operation status.

## Commands
No scripts exist yet. Expected once the project is scaffolded (confirm against `package.json`):
```
npm install
npm run dev        # local dev server
npm run build      # production build
npm run lint
npx vitest run     # tests (single run, no watch)
```
