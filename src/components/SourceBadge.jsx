import { Mail, MessageCircle, MessageSquare, Upload } from 'lucide-react';
import { sourceMeta } from '../data/seed';

const ICONS = {
  whatsapp: MessageCircle,
  email: Mail,
  sms: MessageSquare,
  upload: Upload,
};

/**
 * Small muted source badge: WhatsApp green, Email blue, SMS gray, Upload teal.
 */
export default function SourceBadge({ source, className = '' }) {
  const meta = sourceMeta[source] ?? sourceMeta.upload;
  const Icon = ICONS[source] ?? Upload;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.04em] ${meta.classes} ${className}`}
    >
      <Icon size={10} strokeWidth={2.4} />
      {meta.label}
    </span>
  );
}
