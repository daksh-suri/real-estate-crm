import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth';
import AppShell from './components/layout/AppShell';
import { ToastViewport } from './components/ui/ToastViewport';
import LoginPage from './routes/LoginPage';
import DashboardPage from './routes/DashboardPage';
import PlaceholderPage from './routes/PlaceholderPage';
import EnquiriesPage from './routes/enquiries/EnquiriesPage';
import EnquiryDetailPage from './routes/enquiries/EnquiryDetailPage';
import UnmatchedEnquiriesPage from './routes/enquiries/UnmatchedEnquiriesPage';
import ContactsPage from './routes/contacts/ContactsPage';
import ContactDetailPage from './routes/contacts/ContactDetailPage';
import DuplicatesPage from './routes/contacts/DuplicatesPage';
import LeadsPage from './routes/leads/LeadsPage';
import LeadDetailPage from './routes/leads/LeadDetailPage';
import './routes/slice.css';

// Declared hierarchy: 17A placeholders remain for later checkpoints; 17B
// entries below are real screens. No fake data anywhere.
const PLACEHOLDERS = [
  ['Property', 'Projects', '/app/properties/projects', 'Property screens'],
  ['Property', 'Project detail', '/app/properties/projects/:id', 'Property screens'],
  ['Property', 'Inventory', '/app/properties/inventory', 'Property screens'],
  ['Property', 'Unit detail', '/app/properties/inventory/:id', 'Property screens'],
  ['Sales', 'Pipeline', '/app/deals', 'Deal pipeline screens'],
  ['Sales', 'Deal detail', '/app/deals/:id', 'Deal pipeline screens'],
  ['Sales', 'Site visits', '/app/site-visits', 'Site visit screens'],
  ['Sales', 'Site visit detail', '/app/site-visits/:id', 'Site visit screens'],
  ['Sales', 'Reservations', '/app/reservations', 'Reservation screens'],
  ['Sales', 'Reservation detail', '/app/reservations/:id', 'Reservation screens'],
  ['Sales', 'Bookings', '/app/bookings', 'Booking screens'],
  ['Sales', 'Booking detail', '/app/bookings/:id', 'Booking screens'],
  ['Sales', 'Payments', '/app/payments', 'Payment screens'],
  ['Sales', 'Payment detail', '/app/payments/:id', 'Payment screens'],
  ['Operations', 'Documents', '/app/documents', 'Document screens'],
  ['Operations', 'Document detail', '/app/documents/:id', 'Document screens'],
  ['Operations', 'Activities', '/app/activities', 'Activity & task screens'],
  ['Operations', 'Tasks', '/app/tasks', 'Activity & task screens'],
  ['Communication', 'Communication', '/app/communication', 'Communication screens'],
  ['Insights', 'Reports', '/app/reports', 'Reports & dashboards'],
  ['Admin', 'Settings', '/app/settings', 'Admin screens'],
  ['Admin', 'Team', '/app/settings/team', 'Admin screens'],
  ['Admin', 'Roles & permissions', '/app/settings/roles-permissions', 'Admin screens'],
  ['Admin', 'Lead sources', '/app/settings/lead-sources', 'Admin screens'],
  ['Admin', 'Campaigns', '/app/settings/campaigns', 'Admin screens'],
  ['Admin', 'Assignment rules', '/app/settings/assignment-rules', 'Admin screens'],
];

function placeholderPath(full) {
  return full.replace(/^\/app\//, '');
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="enquiries" element={<EnquiriesPage />} />
          <Route path="enquiries/unmatched" element={<UnmatchedEnquiriesPage />} />
          <Route path="enquiries/:id" element={<EnquiryDetailPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="contacts/duplicates" element={<DuplicatesPage />} />
          <Route path="contacts/:id" element={<ContactDetailPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetailPage />} />
          {PLACEHOLDERS.map(([eyebrow, title, full, checkpoint]) => (
            <Route
              key={full}
              path={placeholderPath(full)}
              element={<PlaceholderPage eyebrow={eyebrow} title={title} checkpoint={checkpoint} />}
            />
          ))}
        </Route>
        <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
        <Route
          path="*"
          element={
            <PlaceholderPage eyebrow="Not found" title="Page not found" checkpoint={null} />
          }
        />
      </Routes>
      <ToastViewport />
    </>
  );
}
