import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import PhoneFrame from './components/PhoneFrame';
import TabBar from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { DemoBridge, DemoProvider, useDemo } from './context/DemoContext';
import DemoShell, { SHELL_RESERVED } from './components/presentation/DemoShell';
import MyDay from './screens/MyDay';
import Calendar from './screens/Calendar';
import CalendarDay from './screens/CalendarDay';
import Records from './screens/Records';
import RecordDetail from './screens/RecordDetail';
import Upload from './screens/Upload';

function AppShell() {
  const { pathname } = useLocation();
  const { resetKey } = useDemo();
  const hideTabBar = /^\/(records|calendar\/day)\/.+/.test(pathname);

  return (
    <ToastProvider>
      {/* Demo toast bridge — inside the ToastProvider, outside app state */}
      <DemoBridge />
      <div key={resetKey} className="relative flex h-full min-h-0 flex-col bg-canvas">
        <div className="relative min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<MyDay />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/calendar/day/:date" element={<CalendarDay />} />
            <Route path="/records" element={<Records />} />
            <Route path="/records/:id" element={<RecordDetail />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {!hideTabBar && <TabBar />}
      </div>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DemoProvider>
        <DemoShell>
          <PhoneFrame reserved={SHELL_RESERVED}>
            <AppShell />
          </PhoneFrame>
        </DemoShell>
      </DemoProvider>
    </BrowserRouter>
  );
}
