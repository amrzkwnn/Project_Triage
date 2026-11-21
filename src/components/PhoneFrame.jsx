import { createContext, useContext, useEffect, useState } from 'react';
import { Signal, Wifi, BatteryFull } from 'lucide-react';
import { useViewport } from '../hooks/useViewport';

const DEVICE_W = 390;
const DEVICE_H = 844;
const BEZEL = 12;
const OUTER_W = DEVICE_W + BEZEL * 2; // 414
const OUTER_H = DEVICE_H + BEZEL * 2; // 868
const STATUS_H = 56;

/**
 * Portal target: toasts, zoom lightbox and bottom sheets must render inside
 * the phone screen (or the fullscreen app container), never the browser page.
 */
const ScreenPortalContext = createContext(null);
export const useScreenPortal = () => useContext(ScreenPortalContext);

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?[AP]M/i, '');
}

function StatusBar() {
  const time = useClock();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-8 pt-3 text-ink chrome">
      <span className="text-[15px] font-semibold tracking-tight tnum">{time}</span>
      <span className="flex items-center gap-[6px]">
        <Signal size={15} strokeWidth={2.4} />
        <Wifi size={15} strokeWidth={2.4} />
        <BatteryFull size={23} strokeWidth={1.9} />
      </span>
    </div>
  );
}

function DynamicIsland() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[11px] z-40 flex h-[34px] w-[118px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-3">
      <span className="mr-1 h-[9px] w-[9px] rounded-full bg-[#101a2e]" />
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="pointer-events-none absolute bottom-[7px] left-1/2 z-40 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-ink/70" />
  );
}

/**
 * Wraps the entire app in a realistic phone frame, centered and scaled to fit
 * the browser viewport. Under 500px wide (a real phone) the frame is skipped
 * and the app renders full screen with OS safe-area padding.
 *
 * `reserved` = vertical pixels outside the phone the shell needs for itself
 * (stepper, footer, margins) — used by the presentation layer later.
 */
export default function PhoneFrame({ children, reserved = 40 }) {
  const { w, h } = useViewport();
  const [portal, setPortal] = useState(null);

  const narrow = w !== 0 && w < 500;
  const scale = Math.min(1, Math.max(0.35, (h - reserved) / OUTER_H));

  // Fullscreen branch — real phone, no frame, no simulated status bar.
  if (narrow) {
    return (
      <div
        ref={setPortal}
        className="fixed inset-0 flex flex-col overflow-hidden bg-canvas"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <ScreenPortalContext.Provider value={portal}>
          <div className="relative min-h-0 flex-1">{children}</div>
        </ScreenPortalContext.Provider>
      </div>
    );
  }

  // Desktop branch — framed device, scaled to fit the viewport height.
  // `reserved` = vertical space the surrounding shell needs below the phone.
  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden"
      style={{ paddingBottom: reserved }}
    >
      <div style={{ width: OUTER_W * scale, height: OUTER_H * scale }}>
        <div
          style={{ width: OUTER_W, height: OUTER_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <div className="relative chrome" style={{ width: OUTER_W, height: OUTER_H }}>
            {/* side buttons */}
            <div className="absolute -left-[2px] top-[148px] h-[28px] w-[3px] rounded-l-sm bg-[#2a2d33]" />
            <div className="absolute -left-[2px] top-[192px] h-[54px] w-[3px] rounded-l-sm bg-[#2a2d33]" />
            <div className="absolute -left-[2px] top-[256px] h-[54px] w-[3px] rounded-l-sm bg-[#2a2d33]" />
            <div className="absolute -right-[2px] top-[212px] h-[78px] w-[3px] rounded-r-sm bg-[#2a2d33]" />

            {/* device body */}
            <div className="phone-body absolute inset-0 shadow-phone" style={{ borderRadius: 48 }} />

            {/* screen */}
            <div
              ref={setPortal}
              className="absolute overflow-hidden bg-canvas"
              style={{
                left: BEZEL,
                top: BEZEL,
                width: DEVICE_W,
                height: DEVICE_H,
                borderRadius: 36,
                transform: 'translateZ(0)',
                boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.08)',
              }}
            >
              <ScreenPortalContext.Provider value={portal}>
                <div className="absolute inset-0">
                  <StatusBar />
                  <div className="absolute inset-x-0 bottom-0" style={{ top: STATUS_H }}>
                    {children}
                  </div>
                  <DynamicIsland />
                  <HomeIndicator />
                </div>
              </ScreenPortalContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
