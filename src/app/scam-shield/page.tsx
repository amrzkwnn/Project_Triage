'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  KeyRound,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { TrafficLightCard } from '@/components/TrafficLightCard';
import {
  SAFE_PHONE_CHECKLIST_STEPS,
  SAFETY_HABITS,
  formatChecklistProgress,
  saveFamilyCodeWord,
  toggleChecklistStep,
  validateCodeWord,
} from '@/lib/scam/habits';
import { checkMessageWithAi } from '@/lib/scam/aiScamClient';
import { checkText, type ScamCheckOutput } from '@/lib/scam/verdict';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { canShowAskFamily, shareItemWithFamily } from '@/lib/actions/sharing';
import { createDefaultSettings, type Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

const MAX_SCAM_TEXT_LENGTH = 5_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const ALLOWED_SCREENSHOT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function encodeScreenshotBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    let chunk = '';
    for (let i = 0; i < slice.length; i += 1) {
      chunk += String.fromCharCode(slice[i]);
    }
    parts.push(chunk);
  }
  const binary = parts.join('');
  return typeof btoa === 'function' ? btoa(binary) : '';
}

export const UNREADABLE_SCREENSHOT_MESSAGE =
  'We could not read the words in that screenshot. Please retake or crop the screenshot more clearly, or paste the message text above.';

export type ScamInputEvaluation =
  | { ok: true; verdict: ScamCheckOutput }
  | {
      ok: false;
      kind: 'empty' | 'too-long' | 'unreadable-screenshot';
      message: string;
    };

export function evaluateScamCheckInput(params: {
  messageText: string;
  screenshotName?: string;
  screenshotOcrText?: string;
}): ScamInputEvaluation {
  const { messageText, screenshotName, screenshotOcrText } = params;
  const trimmedMessage = messageText.trim();
  const trimmedOcr = (screenshotOcrText ?? '').trim();

  if (messageText.length > MAX_SCAM_TEXT_LENGTH) {
    return {
      ok: false,
      kind: 'too-long',
      message:
        'This message is longer than 5,000 characters. Please shorten it and check again.',
    };
  }

  if (trimmedMessage.length === 0) {
    if (screenshotName) {
      if (trimmedOcr.length === 0) {
        return {
          ok: false,
          kind: 'unreadable-screenshot',
          message: UNREADABLE_SCREENSHOT_MESSAGE,
        };
      }
      if (trimmedOcr.length > MAX_SCAM_TEXT_LENGTH) {
        return {
          ok: false,
          kind: 'too-long',
          message:
            'The words in this screenshot are longer than 5,000 characters. Please crop the screenshot or paste the key part above.',
        };
      }
      return { ok: true, verdict: checkText(trimmedOcr) };
    }

    return {
      ok: false,
      kind: 'empty',
      message:
        'Please paste a message or pick a screenshot first so we can check it.',
    };
  }

  const combinedText =
    trimmedOcr.length > 0 ? `${messageText}\n${trimmedOcr}` : messageText;
  return { ok: true, verdict: checkText(combinedText) };
}

export function readPreloadedScamText(search?: string): string {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!raw || raw.trim().length === 0) return '';
  try {
    const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    return params.get('text') ?? '';
  } catch {
    return '';
  }
}

export type ScamShieldPageProps = {
  initialSettings?: Settings;
  initialText?: string;
  initialQuery?: string;
  initialScreenshotName?: string;
  initialScreenshotOcrText?: string;
  initialVerdict?: ScamCheckOutput;
  initialCheckedBy?: 'ai' | 'device';
  initialError?: string;
  extractScreenshotText?: (file: File) => Promise<string>;
  fetchFn?: typeof fetch;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function ScamShieldPage({
  initialSettings,
  initialText,
  initialQuery,
  initialScreenshotName,
  initialScreenshotOcrText = '',
  initialVerdict,
  initialCheckedBy,
  initialError,
  extractScreenshotText,
  fetchFn,
  vault,
  onNavigate,
}: ScamShieldPageProps) {
  const resolvedInitialText =
    initialText !== undefined
      ? initialText
      : readPreloadedScamText(initialQuery);

  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [messageText, setMessageText] = useState<string>(resolvedInitialText);
  const [screenshotName, setScreenshotName] = useState<string | undefined>(
    initialScreenshotName
  );
  const [screenshotBase64, setScreenshotBase64] = useState<string | undefined>(
    undefined
  );
  const [screenshotMime, setScreenshotMime] = useState<string | undefined>(
    undefined
  );
  const [screenshotOcrText, setScreenshotOcrText] = useState<string>(
    initialScreenshotOcrText
  );
  const [verdict, setVerdict] = useState<ScamCheckOutput | undefined>(() => {
    if (initialVerdict) return initialVerdict;
    if (
      resolvedInitialText.trim().length > 0 ||
      initialScreenshotOcrText.trim().length > 0
    ) {
      const evaluated = evaluateScamCheckInput({
        messageText: resolvedInitialText,
        screenshotName: initialScreenshotName,
        screenshotOcrText: initialScreenshotOcrText,
      });
      return evaluated.ok ? evaluated.verdict : undefined;
    }
    return undefined;
  });
  const [checkedBy, setCheckedBy] = useState<'ai' | 'device' | undefined>(() => {
    if (initialCheckedBy) return initialCheckedBy;
    if (
      initialVerdict ||
      resolvedInitialText.trim().length > 0 ||
      initialScreenshotOcrText.trim().length > 0
    ) {
      return 'device';
    }
    return undefined;
  });
  const [checking, setChecking] = useState<boolean>(false);
  const [checkNotice, setCheckNotice] = useState<string | undefined>(undefined);
  const [checkError, setCheckError] = useState<string | undefined>(
    initialError
  );
  const [codeWordInput, setCodeWordInput] = useState<string>(
    initialSettings?.familyCodeWord ?? ''
  );
  const [codeWordError, setCodeWordError] = useState<string | undefined>(
    undefined
  );
  const [codeWordSaved, setCodeWordSaved] = useState<boolean>(false);
  const [askFamilyConfirmOpen, setAskFamilyConfirmOpen] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadSettings = useCallback(async () => {
    if (!resolvedVault) return;
    const res = await resolvedVault.getSettings();
    if (res.ok) {
      setSettings(res.value);
      setCodeWordInput(res.value.familyCodeWord ?? '');
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined) {
      void loadSettings();
    }
  }, [initialSettings, loadSettings]);

  useEffect(() => {
    if (initialText !== undefined) return;
    const preloaded = readPreloadedScamText(initialQuery);
    if (preloaded.length > 0) {
      setMessageText(preloaded);
      const evaluated = evaluateScamCheckInput({
        messageText: preloaded,
        screenshotName,
        screenshotOcrText,
      });
      if (evaluated.ok) {
        setVerdict(evaluated.verdict);
        setCheckedBy('device');
      }
    }
  }, [initialText, initialQuery, screenshotName, screenshotOcrText]);

  const handleBack = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const handleTurnOnAiScanning = async () => {
    let baseSettings = settings;
    if (resolvedVault) {
      const latestRes = await resolvedVault.getSettings();
      if (latestRes.ok) {
        baseSettings = latestRes.value;
      }
    }
    const nextSettings: Settings = {
      ...baseSettings,
      allowAiReading: true,
    };
    if (resolvedVault) {
      const saveRes = await resolvedVault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        setCheckError(saveRes.error.message);
        setStatusMessage(saveRes.error.message);
        return;
      }
    }
    setSettings(nextSettings);
    setCheckError(undefined);
    setStatusMessage(
      'AI scanning is now ON. Tap "Is This Safe?" to check messages or screenshots with AI Helper.'
    );
  };

  const handleRunCheck = async () => {
    setCheckError(undefined);
    setCheckNotice(undefined);

    const canScanScreenshotWithAi =
      settings.allowAiReading &&
      Boolean(screenshotBase64 && screenshotMime);

    if (messageText.length > MAX_SCAM_TEXT_LENGTH) {
      const tooLongMsg =
        'This message is longer than 5,000 characters. Please shorten it and check again.';
      setVerdict(undefined);
      setCheckedBy(undefined);
      setCheckError(tooLongMsg);
      setStatusMessage(tooLongMsg);
      return;
    }

    if (!canScanScreenshotWithAi) {
      const evaluated = evaluateScamCheckInput({
        messageText,
        screenshotName,
        screenshotOcrText,
      });
      if (!evaluated.ok) {
        setVerdict(undefined);
        setCheckedBy(undefined);
        setCheckError(evaluated.message);
        setStatusMessage(evaluated.message);
        return;
      }
    }

    const trimmedMessage = messageText.trim();
    const trimmedOcr = screenshotOcrText.trim();
    const textToCheck =
      trimmedMessage.length === 0
        ? trimmedOcr
        : trimmedOcr.length > 0
          ? `${messageText}\n${trimmedOcr}`
          : messageText;

    if (settings.allowAiReading) {
      setChecking(true);
      setStatusMessage('Checking with AI Helper...');
    }

    try {
      const aiRes = await checkMessageWithAi({
        text: textToCheck,
        ...(canScanScreenshotWithAi && screenshotBase64 && screenshotMime
          ? { imageBase64: screenshotBase64, imageMime: screenshotMime }
          : {}),
        settings,
        vault: resolvedVault,
        fetchFn,
      });

      if (!aiRes.ok) {
        setVerdict(undefined);
        setCheckedBy(undefined);
        setCheckError(aiRes.message);
        setStatusMessage(aiRes.message);
        return;
      }

      const result = aiRes.verdict;
      setVerdict(result);
      setCheckedBy(aiRes.checkedBy);
      setCheckNotice(aiRes.notice);
      setAskFamilyConfirmOpen(false);
      setStatusMessage(
        result.value === 'danger'
          ? 'Check finished: Likely scam. Do not click or pay.'
          : result.value === 'caution'
            ? 'Check finished: Be careful and verify first.'
            : 'Check finished: No warning signs were found.'
      );
    } finally {
      setChecking(false);
    }
  };

  const handleScreenshotChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCheckError(undefined);

    if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
      setScreenshotName(undefined);
      setScreenshotBase64(undefined);
      setScreenshotMime(undefined);
      setScreenshotOcrText('');
      setCheckError(
        'Please choose a JPEG, PNG, or WebP screenshot up to 10 MB. Your message text is still here.'
      );
      setStatusMessage('Unsupported screenshot file.');
      return;
    }

    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotName(undefined);
      setScreenshotBase64(undefined);
      setScreenshotMime(undefined);
      setScreenshotOcrText('');
      setCheckError(
        'That screenshot is larger than 10 MB. Please choose a smaller JPEG, PNG, or WebP screenshot.'
      );
      setStatusMessage('Screenshot is larger than 10 MB.');
      return;
    }

    if (file.size === 0) {
      setScreenshotName(undefined);
      setScreenshotBase64(undefined);
      setScreenshotMime(undefined);
      setScreenshotOcrText('');
      setCheckError(
        'We could not read that screenshot. Please retake the screenshot or paste the message text.'
      );
      setStatusMessage('Screenshot could not be read.');
      return;
    }

    setScreenshotName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoded = encodeScreenshotBytesToBase64(bytes);
      setScreenshotBase64(encoded || undefined);
      setScreenshotMime(encoded ? file.type : undefined);
    } catch {
      setScreenshotBase64(undefined);
      setScreenshotMime(undefined);
    }

    if (extractScreenshotText) {
      try {
        const extracted = await extractScreenshotText(file);
        setScreenshotOcrText(extracted);
      } catch {
        setScreenshotOcrText('');
      }
    } else {
      setScreenshotOcrText('');
    }
    setStatusMessage(
      `Screenshot "${file.name}" is ready. Tap "Is This Safe?" to check.`
    );
  };

  const handleSaveCodeWord = async (event: React.FormEvent) => {
    event.preventDefault();
    setCodeWordError(undefined);
    setCodeWordSaved(false);

    const validated = validateCodeWord(codeWordInput);
    if (!validated.ok) {
      const msg =
        validated.error === 'empty'
          ? 'Please enter a family code word before saving.'
          : 'Please keep your family code word to 50 characters or fewer.';
      setCodeWordError(msg);
      setStatusMessage(msg);
      return;
    }

    if (!resolvedVault) {
      setSettings((prev) => ({ ...prev, familyCodeWord: validated.value }));
      setCodeWordSaved(true);
      setStatusMessage('Your family secret code word was saved.');
      return;
    }

    const res = await saveFamilyCodeWord(
      resolvedVault,
      settings,
      validated.value
    );
    if (!res.ok) {
      setCodeWordError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    setSettings(res.value);
    setCodeWordSaved(true);
    setStatusMessage('Your family secret code word was saved.');
  };

  const handleToggleChecklist = async (stepId: string) => {
    const nextDone = !settings.checklist[stepId];
    if (!resolvedVault) {
      const nextChecklist = { ...settings.checklist, [stepId]: nextDone };
      setSettings((prev) => ({ ...prev, checklist: nextChecklist }));
      setStatusMessage(formatChecklistProgress(nextChecklist));
      return;
    }

    const res = await toggleChecklistStep(
      resolvedVault,
      settings,
      stepId,
      nextDone
    );
    if (!res.ok) {
      setSettings(res.error.settings);
      setStatusMessage(res.error.message);
      return;
    }

    setSettings(res.value.settings);
    setStatusMessage(res.value.progressText);
  };

  const handleConfirmAskFamily = async () => {
    const actionId = 'scam-shield-ask-family';
    const confirmation = confirmFromTap(actionId);
    const recipient = settings.familyMembers[0]?.name ?? 'Trusted Family';
    const auditVault = resolvedVault ?? {
      appendAudit: async () => ({ ok: true as const, value: undefined }),
    };

    const shareRes = await shareItemWithFamily({
      item: {
        id: 'scam-check-current',
        source: screenshotName && messageText.trim().length === 0 ? 'photos' : 'smsPaste',
        text: messageText.trim().length > 0 ? messageText : screenshotOcrText,
        attachments: [],
        receivedAt: new Date().toISOString(),
        group: 'Others',
        priority: 'Important',
        tier: 3,
        confidence: 0.9,
        status: 'ok',
      },
      recipient,
      settings,
      confirmation,
      actionId,
      vault: auditVault,
      sendTransport: async () => ({ ok: true, value: undefined }),
    });

    if (!shareRes.ok) {
      setStatusMessage(shareRes.error.message);
      return;
    }

    setAskFamilyConfirmOpen(false);
    setStatusMessage(`Shared this safety check summary with ${recipient}.`);
  };

  const checklistProgress = formatChecklistProgress(settings.checklist);
  const canShareWithFamily = canShowAskFamily(settings);

  return (
    <div className="space-y-7 pb-6">
      <BackToHome onClick={handleBack} />

      <section className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          Scam Shield
        </h1>
        <p className="text-[18px] leading-relaxed text-muted">
          Paste a suspicious message or choose a screenshot to check for scam
          warning signs before you click or pay.
        </p>
      </section>

      <StatusLive message={statusMessage} />

      {/* Message & Screenshot Checker */}
      <section
        aria-labelledby="scam-check-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-5"
      >
        <h2
          id="scam-check-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Check a Message or Screenshot
        </h2>

        <div className="space-y-2">
          <label
            htmlFor="scam-message-input"
            className="block text-[18px] font-semibold text-ink"
          >
            Paste the message here (up to 5,000 characters)
          </label>
          <textarea
            id="scam-message-input"
            rows={5}
            maxLength={MAX_SCAM_TEXT_LENGTH}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Paste the text message, WhatsApp note, or email here..."
            className="w-full rounded-chip border-2 border-line bg-canvas p-4 text-[18px] text-ink focus:border-brand"
          />
        </div>

        <div className="rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-4 space-y-3">
          <label
            htmlFor="scam-screenshot-input"
            className="pressable inline-flex min-h-[56px] cursor-pointer items-center gap-3 rounded-full border-2 border-brand-soft bg-brand-wash px-5 py-3 text-[18px] font-semibold text-brand-deep shadow-pill transition-colors hover:border-brand"
          >
            <span aria-hidden="true" className="inline-flex shrink-0 text-brand">
              <Upload size={20} />
            </span>
            <span>Choose Screenshot (JPEG, PNG, or WebP, up to 10 MB)</span>
          </label>
          <input
            id="scam-screenshot-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void handleScreenshotChange(e)}
            className="sr-only"
          />
          {screenshotName ? (
            <p className="text-[18px] font-medium text-brand-deep">
              Selected screenshot: {screenshotName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4">
          <SeniorButton
            variant="primary"
            icon={<ShieldAlert size={22} />}
            onClick={() => void handleRunCheck()}
            disabled={checking}
          >
            {checking ? 'Checking with AI Helper...' : 'Is This Safe?'}
          </SeniorButton>
        </div>

        {!settings.allowAiReading ? (
          <div className="rounded-card border border-line bg-canvas p-4 space-y-3">
            <p className="text-[18px] leading-relaxed text-muted">
              Right now, messages are checked using built-in safety rules on
              this device. Turn on AI scanning to let AI Helper read screenshots
              and spot subtle scams. Every check is recorded in My Data, and you
              can turn it off anytime.
            </p>
            <SeniorButton
              variant="secondary"
              icon={<Sparkles size={20} />}
              onClick={() => void handleTurnOnAiScanning()}
            >
              Turn On AI Scanning
            </SeniorButton>
          </div>
        ) : null}

        {checkError ? (
          <div
            role="alert"
            className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 shadow-card space-y-3"
          >
            <p className="flex items-start gap-2 text-[18px] font-semibold text-[#881337]">
              <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                <AlertTriangle size={22} />
              </span>
              <span>{checkError}</span>
            </p>
            <SeniorButton
              variant="warn"
              icon={<RefreshCw size={20} />}
              onClick={() => void handleRunCheck()}
            >
              Try Again
            </SeniorButton>
          </div>
        ) : null}

        {verdict ? (
          <div className="space-y-4">
            {checkedBy ? (
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-badge="true"
                  className={
                    checkedBy === 'ai'
                      ? 'inline-flex items-center gap-2 rounded-full border-2 border-brand bg-brand-wash px-3.5 py-1.5 text-[16px] font-bold text-brand-deep shadow-pill'
                      : 'inline-flex items-center gap-2 rounded-full border-2 border-line bg-canvas px-3.5 py-1.5 text-[16px] font-bold text-ink shadow-pill'
                  }
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex shrink-0 text-brand"
                  >
                    {checkedBy === 'ai' ? (
                      <Sparkles size={18} />
                    ) : (
                      <ShieldCheck size={18} />
                    )}
                  </span>
                  <span>
                    {checkedBy === 'ai'
                      ? 'Checked with AI Helper'
                      : 'Checked on This Device'}
                  </span>
                </span>
                {checkNotice ? (
                  <span className="text-[16px] font-medium text-muted">
                    {checkNotice}
                  </span>
                ) : null}
              </div>
            ) : null}

            <TrafficLightCard
              verdict={verdict}
              showAskFamily={verdict.showAskFamily && canShareWithFamily}
              onAskFamily={
                verdict.showAskFamily && canShareWithFamily
                  ? () => setAskFamilyConfirmOpen(true)
                  : undefined
              }
            />

            {askFamilyConfirmOpen ? (
              <div
                role="region"
                aria-label="Confirm sharing with family"
                className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 shadow-card space-y-3"
              >
                <p className="text-[20px] font-semibold text-ink">
                  Send a short summary of this message to your trusted family
                  member to double-check? Your family code word will never be
                  included.
                </p>
                <div className="flex flex-wrap gap-4">
                  <SeniorButton
                    variant="primary"
                    icon={<Check size={20} />}
                    onClick={() => void handleConfirmAskFamily()}
                  >
                    Confirm Share with Family
                  </SeniorButton>
                  <SeniorButton
                    variant="secondary"
                    onClick={() => setAskFamilyConfirmOpen(false)}
                  >
                    Cancel
                  </SeniorButton>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 4 Safety Habits displayed together */}
      <section aria-labelledby="habits-heading" className="space-y-4">
        <h2 id="habits-heading" className="text-[22px] font-bold tracking-tight text-ink">
          4 Safety Habits
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SAFETY_HABITS.map((habit) => (
            <article
              key={habit.id}
              data-card="true"
              className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-3"
            >
              <h3 className="flex items-center gap-3 text-[20px] font-bold text-ink">
                <span
                  aria-hidden="true"
                  className="inline-flex h-10 w-10 rounded-full bg-brand-wash text-brand shrink-0 items-center justify-center"
                >
                  <ShieldCheck size={22} />
                </span>
                <span>{habit.title}</span>
              </h3>
              <p className="text-[18px] leading-snug text-muted">
                {habit.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Family Secret Code Word */}
      <section
        aria-labelledby="codeword-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
      >
        <h2
          id="codeword-heading"
          className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <KeyRound size={22} />
          </span>
          <span>Family Secret Code Word</span>
        </h2>
        <p className="text-[18px] leading-relaxed text-muted">
          Agree on a secret word with your family. If someone calls asking for
          urgent money, ask them for this word first.
        </p>

        <form onSubmit={(e) => void handleSaveCodeWord(e)} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="family-codeword-input"
              className="block text-[18px] font-semibold text-ink"
            >
              Your Secret Code Word (1 to 50 characters)
            </label>
            <input
              id="family-codeword-input"
              type="text"
              maxLength={50}
              value={codeWordInput}
              onChange={(e) => setCodeWordInput(e.target.value)}
              placeholder="For example: Mango Tree"
              className="w-full min-h-[56px] rounded-chip border-2 border-line bg-canvas px-4 py-3 text-[18px] text-ink focus:border-brand"
            />
          </div>

          {codeWordError ? (
            <p role="alert" className="text-[18px] font-semibold text-[#881337]">
              {codeWordError}
            </p>
          ) : null}

          {codeWordSaved ? (
            <p role="status" className="text-[18px] font-semibold text-[#14532D]">
              Saved on this device. Your code word is never sent outside this
              device.
            </p>
          ) : null}

          <SeniorButton type="submit" variant="primary" icon={<Check size={20} />}>
            Save Family Code Word
          </SeniorButton>
        </form>
      </section>

      {/* Safe Phone Checklist */}
      <section
        aria-labelledby="checklist-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="checklist-heading"
            className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
            >
              <PhoneCall size={22} />
            </span>
            <span>Safe Phone Checklist</span>
          </h2>
          <span
            data-badge="true"
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-soft bg-brand-wash px-3.5 py-1.5 text-[16px] font-bold text-brand-deep shadow-pill tnum"
          >
            <span aria-hidden="true" className="inline-flex shrink-0 text-brand">
              <Check size={18} />
            </span>
            <span>{checklistProgress}</span>
          </span>
        </div>

        <ul className="space-y-4">
          {SAFE_PHONE_CHECKLIST_STEPS.map((step) => {
            const done = settings.checklist[step.id] === true;
            return (
              <li
                key={step.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-chip border border-line bg-canvas p-4"
              >
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <p className="text-[20px] font-bold text-ink">
                    {step.title}
                  </p>
                  <p className="text-[18px] text-muted">
                    {step.description}
                  </p>
                </div>
                <SeniorButton
                  variant={done ? 'safe' : 'secondary'}
                  aria-pressed={done}
                  icon={<Check size={20} />}
                  onClick={() => void handleToggleChecklist(step.id)}
                >
                  {done ? 'Completed' : 'Mark Done'}
                </SeniorButton>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default ScamShieldPage;
