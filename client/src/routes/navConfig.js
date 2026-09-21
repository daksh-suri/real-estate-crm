// Declared /app hierarchy (Checkpoint 17A). Only dashboard is a real page;
// every other entry renders PlaceholderPage until its domain checkpoint
// lands. Icons are single glyphs — no icon dependency for the foundation.
export const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { label: 'Dashboard', path: '/app/dashboard', icon: '◧' },
      { label: 'Enquiries', path: '/app/enquiries', icon: '✉' },
      { label: 'Leads', path: '/app/leads', icon: '◎' },
      { label: 'Contacts', path: '/app/contacts', icon: '○' },
    ],
  },
  {
    label: 'Property',
    items: [
      { label: 'Projects', path: '/app/properties/projects', icon: '▦' },
      { label: 'Inventory', path: '/app/properties/inventory', icon: '▤' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Pipeline', path: '/app/deals', icon: '▭' },
      { label: 'Site Visits', path: '/app/site-visits', icon: '◷' },
      { label: 'Calendar', path: '/app/calendar', icon: '▦' },
      { label: 'Reservations', path: '/app/reservations', icon: '⬔' },
      { label: 'Bookings', path: '/app/bookings', icon: '✔' },
      { label: 'Payments', path: '/app/payments', icon: '₹' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Documents', path: '/app/documents', icon: '▤' },
      { label: 'Activities', path: '/app/activities', icon: '✎' },
      { label: 'Tasks', path: '/app/tasks', icon: '☑' },
    ],
  },
  {
    label: 'Communication',
    items: [{ label: 'Communication', path: '/app/communication', icon: '✆' }],
  },
  {
    label: 'Insights',
    items: [{ label: 'Reports', path: '/app/reports', icon: '▧' }],
  },
  {
    label: 'Admin',
    items: [
      {
        label: 'Settings',
        icon: '⚙',
        children: [
          { label: 'Team', path: '/app/settings/team', icon: '○' },
          { label: 'Roles & permissions', path: '/app/settings/roles-permissions', icon: '◈' },
          { label: 'Lead sources', path: '/app/settings/lead-sources', icon: '✉' },
          { label: 'Campaigns', path: '/app/settings/campaigns', icon: '✦' },
        ],
      },
    ],
  },
];
