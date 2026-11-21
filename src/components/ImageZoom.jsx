import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { useScreenPortal } from './PhoneFrame';

/**
 * Fullscreen document zoom, rendered inside the phone screen via portal.
 * Pinch (touch), double-tap/click, and +/- buttons all control the zoom.
 */
export default function ImageZoom({ svg, onClose }) {
  const screen = useScreenPortal();
  const [scale, setScale] = useState(1);
  const pinch = useRef({ dist: 0, scale: 1 });

  if (!screen) return null;

  const touchDist = (touches) =>
    Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );

  const onTouchStart = (e) => {
    if (e.touches.length === 2) pinch.current = { dist: touchDist(e.touches), scale };
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinch.current.dist > 0) {
      const next = (pinch.current.scale * touchDist(e.touches)) / pinch.current.dist;
      setScale(Math.min(4, Math.max(1, next)));
    }
  };

  return createPortal(
    <div
      className="anim-fade-in chrome absolute inset-0 z-[80] flex flex-col bg-ink/95 backdrop-blur-sm"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pt-3">
        <p className="text-[13px] font-semibold text-white/80">
          Pinch or double-tap to zoom
        </p>
        <button
          type="button"
          aria-label="Close zoom"
          onClick={onClose}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X size={20} strokeWidth={2.2} />
        </button>
      </div>

      <div
        className="app-scroll flex min-h-0 flex-1 items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="doc-svg w-full max-w-[330px] transition-transform duration-200 ease-out"
          style={{ transform: `scale(${scale})` }}
          onDoubleClick={() => setScale((s) => (s > 1.5 ? 1 : 2.4))}
        >
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 pb-8 pt-2">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={scale <= 1}
          onClick={() => setScale((s) => Math.max(1, +(s - 0.5).toFixed(1)))}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-40"
        >
          <Minus size={18} strokeWidth={2.2} />
        </button>
        <p className="w-12 text-center text-[12px] font-semibold text-white/70 tnum">
          {Math.round(scale * 100)}%
        </p>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={scale >= 4}
          onClick={() => setScale((s) => Math.min(4, +(s + 0.5).toFixed(1)))}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-40"
        >
          <Plus size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>,
    screen
  );
}
