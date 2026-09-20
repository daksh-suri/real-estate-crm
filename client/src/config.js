// Frontend runtime configuration. All values are build-time (Vite) so no
// secrets can be baked in accidentally — only public endpoint URLs here.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const APP_NAME = 'Vynexa CRM';
