import { useEffect, useRef } from 'react';
import './ui.css';
import { Button } from './controls';

// Modal dialog: focus-trapped lightly (initial focus + Escape), labelled by
// title. Mobile-friendly (bottom sheet under 640px via CSS).
export function Dialog({ open, title, onClose, children, actions }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const node = ref.current;
    const first = node ? node.querySelector('button, input, select, textarea, [tabindex]') : null;
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog__header">
          <h2 className="dialog__title">{title}</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {actions && <footer className="dialog__footer">{actions}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', onConfirm, onClose }) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Dialog>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`tabs__tab${active === t.key ? ' tabs__tab--active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
