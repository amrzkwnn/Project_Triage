# Implementation Plan: Senior Digital Companion

## Overview

Implementation language: TypeScript (Next.js 15 App Router, Tailwind CSS v4), as chosen in the design. The plan builds pure logic modules first (dates, vault, consent, ingest, classification, engine, scam, media, calendar), each followed by its property tests. It then adds server routes, shared UI, section screens, and finally wires the ingest pipeline end to end. Tests use Vitest and fast-check (at least 100 runs per property), with `fake-indexeddb` for the Vault. Each property test carries the tag `Feature: senior-digital-companion, Property N: <text>`.

## Tasks

- [ ] 1. Scaffold project and shared types
  - Create the Next.js 15 + TypeScript + Tailwind v4 project under `src/` using the structure in the design
  - Add Vitest, fast-check, fake-indexeddb, msw, Testing Library, Playwright, axe-core, and `temporal-polyfill`
  - Define shared types in `src/lib/types.ts`: Channel, GroupCategory, PriorityType, CalendarCategory, DecisionTier, Settings (with defaults: all channels OFF, AI OFF, caregiver OFF, push OFF, lead `1h`), ClaritySummary, DetectedEvent, InboxItem, InboxItemDraft, CalendarEvent, AuditEntry, ExportDocument, and `Result<T, E>`
  - _Requirements: 1.4, 4.2, 5.1, 9.1, 22.2, 22.3_

- [ ] 2. Date handling and plain-language errors
  - [ ] 2.1 Implement `lib/calendar/dates.ts`
    - `parsePlainDate` (using `overflow: 'reject'`), `formatPlainDate`, and PlainTime parse/format as `HH:mm`
    - Reject non-`YYYY-MM-DD` strings and impossible dates, with a message asking the Senior to confirm the date
    - _Requirements: 24.1, 24.2, 24.3_

  - [ ]* 2.2 Write property test for plain date round trip
    - **Property 15: Plain date round trip**
    - **Validates: Requirements 24.1, 24.2**

  - [ ]* 2.3 Write property test for invalid date rejection
    - **Property 16: Invalid dates are rejected**
    - **Validates: Requirements 24.3**

  - [ ] 2.4 Implement `lib/errors/plainMessage.ts`
    - `toPlainMessage(err, action)` returns at most 25 words, names the action, gives one next step, and never includes codes, exception names, or stack text
    - _Requirements: 23.3, 23.5_

  - [ ]* 2.5 Write property test for plain error messages
    - **Property 41: Plain error messages**
    - **Validates: Requirements 23.3, 23.5**

- [ ] 3. Vault, consent, audit, export/import, erase
  - [ ] 3.1 Implement `lib/vault/schema.ts`, `store.ts`, `settings.ts`
    - IndexedDB database `bersama` with stores `items`, `events`, `audit`, `blobs`, `meta`; localStorage mirror of Settings
    - One transaction per write; `saveSettings` writes all five toggles together; failures return `Result` errors and leave stored data unchanged
    - Treat an incoming item with an existing id as a separate entry
    - _Requirements: 1.4, 1.7, 4.2, 4.7, 4.8, 23.2, 23.4_

  - [ ] 3.2 Implement `lib/vault/consent.ts`
    - Pure `admit`, `mayCallAi`, `mayShare`
    - AI toggle state machine: turn-on request, single-tap confirm, dismiss keeps OFF, turn-off needs no confirmation
    - Channel OFF returns the discard result naming the channel with a "turn on" offer, and never restores the discarded item
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.5, 5.6, 5.7, 9.1_

  - [ ]* 3.3 Write property test for channel consent gating
    - **Property 1: Channel consent gating**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 11.3, 17.7, 19.8**

  - [ ]* 3.4 Write property test for settings persistence round trip
    - **Property 2: Settings persistence round trip**
    - **Validates: Requirements 4.7, 4.8**

  - [ ]* 3.5 Write property test for AI toggle confirmation
    - **Property 5: AI toggle requires confirmation**
    - **Validates: Requirements 5.1, 5.5, 5.6, 5.7**

  - [ ] 3.6 Implement `lib/vault/audit.ts`
    - `appendAudit` with local-time timestamp to the second, 1 to 200 character description and purpose
    - Reverse-chronological listing and empty-state message; entries are kept until the Senior deletes them
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 3.7 Write property test for audit log display order
    - **Property 8: Audit log display order**
    - **Validates: Requirements 6.3**

  - [ ] 3.8 Implement `lib/vault/export.ts` and `import.ts`
    - Export with `JSON.stringify(doc, null, 2)`, UTF-8, integer `schemaVersion`, photo blobs as base64
    - Atomic import that rejects the whole file for malformed JSON, missing or unsupported version, missing required field, or size over 10 MB (checked before reading), naming the reason
    - _Requirements: 7.1, 7.2, 7.3, 25.1, 25.2, 25.3, 25.4, 25.5_

  - [ ]* 3.9 Write property test for export and import round trip
    - **Property 12: Export and import round trip**
    - **Validates: Requirements 7.1, 7.2, 13.9, 25.1, 25.2, 25.6**

  - [ ]* 3.10 Write property test for invalid imports
    - **Property 13: Invalid imports change nothing**
    - **Validates: Requirements 25.4, 25.5**

  - [ ]* 3.11 Write property test for failed writes
    - **Property 14: Failed writes leave stored data unchanged**
    - **Validates: Requirements 1.7, 7.3, 23.4**

  - [ ]* 3.12 Write property test for identifier collision
    - **Property 22: Identifier collision keeps both**
    - **Validates: Requirements 23.2**

  - [ ] 3.13 Implement erase with OAuth token revocation
    - `eraseAll` deletes all data and local tokens; each revocation limited to 10 seconds
    - Report the accounts whose revocation failed, with provider-settings instructions; show success only when all revocations succeeded
    - Take revocation and side effects through injected dependencies
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 3.14 Write property test for erase with token revocation
    - **Property 40: Erase with token revocation**
    - **Validates: Requirements 7.6, 7.7, 7.8**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Ingest parsing, classification, and inbox logic
  - [ ] 5.1 Implement `lib/inbox/parse.ts` and `print.ts`
    - `parseIngest`, `parseIngestQuery` (percent-decode as UTF-8), `printIngest`
    - Limits: source 1 to 64, text 1 to 10,000, sender 0 to 256, attachments 0 to 10, received time in UTC with milliseconds
    - `IngestError` names the failing field and reason; HTML and script text is kept unchanged as plain text
    - _Requirements: 10.9, 26.1, 26.2, 26.3, 26.4, 26.5_

  - [ ]* 5.2 Write property test for ingest round trip
    - **Property 18: Ingest parse and print round trip**
    - **Validates: Requirements 26.1, 26.4, 26.5, 26.6**

  - [ ]* 5.3 Write property test for query parameter decoding
    - **Property 19: Query parameter decoding**
    - **Validates: Requirements 26.2, 10.3, 10.4**

  - [ ]* 5.4 Write property test for malformed ingest rejection
    - **Property 20: Malformed ingest is rejected with the failing field**
    - **Validates: Requirements 10.9, 26.3**

  - [ ] 5.5 Implement `lib/inbox/classify.ts` and `order.ts`
    - `classify` rules for clinic email, family sender (urgent or not), promotion, unknown sender with urgency and payment link (Scam_Warning and Check Scam proposal), and the default
    - `sortInbox` (Important first, then received time descending) and `filterByTab`, plus the Promotion filter
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.10, 12.11_

  - [ ]* 5.6 Write property test for classification
    - **Property 23: Classification is total and follows the rules**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7**

  - [ ]* 5.7 Write property test for inbox ordering and filtering
    - **Property 24: Inbox ordering and filtering**
    - **Validates: Requirements 12.8, 12.10, 12.11**

  - [ ] 5.8 Implement `lib/inbox/dedup.ts`
    - `isDuplicate`: same source and identical text within the previous 24 hours
    - _Requirements: 10.11_

  - [ ]* 5.9 Write property test for duplicate ingest
    - **Property 21: Duplicate ingest within 24 hours**
    - **Validates: Requirements 10.11**

  - [ ] 5.10 Implement `lib/inbox/events.ts` and `lib/ai/summary.ts`
    - `detectEvent` returns an event only for a real date plus a time from 00:00 to 23:59, with no UTC conversion
    - Clarity_Summary builder (1 to 2 sentences, at most 300 characters, "Unknown sender", "No action needed")
    - Compute available Forward-to actions (calendar, scam check, image check, family) from item content
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 13.7, 13.8, 14.9_

  - [ ]* 5.11 Write property test for clarity summary shape
    - **Property 25: Clarity summary shape**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [ ]* 5.12 Write property test for event detection and action visibility
    - **Property 26: Event detection and action visibility**
    - **Validates: Requirements 13.5, 13.6, 13.7, 14.9**

- [ ] 6. Decision engine, tiering, and action executor
  - [ ] 6.1 Implement `lib/ai/rules.ts`, `tiering.ts`, `proxyClient.ts`, `engine.ts`
    - `analyzeWithRules` (pure, deterministic), `assignTier` (Tier 3 for `danger` or confidence below 0.6, Tier 2 with proposals, else Tier 1)
    - `analyze`: rules only when AI is OFF; otherwise write the audit entry first (block on failure), send only the single item to `/api/decide` with a 10-second abort, fall back to rules once on any failure without retry
    - Merge only summary, group, priority, and confidence from AI; compute tier locally
    - _Requirements: 5.2, 5.3, 5.8, 6.2, 8.1, 8.2, 8.4, 13.4, 15.9_

  - [ ]* 6.2 Write property test for tier assignment
    - **Property 9: Tier assignment**
    - **Validates: Requirements 8.1, 8.3, 8.4, 19.6, 21.2, 23.1**

  - [ ]* 6.3 Write property test for AI off
    - **Property 3: AI off means no external calls**
    - **Validates: Requirements 1.4, 5.2, 6.5**

  - [ ]* 6.4 Write property test for the AI request body
    - **Property 4: AI request contains only the inspected item**
    - **Validates: Requirements 5.3, 16.8**

  - [ ]* 6.5 Write property test for fallback on AI failure
    - **Property 6: Fallback on AI failure**
    - **Validates: Requirements 5.8**

  - [ ]* 6.6 Write property test for audit before read
    - **Property 7: Audit before read**
    - **Validates: Requirements 6.1, 6.2**

  - [ ] 6.7 Implement `lib/actions/executor.ts` and `confirmation.ts`
    - Branded `Confirmation` created only by `confirmFromTap`; `execute` calls no side effect unless the confirmation matches the `actionId`
    - Pending proposals never expire into execution; Dismiss removes the proposal without executing
    - Cover forward to calendar, send, delete original, open link, pay, calendar and medication commits, and erase
    - _Requirements: 8.3, 8.5, 8.6, 8.7, 14.1, 14.2, 14.3, 14.4, 20.6, 20.7, 21.4_

  - [ ]* 6.8 Write property test for no side effect without confirmation
    - **Property 10: No side effect without a matching confirmation**
    - **Validates: Requirements 7.4, 7.5, 7.9, 8.3, 8.5, 8.6, 8.7, 14.3, 20.6, 20.7, 21.4**

  - [ ] 6.9 Implement caregiver sharing flow
    - Hide "Ask Family" when the toggle is OFF; offer to turn the toggle ON when a Tier 3 item opens
    - Preview, then send only the single item and its Clarity_Summary after Confirm; append an audit entry only on a successful send; Cancel sends nothing; failure offers Retry
    - Exclude the Family_Code_Word from shared content
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 14.7, 14.8, 16.8, 18.10, 18.11_

  - [ ]* 6.10 Write property test for sharing
    - **Property 11: Sharing sends only the confirmed single item**
    - **Validates: Requirements 9.2, 9.4, 9.5, 9.6, 9.7, 9.8, 14.8, 18.11**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Server routes
  - [ ] 8.1 Implement `lib/server/auth.ts`, `rateLimit.ts`, `relay.ts`, and `safeLog`
    - Hashed token lookup returning `seniorId`; sliding window of 60 requests per 60 seconds per token
    - Relay `enqueue/pull/ack` scoped by the token's `seniorId`, AES-GCM encrypted at rest, 7-day TTL
    - `safeLog` accepts only status codes and durations
    - _Requirements: 11.4, 27.1, 27.2, 27.3, 27.6, 27.8_

  - [ ] 8.2 Implement `app/api/ingest`, `ingest/email`, `ingest/pull`, `ingest/ack` routes
    - Auth, rate limit, parse, enqueue; return 400 naming the field, 401, 413 above 10 MB, 429, and success within 3 seconds
    - Return a fixed generic body on unexpected errors without echoing content
    - _Requirements: 10.1, 10.2, 10.9, 10.12, 27.1, 27.2, 27.3, 27.8_

  - [ ] 8.3 Implement `app/api/decide/route.ts` and `middleware.ts`
    - Stateless proxy accepting exactly one item, with the AI key read from server env only
    - Redirect `x-forwarded-proto: http` to HTTPS and send an HSTS header
    - _Requirements: 5.4, 27.4, 27.5, 27.6, 27.7_

  - [ ]* 8.4 Write property test for token authentication and tenant isolation
    - **Property 42: Token authentication and tenant isolation**
    - **Validates: Requirements 27.1, 27.2, 27.3**

  - [ ]* 8.5 Write property test for rate limiting
    - **Property 43: Rate limiting**
    - **Validates: Requirements 27.8**

  - [ ]* 8.6 Write property test for logs and bundle secrecy
    - **Property 44: Logs never contain secrets or content**
    - **Validates: Requirements 11.4, 27.6, 27.7**

  - [ ]* 8.7 Write integration tests for server routes
    - Ingest routes (200, 400, 401, 413, 429) with the relay; `/api/decide` with a mocked AI service stays stateless
    - Smoke check that no API key appears in the client bundle
    - _Requirements: 5.4, 10.1, 10.2, 10.9, 10.12, 27.2, 27.7_

- [ ] 9. Scam Shield logic
  - [ ] 9.1 Implement `lib/scam/verdict.ts`, `links.ts`, `habits.ts`
    - Deterministic `checkText` returning a verdict with 1 to 3 reasons of at most 150 characters and flag categories (urgency, secrecy, payment, domain-mismatch)
    - `extractLinks` parses only and imports no network client; `validateCodeWord` accepts 1 to 50 non-blank characters
    - Verdict instructions: "Do not click or pay" with Ask Family for `danger`; Hang Up & Call Back for `caution`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 16.2, 16.3_

  - [ ]* 9.2 Write property test for verdict shape and determinism
    - **Property 28: Verdict shape and determinism**
    - **Validates: Requirements 15.1, 15.9**

  - [ ]* 9.3 Write property test for red flags never safe
    - **Property 29: Red flags are never safe**
    - **Validates: Requirements 15.2, 15.3, 15.6**

  - [ ]* 9.4 Write property test for no network requests
    - **Property 30: Scam check makes no requests**
    - **Validates: Requirements 15.7**

  - [ ]* 9.5 Write property test for code word validation
    - **Property 31: Family code word validation**
    - **Validates: Requirements 16.2, 16.3**

  - [ ] 9.6 Implement Safe_Phone_Checklist and code word persistence
    - At least three steps; save step state within 1 second; revert and show an error when the write fails
    - Progress text "X of Y steps completed"; code word store errors keep the previous word
    - _Requirements: 16.4, 16.5, 16.6, 16.7_

  - [ ]* 9.7 Write property test for checklist progress
    - **Property 32: Checklist progress text**
    - **Validates: Requirements 16.6**

- [ ] 10. Media check and photo helper logic
  - [ ] 10.1 Implement `lib/media/provenance.ts` and `result.ts`
    - Parse EXIF (`exifr`), C2PA (`c2pa`), and generator signatures in the browser
    - `mediaResult` precedence: AI signal over EXIF, camera note, `Cannot tell` default; never claim "100% Real"; 10-second timeout gives `Cannot tell` with retry
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.9_

  - [ ]* 10.2 Write property test for media result precedence
    - **Property 33: Media check result precedence**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.6**

  - [ ] 10.3 Implement `lib/photo/presets.ts` and `filename.ts`
    - Exactly four presets as canvas pipelines with no adjustable controls; 15-second limit; JPEG or PNG up to 25 MB
    - `editedName` adds `-edited`, then `-2`, `-3`, and so on; the original bytes are never modified
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8_

  - [ ]* 10.4 Write property test for saved copy naming
    - **Property 34: Saved copy naming**
    - **Validates: Requirements 17.3, 17.5**

  - [ ]* 10.5 Write property test for byte-identical originals
    - **Property 35: Originals are byte-identical**
    - **Validates: Requirements 17.4, 17.6, 21.3**

- [ ] 11. Calendar logic
  - [ ] 11.1 Implement `lib/calendar/categories.ts`, `views.ts`, `snap.ts`, `ocr.ts`
    - Today, week (current day plus six), and month list views with the required ordering; "Nothing planned" for empty days
    - Tesseract.js OCR with a 15-second limit, up to 100 candidates, Keep/Skip review, "Please check" below 0.6, low OCR confidence yields no candidates
    - `mergeCandidates` with duplicate detection by Plain_Date and normalized title, and "Keep both"
    - Event creation stores the source item link; edit, delete, and add go through confirmation
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9, 20.1, 20.2, 20.3, 20.4, 20.5, 20.8, 20.9, 20.10_

  - [ ]* 11.2 Write property test for calendar view ordering
    - **Property 36: Calendar views ordering**
    - **Validates: Requirements 20.2, 20.3, 20.4**

  - [ ]* 11.3 Write property test for candidate review and low confidence
    - **Property 37: Candidate review and low confidence**
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.5, 19.6**

  - [ ]* 11.4 Write property test for duplicates and scan idempotence
    - **Property 38: Duplicate events and scan idempotence**
    - **Validates: Requirements 19.7, 19.10, 20.9**

  - [ ] 11.5 Implement `lib/calendar/reminders.ts`
    - `reminderTime`, `planReminder` (skip past times), lead options 15m, 30m, 1h, 2h, 1d with default 1h
    - Cancel or reschedule pending reminders; notification text with title truncated to 60 characters, weekday with date, and 12/24-hour time
    - Handle denied permission by keeping push OFF and showing the Today view as the reminder surface
    - _Requirements: 22.1, 22.2, 22.4, 22.5, 22.6, 22.7_

  - [ ]* 11.6 Write property test for reminder planning
    - **Property 39: Reminder planning**
    - **Validates: Requirements 22.4, 22.6, 22.7**

  - [ ]* 11.7 Write property test for time zone invariance
    - **Property 17: Time zone invariance**
    - **Validates: Requirements 13.8, 24.4, 24.5**

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Shared UI, app shell, Home Hub, and My Data
  - [ ] 13.1 Build shared components in `src/components`
    - `SeniorButton`, `StepWizard`, `TrafficLightCard`, `SourceBadge`, `PriorityPill`, `DecisionConfirmCard`, `StatusLive`, `BackToHome`, `PrivacyPill`
    - Text at 18px or larger (summaries 20px), targets at least 52px with 12px spacing, icon plus text plus color on badges, contrast 4.5:1 and 3:1, forced-colors support, single-column at 320px and 200% zoom
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.10, 2.8, 2.9_

  - [ ] 13.2 Build app shell, manifest, and service worker
    - `app/layout.tsx`, `app/manifest.ts` (name 1 to 45 characters, 192 and 512 icons, standalone), `public/sw.js` for offline shell caching, offline indicator
    - Show a plain error and keep the app usable when the Local_Store fails
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 3.9_

  - [ ] 13.3 Build Home Hub (`app/page.tsx`)
    - Five section cards in order; Today's Important Decisions list (Tier 3 first, oldest first, 5 visible with reveal, empty message, error with retry); privacy pill that updates within 1 second and opens My Data
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 2.11_

  - [ ]* 13.4 Write property test for the Home Hub decision list
    - **Property 27: Home Hub decision list**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6**

  - [ ] 13.5 Build My Data screen (`app/my-data/page.tsx`)
    - Five channel toggles, AI reading toggle with plain-language explanation and single-tap confirm, caregiver toggle, audit log view, Download My Data with Try Again, two-step Erase flow
    - Revert toggles and show an error when a write fails
    - _Requirements: 4.1, 4.2, 4.5, 4.8, 5.5, 5.6, 6.3, 6.4, 7.1, 7.3, 7.4, 7.5, 7.7, 7.8, 9.1_

- [ ] 14. Section screens
  - [ ] 14.1 Build Scam Shield screen (`app/scam-shield`)
    - Paste text or upload a screenshot (JPEG or PNG up to 10 MB) with client OCR; "Is This Safe?" shows the TrafficLightCard
    - Unreadable screenshot and 10-second failure keep input on screen with a retake or retry message; safety habits screen with all four items visible; code word form; Safe_Phone_Checklist
    - _Requirements: 15.1, 15.4, 15.5, 15.8, 15.10, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [ ] 14.2 Build Photo Helper screen (`app/photo-helper`)
    - Four preset buttons, photo picker gated on the `photos` toggle, progress indicator, before/after view, Save, Discard, Try Again and Back on failure, and the 3-step Old Print Scan Tip
    - _Requirements: 17.1, 17.2, 17.3, 17.6, 17.7, 17.8, 17.9_

  - [ ] 14.3 Build Unified Inbox screen (`app/inbox`)
    - Tabs Personal, Family, Others, All and the Promotion filter; items with SourceBadge, PriorityPill, and Clarity_Summary; original text shown as literal characters
    - `/inbox?source=&text=` preview with Confirm and Cancel; invalid links show a plain message; always-visible "Paste Message or Pick Photo"; Apple_Shortcut setup steps with screenshots via `StepWizard`
    - Forward-to actions with confirmation (calendar, scam check, image check, family); Tier 1 failure shows an uncategorized item with retry; duplicate note; "not received" message within 5 seconds
    - _Requirements: 8.2, 8.8, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 12.8, 12.9, 12.11, 13.4, 13.9, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 26.4_

  - [ ] 14.4 Build AI Media Check screen (`app/media-check`)
    - Upload with format and size message, result display with signal name, Eye_Check_Guide (exactly four spots) on the same screen, Voice Clone Safety explanation, "Ask Family to Check" following the sharing flow
    - _Requirements: 18.1, 18.5, 18.7, 18.8, 18.9, 18.10, 18.11_

  - [ ] 14.5 Build Calendar screen (`app/calendar`)
    - Today, This Week, and month list views with category icon, text, and color; Edit category; confirmation for edit, delete, and add; Paper Calendar Snap review with Keep/Skip, "Please check", duplicate handling, and retake messages; reminder settings
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.10, 22.1, 22.2, 22.3, 22.5_

  - [ ] 14.6 Build prescription photo flow
    - Create a Personal and Important Inbox_Item with "From Photo" badge and thumbnail within 3 seconds; show the original photo above extracted text
    - Low confidence, empty, or 30-second OCR gives Tier 3 with the hard-to-read message and a retake action; save failure creates no item and offers retry; schedules and reminders only after a specific confirm
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 23.1_

  - [ ] 14.7 Implement email channel integration
    - Provider forwarding rule and read-only OAuth connection; make emails available within 60 seconds; stop within 5 seconds when the email toggle turns OFF
    - Reconnect message within 5 seconds when the token expires or is revoked; skip malformed or over-25 MB emails with a message; encrypted server-side token storage and no token logging
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 15. Integration and wiring
  - [ ] 15.1 Wire the ingest pull pipeline
    - On app open and focus: pull from the relay, apply ConsentGate, deduplicate, classify, analyze (rules or AI per consent), assign tier, write Inbox_Item, then ack
    - Discard OFF-channel items and show the turn-on offer; Tier 1 actions complete within 5 seconds; low confidence results show "Not sure" with retake and Ask Family actions
    - Connect Tier 2 and Tier 3 items to the Home Hub list and the DecisionConfirmCard
    - _Requirements: 4.3, 4.5, 8.1, 8.2, 8.3, 8.4, 10.1, 10.2, 10.11, 23.1_

  - [ ]* 15.2 Write integration tests for end-to-end flows
    - WhatsApp forward through consent, classification, and calendar confirmation; AI ON with proxy failure falling back to rules; erase flow
    - _Requirements: 5.8, 7.6, 8.3, 10.1, 14.2_

  - [ ]* 15.3 Write accessibility and smoke tests
    - axe-core and Playwright checks at 320px width and 200% zoom, forced-colors, aria-live announcements, touch target sizes, and copy checks for banned jargon and reading grade
    - PWA manifest schema, offline load, and HTTPS redirect checks
    - _Requirements: 1.2, 1.6, 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 27.5_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (one test per property, at least 100 runs)
- Unit tests validate specific examples and edge cases

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.4", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "3.2", "3.6", "3.8"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.7", "3.9", "3.10", "3.11", "3.12", "3.13"] },
    { "id": 4, "tasks": ["3.14"] },
    { "id": 5, "tasks": ["4"] },
    { "id": 6, "tasks": ["5.1", "5.5", "5.8", "5.10"] },
    { "id": 7, "tasks": ["5.2", "5.3", "5.4", "5.6", "5.7", "5.9", "5.11", "5.12", "6.1", "6.7"] },
    { "id": 8, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.8", "6.9"] },
    { "id": 9, "tasks": ["6.10"] },
    { "id": 10, "tasks": ["7"] },
    { "id": 11, "tasks": ["8.1", "9.1", "9.6", "10.1", "10.3", "11.1", "11.5"] },
    { "id": 12, "tasks": ["8.2", "8.3", "9.2", "9.3", "9.4", "9.5", "9.7", "10.2", "10.4", "10.5", "11.2", "11.3", "11.4", "11.6", "11.7"] },
    { "id": 13, "tasks": ["8.4", "8.5", "8.6", "8.7"] },
    { "id": 14, "tasks": ["12"] },
    { "id": 15, "tasks": ["13.1", "13.2"] },
    { "id": 16, "tasks": ["13.3", "13.5"] },
    { "id": 17, "tasks": ["13.4", "14.1", "14.2", "14.3", "14.4", "14.5", "14.7"] },
    { "id": 18, "tasks": ["14.6"] },
    { "id": 19, "tasks": ["15.1"] },
    { "id": 20, "tasks": ["15.2", "15.3"] },
    { "id": 21, "tasks": ["16"] }
  ]
}
```
