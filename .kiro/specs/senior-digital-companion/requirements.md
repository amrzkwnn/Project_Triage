# Requirements Document

## Introduction

The Senior Digital Companion (Build_Bersama) is a multi-platform, iOS-friendly, local-first Progressive Web App that helps senior citizens stay safe and organized across digital tools. It addresses five problems: scams and hacking, confusing AI photo editing, communication scattered across email, WhatsApp, and photos of prescriptions, AI-generated images and cloned voices in group chats, and cluttered paper calendars.

The product follows "Approach A": official APIs, Share/Forward actions, and camera/photo upload. It does not scrape WhatsApp or Messenger. Seniors may allow AI to read their data, provided they stay in control of it. The system makes bounded decisions in three tiers. It organizes automatically, proposes actions that need a 1-tap approval, and escalates high-risk or low-confidence items to family.

The product has five sections (Scam Shield, Photo Helper, Unified Inbox, AI Media Check, Calendar), a Home Hub, and a My Data control vault.

## Glossary

- **Companion_App**: The Senior Digital Companion Progressive Web App, including its client UI and server API routes.
- **Senior**: The primary end user, an older adult using the Companion_App.
- **Family_Member**: A trusted person the Senior chooses to receive items through "Ask Family".
- **Home_Hub**: The landing screen showing Today's Important Decisions, the section cards, and the privacy status pill.
- **Consent_Vault**: The My Data screen (`/my-data`) holding consent toggles, the audit log, export, and erase controls.
- **Channel**: A data source: `email`, `whatsappForward`, `smsPaste`, `messengerPaste`, or `photos`.
- **Channel_Toggle**: An ON/OFF setting for one Channel.
- **AI_Reading_Toggle**: The `allowAiReading` setting. When OFF, the Companion_App uses on-device deterministic rules and makes no external AI calls.
- **Caregiver_Share_Toggle**: The `caregiverShareEnabled` setting that permits sharing items with a Family_Member.
- **Local_Store**: Browser storage (IndexedDB and localStorage) on the Senior's device.
- **Audit_Log**: The plain-language "What AI Read" history of items the AI inspected.
- **Decision_Proxy**: The stateless `/api/decide` server route that forwards a single inspected item to the AI service.
- **Ingest_API**: The server routes `POST /api/ingest` and `POST /api/ingest/email`, plus the `/inbox?source=...&text=...` deep link, that receive forwarded items.
- **Apple_Shortcut**: An iOS Shortcut available from the Share Sheet Actions menu that sends shared content to the Ingest_API.
- **Inbox_Item**: One received message, email, or photo with its source badge, classification, summary, and proposed actions.
- **Source_Badge**: A label with icon and text showing where an Inbox_Item came from (for example "From Email" or "From WhatsApp").
- **Group_Category**: One of `Personal`, `Family`, or `Others`.
- **Priority_Type**: One of `Important`, `Social`, or `Promotion`.
- **Clarity_Summary**: A plain-language summary with the fields `fromApp`, `whoSent`, and `actionNeeded`.
- **Detected_Event**: A calendar event extracted from an item, with a date in `YYYY-MM-DD` format, a time, and a location.
- **Scam_Warning**: A flag on an Inbox_Item indicating likely scam characteristics.
- **Scam_Shield**: The section that checks messages, links, and screenshots and returns a Traffic_Light_Verdict.
- **Traffic_Light_Verdict**: One of `safe` (green), `caution` (yellow), or `danger` (red), with plain-language reasons.
- **Safe_Phone_Checklist**: A step-by-step list of phone and WhatsApp privacy settings the Senior can mark done.
- **Family_Code_Word**: A secret word agreed within the family to verify identity.
- **Photo_Helper**: The section that applies one-tap photo presets.
- **Photo_Preset**: One of `Make Clearer`, `Brighten Dark Photo`, `Fix Old / Scratched Photo`, or `Tidy Background`.
- **Media_Checker**: The AI Media Check section that inspects images for AI-generation signals.
- **Provenance_Signal**: Evidence of origin in an image, such as EXIF data, C2PA manifest, or a generator signature.
- **Eye_Check_Guide**: The 4-Spot Eye Check guide covering hands and fingers, background words and signs, eyes, teeth and glasses, and plastic or smooth face edges.
- **Calendar_Section**: The section for the phone calendar and paper calendar import.
- **Paper_Calendar_Snap**: The feature that extracts events from a photo of a paper calendar using OCR.
- **Calendar_Category**: One of `Medical`, `Family & Social`, `Bills & Errands`, or `Daily Routine`.
- **Decision_Tier**: Tier 1 (automatic organization), Tier 2 (proposed action needing 1-tap approval), or Tier 3 (escalation to family).
- **Confidence**: A numeric score from 0 to 1 for an extraction or classification result.
- **Low_Confidence_Threshold**: A Confidence value of 0.6, below which a result counts as low confidence.
- **Plain_Date**: A calendar date without a time zone, represented by `Temporal.PlainDate`.

## Requirements

### Requirement 1: Multi-Platform Installable Web App

**User Story:** As a Senior using an iPhone, I want to open the app from my Home Screen, so that I can use it without an app store.

#### Acceptance Criteria

1. THE Companion_App SHALL run without functional errors in iOS Safari, Android Chrome, and desktop Chrome, Safari, Edge, and Firefox, each at the latest stable release and the one major release before it.
2. THE Companion_App SHALL provide a PWA manifest containing an app name of 1 to 45 characters, at least one 192x192 pixel icon, at least one 512x512 pixel icon, and standalone display mode, so that iOS can add the Companion_App to the Home Screen.
3. WHEN the Senior launches the Companion_App from the Home Screen, THE Companion_App SHALL open in standalone display mode without browser address bar or browser tab controls within 3 seconds on a 4G connection.
4. THE Companion_App SHALL store Senior data in the Local_Store on the Senior's device by default and SHALL NOT transmit Senior data to any remote server unless the Senior has explicitly enabled that transmission.
5. THE Companion_App SHALL obtain WhatsApp, SMS, and Messenger content only through Share/Forward actions, paste, or photo upload.
6. WHEN the Senior opens the installed Companion_App with no network connection, THE Companion_App SHALL display all data previously stored in the Local_Store within 3 seconds and show an indicator that the device is offline.
7. IF the Local_Store is unavailable, full, or returns a read or write error, THEN THE Companion_App SHALL keep the data already stored unchanged, display an error message indicating that the data could not be saved or loaded, and keep the app usable for all functions that do not need the Local_Store.

### Requirement 2: Home Hub

**User Story:** As a Senior, I want one calm starting screen, so that I know what needs my attention and where to go.

#### Acceptance Criteria

1. THE Home_Hub SHALL display exactly five section cards, in this order: Scam Shield, Photo Helper, Unified Inbox, AI Media Check, and Calendar.
2. WHEN a section card is tapped, THE Companion_App SHALL open the corresponding section within 1 second.
3. WHEN the Home_Hub is displayed, THE Home_Hub SHALL show a "Today's Important Decisions" list containing every Tier 2 and Tier 3 item awaiting the Senior, ordered with Tier 3 items first and, within each tier, with the oldest item first.
4. WHERE the "Today's Important Decisions" list contains more than 5 items, THE Home_Hub SHALL display the first 5 items and a control that reveals the remaining items.
5. WHEN the Home_Hub is displayed, THE Home_Hub SHALL show a My Data & Privacy status pill containing the number of enabled Channels (an integer from 0 to the total number of configured Channels) and the AI_Reading_Toggle state (On or Off).
6. WHEN the enabled Channel count or the AI_Reading_Toggle state changes, THE Home_Hub SHALL update the My Data & Privacy status pill within 1 second.
7. WHEN the Senior taps the My Data & Privacy status pill, THE Companion_App SHALL open the Consent_Vault within 1 second.
8. WHILE the Senior is on any screen other than the Home_Hub, THE Companion_App SHALL display a persistent "← Back to Home" control.
9. WHEN the Senior taps the "← Back to Home" control, THE Companion_App SHALL display the Home_Hub within 1 second.
10. IF zero Tier 2 and Tier 3 items await a decision, THEN THE Home_Hub SHALL display the message "Nothing needs your attention today" in place of the "Today's Important Decisions" list.
11. IF the list of items awaiting a decision cannot be loaded, THEN THE Home_Hub SHALL display an error message indicating the list is unavailable and a retry control, and SHALL keep the five section cards and the My Data & Privacy status pill visible and operable.

### Requirement 3: Senior Accessibility Floor

**User Story:** As a Senior with reduced vision and dexterity, I want large, clear, simple screens, so that I can use the app without help.

#### Acceptance Criteria

1. THE Companion_App SHALL render body text at 18px or larger and summary text at 20px or larger on every screen.
2. THE Companion_App SHALL render every interactive control with a touch target of at least 52px by 52px and at least 12px spacing between adjacent targets.
3. THE Companion_App SHALL present each status badge with an icon, a text label, and a color, so that the status is identifiable from the icon and text label alone without relying on color.
4. THE Companion_App SHALL write all user-facing text at a reading grade level of 8 or lower, with no technical jargon, where technical jargon means any term that is not in everyday use by non-technical adults, such as "sync", "token", "API", "cache", or "error code".
5. WHEN the page is zoomed to 200%, THE Companion_App SHALL display content in a single column with no horizontal scrolling at a viewport width of 320 CSS px, and with no content clipped or overlapping.
6. WHILE the operating system forced-colors mode is active, THE Companion_App SHALL render all text, controls, and badges using the system forced colors, keep every text label and icon visible, and keep every interactive control's boundary visible.
7. WHEN the status of an operation changes, THE Companion_App SHALL announce the new status text in a polite aria-live region within 1 second, without moving keyboard focus.
8. THE Companion_App SHALL provide a contrast ratio of at least 4.5:1 for body text and summary text against its background, and at least 3:1 for icons, status badge borders, and control boundaries.
9. THE Companion_App SHALL limit navigation to the Home_Hub and its five section screens, with no nested navigation menus.
10. WHEN a user is on any section screen, THE Companion_App SHALL provide a single control, with a visible text label, that returns the user to the Home_Hub in one tap.

### Requirement 4: Consent Vault Channel Controls

**User Story:** As a Senior, I want to turn each data source on or off, so that I decide what the app can receive.

#### Acceptance Criteria

1. THE Consent_Vault SHALL provide exactly one Channel_Toggle for each of the five Channels: `email`, `whatsappForward`, `smsPaste`, `messengerPaste`, and `photos`, each showing its current state (ON or OFF) and the Channel name.
2. WHEN the Companion_App is launched for the first time, THE Consent_Vault SHALL set all five Channel_Toggles to OFF before any item from any Channel is accepted.
3. WHEN the Senior turns a Channel_Toggle ON, THE Companion_App SHALL accept items arriving from that Channel within 1 second of the toggle change and SHALL display the toggle as ON.
4. WHEN the Senior turns a Channel_Toggle OFF, THE Companion_App SHALL reject new items from that Channel within 1 second of the toggle change, SHALL retain all items already stored from that Channel without modification, and SHALL display the toggle as OFF.
5. IF an item arrives from a Channel whose Channel_Toggle is OFF, THEN THE Companion_App SHALL discard the item without writing any of its content to the Local_Store and SHALL display a message that names the Channel and offers an action to turn that Channel's Channel_Toggle ON.
6. WHEN the Senior selects the offered action to turn the Channel ON, THE Companion_App SHALL set that Channel_Toggle to ON and SHALL NOT restore the previously discarded item.
7. WHEN the Senior changes a Channel_Toggle, THE Companion_App SHALL write the new state of all five toggles to the Local_Store within 1 second, and WHEN the Companion_App is relaunched, THE Consent_Vault SHALL display each Channel_Toggle in the state last written.
8. IF writing a toggle state to the Local_Store fails, THEN THE Companion_App SHALL revert the Channel_Toggle to its previous state and SHALL display an error message indicating that the setting could not be saved.

### Requirement 5: AI Reading Consent

**User Story:** As a Senior, I want to choose whether AI may read my items, so that my private content stays under my control.

#### Acceptance Criteria

1. WHEN the Companion_App is launched for the first time, THE Consent_Vault SHALL provide the AI_Reading_Toggle in the OFF state, and THE Consent_Vault SHALL keep the toggle OFF until the Senior completes the confirmation in criterion 5.
2. WHILE the AI_Reading_Toggle is OFF, THE Companion_App SHALL classify, summarize, and check each item using on-device deterministic rules and SHALL make 0 external AI calls and 0 network requests containing item content.
3. WHILE the AI_Reading_Toggle is ON, THE Companion_App SHALL send only the single item under inspection to the Decision_Proxy in each request, and SHALL include no other items, no Senior profile data, and no content from previous requests.
4. WHEN the Decision_Proxy receives a request, THE Decision_Proxy SHALL process it statelessly and SHALL retain 0 bytes of request content after the response is sent or after the request fails.
5. WHEN the Senior turns the AI_Reading_Toggle ON, THE Companion_App SHALL display an explanation stating which item content AI will read and where it is sent, written at a reading level no higher than grade 6 and using no technical terms, and THE Companion_App SHALL enable the toggle only after the Senior performs a single tap on a confirmation control.
6. IF the Senior dismisses the explanation without confirming, THEN THE Companion_App SHALL keep the AI_Reading_Toggle OFF and make 0 external AI calls.
7. WHEN the Senior turns the AI_Reading_Toggle OFF, THE Companion_App SHALL stop sending items to the Decision_Proxy within 1 second, and SHALL require no confirmation to turn it OFF.
8. IF the Decision_Proxy is unreachable, returns an error, or does not respond within 10 seconds, THEN THE Companion_App SHALL apply the on-device deterministic rules to that item, SHALL send no retry for that item, SHALL display a notice stating that the simpler check was used, and SHALL leave the AI_Reading_Toggle in the ON state.

### Requirement 6: What AI Read Audit Log

**User Story:** As a Senior, I want to see what AI has read, so that I can trust what the app does.

#### Acceptance Criteria

1. WHEN the AI inspects an item, THE Companion_App SHALL append one Audit_Log entry to the Local_Store within 2 seconds of the inspection starting, containing the timestamp (date and time to the second, in the device's local time zone), the Channel, a description of the item of 1 to 200 characters written in everyday words with no technical identifiers, and the purpose of the inspection of 1 to 200 characters.
2. IF the Companion_App fails to write an Audit_Log entry to the Local_Store, THEN THE Companion_App SHALL block the AI inspection of that item, retain the item unchanged, and show the Senior a message indicating that the item was not read because the record could not be saved.
3. WHEN the Senior opens the Consent_Vault Audit_Log view, THE Consent_Vault SHALL display the Audit_Log entries in reverse chronological order, with the most recent entry first, within 2 seconds for up to 1,000 entries.
4. WHEN the Audit_Log contains no entries, THE Consent_Vault SHALL display a message indicating that the AI has not read anything.
5. THE Audit_Log SHALL contain no entry for items processed only by on-device rules.
6. THE Companion_App SHALL retain Audit_Log entries in the Local_Store until the Senior deletes them.

### Requirement 7: Data Export and Erase

**User Story:** As a Senior, I want to download or erase all my data in one step, so that I always own my information.

#### Acceptance Criteria

1. WHEN the Senior taps "Download My Data", THE Companion_App SHALL produce a JSON file containing all Inbox_Items, calendar events, settings, and Audit_Log entries within 10 seconds for a dataset of up to 10,000 Inbox_Items, and SHALL make the file available for saving to the device.
2. FOR ALL valid stored datasets, importing the exported JSON file into an empty Local_Store SHALL reproduce a dataset with the same Inbox_Items, calendar events, settings, and Audit_Log entries, with every field value identical to the original (round-trip property).
3. IF the export fails (for example, because device storage is full or the file cannot be written), THEN THE Companion_App SHALL display an error message stating that the download failed and the reason, leave the Local_Store unchanged, and offer a "Try Again" action.
4. WHEN the Senior taps "Erase All My Data", THE Companion_App SHALL display a first confirmation that lists the categories to be deleted (Inbox_Items, calendar events, settings, Audit_Log entries, and email access) and provides "Continue" and "Cancel" actions.
5. WHEN the Senior taps "Continue" on the first confirmation, THE Companion_App SHALL display a second confirmation that states the erasure is permanent and cannot be undone, and provides "Erase Everything" and "Cancel" actions.
6. WHEN the Senior taps "Erase Everything" on the second confirmation, THE Companion_App SHALL delete all data from the Local_Store and revoke all stored OAuth tokens, with each revocation request limited to 10 seconds.
7. WHEN erasure completes with all OAuth tokens revoked, THE Companion_App SHALL display a message confirming that all data and email access were removed.
8. IF token revocation fails or times out after 10 seconds for any OAuth token, THEN THE Companion_App SHALL still delete the local copy of that token and all other data, display a message stating which email accounts could not be revoked, and display instructions for revoking access in the email provider settings.
9. WHEN the Senior taps "Cancel" at either confirmation step, THE Companion_App SHALL close the confirmation and leave all data and OAuth tokens unchanged.

### Requirement 8: Bounded AI Decision Tiers

**User Story:** As a Senior, I want AI to help without acting on its own, so that nothing important happens without my approval.

#### Acceptance Criteria

1. WHEN the Companion_App produces an AI result, THE Companion_App SHALL assign the result to exactly one Decision_Tier (Tier 1, Tier 2, or Tier 3) before displaying it to the Senior.
2. WHEN an Inbox_Item is received and its Channel is enabled, THE Companion_App SHALL apply Tier 1 actions automatically, without Senior input, within 5 seconds of receipt: assign Group_Category, assign Priority_Type, write the Clarity_Summary, and attach the Source_Badge.
3. WHEN the Companion_App proposes Forward to Calendar, Check Scam, or Share with Family, THE Companion_App SHALL classify the proposal as Tier 2, display a Confirm control and a Dismiss control, and execute the proposal only after the Senior taps Confirm.
4. IF an item has a `danger` Traffic_Light_Verdict or a Confidence below the Low_Confidence_Threshold, THEN THE Companion_App SHALL classify the item as Tier 3, display an "Ask Family to Check" control, and execute no Tier 2 action on the item unless the Senior taps Confirm.
5. IF the Companion_App is about to send a message, delete an original item, open a link in a message, make a payment, or commit a calendar or medication change, THEN THE Companion_App SHALL display a confirmation prompt and perform the action only after the Senior taps Confirm.
6. WHEN the Senior dismisses a Tier 2 proposal, THE Companion_App SHALL leave the underlying data unchanged and SHALL NOT execute the proposed action.
7. IF the Senior does not tap Confirm or Dismiss on a Tier 2 proposal or a confirmation prompt, THEN THE Companion_App SHALL keep the proposal pending, execute no action, and leave the underlying data unchanged.
8. IF a Tier 1 action fails, THEN THE Companion_App SHALL leave the Inbox_Item unmodified, display the item as uncategorized with an indication that automatic processing failed, and offer a retry control.

### Requirement 9: Caregiver Sharing

**User Story:** As a Senior, I want to ask a trusted family member to double-check something, so that I get help on risky items.

#### Acceptance Criteria

1. THE Consent_Vault SHALL provide the Caregiver_Share_Toggle and initialize the toggle to OFF for every new Senior account.
2. WHILE the Caregiver_Share_Toggle is OFF, THE Companion_App SHALL hide all "Ask Family" actions.
3. WHILE the Caregiver_Share_Toggle is OFF, WHEN the Senior opens a Tier 3 item, THE Companion_App SHALL display an offer to turn the Caregiver_Share_Toggle ON within 1 second of the item opening.
4. WHILE the Caregiver_Share_Toggle is ON, WHEN the Senior taps "Ask Family" on an item, THE Companion_App SHALL display a preview of the item and its Clarity_Summary with "Confirm" and "Cancel" controls, and SHALL NOT send any content to a Family_Member before the Senior taps "Confirm".
5. WHEN the Senior taps "Confirm" on the item preview, THE Companion_App SHALL send only that single item and its Clarity_Summary to the selected Family_Member and SHALL display a confirmation that the share was sent.
6. WHEN the Senior taps "Confirm" and the share is sent, THE Companion_App SHALL append one Audit_Log entry containing the shared item identifier, the Family_Member recipient, and the date and time of sharing, within 2 seconds of sending.
7. IF the share fails to send (for example, no network connection or recipient unavailable), THEN THE Companion_App SHALL display an error message indicating the share was not sent, SHALL keep the item unchanged, SHALL NOT append an Audit_Log entry for a share that was not sent, and SHALL offer a "Retry" action.
8. WHEN the Senior taps "Cancel" on the item preview, THE Companion_App SHALL close the preview, send no content, and append no Audit_Log entry.

### Requirement 10: Ingestion Through Share and Forward

**User Story:** As a Senior using WhatsApp on an iPhone, I want to forward a message to the app in a few taps, so that I can have it organized without copying.

#### Acceptance Criteria

1. WHEN the Ingest_API receives a `POST /api/ingest` request with non-empty content and a recognized source, THE Companion_App SHALL create exactly one Inbox_Item with that source and the received content, and the Ingest_API SHALL respond with a success response within 3 seconds.
2. WHEN the Ingest_API receives a `POST /api/ingest/email` request containing an email with non-empty content, THE Companion_App SHALL create exactly one Inbox_Item with the source `email` and the received email content, and the Ingest_API SHALL respond with a success response within 3 seconds.
3. WHEN the Senior opens `/inbox?source=...&text=...`, THE Companion_App SHALL display a preview of the `text` parameter value (up to 5,000 characters) with Confirm and Cancel buttons, and SHALL create no Inbox_Item until the Senior taps Confirm.
4. WHEN the Senior taps Confirm on the preview, THE Companion_App SHALL create exactly one Inbox_Item from the `source` and `text` parameter values and display the new item in the Unified Inbox within 2 seconds.
5. WHEN the Senior taps Cancel on the preview, THE Companion_App SHALL create no Inbox_Item and display the Unified Inbox.
6. IF the `/inbox` link has an empty `text` value, a missing `source`, or an unrecognized `source`, THEN THE Companion_App SHALL show no preview, create no Inbox_Item, and display a plain-language message stating that the shared item could not be read, together with the "Paste Message or Pick Photo" button.
7. THE Companion_App SHALL provide setup instructions for the Apple_Shortcut as a numbered sequence of steps, with at least one screenshot for each step, accessible from within the Companion_App.
8. THE Companion_App SHALL display a "Paste Message or Pick Photo" button on the Unified Inbox screen at all times, regardless of connectivity or Apple_Shortcut installation state.
9. IF an ingest request has an empty body, a missing source, or an unrecognized source, THEN THE Ingest_API SHALL return a 400 status with a plain-language error message stating which of these problems occurred, and SHALL create no Inbox_Item.
10. IF an ingest request cannot reach the Ingest_API because the Senior's device is offline or the Apple_Shortcut is not installed, THEN THE Companion_App SHALL, within 5 seconds of the Senior returning to or opening the Companion_App, display a message stating that the item was not received, together with the "Paste Message or Pick Photo" button, and SHALL create no Inbox_Item.
11. IF an ingest request has the same source and identical content as an existing Inbox_Item received within the previous 24 hours, THEN THE Companion_App SHALL keep only the original Inbox_Item, create no new Inbox_Item, and display a note stating that the item was already received.
12. IF an ingest request has a payload larger than 10 MB, THEN THE Ingest_API SHALL return a 413 status with a plain-language error message stating that the item is too large, and SHALL create no Inbox_Item.

### Requirement 11: Email Auto-Forwarding

**User Story:** As a Senior, I want my emails to arrive in the app automatically, so that I do not have to forward each one.

#### Acceptance Criteria

1. WHERE email auto-forwarding is configured through a provider forwarding rule or an OAuth read-only connection, WHEN an email arrives at the configured source, THE Companion_App SHALL make the email available for processing within 60 seconds of receipt by the provider.
2. WHERE OAuth is used, THE Companion_App SHALL request read-only scopes only, and SHALL NOT request any scope that permits sending, modifying, or deleting emails.
3. WHEN the Senior turns the `email` Channel_Toggle OFF, THE Companion_App SHALL stop processing incoming emails within 5 seconds, SHALL discard any email received after the toggle time, and SHALL retain emails already processed before the toggle time.
4. THE Companion_App SHALL store OAuth tokens only in the Local_Store or in encrypted form on the server side, and SHALL NOT write token values to logs.
5. IF the OAuth token expires or is revoked, THEN THE Companion_App SHALL stop fetching emails, display a message within 5 seconds of detecting the failure asking the Senior to reconnect email, and retain previously processed emails.
6. IF an incoming email cannot be processed (for example, it is malformed or exceeds 25 MB), THEN THE Companion_App SHALL skip that email, display a message indicating that one email could not be processed, and continue processing subsequent emails.

### Requirement 12: Inbox Classification

**User Story:** As a Senior, I want messages sorted by who they are from and how much they matter, so that the important ones are easy to find.

#### Acceptance Criteria

1. WHEN an Inbox_Item is created, THE Companion_App SHALL assign exactly one Group_Category from {`Personal`, `Family`, `Others`} and exactly one Priority_Type from {`Important`, `Social`, `Promotion`} within 2 seconds of creation.
2. WHEN an email from a clinic or doctor contains an appointment, THE Companion_App SHALL classify the Inbox_Item with Source_Badge `email`, Group_Category `Personal`, and Priority_Type `Important`.
3. WHEN a WhatsApp forward comes from a sender saved as a Family_Member and the content does not contain urgent wording, THE Companion_App SHALL classify the Inbox_Item as Group_Category `Family` and Priority_Type `Social`.
4. WHEN a WhatsApp forward comes from a sender saved as a Family_Member and the content contains urgent wording, THE Companion_App SHALL classify the Inbox_Item as Group_Category `Family` and Priority_Type `Important`.
5. WHEN a promotional email arrives, THE Companion_App SHALL classify the Inbox_Item as Group_Category `Others` and Priority_Type `Promotion`.
6. WHEN an unknown sender sends a message that contains urgent wording and a payment link, THE Companion_App SHALL classify the Inbox_Item as Group_Category `Others` and Priority_Type `Important`, attach a Scam_Warning, and propose the Check Scam action.
7. IF an Inbox_Item matches none of the classification rules above, THEN THE Companion_App SHALL classify it as Group_Category `Others` and Priority_Type `Social`.
8. THE Unified Inbox SHALL provide tabs labelled `Personal`, `Family`, `Others`, and `All`, where each of the first three tabs lists only Inbox_Items with the matching Group_Category and `All` lists every Inbox_Item.
9. THE Unified Inbox SHALL display on every Inbox_Item the Priority_Type as a pill containing an icon, the Priority_Type text, and a color, and the Source_Badge.
10. THE Unified Inbox SHALL order Inbox_Items with Priority_Type `Important` first, then all other Inbox_Items, and within each of these two groups by received time descending.
11. WHEN the Senior opens the Promotion filter, THE Unified Inbox SHALL show all Inbox_Items with Priority_Type `Promotion` and no other Inbox_Items, ordered by received time descending.

### Requirement 13: Clarity Summary and Detected Events

**User Story:** As a Senior, I want long messages turned into one or two clear sentences, so that I can see what to do.

#### Acceptance Criteria

1. WHEN an Inbox_Item is created, THE Companion_App SHALL generate a Clarity_Summary within 5 seconds, containing a `fromApp` field, a `whoSent` field, an `actionNeeded` field, and a summary text of 1 to 2 sentences with a maximum of 300 characters.
2. IF the sender is not identifiable, THEN THE Companion_App SHALL set `whoSent` to "Unknown sender".
3. IF no action is required, THEN THE Companion_App SHALL set `actionNeeded` to "No action needed".
4. IF the Clarity_Summary is not generated within 5 seconds or generation fails, THEN THE Companion_App SHALL display the Inbox_Item with its original content, show an indication that no summary is available, and retain the Inbox_Item unchanged.
5. WHEN an Inbox_Item contains a date and a time, THE Companion_App SHALL create a Detected_Event with the date as a Plain_Date in `YYYY-MM-DD` format, the time as a Temporal.PlainTime, and the location when present.
6. IF an Inbox_Item contains a date but no time, or a date or time that cannot be parsed as a valid calendar date or a time from 00:00 to 23:59, THEN THE Companion_App SHALL NOT create a Detected_Event for that Inbox_Item and SHALL still display the Inbox_Item with its Clarity_Summary.
7. WHILE a Detected_Event exists for an Inbox_Item, THE Companion_App SHALL display a "Forward to Calendar" action on that Inbox_Item.
8. THE Companion_App SHALL store and display every Detected_Event date and time without conversion to UTC, so that the displayed date equals the date in the original content in every device time zone.
9. WHEN the Senior opens an Inbox_Item, THE Companion_App SHALL provide access to the original content, with text identical to the received text, character for character.

### Requirement 14: Forward-To Actions

**User Story:** As a Senior, I want one-tap actions on each message, so that I can move it to the right place safely.

#### Acceptance Criteria

1. WHEN the Senior taps "Forward to Calendar", THE Companion_App SHALL display a confirmation prompt showing the Detected_Event title, date, and time, with Confirm and Cancel controls, within 1 second of the tap.
2. WHEN the Senior taps Confirm on the Forward to Calendar confirmation prompt, THE Companion_App SHALL create exactly one Calendar_Section event from the Detected_Event and display a success indication within 2 seconds.
3. WHEN the Senior taps Cancel on the Forward to Calendar confirmation prompt, THE Companion_App SHALL close the prompt and create no Calendar_Section event.
4. IF creating the Calendar_Section event fails, THEN THE Companion_App SHALL display an error indication that the event was not created, retain the Inbox_Item and Detected_Event unchanged, and offer a Retry control.
5. WHEN the Senior taps "Forward to Scam Check", THE Companion_App SHALL open Scam_Shield within 1 second with the full text content and all links of the Inbox_Item preloaded and unmodified.
6. WHEN the Senior taps "Forward to AI Image Check" on an Inbox_Item with an image, THE Companion_App SHALL open the Media_Checker within 1 second with the image preloaded, and if the Inbox_Item has more than one image, THE Companion_App SHALL preload the first image.
7. WHEN the Senior taps "Forward Summary to Family" and the Caregiver_Share_Toggle is ON, THE Companion_App SHALL follow the Requirement 9 sharing flow.
8. IF the Senior taps "Forward Summary to Family" and the Caregiver_Share_Toggle is OFF, THEN THE Companion_App SHALL share nothing and display a message stating that sharing is turned off.
9. WHERE the Inbox_Item content contains no Detected_Event date, no link, or no image, THE Companion_App SHALL hide the "Forward to Calendar" action, the "Forward to Scam Check" action, or the "Forward to AI Image Check" action respectively, and SHALL continue to display the remaining applicable actions.

### Requirement 15: Scam Shield Checker

**User Story:** As a Senior, I want to check a suspicious message in one tap, so that I know whether to trust it.

#### Acceptance Criteria

1. WHEN the Senior pastes text of 1 to 5,000 characters or uploads one screenshot (JPEG or PNG, up to 10 MB) and taps "Is This Safe?", THE Scam_Shield SHALL return a Traffic_Light_Verdict within 10 seconds containing exactly one verdict value (`safe`, `caution`, or `danger`), an icon, a text label, a color, and between 1 and 3 plain-language reasons, each of at most 150 characters.
2. WHEN the content contains urgency wording, a request for secrecy, or an unusual payment request, THE Scam_Shield SHALL return a verdict of `caution` or `danger` and list each detected red flag by category (urgency, secrecy, or unusual payment) in the reasons.
3. WHEN the content contains a link whose domain differs from the domain of the claimed sender organization, THE Scam_Shield SHALL return a verdict of `caution` or `danger` and display a reason naming the link domain and the claimed organization.
4. WHEN the verdict is `danger`, THE Scam_Shield SHALL display the instruction "Do not click or pay" and display an "Ask Family to Check" button.
5. WHEN the verdict is `caution`, THE Scam_Shield SHALL display an instruction to verify the message using the Hang Up & Call Back rule on a number saved in the Senior's contacts.
6. IF the content contains a payment request together with urgency wording, THEN THE Scam_Shield SHALL return a verdict of `caution` or `danger` and SHALL NOT return `safe`.
7. THE Scam_Shield SHALL NOT open, fetch, or click any link in the checked content.
8. IF a screenshot is unreadable (no text extracted, or file larger than 10 MB or not JPEG or PNG), THEN THE Scam_Shield SHALL return no verdict, display a message asking the Senior to retake or crop the screenshot, and keep the Senior's current input on screen.
9. WHEN the same input is checked twice with the same settings, THE Scam_Shield SHALL return the same verdict value and the same set of red flag categories both times.
10. IF the Scam_Shield cannot complete a check within 10 seconds or a required service is unavailable, THEN THE Scam_Shield SHALL return no verdict, display a message stating the check failed and offering a retry, and keep the Senior's current input on screen.

### Requirement 16: Safety Habits and Phone Checklist

**User Story:** As a Senior, I want simple safety habits and a setup checklist, so that I am harder to scam in the first place.

#### Acceptance Criteria

1. WHEN the Senior opens the safety habits screen, THE Scam_Shield SHALL display the three red flags (urgency, secrecy, unusual payment) and the Hang Up & Call Back rule together, with all four items visible on one screen without scrolling at the default text size.
2. WHEN the Senior submits a Family_Code_Word of 1 to 50 characters that is not empty or whitespace-only, THE Scam_Shield SHALL store the word in the Local_Store and display a confirmation that the word was saved.
3. IF the Senior submits a Family_Code_Word that is empty, whitespace-only, or longer than 50 characters, THEN THE Scam_Shield SHALL reject the entry, display an error message indicating the allowed length, and keep any previously stored Family_Code_Word unchanged.
4. IF the Local_Store write fails when saving a Family_Code_Word, THEN THE Scam_Shield SHALL display an error message indicating the word was not saved and keep any previously stored Family_Code_Word unchanged.
5. THE Safe_Phone_Checklist SHALL list at least these three steps: restrict WhatsApp profile photo to contacts, silence unknown callers, and set a screen lock.
6. WHEN the Senior marks a checklist step as done, THE Safe_Phone_Checklist SHALL save the step state in the Local_Store within 1 second and display progress in the form "X of Y steps completed", where X is the number of completed steps and Y is the total number of steps.
7. IF the Local_Store write fails when saving a checklist step state, THEN THE Safe_Phone_Checklist SHALL revert the step to its previous state and display an error message indicating the change was not saved.
8. THE Companion_App SHALL exclude the Family_Code_Word from all data sent to the Decision_Proxy and from all Family_Member share content.

### Requirement 17: Photo Helper Presets

**User Story:** As a Senior, I want to improve a photo with one tap, so that I can fix old or dark family photos without learning editing.

#### Acceptance Criteria

1. THE Photo_Helper SHALL offer exactly four Photo_Presets: `Make Clearer`, `Brighten Dark Photo`, `Fix Old / Scratched Photo`, and `Tidy Background`, with no sliders or other adjustable controls.
2. WHEN the Senior picks a photo in JPEG or PNG format of up to 25 MB and taps a Photo_Preset, THE Photo_Helper SHALL display a before/after view of the original and the edited result within 15 seconds of the tap, with a visible progress indicator until the result appears.
3. WHEN the Senior taps Save on the result, THE Photo_Helper SHALL save the edited image as a new file whose name is the original file name with `-edited` inserted before the file extension, and SHALL display a confirmation that the copy was saved.
4. THE Photo_Helper SHALL leave the original image file byte-for-byte unchanged during preview, Save, Discard, and error handling.
5. IF the file name produced by Save already exists in the destination, THEN THE Photo_Helper SHALL append a numeric suffix starting at `-2` and increasing by 1 until the name is unused, and SHALL NOT overwrite or modify the existing file.
6. WHEN the Senior taps Discard, THE Photo_Helper SHALL delete the unsaved edited image, return to the photo selection screen, and keep the original unchanged.
7. WHILE the `photos` Channel_Toggle is OFF, THE Photo_Helper SHALL display a prompt to turn on photo access, SHALL NOT open the photo picker, and SHALL NOT accept any photo.
8. IF a Photo_Preset fails to process an image or exceeds 15 seconds, THEN THE Photo_Helper SHALL stop processing, display an error message in plain language stating that the photo could not be improved and offering a Try Again option and a Back option, and keep the original unchanged with no edited file saved.
9. WHEN the Senior opens the Photo_Helper, THE Photo_Helper SHALL make available a 3-step "Old Print Scan Tip" guide for photographing printed photos without glare, with exactly three steps shown in order.

### Requirement 18: AI Media Check

**User Story:** As a Senior, I want help recognizing fake images and cloned voices in group chats, so that I do not trust or forward fakes.

#### Acceptance Criteria

1. WHEN the Senior uploads a supported image, THE Media_Checker SHALL inspect Provenance_Signals (EXIF, C2PA manifest, and generator signatures) and display exactly one result, `AI signal found`, `Camera signal found`, or `Cannot tell`, within 10 seconds of upload completion for an image of up to 10 MB.
2. WHEN a C2PA manifest or generator signature identifies AI generation, THE Media_Checker SHALL return `AI signal found` and display the name of the signal that identified AI generation, even if EXIF camera data is also present.
3. WHEN the image contains camera EXIF data and no C2PA manifest or generator signature identifying AI generation, THE Media_Checker SHALL return `Camera signal found` and display a note that this result does not prove the image is authentic.
4. IF the image contains no Provenance_Signals, THEN THE Media_Checker SHALL return `Cannot tell` and display an explanation that messaging apps often remove this information.
5. IF the inspection fails or does not complete within 10 seconds, THEN THE Media_Checker SHALL return `Cannot tell`, display an error message indicating the check could not be completed, and offer a retry action.
6. THE Media_Checker SHALL NOT display "100% Real" or any other statement that an image is certainly authentic, on any result screen.
7. WHEN the Media_Checker displays any result, THE Media_Checker SHALL display the Eye_Check_Guide containing exactly four spots on the same screen as the result.
8. WHEN the Senior opens the Media_Checker, THE Media_Checker SHALL display a Voice Clone Safety explanation stating that short clips can imitate a relative's voice, with the instruction to verify using the Family_Code_Word or a saved phone number.
9. IF the uploaded file is not a supported image, THEN THE Media_Checker SHALL display a message listing the supported formats and the maximum file size of 10 MB, and SHALL perform no check.
10. WHEN the Senior taps "Ask Family to Check" and the Caregiver_Share_Toggle is ON, THE Companion_App SHALL follow the Requirement 9 sharing flow.
11. WHEN the Senior taps "Ask Family to Check" and the Caregiver_Share_Toggle is OFF, THE Companion_App SHALL send nothing to any Family_Member and SHALL display a message that sharing is turned off.

### Requirement 19: Paper Calendar Snap

**User Story:** As a Senior, I want to photograph my paper calendar and have the events moved to my phone, so that my phone calendar is organized.

#### Acceptance Criteria

1. WHEN the Senior takes or uploads a photo of a paper calendar, THE Calendar_Section SHALL extract up to 100 candidate events using OCR, each with a date, a title of 1 to 100 characters, a Calendar_Category, and a Confidence between 0.00 and 1.00, and SHALL complete extraction within 15 seconds.
2. WHEN extraction completes with at least one candidate, THE Calendar_Section SHALL present candidate events one at a time, showing the date, title, and Calendar_Category, with "Keep" and "Skip" buttons, and SHALL show the position of the current candidate out of the total number of candidates.
3. WHEN the Senior taps Keep, THE Calendar_Section SHALL add that event to the calendar and advance to the next candidate, or end the review if it was the last candidate.
4. WHEN the Senior taps Skip, THE Calendar_Section SHALL discard that candidate, add nothing to the calendar, and advance to the next candidate, or end the review if it was the last candidate.
5. IF the OCR Confidence for a photo is below the Low_Confidence_Threshold, THEN THE Calendar_Section SHALL display a message asking the Senior to retake the photo with better light and a flat angle, SHALL present no candidate events from that photo, and SHALL add nothing to the calendar.
6. IF a candidate event has a Confidence below the Low_Confidence_Threshold, THEN THE Calendar_Section SHALL mark the candidate "Please check" and SHALL keep the Keep button disabled until the Senior has confirmed or edited the date.
7. IF a candidate event matches an existing event on the same Plain_Date with the same normalized title, THEN THE Calendar_Section SHALL mark the candidate as a duplicate and add no second event unless the Senior explicitly chooses "Keep both".
8. WHILE the `photos` Channel_Toggle is OFF, THE Calendar_Section SHALL display a prompt to turn on photo access, SHALL NOT accept a photo, and SHALL leave the calendar unchanged.
9. IF OCR finds zero candidate events in a photo, or OCR fails or times out after 15 seconds, THEN THE Calendar_Section SHALL display a message indicating that no events could be read, offer a "Try again" action, and add nothing to the calendar.
10. FOR ALL sets of candidate events, scanning the same paper calendar photo twice and keeping all candidates both times SHALL produce the same calendar as scanning once (idempotence).

### Requirement 20: Systematic Calendar Views

**User Story:** As a Senior, I want a calm, organized calendar, so that I can see what is coming without clutter.

#### Acceptance Criteria

1. THE Calendar_Section SHALL assign every event exactly one Calendar_Category from the four defined categories and display the category with an icon, a text label, and a color on every event shown in the Today, This Week, and month views.
2. WHEN the Senior opens the Calendar_Section, THE Calendar_Section SHALL display a "Today" view showing the events of the current Plain_Date in ascending start-time order, with events that have equal start times ordered by creation time.
3. WHEN the Senior taps "This Week", THE Calendar_Section SHALL show events for the current Plain_Date and the following six days, grouped by day in chronological order, with events within each day in ascending start-time order.
4. WHEN the Senior opens a month view, THE Calendar_Section SHALL display only the days of that month that have at least one event as a vertical list, with each day's events listed beneath its date, and SHALL NOT display a grid of day cells.
5. WHEN the Senior opens an event, THE Calendar_Section SHALL show an "Edit category" control that offers exactly the four Calendar_Categories and indicates the current one.
6. WHEN the Senior taps Edit, Delete, or Add on an event, THE Calendar_Section SHALL show a confirmation prompt with Confirm and Cancel controls and SHALL apply the change only after the Senior taps Confirm.
7. IF the Senior taps Cancel on the confirmation prompt or dismisses it, THEN THE Calendar_Section SHALL close the prompt, make no change to the event, and keep the event's previous data.
8. WHEN an event is created from an Inbox_Item, THE Calendar_Section SHALL store a link to the source Inbox_Item and display the Source_Badge of that Inbox_Item on the event.
9. WHEN a Detected_Event is forwarded from the Unified Inbox and an equivalent event already exists, THE Calendar_Section SHALL apply the duplicate handling in Requirement 19, criterion 7.
10. IF the Senior opens a day with no events, THEN THE Calendar_Section SHALL display the text "Nothing planned" for that day.

### Requirement 21: Prescription and Medical Photos

**User Story:** As a Senior, I want prescriptions and appointment photos kept organized, so that I can find them later.

#### Acceptance Criteria

1. WHEN the Senior adds a photo of a prescription, THE Companion_App SHALL create one Inbox_Item under `Personal` and `Important` within 3 seconds of the photo being saved, with a Source_Badge showing "From Photo" and a thumbnail of the photo.
2. IF text extraction from a prescription photo has Confidence below the Low_Confidence_Threshold, THEN THE Companion_App SHALL classify the item as Tier 3, display the message "This photo is hard to read. Please retake it or ask family to check", offer a retake action, and keep the original photo and Inbox_Item until the Senior completes a retake.
3. THE Companion_App SHALL store the original prescription photo with no changes to its content (byte-identical to the saved photo) and SHALL display it above any extracted text.
4. THE Companion_App SHALL create a medication schedule or reminder only after the Senior selects a confirm action for that specific schedule or reminder, and SHALL create zero schedules or reminders from text extraction alone.
5. IF the prescription photo cannot be saved (for example, storage is full or the file is unreadable), THEN THE Companion_App SHALL create no Inbox_Item, display an error message indicating the photo was not saved and the reason, and offer a retry action.
6. IF text extraction returns no text or does not finish within 30 seconds, THEN THE Companion_App SHALL keep the Inbox_Item and original photo, classify the item as Tier 3, display the same message as criterion 2, and offer a retake action.

### Requirement 22: Reminders

**User Story:** As a Senior, I want optional reminders for upcoming appointments, so that I do not miss them.

#### Acceptance Criteria

1. WHERE push notifications are enabled by the Senior, THE Companion_App SHALL send one reminder for each confirmed calendar event at the lead time the Senior selected, with a delivery tolerance of plus or minus 60 seconds of the scheduled reminder time.
2. THE Companion_App SHALL offer lead-time options of 15 minutes, 30 minutes, 1 hour, 2 hours, and 1 day before the event start, and SHALL default the selection to 1 hour.
3. THE Companion_App SHALL set push notifications to OFF for every new Senior account until the Senior explicitly enables them.
4. THE Companion_App SHALL write each notification in plain language that contains the event title (truncated to a maximum of 60 characters), the day of the week with the calendar date, and the start time in the Senior's local 12-hour or 24-hour format setting.
5. IF the browser denies notification permission, THEN THE Companion_App SHALL keep push notifications OFF, display the in-app Today view as the reminder surface, and display a message explaining how to enable notifications in the browser settings.
6. WHEN a confirmed calendar event is rescheduled or cancelled before its reminder is sent, THE Companion_App SHALL cancel the pending reminder and, for a rescheduled event, schedule a new reminder at the Senior's selected lead time for the new start time.
7. IF the scheduled reminder time for a confirmed calendar event has already passed when the event is confirmed, THEN THE Companion_App SHALL send no push reminder for that event.

### Requirement 23: Failure Handling and Honest Uncertainty

**User Story:** As a Senior, I want the app to say when it is unsure, so that I do not rely on a wrong answer.

#### Acceptance Criteria

1. IF any extraction or classification result has a Confidence below the Low_Confidence_Threshold, THEN THE Companion_App SHALL label the result "Not sure", display a retake action and an "Ask Family to Check" action alongside the result, and keep the result from being saved as confirmed until the Senior selects one of the two actions or explicitly confirms it.
2. WHEN an incoming item has the same identifier as a stored item, THE Companion_App SHALL keep the existing item unchanged, save the incoming item as a separate entry, and display both entries to the Senior.
3. IF a network request fails or does not complete within 30 seconds, THEN THE Companion_App SHALL display a message in plain language of at most 25 words that states which action did not work and names one next step the Senior can take, SHALL keep all data the Senior entered, and SHALL offer a retry action.
4. IF a Local_Store write fails because storage is full, THEN THE Companion_App SHALL display a message asking the Senior to free space or download their data, SHALL leave all previously stored items unchanged and readable, and SHALL show that the new item was not saved.
5. IF any error occurs, THEN THE Companion_App SHALL show the Senior no error codes, exception names, or stack traces in any screen or message.

### Requirement 24: Date Handling

**User Story:** As a Senior, I want dates to show correctly wherever I travel, so that appointments are never a day off.

#### Acceptance Criteria

1. THE Companion_App SHALL store and compare calendar dates as Plain_Dates and times of day as Temporal.PlainTime, without applying a time zone offset to either value.
2. FOR ALL valid Plain_Dates from 0001-01-01 to 9999-12-31, formatting a date to `YYYY-MM-DD` and parsing the result SHALL produce a Plain_Date equal to the original (round-trip property).
3. IF a date string is not in `YYYY-MM-DD` format or does not represent a real calendar date (for example 2025-02-30), THEN THE Companion_App SHALL reject the value, keep the previously stored date unchanged, and display a message that asks the Senior to confirm the date.
4. WHEN the device time zone changes, THE Companion_App SHALL keep the Plain_Date and Temporal.PlainTime of every stored event unchanged and display each event on the same Plain_Date as before the change.
5. WHEN the Companion_App displays an event after the device time zone changes, THE Companion_App SHALL show the event's time of day as the stored Temporal.PlainTime value, with no shift in hours or minutes.

### Requirement 25: Data Serialization

**User Story:** As a developer, I want stored data to serialize reliably, so that exports, imports, and storage never corrupt a Senior's data.

#### Acceptance Criteria

1. WHEN the Local_Store is exported or saved, THE Companion_App SHALL serialize all Inbox_Items, events, and settings into a JSON document that contains an integer schema version field.
2. WHEN the Companion_App serializes in-memory Inbox_Items, events, and settings, THE Pretty_Printer SHALL produce valid JSON text encoded in UTF-8 and indented with 2 spaces per nesting level.
3. WHEN a JSON file of 10 MB or less is imported, THE Parser SHALL parse the file into in-memory Inbox_Items, events, and settings and complete within 5 seconds for a file containing up to 10,000 Inbox_Items.
4. IF an imported file is not well-formed JSON, is missing the schema version field, has a schema version the Companion_App does not support, or lacks a required field of an Inbox_Item, event, or setting, THEN THE Parser SHALL reject the entire file, leave the Local_Store unchanged, and display an error message in plain language that states which of these reasons applies.
5. IF an imported file is larger than 10 MB, THEN THE Parser SHALL reject the file without reading its contents, leave the Local_Store unchanged, and display an error message in plain language that states the 10 MB size limit.
6. FOR ALL valid in-memory datasets, parsing the output of the Pretty_Printer and then printing and parsing it again SHALL produce a dataset equal to the original in every Inbox_Item, event, and setting field, including text containing Unicode characters, line breaks, and quotation marks (round-trip property).

### Requirement 26: Ingest Payload Parsing

**User Story:** As a developer, I want incoming payloads parsed predictably, so that malformed requests cannot break the app.

#### Acceptance Criteria

1. WHEN the Ingest_API receives a valid payload, THE Ingest_Parser SHALL parse the payload into an Inbox_Item draft containing a required source (1 to 64 characters), required text (1 to 10,000 characters), an optional sender (0 to 256 characters), optional attachments (0 to 10 items), and a received time recorded in UTC with millisecond precision.
2. WHEN the Ingest_API receives a request to `/inbox` with `source` and `text` query parameters, THE Ingest_Parser SHALL percent-decode the parameter values as UTF-8, including multi-byte Unicode characters, and produce an Inbox_Item draft with the same fields and limits as criterion 1.
3. IF the payload is malformed, is missing a required field, contains a field exceeding its limit from criterion 1, or contains text that is not valid UTF-8 after decoding, THEN THE Ingest_Parser SHALL reject the payload within 500 milliseconds, return an error to the caller indicating which field or condition failed, create no Inbox_Item, and leave existing Inbox_Items unchanged.
4. IF the payload contains HTML or script content, THEN THE Ingest_Parser SHALL store the content unchanged as plain text, and THE Companion_App SHALL display the content as literal characters without executing scripts or interpreting HTML markup.
5. WHEN an Inbox_Item draft is provided, THE Ingest_Printer SHALL format the draft into an ingest payload that THE Ingest_Parser accepts as valid under criterion 1.
6. FOR ALL valid Inbox_Item drafts, parsing then printing then parsing SHALL produce a draft whose source, text, sender, attachments, and received time are equal to those of the first parsed draft (round-trip property).

### Requirement 27: Security and Privacy of the Server Routes

**User Story:** As a Senior, I want my forwarded messages protected, so that nobody else can read or add to my inbox.

#### Acceptance Criteria

1. WHEN the Ingest_API receives a request, THE Ingest_API SHALL verify that the request carries a secret token issued to a single Senior and SHALL accept the request only if the token matches an active token.
2. IF a request has a missing, malformed, revoked, or invalid token, THEN THE Ingest_API SHALL return a 401 status, process no content from the request, and store no data from the request.
3. IF a request carries a valid token for Senior A and targets the inbox or data of a different Senior, THEN THE Ingest_API SHALL reject the request, return no data belonging to the other Senior, and make no change to the other Senior's inbox.
4. THE Companion_App SHALL transmit all data between the client and the server over HTTPS.
5. IF a client attempts to connect to the server over unencrypted HTTP, THEN THE Companion_App SHALL refuse the connection or redirect it to HTTPS, and SHALL process no message content over the unencrypted connection.
6. THE Decision_Proxy SHALL write no message content, summaries, or tokens to server logs, including logs written during error conditions.
7. THE Companion_App SHALL keep API keys for AI services on the server and SHALL include no API key in any client bundle, client-visible response, or client-visible error.
8. IF a token sends more than 60 requests within any 60-second window, THEN THE Ingest_API SHALL return a 429 status for each request above the limit, process no content from those requests, and resume accepting requests from that token once fewer than 60 requests fall within the preceding 60 seconds.