'use client';

import React from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Eye,
  HelpCircle,
  ScanEye,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { canShowAskFamily, shareItemWithFamily } from '@/lib/actions/sharing';
import { checkMediaWithAi } from '@/lib/media/aiMediaClient';
import {
  EYE_CHECK_SPOTS,
  VOICE_CLONE_SAFETY_NOTE,
  type MediaCheckOutcome,
} from '@/lib/media/result';
import {
  createDefaultSettings,
  type Settings,
  type Verdict,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const SUPPORTED_MEDIA_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const FORWARDED_MEDIA_STORAGE_KEY = 'sdc_forwarded_media_image';

export function readPreloadedMediaImageName(search?: string): string | undefined {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    const name = params.get('image')?.trim();
    return name && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function base64ToUint8Array(base64: string): Uint8Array | undefined {
  try {
    if (typeof atob !== 'function') return undefined;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

export type AiMediaCheckPageProps = {
  initialSettings?: Settings;
  initialImageName?: string;
  initialImageDataBase64?: string;
  initialImageMime?: string;
  initialQuery?: string;
  initialOutcome?: MediaCheckOutcome;
  initialCheckedBy?: 'ai' | 'device';
  initialScamWarning?: Verdict;
  initialError?: string;
  fetchFn?: typeof fetch;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function AiMediaCheckPage({
  initialSettings,
  initialImageName,
  initialImageDataBase64,
  initialImageMime,
  initialQuery,
  initialOutcome,
  initialCheckedBy,
  initialScamWarning,
  initialError,
  fetchFn,
  vault,
  onNavigate,
}: AiMediaCheckPageProps) {
  const resolvedInitialImageName =
    initialImageName ?? readPreloadedMediaImageName(initialQuery);

  const [settings, setSettings] = React.useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [selectedFileName, setSelectedFileName] = React.useState<
    string | undefined
  >(resolvedInitialImageName);
  const [outcome, setOutcome] = React.useState<MediaCheckOutcome | undefined>(
    initialOutcome
  );
  const [checkedBy, setCheckedBy] = React.useState<
    'ai' | 'device' | undefined
  >(initialCheckedBy ?? (initialOutcome ? 'device' : undefined));
  const [scamWarning, setScamWarning] = React.useState<Verdict | undefined>(
    initialScamWarning
  );
  const [checking, setChecking] = React.useState<boolean>(false);
  const [checkNotice, setCheckNotice] = React.useState<string | undefined>(
    undefined
  );
  const [uploadError, setUploadError] = React.useState<string | undefined>(
    initialError
  );
  const [confirmShareOpen, setConfirmShareOpen] = React.useState<boolean>(false);
  const [statusMessage, setStatusMessage] = React.useState<string>('');
  const [settingsLoaded, setSettingsLoaded] = React.useState<boolean>(
    initialSettings !== undefined
  );
  const settingsRef = React.useRef<Settings>(settings);
  settingsRef.current = settings;
  const preloadedCheckedKeyRef = React.useRef<string | undefined>(undefined);

  const resolvedVault = React.useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadSettings = React.useCallback(async () => {
    try {
      if (!resolvedVault) return;
      const res = await resolvedVault.getSettings();
      if (res.ok) {
        settingsRef.current = res.value;
        setSettings(res.value);
      }
    } finally {
      setSettingsLoaded(true);
    }
  }, [resolvedVault]);

  React.useEffect(() => {
    if (initialSettings === undefined) {
      void loadSettings();
    } else {
      setSettingsLoaded(true);
    }
  }, [initialSettings, loadSettings]);

  const runPhotoCheck = React.useCallback(
    async (
      bytes: Uint8Array,
      mimeType: string,
      fileName: string,
      activeSettings: Settings
    ) => {
      setUploadError(undefined);
      setCheckNotice(undefined);
      setScamWarning(undefined);
      setChecking(true);
      setStatusMessage('Checking Photo...');
      try {
        const res = await checkMediaWithAi({
          bytes,
          mimeType,
          fileName,
          settings: activeSettings,
          vault: resolvedVault,
          fetchFn,
        });
        if (!res.ok) {
          setOutcome(undefined);
          setCheckedBy(undefined);
          setUploadError(res.message);
          setStatusMessage(res.message);
          return;
        }
        setOutcome(res.outcome);
        setCheckedBy(res.checkedBy);
        setScamWarning(res.scamWarning);
        setCheckNotice(res.notice);
        setStatusMessage(`Check finished: ${res.outcome.result}.`);
      } finally {
        setChecking(false);
      }
    },
    [resolvedVault, fetchFn]
  );

  React.useEffect(() => {
    if (!settingsLoaded) return;
    const preloadedName =
      initialImageName ?? readPreloadedMediaImageName(initialQuery);
    if (!preloadedName) return;

    const preloadKey = `${preloadedName}:${initialImageDataBase64 ?? ''}:${initialImageMime ?? ''}:${initialQuery ?? ''}`;
    if (preloadedCheckedKeyRef.current === preloadKey) {
      return;
    }
    preloadedCheckedKeyRef.current = preloadKey;

    setSelectedFileName(preloadedName);
    if (initialOutcome) return;

    let base64 = initialImageDataBase64;
    let mimeType = initialImageMime ?? 'image/jpeg';
    if (!base64 && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(FORWARDED_MEDIA_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            name?: string;
            mime?: string;
            dataBase64?: string;
          };
          if (parsed.name === preloadedName && parsed.dataBase64) {
            base64 = parsed.dataBase64;
            if (parsed.mime && SUPPORTED_MEDIA_MIMES.has(parsed.mime)) {
              mimeType = parsed.mime;
            }
          }
        }
      } catch {
        // ignore storage errors
      }
    }

    if (base64) {
      const bytes = base64ToUint8Array(base64);
      if (bytes && bytes.length > 0) {
        void runPhotoCheck(bytes, mimeType, preloadedName, settingsRef.current);
      }
    }
  }, [
    settingsLoaded,
    initialImageName,
    initialImageDataBase64,
    initialImageMime,
    initialQuery,
    initialOutcome,
    runPhotoCheck,
  ]);

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
        setUploadError(saveRes.error.message);
        setStatusMessage(saveRes.error.message);
        return;
      }
    }
    setSettings(nextSettings);
    setUploadError(undefined);
    setStatusMessage(
      'AI scanning is now ON. Choose a photo to check it with AI Helper.'
    );
  };

  const handleBack = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(undefined);
    setOutcome(undefined);
    setScamWarning(undefined);
    setCheckNotice(undefined);
    setConfirmShareOpen(false);

    if (!SUPPORTED_MEDIA_MIMES.has(file.type) || file.size > MAX_MEDIA_BYTES) {
      const msg =
        'Please choose a JPEG, PNG, or WebP photo that is 10 MB or smaller.';
      setUploadError(msg);
      setStatusMessage(msg);
      return;
    }

    setSelectedFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await runPhotoCheck(bytes, file.type, file.name, settings);
  };

  const handleConfirmAskFamily = async () => {
    const actionId = 'media-check-ask-family';
    const confirmation = confirmFromTap(actionId);
    const recipient = settings.familyMembers[0]?.name ?? 'Trusted Family';
    const auditVault = resolvedVault ?? {
      appendAudit: async () => ({ ok: true as const, value: undefined }),
    };

    const shareRes = await shareItemWithFamily({
      item: {
        id: 'media-check-current',
        source: 'photos',
        text: `${selectedFileName ?? 'Checked photo'}: ${outcome?.result ?? 'Please check this photo'}`,
        attachments: [],
        receivedAt: new Date().toISOString(),
        group: 'Others',
        priority: 'Important',
        tier: 3,
        confidence: 0.7,
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

    setConfirmShareOpen(false);
    setStatusMessage(`Shared photo check summary with ${recipient}.`);
  };

  const renderOutcomeBadge = (res: MediaCheckOutcome) => {
    if (res.result === 'AI signal found') {
      return (
        <span
          data-badge="true"
          className="inline-flex items-center gap-2 rounded-xl border-2 border-[#BE123C] bg-[#FFF1F2] px-4 py-2 text-[20px] font-bold text-[#881337]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <ShieldAlert size={24} />
          </span>
          <span>AI signal found</span>
        </span>
      );
    }

    if (res.result === 'Camera signal found') {
      return (
        <span
          data-badge="true"
          className="inline-flex items-center gap-2 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] px-4 py-2 text-[20px] font-bold text-[#115E59]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Camera size={24} />
          </span>
          <span>Camera signal found</span>
        </span>
      );
    }

    return (
      <span
        data-badge="true"
        className="inline-flex items-center gap-2 rounded-xl border-2 border-[#D97706] bg-[#FFFBEB] px-4 py-2 text-[20px] font-bold text-[#92400E]"
      >
        <span aria-hidden="true" className="inline-flex shrink-0">
          <HelpCircle size={24} />
        </span>
        <span>Cannot tell</span>
      </span>
    );
  };

  const canShare = canShowAskFamily(settings);

  return (
    <div className="space-y-7 pb-6">
      <BackToHome onClick={handleBack} />

      <section className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          AI Media Check
        </h1>
        <p className="text-[18px] leading-relaxed text-muted">
          Check a photo for AI signs and use the simple 4-spot eye guide below.
          No tool can guarantee a photo is authentic, so always pause if a photo
          asks you to send money.
        </p>
      </section>

      <StatusLive message={statusMessage} />

      {/* Photo Upload & Result */}
      <section
        aria-labelledby="media-upload-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-5"
      >
        <h2
          id="media-upload-heading"
          className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <ScanEye size={22} />
          </span>
          <span>Check a Photo</span>
        </h2>

        <div className="rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-6 text-center space-y-3">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <Upload size={22} />
          </span>
          <div>
            <label
              htmlFor="media-check-file-input"
              className="pressable inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-full border-2 border-brand bg-brand px-5 py-3 text-[18px] font-semibold text-white shadow-pill transition-colors hover:bg-brand-deep"
            >
              <span aria-hidden="true" className="inline-flex shrink-0">
                <Upload size={20} />
              </span>
              <span>Choose a Photo (JPEG, PNG, or WebP, up to 10 MB)</span>
            </label>
          </div>
          <input
            id="media-check-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void handleFileSelected(e)}
            className="sr-only"
          />
          {checking ? (
            <p className="text-[18px] font-semibold text-brand-deep">
              Checking Photo...
            </p>
          ) : selectedFileName ? (
            <p className="text-[18px] font-semibold text-brand-deep">
              Checked photo: {selectedFileName}
            </p>
          ) : null}
        </div>

        {!settings.allowAiReading ? (
          <div className="rounded-card border border-line bg-canvas p-4 space-y-3">
            <p className="text-[18px] leading-relaxed text-muted">
              AI scanning is currently OFF, so photos are checked using file
              details on this device only. Turn on AI scanning to let AI Helper
              look closely at visual clues and scam signs. Every check is
              recorded in My Data, and you can turn it off anytime.
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

        {uploadError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 text-[18px] font-semibold text-[#881337] shadow-card"
          >
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{uploadError}</span>
          </div>
        ) : null}

        {outcome ? (
          <div className="relative overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft/80 via-brand-wash to-white p-4 shadow-card space-y-3">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-soft/50 blur-2xl"
            />
            <div className="relative space-y-3">
              <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-brand-deep">
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <Sparkles size={14} strokeWidth={2.4} />
                </span>
                <span>Check summary</span>
              </p>
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
              <div>{renderOutcomeBadge(outcome)}</div>
              {outcome.signalName ? (
                <p className="text-[18px] font-semibold text-ink">
                  Detail found: {outcome.signalName}
                </p>
              ) : null}
              <p className="text-[20px] leading-relaxed text-ink">
                {outcome.note}
              </p>
              {scamWarning &&
              (scamWarning.value === 'danger' ||
                scamWarning.value === 'caution') ? (
                <div
                  role="alert"
                  className="rounded-card border-2 border-[#BE123C] bg-red-50 p-4 space-y-2"
                >
                  <p className="flex items-center gap-2 text-[18px] font-bold text-[#881337]">
                    <span aria-hidden="true" className="inline-flex shrink-0">
                      <ShieldAlert size={20} />
                    </span>
                    <span>
                      {scamWarning.value === 'danger'
                        ? 'Scam Warning Found in Photo'
                        : 'Be Careful with This Photo'}
                    </span>
                  </p>
                  <ul className="list-disc pl-6 space-y-1 text-[18px] text-[#881337]">
                    {scamWarning.reasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Ask Family to Check (Requirement 9 flow) */}
        <div className="pt-2 space-y-3">
          {canShare ? (
            <SeniorButton
              variant="warn"
              icon={<Users size={22} />}
              onClick={() => setConfirmShareOpen(true)}
            >
              Ask Family to Check
            </SeniorButton>
          ) : (
            <div className="rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-4 shadow-card space-y-3">
              <p className="text-[18px] font-semibold text-[#92400E]">
                Want to ask family to look at this photo? Turn on Family Sharing
                in My Data first.
              </p>
              <SeniorButton
                variant="secondary"
                href="/my-data"
                icon={<Users size={20} />}
                onClick={
                  onNavigate
                    ? (e) => {
                        e.preventDefault();
                        onNavigate('/my-data');
                      }
                    : undefined
                }
              >
                Open My Data to Enable Family Sharing
              </SeniorButton>
            </div>
          )}

          {confirmShareOpen ? (
            <div
              role="region"
              aria-label="Confirm sharing photo check with family"
              className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 shadow-card space-y-3"
            >
              <p className="text-[20px] font-semibold text-ink">
                Send this photo check summary to your trusted family member?
              </p>
              <div className="flex flex-wrap gap-3">
                <SeniorButton
                  variant="primary"
                  icon={<Check size={20} />}
                  onClick={() => void handleConfirmAskFamily()}
                >
                  Confirm Ask Family
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  onClick={() => setConfirmShareOpen(false)}
                >
                  Cancel
                </SeniorButton>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* 4-Spot Eye Check Guide on the same screen */}
      <section aria-labelledby="eye-guide-heading" className="space-y-4">
        <h2
          id="eye-guide-heading"
          className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <Eye size={22} />
          </span>
          <span>4-Spot Eye Check Guide</span>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {EYE_CHECK_SPOTS.map((spot) => (
            <article
              key={spot.id}
              data-card="true"
              className="rounded-card border border-line bg-white p-4 shadow-card anim-fade-up space-y-2"
            >
              <h3 className="text-[20px] font-bold text-brand-deep">
                {spot.title}
              </h3>
              <p className="text-[18px] leading-snug text-ink">
                {spot.tip}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Voice Clone Safety Box */}
      <section
        aria-labelledby="voice-clone-heading"
        data-card="true"
        className="rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-card anim-fade-up space-y-3"
      >
        <h2
          id="voice-clone-heading"
          className="flex items-center gap-3 text-[22px] font-bold text-[#92400E]"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[#92400E]"
          >
            <Volume2 size={22} />
          </span>
          <span>Voice Clone Safety</span>
        </h2>
        <p className="text-[20px] leading-relaxed text-ink">
          {VOICE_CLONE_SAFETY_NOTE}
        </p>
      </section>
    </div>
  );
}

export default AiMediaCheckPage;
