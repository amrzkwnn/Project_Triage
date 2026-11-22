# Triage — Senior Digital Companion

A calm, senior-friendly mobile web app (PWA) designed to help older adults review messages, spot scams and AI-edited images, organize appointments, and enhance photos with large touch targets, plain language, and full privacy control.

---

## Key Features

### 1. Calm 3-Layer Mobile Layout
- **Always-Visible Navigation:** Every screen uses a fixed top bar, an independent scrollable middle layer, and a pinned bottom navigation bar (**My Day**, **Inbox**, **Calendar**, **Safety**, **My Data**) so navigation never disappears while scrolling.
- **Accessible by Design:** Large `56px+` tap targets, high-contrast surfaces, dual-modality badges (icon + text), and zero technical jargon.

### 2. Home Hub — One-at-a-Time Decision Queue
- **No Endless Email Scrolling:** Shows **one important decision at a time** (with a clear `1 of N` queue indicator) so users can focus without feeling overwhelmed.
- **Auto-Advance on Every Action:** Tapping **Confirm**, **Save to `<Category>`**, **Dismiss**, or **Ask Family** immediately saves the choice and brings up the next message.
- **Sender Name & Email Visibility:** Clearly displays both who sent each message and their email address.
- **Quick Helpers & Privacy Pill:** Displays live counts of pending decisions, active sources, and AI status at a glance, with quick cards to open every helper.

### 3. Unified Inbox & Custom Categories
- **Read-Only Gmail & Outlook Sign-In:** Connects directly to Gmail or Outlook with strict read-only permissions, truthful live connection verification, automatic background checks for new emails, and a dedicated unobstructed scrollable mail list.
- **Custom Categories:** Comes with built-in **Personal** and **All** (always kept), plus users can freely create and delete their own categories (e.g., *Family*, *Bills*, *Health*).
- **1-Tap `"Save to"` Filing:** Tap **Save to** on any Home or Inbox card to file a message into any category without cluttering cards with always-on family-forward buttons.
- **Plain-Language AI Summaries & Priority Sorting:** Uses Google Gemini AI (when enabled) to summarize messages, classify priority (**Important**, **Social**, **Promotion**), scan attached images for AI/scam clues, and offer 1-tap next steps (**Forward to Calendar**, **Forward to Scam Check**, **Forward to AI Image Check**).
- **Local-First Persistence:** Undismissed messages and settings stay saved locally on-device; dismissed items are removed locally and skipped on future checks.

### 4. Scam Shield ("Is This Safe?")
- **Text & Screenshot AI Scanning:** Paste suspicious text or upload a screenshot for a clear **Safe (Green)**, **Caution (Yellow)**, or **Danger (Red)** traffic-light verdict powered by Google Gemini AI + on-device safety checks (with a one-tap button to turn AI scanning on when needed).
- **4 Golden Safety Habits & Family Code Word:** Always-visible safety reminders (*Urgency*, *Secrecy*, *Unusual Payment*, *Hang Up & Call Back*), a private family code word, and a safe-phone checklist.

### 5. AI Media Check (For Photos & Group Chats)
- **Multimodal Vision Check:** Analyzes uploaded photos (and email image attachments) using Google Gemini Vision and on-device metadata checks, reporting honest outcomes (*AI signal found*, *Camera signal found*, or *Cannot tell* — never claiming `"100% real"`).
- **4-Spot Eye Check & Voice Clone Safety:** Plain-language visual inspection guide (*Hands & Fingers*, *Background Words & Signs*, *Eyes, Teeth & Glasses*, *Smooth Plastic Face Edges*) plus voice-clone safety tips.

### 6. Photo Helper (One-Tap Fixes)
- **Four Simple Presets (No Sliders):** **Make Clearer**, **Brighten Dark Photo**, **Fix Old / Scratched Photo**, and **Tidy Background**.
- **Originals Stay Safe:** Always previews **Before / After** and saves enhanced photos as a new copy, alongside a 3-step **Old Print Scan Tip**.

### 7. Smart Calendar & Paper Calendar Snap
- **AI Auto-Plan & Accurate Categories:** Automatically suggests plans from your messages and assigns accurate categories (**Medical**, **Family & Social**, **Bills & Errands**, **Daily Routine**) — e.g., family dinners go under *Family & Social*, never *Medical* — with a 1-tap **Auto-Pick Category with AI** helper.
- **Paper Calendar Snap:** Photograph a paper calendar and review detected dates one by one with **Keep** / **Skip** and duplicate detection.
- **Calm Views:** Switch cleanly between **Today**, **This Week**, and **Month List** with configurable reminder lead times.

### 8. My Data & Privacy Controls
- **Explicit Consent & Audit Log:** Turn each message source, **AI Reading**, and **Family Sharing** ON or OFF anytime; inspect a transparent **"What AI Read"** log; download a local backup; or erase all data with two-step confirmation.

