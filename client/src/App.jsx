import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth';
import AppShell from './components/layout/AppShell';
import { ToastViewport } from './components/ui/ToastViewport';
import LoginPage from './routes/LoginPage';
import PlaceholderPage from './routes/PlaceholderPage';
import EnquiriesPage from './routes/enquiries/EnquiriesPage';
import EnquiryDetailPage from './routes/enquiries/EnquiryDetailPage';
import UnmatchedEnquiriesPage from './routes/enquiries/UnmatchedEnquiriesPage';
import ContactsPage from './routes/contacts/ContactsPage';
import ContactDetailPage from './routes/contacts/ContactDetailPage';
import DuplicatesPage from './routes/contacts/DuplicatesPage';
import LeadsPage from './routes/leads/LeadsPage';
import LeadDetailPage from './routes/leads/LeadDetailPage';
import ProjectsPage from './routes/properties/ProjectsPage';
import ProjectDetailPage from './routes/properties/ProjectDetailPage';
import InventoryPage from './routes/properties/InventoryPage';
import UnitDetailPage from './routes/properties/UnitDetailPage';
import DealsPage from './routes/deals/DealsPage';
import DealDetailPage from './routes/deals/DealDetailPage';
import VisitsPage from './routes/visits/VisitsPage';
import VisitDetailPage from './routes/visits/VisitDetailPage';
import ReservationsPage from './routes/reservations/ReservationsPage';
import ReservationDetailPage from './routes/reservations/ReservationDetailPage';
import BookingsPage from './routes/bookings/BookingsPage';
import BookingDetailPage from './routes/bookings/BookingDetailPage';
import PaymentsPage from './routes/payments/PaymentsPage';
import PlanDetailPage from './routes/payments/PlanDetailPage';
import DocumentsPage from './routes/documents/DocumentsPage';
import DocumentDetailPage from './routes/documents/DocumentDetailPage';
import ActivitiesPage from './routes/activities/ActivitiesPage';
import TasksPage, { TaskDetailPage } from './routes/activities/TasksPage';
import CommunicationPage from './routes/CommunicationPage';
import ReportsPage from './routes/reports/ReportsPage';
import DashboardPage from './routes/dashboard/DashboardPage';
import CalendarPage from './routes/calendar/CalendarPage';
import TeamPage from './routes/settings/TeamPage';
import RolesPage from './routes/settings/RolesPage';
import LeadSourcesPage from './routes/settings/LeadSourcesPage';
import CampaignsPage from './routes/settings/CampaignsPage';
import AssignmentRulesPage from './routes/settings/AssignmentRulesPage';
import './routes/slice.css';

// Declared hierarchy: all entries below are real screens.
// No fake data anywhere.

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
          <Route path="properties/projects" element={<ProjectsPage />} />
          <Route path="properties/projects/:id" element={<ProjectDetailPage />} />
          <Route path="properties/inventory" element={<InventoryPage />} />
          <Route path="properties/inventory/:id" element={<UnitDetailPage />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="deals/:id" element={<DealDetailPage />} />
          <Route path="site-visits" element={<VisitsPage />} />
          <Route path="site-visits/:id" element={<VisitDetailPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="reservations/:id" element={<ReservationDetailPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="bookings/:id" element={<BookingDetailPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="payments/:id" element={<PlanDetailPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="documents/:id" element={<DocumentDetailPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="communication" element={<CommunicationPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<Navigate to="settings/team" replace />} />
          <Route path="settings/team" element={<TeamPage />} />
          <Route path="settings/roles-permissions" element={<RolesPage />} />
          <Route path="settings/lead-sources" element={<LeadSourcesPage />} />
          <Route path="settings/campaigns" element={<CampaignsPage />} />
          {/* Hidden: backend assignment-rule infra remains intact, not advertised */}
          <Route path="settings/assignment-rules" element={<AssignmentRulesPage />} />
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
