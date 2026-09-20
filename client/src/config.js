// Frontend runtime configuration. All values are build-time (Vite) so no
// secrets can be baked in accidentally — only public endpoint URLs here.
// Production builds fail closed: a missing VITE_API_URL would otherwise
// silently point the shipped app at localhost.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  throw new Error('Missing required VITE_API_URL for production build');
}
export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const APP_NAME = 'Vynexa CRM';
