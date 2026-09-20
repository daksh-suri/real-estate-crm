import './ui.css';

export function Button({ variant = 'primary', size = 'md', ...props }) {
  return <button type="button" className={`btn btn--${variant} btn--${size}`} {...props} />;
}

export function Input(props) {
  return <input className="field" {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className="field" {...props}>
      {children}
    </select>
  );
}

export function Textarea(props) {
  return <textarea className="field" rows={4} {...props} />;
}

export function Field({ label, error, hint, children }) {
  return (
    <label className="form-field">
      {label && <span className="form-field__label">{label}</span>}
      {children}
      {error ? (
        <span className="form-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="form-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Card({ title, actions, children }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          {title && <h2 className="card__title">{title}</h2>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
