import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing } from 'lucide-react';
import { useScreenPortal } from './PhoneFrame';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

/**
 * In-app toasts. Rendered inside the phone screen via portal — never over the
 * browser window. Usage: const toast = useToast(); toast({ title, message })
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const screen = useScreenPortal();

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast) => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, ...toast }]);
      setTimeout(() => dismiss(id), toast.duration ?? 3600);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {screen &&
        createPortal(
          <div className="pointer-events-none absolute inset-x-4 bottom-[104px] z-[70] flex flex-col items-center gap-2">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="anim-toast pointer-events-auto flex w-full max-w-[330px] items-start gap-3 rounded-card bg-ink/95 px-4 py-3 text-white shadow-lift backdrop-blur-md"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/25 text-brand-soft">
                  {t.icon ?? <BellRing size={16} strokeWidth={2.2} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-snug">{t.title}</p>
                  {t.message && (
                    <p className="mt-0.5 text-[12.5px] leading-snug text-white/70">{t.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>,
          screen
        )}
    </ToastContext.Provider>
  );
}
