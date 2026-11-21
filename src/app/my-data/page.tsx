'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Mail,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import {
  connectReadOnlyEmailAccount,
  sendSampleEmailToRelay,
  syncEmailsFromRelay,
  type EmailProvider,
} from '@/lib/inbox/emailClient';
import {
  ALL_CHANNELS,
  type AuditEntry,
  type Channel,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import {
  AUDIT_EMPTY_MESSAGE,
  listAuditNewestFirst,
} from '@/lib/vault/audit';
import {
  type AiToggleMachineState,
  CHANNEL_LABELS,
  createAiToggleState,
  stepAiToggle,
} from '@/lib/vault/consent';
import { eraseAllDataAndTokens } from '@/lib/vault/erase';
import { exportDocument } from '@/lib/vault/export';
import type { OAuthTokenRecord, Vault } from '@/lib/vault/schema';
import { setChannelToggle } from '@/lib/vault/settings';
import { createVault } from '@/lib/vault/store';

export type MyDataPageProps = {
  initialSettings?: Settings;
  initialAudit?: AuditEntry[];
  initialAiConfirmOpen?: boolean;
  initialEraseStep?: 0 | 1 | 2;
  initialExportError?: string;
  initialToggleError?: string;
  vault?: Vault;
  revokeToken?: (rec: OAuthTokenRecord, signal: AbortSignal) => Promise<void>;
  onNavigate?: (href: string) => void;
  onSettingsChange?: (next: Settings) => void;
};

const CHANNEL_DESCRIPTIONS: Record<Channel, string> = {
  email: 'Let this helper organize emails you connect or forward.',
  whatsappForward: 'Accept WhatsApp messages you choose to forward here.',
  smsPaste: 'Accept text messages you paste or share here.',
  messengerPaste: 'Accept Messenger notes you paste or share here.',
  photos: 'Let you pick family or prescription photos from your device.',
};

const AI_EXPLANATION_TEXT =
  'When AI Reading is ON, this helper sends only the one message or photo you are checking to our helper service. It reads that one item to write a short summary and spot scam signs, and does not keep it afterwards. You can turn this off at any time.';

export function MyDataPage({
  initialSettings,
  initialAudit,
  initialAiConfirmOpen = false,
  initialEraseStep = 0,
  initialExportError,
  initialToggleError,
  vault,
  revokeToken,
  onNavigate,
  onSettingsChange,
}: MyDataPageProps) {
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [aiState, setAiState] = useState<AiToggleMachineState>(() => ({
    ...createAiToggleState(initialSettings?.allowAiReading ?? false),
    awaitingConfirm: initialAiConfirmOpen,
  }));
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(
    initialAudit ?? []
  );
  const [toggleError, setToggleError] = useState<string | undefined>(
    initialToggleError
  );
  const [exportError, setExportError] = useState<string | undefined>(
    initialExportError
  );
  const [eraseStep, setEraseStep] = useState<0 | 1 | 2>(initialEraseStep);
  const [eraseResultMessage, setEraseResultMessage] = useState<
    string | undefined
  >(undefined);
  const [eraseInstructions, setEraseInstructions] = useState<
    string | undefined
  >(undefined);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [emailProvider, setEmailProvider] = useState<EmailProvider>('Gmail');
  const [connectedAccount, setConnectedAccount] = useState<
    OAuthTokenRecord | undefined
  >(undefined);
  const [emailNotice, setEmailNotice] = useState<string | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState<boolean>(false);

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadData = useCallback(async () => {
    if (!resolvedVault) return;
    const [settingsRes, auditRes, tokensRes] = await Promise.all([
      resolvedVault.getSettings(),
      resolvedVault.listAudit(),
      typeof resolvedVault.listOAuthTokens === 'function'
        ? resolvedVault.listOAuthTokens()
        : Promise.resolve({ ok: true as const, value: [] as OAuthTokenRecord[] }),
    ]);
    if (settingsRes.ok) {
      setSettings(settingsRes.value);
      setAiState(createAiToggleState(settingsRes.value.allowAiReading));
    }
    if (auditRes.ok) {
      setAuditEntries(auditRes.value);
    }
    if (tokensRes.ok && tokensRes.value.length > 0) {
      setConnectedAccount(tokensRes.value[0]);
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined || initialAudit === undefined) {
      void loadData();
    }
  }, [initialSettings, initialAudit, loadData]);

  const orderedAudit = useMemo(
    () => listAuditNewestFirst(auditEntries),
    [auditEntries]
  );

  const handleBackClick = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const handleChannelToggle = async (channel: Channel) => {
    const nextEnabled = !settings.channels[channel];
    setToggleError(undefined);

    if (!resolvedVault) {
      const next: Settings = {
        ...settings,
        channels: { ...settings.channels, [channel]: nextEnabled },
      };
      setSettings(next);
      onSettingsChange?.(next);
      setStatusMessage(
        `${CHANNEL_LABELS[channel]} is now ${nextEnabled ? 'ON' : 'OFF'}.`
      );
      return;
    }

    const res = await setChannelToggle(
      resolvedVault,
      settings,
      channel,
      nextEnabled
    );
    if (!res.ok) {
      setSettings(res.settings);
      setToggleError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    setSettings(res.settings);
    onSettingsChange?.(res.settings);
    setStatusMessage(
      `${CHANNEL_LABELS[channel]} is now ${nextEnabled ? 'ON' : 'OFF'}.`
    );
  };

  const handleConnectEmail = async () => {
    setEmailError(undefined);
    setEmailNotice(undefined);
    const res = await connectReadOnlyEmailAccount({
      vault: resolvedVault,
      settings,
      emailAddress: emailInput,
      provider: emailProvider,
    });
    if (!res.ok) {
      setEmailError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }
    setConnectedAccount(res.record);
    setSettings(res.settings);
    onSettingsChange?.(res.settings);
    setEmailNotice(res.message);
    setStatusMessage(res.message);
  };

  const handleSendTestEmail = async () => {
    setEmailError(undefined);
    setEmailNotice(undefined);
    setIsSendingTestEmail(true);
    try {
      const sendRes = await sendSampleEmailToRelay();
      if (!sendRes.ok) {
        setEmailError(sendRes.errorMessage);
        setStatusMessage(sendRes.errorMessage);
        return;
      }

      if (settings.channels.email && resolvedVault) {
        const pullRes = await syncEmailsFromRelay({
          vault: resolvedVault,
          settings,
        });
        if (pullRes.ok) {
          const msg =
            pullRes.stored.length > 0
              ? 'Test clinic email sent and added to your Unified Inbox.'
              : 'Test clinic email sent and checked in your Unified Inbox.';
          setEmailNotice(msg);
          setStatusMessage(msg);
          return;
        }
      }

      const queuedMsg = settings.channels.email
        ? 'Test clinic email is ready. Open your Unified Inbox to read it.'
        : 'Test clinic email is waiting. Turn Email ON above to read it in your Unified Inbox.';
      setEmailNotice(queuedMsg);
      setStatusMessage(queuedMsg);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const saveSettingsWithRollback = async (
    next: Settings,
    previous: Settings,
    successNotice: string
  ): Promise<boolean> => {
    setToggleError(undefined);
    if (!resolvedVault) {
      setSettings(next);
      onSettingsChange?.(next);
      setStatusMessage(successNotice);
      return true;
    }

    const res = await resolvedVault.saveSettings(next);
    if (!res.ok) {
      setSettings(previous);
      setToggleError(res.error.message);
      setStatusMessage(res.error.message);
      return false;
    }

    setSettings(next);
    onSettingsChange?.(next);
    setStatusMessage(successNotice);
    return true;
  };

  const handleAiButtonClick = async () => {
    if (settings.allowAiReading) {
      const nextMachine = stepAiToggle(aiState, 'turn-off');
      const nextSettings: Settings = {
        ...settings,
        allowAiReading: nextMachine.allowAiReading,
      };
      const saved = await saveSettingsWithRollback(
        nextSettings,
        settings,
        'AI Reading is now OFF. Only on-device checks will run.'
      );
      if (saved) {
        setAiState(nextMachine);
      }
      return;
    }

    const nextMachine = stepAiToggle(aiState, 'request-on');
    setAiState(nextMachine);
    setStatusMessage('Please read the AI Reading notice and confirm if you agree.');
  };

  const handleAiConfirm = async () => {
    const nextMachine = stepAiToggle(aiState, 'confirm');
    const nextSettings: Settings = {
      ...settings,
      allowAiReading: nextMachine.allowAiReading,
    };
    const saved = await saveSettingsWithRollback(
      nextSettings,
      settings,
      'AI Reading is now ON.'
    );
    if (saved) {
      setAiState(nextMachine);
    } else {
      setAiState(createAiToggleState(settings.allowAiReading));
    }
  };

  const handleAiDismiss = () => {
    const nextMachine = stepAiToggle(aiState, 'dismiss');
    setAiState(nextMachine);
    setStatusMessage('AI Reading stayed OFF.');
  };

  const handleCaregiverToggle = async () => {
    const nextEnabled = !settings.caregiverShareEnabled;
    const nextSettings: Settings = {
      ...settings,
      caregiverShareEnabled: nextEnabled,
    };
    await saveSettingsWithRollback(
      nextSettings,
      settings,
      `Family Sharing is now ${nextEnabled ? 'ON' : 'OFF'}.`
    );
  };

  const handleDownloadData = async () => {
    setExportError(undefined);
    if (!resolvedVault) {
      setExportError(
        'We could not download your data right now. Please try again.'
      );
      setStatusMessage('Download failed. Please try again.');
      return;
    }

    const res = await exportDocument(resolvedVault);
    if (!res.ok) {
      setExportError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    try {
      if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
        const blob = new Blob([res.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'my-daily-helper-backup.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setStatusMessage('Your data backup file is ready to save.');
    } catch {
      setExportError(
        'We could not save the backup file to your device. Please try again.'
      );
      setStatusMessage('Download failed. Please try again.');
    }
  };

  const handleEraseEverything = async () => {
    setEraseResultMessage(undefined);
    setEraseInstructions(undefined);

    if (!resolvedVault) {
      const defaults = createDefaultSettings();
      setSettings(defaults);
      setAiState(createAiToggleState(false));
      setAuditEntries([]);
      setConnectedAccount(undefined);
      setEmailNotice(undefined);
      setEmailError(undefined);
      setEraseStep(0);
      setEraseResultMessage(
        'All your data and connected accounts have been erased from this device.'
      );
      setStatusMessage('All your data has been erased.');
      onSettingsChange?.(defaults);
      return;
    }

    const res = await eraseAllDataAndTokens(resolvedVault, { revokeToken });
    if (!res.ok) {
      setToggleError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    const defaults = createDefaultSettings();
    setSettings(defaults);
    setAiState(createAiToggleState(false));
    setAuditEntries([]);
    setConnectedAccount(undefined);
    setEmailNotice(undefined);
    setEmailError(undefined);
    setEraseStep(0);
    setEraseResultMessage(res.value.message);
    setEraseInstructions(res.value.instructions);
    setStatusMessage(res.value.message);
    onSettingsChange?.(defaults);
  };

  return (
    <div className="space-y-7 pb-6">
      <BackToHome onClick={handleBackClick} />

      <section className="relative overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft via-brand-wash to-white p-5 shadow-lift anim-fade-up">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-soft/60 blur-2xl"
        />
        <div className="relative space-y-2">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
            My Data &amp; Privacy
          </h1>
          <p className="text-[18px] leading-relaxed text-ink">
            You choose what this helper can read, who you share with, and when to
            download or erase your information.
          </p>
        </div>
      </section>

      <StatusLive message={statusMessage} />

      {toggleError ? (
        <div
          role="alert"
          data-card="true"
          className="flex items-start gap-3 rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 text-[18px] font-semibold text-[#881337] shadow-card"
        >
          <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
            <AlertTriangle size={22} />
          </span>
          <span>{toggleError}</span>
        </div>
      ) : null}

      {/* 5 Channel Toggles */}
      <section aria-labelledby="channels-heading" className="space-y-4">
        <h2
          id="channels-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Message &amp; Photo Sources
        </h2>

        <div className="space-y-4">
          {ALL_CHANNELS.map((channel) => {
            const isOn = settings.channels[channel];
            const label = CHANNEL_LABELS[channel];

            return (
              <div
                key={channel}
                data-card="true"
                className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white p-5 shadow-card anim-fade-up"
              >
                <div className="space-y-1">
                  <p className="text-[20px] font-bold text-ink">
                    {label}
                  </p>
                  <p className="text-[18px] text-muted">
                    {CHANNEL_DESCRIPTIONS[channel]}
                  </p>
                </div>

                <SeniorButton
                  variant={isOn ? 'safe' : 'secondary'}
                  aria-pressed={isOn}
                  onClick={() => void handleChannelToggle(channel)}
                >
                  {label}: {isOn ? 'ON' : 'OFF'}
                </SeniorButton>
              </div>
            );
          })}
        </div>

        {/* Automatic Email Reading Setup Card */}
        <div
          data-card="true"
          className="rounded-card border border-brand-soft/80 bg-gradient-to-br from-brand-wash/70 via-white to-white p-5 shadow-card anim-fade-up space-y-5"
        >
          <div className="space-y-1.5">
            <h3 className="text-[20px] font-bold tracking-tight text-ink">
              Automatic Email Reading
            </h3>
            <p className="text-[18px] text-muted">
              Choose either safe option below. This helper can only read emails
              — it can never send, change, or delete them.
            </p>
          </div>

          {connectedAccount ? (
            <div>
              <span
                data-badge="true"
                className="inline-flex items-center gap-2 rounded-full border-2 border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-[16px] font-bold text-emerald-800 shadow-pill"
              >
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <Check size={16} />
                </span>
                <span>
                  Connected ({connectedAccount.provider}):{' '}
                  {connectedAccount.account}
                </span>
              </span>
            </div>
          ) : null}

          {emailError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-chip border-2 border-[#BE123C] bg-red-50/80 p-3.5 text-[18px] font-semibold text-[#881337]"
            >
              <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                <AlertTriangle size={20} />
              </span>
              <span>{emailError}</span>
            </div>
          ) : null}

          {emailNotice ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-chip border-2 border-brand-soft bg-brand-wash p-3.5 text-[18px] font-semibold text-brand-deep"
            >
              <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                <Check size={20} />
              </span>
              <span>{emailNotice}</span>
            </div>
          ) : null}

          {/* Option 1: Read-Only Email Sign-In */}
          <div className="rounded-chip border border-line bg-white p-4 space-y-4">
            <p className="text-[18px] font-bold text-ink">
              Option 1: Read-Only Email Sign-In
            </p>

            <div className="space-y-2">
              <label
                htmlFor="connect-email-input"
                className="block text-[18px] font-semibold text-ink"
              >
                Your email address
              </label>
              <input
                id="connect-email-input"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="For example: grandma@gmail.com"
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="connect-email-provider"
                className="block text-[18px] font-semibold text-ink"
              >
                Email provider
              </label>
              <select
                id="connect-email-provider"
                value={emailProvider}
                onChange={(e) =>
                  setEmailProvider(e.target.value as EmailProvider)
                }
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              >
                <option value="Gmail">Gmail</option>
                <option value="Outlook">Outlook</option>
              </select>
            </div>

            <SeniorButton
              variant="primary"
              icon={<Mail size={20} />}
              onClick={() => void handleConnectEmail()}
            >
              Connect Read-Only Email
            </SeniorButton>
          </div>

          {/* Option 2: No-Login Email Forwarding */}
          <div className="rounded-chip border border-line bg-white p-4 space-y-3">
            <p className="text-[18px] font-bold text-ink">
              Option 2: No-Login Email Forwarding
            </p>
            <p className="text-[18px] text-muted">
              Family or clinic emails forwarded to this helper arrive
              automatically whenever Email is turned ON above — no sign-in
              required.
            </p>
            <SeniorButton
              variant="secondary"
              icon={<Send size={20} />}
              disabled={isSendingTestEmail}
              onClick={() => void handleSendTestEmail()}
            >
              Send Test Clinic Email
            </SeniorButton>
          </div>
        </div>
      </section>

      {/* AI Reading Toggle */}
      <section aria-labelledby="ai-heading" className="space-y-4">
        <h2 id="ai-heading" className="text-[22px] font-bold tracking-tight text-ink">
          AI Reading
        </h2>

        <div
          data-card="true"
          className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[20px] font-bold text-ink">
                Allow AI Reading
              </p>
              <p className="text-[18px] text-muted">
                When OFF, this helper uses simple built-in checks on your device
                only.
              </p>
            </div>

            <SeniorButton
              variant={settings.allowAiReading ? 'safe' : 'secondary'}
              icon={<Sparkles size={20} />}
              aria-pressed={settings.allowAiReading}
              onClick={() => void handleAiButtonClick()}
            >
              AI Reading: {settings.allowAiReading ? 'ON' : 'OFF'}
            </SeniorButton>
          </div>

          {aiState.awaitingConfirm ? (
            <div
              role="region"
              aria-label="Confirm AI Reading"
              className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 shadow-card space-y-4"
            >
              <p className="text-[20px] leading-relaxed text-ink">
                {AI_EXPLANATION_TEXT}
              </p>
              <div className="flex flex-wrap gap-4">
                <SeniorButton
                  variant="primary"
                  icon={<Check size={20} />}
                  onClick={() => void handleAiConfirm()}
                >
                  Confirm Turn AI On
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  icon={<X size={20} />}
                  onClick={handleAiDismiss}
                >
                  Keep AI Off
                </SeniorButton>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Caregiver Share Toggle */}
      <section aria-labelledby="caregiver-heading" className="space-y-4">
        <h2
          id="caregiver-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Family Sharing
        </h2>

        <div
          data-card="true"
          className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white p-5 shadow-card anim-fade-up"
        >
          <div className="space-y-1">
            <p className="text-[20px] font-bold text-ink">
              Allow Ask Family to Check
            </p>
            <p className="text-[18px] text-muted">
              When ON, you can choose to send a single item summary to a trusted
              family member after confirming.
            </p>
          </div>

          <SeniorButton
            variant={settings.caregiverShareEnabled ? 'safe' : 'secondary'}
            icon={<Users size={20} />}
            aria-pressed={settings.caregiverShareEnabled}
            onClick={() => void handleCaregiverToggle()}
          >
            Family Sharing: {settings.caregiverShareEnabled ? 'ON' : 'OFF'}
          </SeniorButton>
        </div>
      </section>

      {/* What AI Read Audit Log */}
      <section aria-labelledby="audit-heading" className="space-y-4">
        <h2 id="audit-heading" className="text-[22px] font-bold tracking-tight text-ink">
          What AI Read
        </h2>

        <div
          data-card="true"
          className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
        >
          {orderedAudit.length === 0 ? (
            <p className="text-[20px] font-medium text-muted">
              {AUDIT_EMPTY_MESSAGE}
            </p>
          ) : (
            <ul className="space-y-3">
              {orderedAudit.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-chip border border-brand-soft bg-brand-wash/50 p-4 space-y-1"
                >
                  <p className="text-[16px] font-bold text-brand-deep tnum">
                    {entry.at}
                    {entry.channel
                      ? ` • ${CHANNEL_LABELS[entry.channel]}`
                      : ''}
                  </p>
                  <p className="text-[20px] font-semibold text-ink">
                    {entry.description}
                  </p>
                  {entry.purpose ? (
                    <p className="text-[18px] text-muted">
                      Why: {entry.purpose}
                    </p>
                  ) : null}
                  {entry.recipient ? (
                    <p className="text-[18px] text-muted">
                      Shared with: {entry.recipient}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Download My Data */}
      <section aria-labelledby="export-heading" className="space-y-4">
        <h2
          id="export-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Download My Data
        </h2>

        <div
          data-card="true"
          className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
        >
          <p className="text-[18px] text-muted">
            Save a copy of your messages, calendar plans, settings, and activity
            history to your device.
          </p>

          <SeniorButton
            variant="primary"
            icon={<Download size={20} />}
            onClick={() => void handleDownloadData()}
          >
            Download My Data
          </SeniorButton>

          {exportError ? (
            <div
              role="alert"
              className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 shadow-card space-y-3"
            >
              <p className="text-[18px] font-semibold text-[#881337]">
                {exportError}
              </p>
              <SeniorButton
                variant="warn"
                icon={<RefreshCw size={20} />}
                onClick={() => void handleDownloadData()}
              >
                Try Again
              </SeniorButton>
            </div>
          ) : null}
        </div>
      </section>

      {/* Two-step Erase All My Data */}
      <section aria-labelledby="erase-heading" className="space-y-4">
        <h2 id="erase-heading" className="text-[22px] font-bold text-[#881337]">
          Erase All My Data
        </h2>

        <div
          data-card="true"
          className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-5 shadow-card anim-fade-up space-y-4"
        >
          <p className="text-[18px] text-ink">
            Remove everything stored on this device and disconnect email access.
          </p>

          {eraseStep === 0 ? (
            <SeniorButton
              variant="danger"
              icon={<Trash2 size={20} />}
              onClick={() => {
                setEraseStep(1);
                setStatusMessage(
                  'Please review what will be erased before continuing.'
                );
              }}
            >
              Erase All My Data
            </SeniorButton>
          ) : null}

          {eraseStep === 1 ? (
            <div
              role="region"
              aria-label="Erase step 1 confirmation"
              className="rounded-card border-2 border-[#BE123C] bg-white p-4 shadow-card space-y-4"
            >
              <p className="text-[20px] font-bold text-[#881337]">
                Step 1 of 2: The following items will be deleted:
              </p>
              <ul className="list-disc pl-6 space-y-1 text-[18px] text-ink">
                <li>All inbox messages and summaries</li>
                <li>All calendar events and reminders</li>
                <li>All settings and safety checklist progress</li>
                <li>Your What AI Read activity log</li>
                <li>Connected email access</li>
              </ul>
              <div className="flex flex-wrap gap-4">
                <SeniorButton
                  variant="danger"
                  onClick={() => {
                    setEraseStep(2);
                    setStatusMessage(
                      'Final step: confirm permanent erasure.'
                    );
                  }}
                >
                  Continue
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  onClick={() => {
                    setEraseStep(0);
                    setStatusMessage('Erase cancelled. Nothing was removed.');
                  }}
                >
                  Cancel
                </SeniorButton>
              </div>
            </div>
          ) : null}

          {eraseStep === 2 ? (
            <div
              role="region"
              aria-label="Erase step 2 final confirmation"
              className="rounded-card border-2 border-[#BE123C] bg-white p-4 shadow-card space-y-4"
            >
              <p className="text-[20px] font-bold text-[#881337]">
                Step 2 of 2: This is permanent and cannot be undone.
              </p>
              <p className="text-[18px] text-ink">
                Are you sure you want to remove all your data from this device?
              </p>
              <div className="flex flex-wrap gap-4">
                <SeniorButton
                  variant="danger"
                  icon={<Trash2 size={20} />}
                  onClick={() => void handleEraseEverything()}
                >
                  Erase Everything
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  onClick={() => {
                    setEraseStep(0);
                    setStatusMessage('Erase cancelled. Nothing was removed.');
                  }}
                >
                  Cancel
                </SeniorButton>
              </div>
            </div>
          ) : null}

          {eraseResultMessage ? (
            <div
              role="status"
              className="rounded-card border-2 border-brand-soft bg-white p-4 shadow-card space-y-2"
            >
              <p className="flex items-start gap-2 text-[18px] font-semibold text-ink">
                <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-brand">
                  <Shield size={20} />
                </span>
                <span>{eraseResultMessage}</span>
              </p>
              {eraseInstructions ? (
                <p className="text-[18px] text-muted">{eraseInstructions}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default MyDataPage;
