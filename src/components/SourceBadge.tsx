import React from 'react';
import {
  Camera,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
} from 'lucide-react';
import type { Channel } from '@/lib/types';

export type SourceBadgeProps = {
  source: Channel;
  className?: string;
};

type SourceMeta = {
  label: string;
  classes: string;
  icon: React.ReactNode;
};

const SOURCE_META: Record<Channel, SourceMeta> = {
  email: {
    label: 'From Email',
    classes: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: <Mail size={18} />,
  },
  whatsappForward: {
    label: 'From WhatsApp',
    classes: 'border-green-200 bg-green-50 text-green-700',
    icon: <MessageCircle size={18} />,
  },
  smsPaste: {
    label: 'From SMS',
    classes: 'border-slate-300 bg-slate-100 text-slate-700',
    icon: <MessageSquare size={18} />,
  },
  messengerPaste: {
    label: 'From Messenger',
    classes: 'border-violet-200 bg-violet-100 text-violet-700',
    icon: <Send size={18} />,
  },
  photos: {
    label: 'From Photo',
    classes: 'border-teal-200 bg-teal-50 text-teal-700',
    icon: <Camera size={18} />,
  },
};

export function SourceBadge({ source, className = '' }: SourceBadgeProps) {
  const meta = SOURCE_META[source];

  return (
    <span
      data-badge="true"
      className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 text-[14px] font-bold tracking-[0.04em] shadow-pill ${meta.classes} ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
