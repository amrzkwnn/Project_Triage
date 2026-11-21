import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { resetSessionRecords } from '../data/seed';

const DemoContext = createContext(null);
export const useDemo = () => useContext(DemoContext);

/**
 * One-way demo control: the presentation stepper drives the app inside the
 * phone. The app can also read intents (Personal filter, export highlight)
 * and a toast signal.
 */
export function DemoProvider({ children }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(-1);
  const [resetKey, setResetKey] = useState(0);
  const [categoryIntent, setCategoryIntent] = useState(null);
  const [toastSignal, setToastSignal] = useState(0);
  const [exportPulse, setExportPulse] = useState(false);

  const goToStep = (n) => {
    setStep(n);
    setExportPulse(false);
    if (n === 0) {
      navigate('/');
    } else if (n === 1) {
      navigate('/');
      setCategoryIntent('personal');
    } else if (n === 2) {
      navigate('/upload?demo=1');
    } else if (n === 3) {
      navigate('/records/rec-uploaded');
      setExportPulse(true);
      setToastSignal((s) => s + 1);
    }
  };

  const next = () => goToStep(Math.min(3, step + 1));
  const prev = () => goToStep(Math.max(0, step - 1));

  const reset = () => {
    resetSessionRecords();
    setResetKey((k) => k + 1);
    setStep(-1);
    setCategoryIntent(null);
    setExportPulse(false);
    navigate('/');
  };

  return (
    <DemoContext.Provider
      value={{
        step,
        goToStep,
        next,
        prev,
        reset,
        resetKey,
        categoryIntent,
        clearCategoryIntent: () => setCategoryIntent(null),
        toastSignal,
        exportPulse,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

/**
 * Renders inside the app's ToastProvider: fires the demo reminder toast once
 * when the stepper requests it (step 4), after navigation settles.
 */
export function DemoBridge() {
  const toast = useToast();
  const { toastSignal } = useDemo();

  useEffect(() => {
    if (toastSignal === 0) return undefined;
    const t = setTimeout(() => {
      toast({
        title: 'Reminder — record ready',
        message: 'Your record is ready to export as a PDF.',
      });
    }, 600);
    return () => clearTimeout(t);
  }, [toastSignal, toast]);

  return null;
}
