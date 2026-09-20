// Typed API error. `status` mirrors HTTP status; `details` carries backend
// validation payloads ({ error: { message, status, details } }) when present.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.details = details ?? null;
  }
}

// Parse the backend error envelope without ever throwing on malformed bodies.
export async function parseErrorResponse(response) {
  let message = `Request failed with status ${response.status}`;
  let details = null;
  try {
    const body = await response.json();
    if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
      if (typeof body.error.message === 'string' && body.error.message) message = body.error.message;
      if (body.error.details !== undefined) details = body.error.details;
    }
  } catch {
    // Non-JSON error body — keep the default message.
  }
  return { message, details };
}
