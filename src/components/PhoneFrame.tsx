'use client';

import React, { createContext, useContext, useState } from 'react';

/**
 * Portal target: toasts, zoom lightbox and bottom sheets must render inside
 * the phone screen container, never over the outer browser page.
 */
const ScreenPortalContext = createContext<HTMLElement | null>(null);
export const useScreenPortal = (): HTMLElement | null =>
  useContext(ScreenPortalContext);

export interface PhoneFrameProps {
  children: React.ReactNode;
  reserved?: number;
}

/**
 * Renders only the inner phone screen design centered in the viewport,
 * without outer device bezel, simulated status bar, Dynamic Island, or home indicator.
 */
export function PhoneFrame({ children }: PhoneFrameProps) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  return (
    <div className="flex h-screen h-[100dvh] max-h-[100dvh] w-full justify-center overflow-hidden bg-canvas">
      <div
        ref={setPortal}
        data-phone-screen="true"
        className="relative flex h-full max-h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-canvas shadow-card sm:border-x sm:border-line"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <ScreenPortalContext.Provider value={portal}>
          {children}
        </ScreenPortalContext.Provider>
      </div>
    </div>
  );
}

export default PhoneFrame;
