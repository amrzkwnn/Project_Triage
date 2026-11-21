'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { StepWizard } from '@/components/StepWizard';
import { editedName } from '@/lib/photo/filename';
import {
  OLD_PRINT_SCAN_STEPS,
  PHOTO_PRESETS,
  applyPhotoPreset,
  getPresetPreviewFilter,
  type PhotoPreset,
} from '@/lib/photo/presets';
import { createDefaultSettings, type Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { setChannelToggle } from '@/lib/vault/settings';
import { createVault } from '@/lib/vault/store';

function detectImageMime(bytes: Uint8Array, fallback = 'image/jpeg'): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'image/jpeg';
  }
  return fallback;
}

function bytesToDataUrl(bytes: Uint8Array, mime?: string): string {
  const resolvedMime = detectImageMime(bytes, mime || 'image/jpeg');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : '';
  return `data:${resolvedMime};base64,${b64}`;
}

export type PhotoHelperPageProps = {
  initialSettings?: Settings;
  initialPhotoName?: string;
  initialPhotoBytes?: Uint8Array;
  initialEditedBytes?: Uint8Array;
  initialActivePreset?: PhotoPreset;
  initialError?: string;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function PhotoHelperPage({
  initialSettings,
  initialPhotoName,
  initialPhotoBytes,
  initialEditedBytes,
  initialActivePreset,
  initialError,
  vault,
  onNavigate,
}: PhotoHelperPageProps) {
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [photoName, setPhotoName] = useState<string | undefined>(
    initialPhotoName
  );
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | undefined>(
    initialPhotoBytes
  );
  const [editedBytes, setEditedBytes] = useState<Uint8Array | undefined>(
    initialEditedBytes
  );
  const [activePreset, setActivePreset] = useState<PhotoPreset | undefined>(
    initialActivePreset
  );

  const originalPreviewUrl = useMemo(
    () =>
      originalBytes && originalBytes.length > 0
        ? bytesToDataUrl(originalBytes, photoMime)
        : undefined,
    [originalBytes, photoMime]
  );

  const editedPreviewUrl = useMemo(
    () =>
      editedBytes && editedBytes.length > 0
        ? bytesToDataUrl(editedBytes, photoMime)
        : undefined,
    [editedBytes, photoMime]
  );
  const [takenNames, setTakenNames] = useState<string[]>([]);
  const [savedFileName, setSavedFileName] = useState<string | undefined>(
    undefined
  );
  const [photoError, setPhotoError] = useState<string | undefined>(
    initialError
  );
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

  const handleBack = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const handleTurnOnPhotos = async () => {
    if (!resolvedVault) {
      setSettings((prev) => ({
        ...prev,
        channels: { ...prev.channels, photos: true },
      }));
      setStatusMessage('Photo access is now ON.');
      return;
    }

    const res = await setChannelToggle(resolvedVault, settings, 'photos', true);
    if (!res.ok) {
      setPhotoError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    setSettings(res.settings);
    setStatusMessage('Photo access is now ON. You can pick a photo now.');
  };

  const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!settings.channels.photos) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setPhotoError(undefined);
    setSavedFileName(undefined);
    setEditedBytes(undefined);
    setActivePreset(undefined);

    try {
      const buffer = await file.arrayBuffer();
      setOriginalBytes(new Uint8Array(buffer));
      setPhotoName(file.name);
      setPhotoMime(file.type || 'image/jpeg');
      setStatusMessage(
        `Photo "${file.name}" is ready. Pick one of the 4 easy buttons below.`
      );
    } catch {
      setPhotoError(
        'We could not open that photo right now. Please choose another photo or try again.'
      );
      setStatusMessage('Could not open photo.');
    }
  };

  const handleApplyPreset = async (preset: PhotoPreset) => {
    setPhotoError(undefined);
    setSavedFileName(undefined);
    const sourceBytes = originalBytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 120, 140, 160]);
    const res = await applyPhotoPreset(sourceBytes, preset);
    if (!res.ok) {
      setPhotoError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }
    setActivePreset(preset);
    setEditedBytes(res.value.editedBytes);
    setStatusMessage(
      `Preview ready for "${preset}". Your original photo is untouched.`
    );
  };

  const handleSaveCopy = async () => {
    if (!editedBytes) return;
    const original = photoName ?? 'family-photo.jpg';
    const nextFileName = editedName(original, new Set(takenNames));

    if (resolvedVault) {
      const putRes = await resolvedVault.putBlob(nextFileName, editedBytes);
      if (!putRes.ok) {
        setPhotoError(putRes.error.message);
        setStatusMessage(putRes.error.message);
        return;
      }
    }

    setTakenNames((prev) => [...prev, nextFileName]);
    setSavedFileName(nextFileName);
    setStatusMessage(
      `Saved new copy "${nextFileName}". Your original photo was kept safe.`
    );
  };

  const handleDiscard = () => {
    setEditedBytes(undefined);
    setActivePreset(undefined);
    setSavedFileName(undefined);
    setPhotoError(undefined);
    setStatusMessage('Preview discarded. Your original photo is unchanged.');
  };

  const photosAllowed = settings.channels.photos;

  const scanWizardSteps = OLD_PRINT_SCAN_STEPS.map((s) => ({
    id: `scan-step-${s.step}`,
    title: s.title,
    content: <p className="text-[18px] text-ink">{s.instruction}</p>,
  }));

  return (
    <div className="space-y-7 pb-6">
      <BackToHome onClick={handleBack} />

      <section className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          Photo Helper
        </h1>
        <p className="text-[18px] leading-relaxed text-muted">
          Improve family photos with one simple tap. Your original photo is
          always kept unchanged.
        </p>
      </section>

      <StatusLive message={statusMessage} />

      {!photosAllowed ? (
        <section
          aria-labelledby="photo-access-off-heading"
          data-card="true"
          className="rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-card anim-fade-up space-y-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-badge="true"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[#D97706] bg-white px-3.5 py-1.5 text-[16px] font-bold text-[#92400E] shadow-pill"
            >
              <span aria-hidden="true" className="inline-flex shrink-0">
                <Lock size={18} />
              </span>
              <span>Photo Access is OFF</span>
            </span>
          </div>
          <h2
            id="photo-access-off-heading"
            className="text-[22px] font-bold text-ink"
          >
            Turn on Photo access to pick a photo
          </h2>
          <p className="text-[18px] text-ink">
            You are in control. Turn on Photos here or in My Data whenever you
            want to touch up a picture.
          </p>
          <div className="flex flex-wrap gap-4">
            <SeniorButton
              variant="primary"
              icon={<Camera size={20} />}
              onClick={() => void handleTurnOnPhotos()}
            >
              Turn On Photo Access
            </SeniorButton>
            <SeniorButton
              variant="secondary"
              href="/my-data"
              onClick={
                onNavigate
                  ? (e) => {
                      e.preventDefault();
                      onNavigate('/my-data');
                    }
                  : undefined
              }
            >
              Open My Data
            </SeniorButton>
          </div>
        </section>
      ) : (
        <section
          aria-labelledby="photo-editor-heading"
          data-card="true"
          className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-5"
        >
          <h2
            id="photo-editor-heading"
            className="text-[22px] font-bold tracking-tight text-ink"
          >
            Pick a Photo and Choose One Easy Fix
          </h2>

          <div className="rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-5 text-center space-y-3">
            <span
              aria-hidden="true"
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand"
            >
              <ImageIcon size={22} />
            </span>
            <div>
              <label
                htmlFor="photo-helper-file-input"
                className="pressable inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-full border-2 border-brand bg-brand px-5 py-3 text-[18px] font-semibold text-white shadow-pill transition-colors hover:bg-brand-deep"
              >
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <ImageIcon size={20} />
                </span>
                <span>Choose a Photo from Your Device</span>
              </label>
            </div>
            <input
              id="photo-helper-file-input"
              type="file"
              accept="image/*"
              onChange={(e) => void handleFilePick(e)}
              className="sr-only"
            />
            {photoName ? (
              <p className="text-[18px] font-semibold text-brand-deep">
                Selected photo: {photoName}
              </p>
            ) : null}
          </div>

          {/* Exactly 4 preset buttons, zero sliders */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PHOTO_PRESETS.map((preset) => (
              <SeniorButton
                key={preset}
                variant={activePreset === preset ? 'safe' : 'primary'}
                icon={<Sparkles size={20} />}
                onClick={() => void handleApplyPreset(preset)}
              >
                {preset}
              </SeniorButton>
            ))}
          </div>

          {photoError ? (
            <div
              role="alert"
              className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 shadow-card space-y-3"
            >
              <p className="flex items-start gap-2 text-[18px] font-semibold text-[#881337]">
                <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                  <AlertTriangle size={22} />
                </span>
                <span>{photoError}</span>
              </p>
              <div className="flex flex-wrap gap-4">
                <SeniorButton
                  variant="warn"
                  icon={<RefreshCw size={20} />}
                  onClick={() =>
                    void handleApplyPreset(activePreset ?? PHOTO_PRESETS[0])
                  }
                >
                  Try Again
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  icon={<ArrowLeft size={20} />}
                  onClick={handleDiscard}
                >
                  Back
                </SeniorButton>
              </div>
            </div>
          ) : null}

          {/* Before / After Preview */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-canvas p-4 shadow-card space-y-2">
              <p className="text-[20px] font-bold text-ink">Before</p>
              {originalPreviewUrl ? (
                <img
                  src={originalPreviewUrl}
                  alt="Original photo preview"
                  className="max-h-60 w-full rounded-chip border border-line bg-white object-contain"
                />
              ) : null}
              <p className="text-[18px] text-muted">
                {photoName
                  ? `Original photo (${photoName}) stays untouched.`
                  : 'Choose a photo to see your original picture here.'}
              </p>
            </div>
            <div className="rounded-card border border-brand-soft bg-brand-wash/70 p-4 shadow-card space-y-2">
              <p className="text-[20px] font-bold text-brand-deep">After</p>
              {editedPreviewUrl && activePreset ? (
                <img
                  src={editedPreviewUrl}
                  alt="Improved photo preview"
                  style={{ filter: getPresetPreviewFilter(activePreset) }}
                  className="max-h-60 w-full rounded-chip border border-brand-soft bg-white object-contain"
                />
              ) : null}
              <p className="text-[18px] text-ink">
                {activePreset && editedBytes
                  ? `Preview ready with "${activePreset}" (${editedBytes.length} bytes).`
                  : 'Tap one of the 4 buttons above to preview your photo.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <SeniorButton
              variant="safe"
              icon={<Check size={20} />}
              disabled={!editedBytes}
              onClick={() => void handleSaveCopy()}
            >
              Save
            </SeniorButton>
            <SeniorButton
              variant="secondary"
              icon={<Trash2 size={20} />}
              onClick={handleDiscard}
            >
              Discard
            </SeniorButton>
          </div>

          {savedFileName ? (
            <p
              role="status"
              className="rounded-card border-2 border-[#15803D] bg-[#F0FDF4] p-4 text-[18px] font-semibold text-[#14532D] shadow-card"
            >
              Saved new copy as {savedFileName}. Your original photo was not
              changed.
            </p>
          ) : null}
        </section>
      )}

      {/* 3-Step Old Print Scan Tip */}
      <section aria-labelledby="scan-tip-heading" className="space-y-4">
        <h2
          id="scan-tip-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Old Print Scan Tip
        </h2>
        <StepWizard
          steps={scanWizardSteps}
          completeLabel="Got It"
          onComplete={() =>
            setStatusMessage('You finished the 3-step Old Print Scan Tip.')
          }
        />
      </section>
    </div>
  );
}

export default PhotoHelperPage;
