import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Minimal toast store for mutation outcomes. Deliberately small: push +
// auto-dismiss. Not a notification center (future checkpoint if needed).
const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, tone = 'info') => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      timers.current.set(id, setTimeout(() => dismiss(id), 4000));
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
