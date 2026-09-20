import PageShell, { PageHeader } from '../components/layout/PageShell';
import './routes.css';

// Placeholder for every not-yet-implemented domain screen. States plainly
// what is missing and which checkpoint owns it — never fake data.
export default function PlaceholderPage({ eyebrow, title, checkpoint }) {
  return (
    <PageShell>
      <PageHeader eyebrow={eyebrow} title={title} description="This screen has not been implemented yet." />
      <div className="state state--empty">
        <h3 className="state__title">Coming in a later checkpoint</h3>
        <p className="state__message">
          {checkpoint
            ? `Planned for ${checkpoint}. The navigation and shell are real; the domain screen is not.`
            : 'The navigation and shell are real; the domain screen is not.'}
        </p>
      </div>
    </PageShell>
  );
}
