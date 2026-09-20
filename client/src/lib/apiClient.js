import { API_BASE_URL } from '../config';
import { ApiError, parseErrorResponse } from './apiErrors';

// Single-attempt JSON request. This layer NEVER retries and NEVER refreshes:
// a 401 is thrown to the caller (the session manager), which owns the one
// guarded refresh + single replay. Keeping retry out of here is what makes
// an infinite refresh loop structurally impossible.
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, token, signal, headers = {} } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    credentials: 'include', // HttpOnly refresh cookie for /auth/* flows
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 204) return null;

  if (!response.ok) {
    const { message, details } = await parseErrorResponse(response);
    throw new ApiError(response.status, message, details);
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(response.status, 'Unexpected non-JSON response from server');
  }
}
