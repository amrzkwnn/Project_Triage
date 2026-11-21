# Product

Senior Digital Companion (repo: Build_Bersama): a local-first, installable PWA that helps older adults stay safe and organized on their phones, with iOS Safari/Home Screen as a priority target.

## Sections
- **Scam Shield**: paste or screenshot a message, get a traffic-light verdict (Looks Safe / Be Careful / Likely Scam) with plain-language reasons.
- **Photo Helper**: four one-tap presets (no sliders). Edits always save as a new copy.
- **Unified Inbox**: email (auto-forward) and WhatsApp (iOS Shortcut or paste) in one place. Each item gets a source badge, a 1-2 sentence summary, and two-axis classification (Personal/Family/Others and Important/Social/Promotion).
- **AI Media Check**: guidance and provenance checks (C2PA/EXIF) for AI-generated images and voice clones. Never claims "100% real"; "Cannot tell" is the honest default.
- **Calendar**: photograph a paper calendar, confirm events one by one. Categories: Medical, Family & Social, Bills & Errands, Daily Routine. Default view is Today & This Week.
- **My Data vault**: per-source ON/OFF consent, "What AI Read" audit log, export, erase all.

## Product rules
- **Consent first**: AI reads data only from sources the user turned on.
- **Bounded AI**: Tier 1 organizes automatically. Tier 2 proposes and waits for a Confirm tap. Tier 3 (high risk or confidence < 0.6) escalates with "Ask Family to Check". AI never sends replies, clicks links, modifies the calendar, or deletes originals without confirmation.
- **Senior-first UI**: body text 18px+, summaries 20px+, tap targets 52px+, high contrast, icon + text label + color together (never color alone), flat navigation with a persistent "Back to Home", no technical jargon.
- **No unofficial WhatsApp scraping**. Manual forward only ("Approach A").

## Source of truth
Requirements, design, and tasks are in `.kiro/specs/senior-digital-companion/`. Background is in `problem_statement.md`, `proposal.md`, and `proposal_approach.md`.
