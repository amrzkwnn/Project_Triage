'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Eye,
  HelpCircle,
  ScanEye,
  ShieldAlert,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { canShowAskFamily, shareItemWithFamily } from '@/lib/actions/sharing';
import { inspectProvenance } from '@/lib/media/provenance';
import {
  EYE_CHECK_SPOTS,
  VOICE_CLONE_SAFETY_NOTE,
  mediaResult,
  type MediaCheckOutcome,
} from '@/lib/media/result';
import { createDefaultSettings, type Settings } from '@/lib/types';
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
  initialQuery?: string;
  initialOutcome?: MediaCheckOutcome;
  initialError?: string;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function AiMediaCheckPage({
  initialSettings,
  initialImageName,
  initialImageDataBase64,
  initialQuery,
  initialOutcome,
  initialError,
  vault,
  onNavigate,
}: AiMediaCheckPageProps) {
  const resolvedInitialImageName =
    initialImageName ?? readPreloadedMediaImageName(initialQuery);

  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [selectedFileName, setSelectedFileName] = useState<string | undefined>(
    resolvedInitialImageName
  );
  const [outcome, setOutcome] = useState<MediaCheckOutcome | undefined>(
    initialOutcome
  );
  const [uploadError, setUploadError] = useState<string | undefined>(
    initialError
  );
  const [confirmShareOpen, setConfirmShareOpen] = useState<boolean>(false);
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
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined) {
      void loadSettings();
    }
  }, [initialSettings, loadSettings]);

  useEffect(() => {
    const preloadedName =
      initialImageName ?? readPreloadedMediaImageName(initialQuery);
    if (!preloadedName) return;

    setSelectedFileName(preloadedName);
    if (initialOutcome) return;

    let base64 = initialImageDataBase64;
    if (!base64 && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(FORWARDED_MEDIA_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            name?: string;
            dataBase64?: string;
          };
          if (parsed.name === preloadedName && parsed.dataBase64) {
            base64 = parsed.dataBase64;
          }
        }
      } catch {
        // ignore storage errors
      }
    }

    if (base64) {
      const bytes = base64ToUint8Array(base64);
      if (bytes && bytes.length > 0) {
        void (async () => {
          const provenance = await inspectProvenance(bytes);
          const result = mediaResult(provenance);
          setOutcome(result);
          setStatusMessage(`Check finished: ${result.result}.`);
        })();
      }
    }
  }, [initialImageName, initialImageDataBase64, initialQuery, initialOutcome]);

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
    const provenance = await inspectProvenance(bytes);
    const result = mediaResult(provenance);
    setOutcome(result);
    setStatusMessage(`Check finished: ${result.result}.`);
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
    <div className="space-y-8">
      <BackToHome onClick={handleBack} />

      <section className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight text-[#111827]">
          AI Media Check
        </h1>
        <p className="text-[20px] leading-relaxed text-[#111827]">
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
        className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-5"
      >
        <h2
          id="media-upload-heading"
          className="flex items-center gap-2 text-[24px] font-bold text-[#111827]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <ScanEye size={24} />
          </span>
          <span>Check a Photo</span>
        </h2>

        <div className="space-y-2">
          <label
            htmlFor="media-check-file-input"
            className="inline-flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] px-5 py-3 text-[18px] font-semibold text-[#115E59]"
          >
            <span aria-hidden="true" className="inline-flex shrink-0">
              <Upload size={22} />
            </span>
            <span>Choose a Photo (JPEG, PNG, or WebP, up to 10 MB)</span>
          </label>
          <input
            id="media-check-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void handleFileSelected(e)}
            className="sr-only"
          />
          {selectedFileName ? (
            <p className="text-[18px] font-semibold text-[#111827]">
              Checked photo: {selectedFileName}
            </p>
          ) : null}
        </div>

        {uploadError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border-2 border-[#BE123C] bg-[#FFF1F2] p-4 text-[18px] font-semibold text-[#881337]"
          >
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{uploadError}</span>
          </div>
        ) : null}

        {outcome ? (
          <div className="rounded-xl border-2 border-[#111827] bg-[#FAF9F6] p-4 space-y-3">
            <div>{renderOutcomeBadge(outcome)}</div>
            {outcome.signalName ? (
              <p className="text-[18px] font-semibold text-[#111827]">
                Detail found: {outcome.signalName}
              </p>
            ) : null}
            <p className="text-[20px] leading-relaxed text-[#111827]">
              {outcome.note}
            </p>
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
            <div className="rounded-xl border-2 border-[#D97706] bg-[#FFFBEB] p-4 space-y-3">
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
              className="rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4 space-y-3"
            >
              <p className="text-[20px] font-semibold text-[#111827]">
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
          className="flex items-center gap-2 text-[24px] font-bold text-[#111827]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Eye size={24} />
          </span>
          <span>4-Spot Eye Check Guide</span>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {EYE_CHECK_SPOTS.map((spot) => (
            <article
              key={spot.id}
              data-card="true"
              className="rounded-2xl border-2 border-[#0F766E] bg-white p-4 space-y-2"
            >
              <h3 className="text-[20px] font-bold text-[#115E59]">
                {spot.title}
              </h3>
              <p className="text-[18px] leading-snug text-[#111827]">
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
        className="rounded-2xl border-2 border-[#D97706] bg-[#FFFBEB] p-5 space-y-3"
      >
        <h2
          id="voice-clone-heading"
          className="flex items-center gap-2 text-[24px] font-bold text-[#92400E]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Volume2 size={24} />
          </span>
          <span>Voice Clone Safety</span>
        </h2>
        <p className="text-[20px] leading-relaxed text-[#111827]">
          {VOICE_CLONE_SAFETY_NOTE}
        </p>
      </section>
    </div>
  );
}

export default AiMediaCheckPage;
