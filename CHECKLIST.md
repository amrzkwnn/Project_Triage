# Triage — Build Checklist

Frontend-only demo · React + Vite + Tailwind + React Router · phone-frame presentation.

## Phase 1 — Scaffold & foundation (COMPLETE)
- [x] package.json, vite.config, tailwind.config, postcss.config, index.html
- [x] Design tokens (palette, type scale, radii, shadows, motion) in tailwind + index.css
- [x] PhoneFrame: bezel 48/36 radii, dynamic island, simulated status bar, home indicator, side buttons, fit-to-window scaling, fullscreen branch <500px, screen portal context
- [x] Routing: `/` `/records` `/records/:id` `/upload` + frosted TabBar (My Day / Add / Records, safe-area padding)
- [x] Seed data: people (me, wife, 2 children, 3 patients), appointments, urgent tasks, 7 records + pre-made upload result
- [x] Inline-SVG document generators (lab report / prescription, original vs enhanced variants)
- [x] `npm install` + `npm run dev` verified serving (all modules transform 200)

## Phase 2 — My Day (COMPLETE)
- [x] Shared components: Card, Badge (Work/Personal), PersonChip, FilterChips, SectionHeader, Toast (+context), Skeleton, EmptyState
- [x] Gradient header: greeting, date, one-line summary pills + Test reminder button
- [x] Sticky filter chips: All/Work/Personal + person filter (Me, Wife, Child 1, Child 2)
- [x] "Needs action now": red accent cards, one-tap Done with check animation + collapse (verified 3→2)
- [x] "Today": vertical timeline, tabular times, Next pill on upcoming (verified 1 pill + 1 highlighted card), past dimmed
- [x] "This week": compact day rows, tap-to-expand (verified expand/collapse + contents)
- [x] "Test reminder" button → in-app toast inside phone screen (verified rendered within screen bounds)
- [x] Loading skeleton + designed empty states for all filters (verified Work+Wife empty state)
- [x] Layout audit: no horizontal overflow, no tap targets under 44px, tab bar inside screen, no page scroll
- [x] Fixed: missing px-5 on scroll container; person chips row made compact to fit 390px

## Phase 2b — Calendar tab added (Today/This week moved out of My Day)
- [x] Shared filter presets (src/lib/filters.js), extracted shared list components, 4-tab bar (My Day · Calendar · Add · Records), My Day "Up next" strip + hero pills linking to Calendar (superseded by Phase 2c's real month calendar; verified at the time)

## Phase 2c — Real calendar screen (user scope change: month grid like reference screenshot)
- [x] src/lib/dates.js — ISO date helpers + calendarStore (selected date survives day-screen round trip)
- [x] MonthCalendar: dark ink→deep-teal card, month title + circular chevron month nav, weekday row, 7-col grid, selected day = filled teal circle, today ringed, event dots (teal=work, violet=personal, max 3)
- [x] DayEventList: upcoming first (asc), past/completed after (dimmed + Completed tag); optional limit
- [x] Calendar screen rebuilt: plain title, dark month card, white rounded sheet with selected day's events capped at 5, "View all" button only when > 5, designed empty state for free days
- [x] CalendarDay screen at /calendar/day/:date — back button, tab bar hidden, full ordered list
- [x] Deleted unused TimelineList.jsx / WeekGroups.jsx (transient HMR 404s during delete, clean reload verified zero errors)
- [x] Verified: 35 grid cells Nov 2026, 10 event dots, today selected by default, first row = next upcoming, Completed tags on past rows, day-24 tap (2 events, no View all), View-all round trip preserves selection, month nav both ways, no overflow, tap targets ≥ 44px

## Phase 2d — Home screen refinements (user feedback)
- [x] Header: light small greeting + "Doctor" as the big title; white stats panel tucked 13px behind the main card's bottom edge with the 3 pills in ONE row (no wrap), today/week pills link to Calendar
- [x] Needs action now: one-card carousel with left/right arrows + dot indicators; glassmorphism red gradient card (translucent, backdrop blur, soft blob); simplified copy (no em-dashes): "Critical lab result" / "Prescription renewal" / "School medical form"; Mark done collapses + auto-advances
- [x] Up next: refined cards with category color top strip, time, 2-line title clamp, location, person chip + badge
- [x] Verified: pills exactly one row, panel overlaps main card, carousel paging + disabled states, done 3→2 with pill count update, no overflow, tap targets ≥44px, zero console errors

## Phase 2e — Home polish round 2 (user feedback)
- [x] Stats panel: shallower 12px tuck + more top padding — pills fully visible below the card edge
- [x] Carousel arrows moved next to the section title (right side); dots stay under the card
- [x] Urgent icon: soft pale-red circle with hairline border (no heavy gradient)
- [x] Test reminder: 44px circular frosted-glass bell button
- [x] Mark done: sleek dark pill, flips to teal when checked
- [x] Person chips appear only when Personal is selected; person filter auto-resets otherwise
- [x] Up next: person name + category badge removed (strip, time, title, location only)
- [x] Verified: pills one row fully below card, arrows in header row with disabled states, person chips show/hide correctly with reset, no overflow, zero console errors
- [x] Follow-up: header stats are now plain text with colored dots (no pill chip backgrounds), same row/height/positions — no layout collapse

## Phase 3 — Records + Record Detail (COMPLETE)
- [x] SourceBadge (WhatsApp green / Email blue / SMS gray / Upload teal, muted)
- [x] SegmentedControl with sliding indicator (used for type tabs + Enhanced/Original)
- [x] Records list: 2 tabs (Lab Reports / Prescriptions), person filter incl. Patients, document thumbnails (inline SVG), title, person + date, source + category badges, "Flagged" chip on abnormal records, Add button → /upload, skeleton + empty states
- [x] Record Detail: back header with source badge, AI-summary gradient card, Enhanced/Original toggle with crossfade, tap-to-zoom fullscreen lightbox (pinch + double-tap + buttons, inside phone screen)
- [x] Extracted details table; abnormal values = red pill with up/down arrow + normal range; "N abnormal" header chip
- [x] Sticky bottom bar: Export as PDF (window.print) + Share (contextual toast)
- [x] Print stylesheet: #root hidden in print; clean A4 record sheet portaled to body (verified .print-doc present, window.print invoked)
- [x] Verified: 4 lab cards (3 flagged), 3 prescriptions, Patients filter, crossfade layers, zoom open/in/close inside screen, share toast, print called, back nav, tab bar states, no overflow, tap targets ≥44px, zero console errors

## Phase 4 — Simulated upload flow (COMPLETE)
- [x] Add record screen: dashed drop area, hidden file input (accept="image/*"), "or use a sample screenshot" shortcut
- [x] Preview card (picked image or sample SVG) + Replace — Process record button directly (chooser area removed per user feedback)
- [x] Process → 2.55s stepped overlay (Enhancing image… → Extracting text… → Summarizing…) portaled over the whole phone screen
- [x] Lands on pre-made result record (CMP, glucose 118 flagged) — nothing actually processed
- [x] Session records: processed record appears in Records list (newest first, flagged) and persists for the session; resetSessionRecords ready for demo reset
- [x] Demo auto mode `?demo=1`: sample pre-loaded, runs hands-free (for the presentation stepper)
- [x] Verified: overlay step labels cycle correctly, result detail correct, list shows 5 labs with new first, demo auto-run works, no overflow, tap targets ≥44px, zero console errors

## Phase 5 — Presentation shell (COMPLETE)
- [x] src/content.js — one file for all copy (brand, problem, solution, steps, footer with [Team name]/[Hackathon name]/[Teammate] placeholders)
- [x] DemoShell: 3-column launch page (minimal copy, single wordmark, 3 pain points, 4 feature cards, note, footer strip), gradient bg + blurred shapes, staggered column load-in
- [x] DemoStepper: 4 numbered steps + active label, Prev/Next, Reset, arrow-key shortcuts (desktop only)
- [x] DemoContext + DemoBridge: one-way step → app (Personal filter intent, auto-upload via ?demo=1, export pulse + toast on step 4); Reset clears session state + remounts app
- [x] Responsive: ≥1100 full layout · <1100 phone+stepper · <500 fullscreen app only (verified all three)
- [x] Verified: 1440×900 / 1366×768 / 1920×1080 — full phone visible, zero page scroll, no phone/stepper overlap, stepper above footer (fixed a top-clip by removing footer padding from the phone's height budget); steps 1–4 land correctly, auto-upload runs, export pulses + toast fires, arrow keys + Next/Prev + Reset all work, reset clears the session record (4 labs after reset), zero console errors

## Phase 6 — Polish & verification
- [ ] In-frame 390px: no horizontal scroll, no clipped/overlapping text, tap targets ≥44px
- [ ] Fullscreen branch at 360px: same checks + safe-area
- [ ] Print output = clean A4 record
- [ ] Desktop 1440×900 / 1366×768 / 1920×1080: full phone visible, zero page scroll
- [ ] Demo steps land correctly, Reset works, arrow keys work
- [ ] Final check: fresh `npm install && npm run dev`
