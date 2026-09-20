import { useToast } from './Toast';
import './ui.css';

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} role="status">
          <span className="toast__message">{t.message}</span>
          <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
