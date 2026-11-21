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
  icon: React.ReactNode;
};

const SOURCE_META: Record<Channel, SourceMeta> = {
  email: {
    label: 'From Email',
    icon: <Mail size={20} />,
  },
  whatsappForward: {
    label: 'From WhatsApp',
    icon: <MessageCircle size={20} />,
  },
  smsPaste: {
    label: 'From SMS',
    icon: <MessageSquare size={20} />,
  },
  messengerPaste: {
    label: 'From Messenger',
    icon: <Send size={20} />,
  },
  photos: {
    label: 'From Photo',
    icon: <Camera size={20} />,
  },
};

export function SourceBadge({ source, className = '' }: SourceBadgeProps) {
  const meta = SOURCE_META[source];

  return (
    <span
      data-badge="true"
      className={`inline-flex items-center gap-2 rounded-lg border-2 border-[#0F766E] bg-[#F0FDFA] px-3 py-1.5 text-[18px] font-semibold text-[#115E59] ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
