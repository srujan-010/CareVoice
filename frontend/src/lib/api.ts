function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!raw) return 'http://localhost:4000/api';
  const stripped = raw.replace(/\/+$/, '');
  try {
    const parsed = new URL(stripped);
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${stripped}/api`;
    }
    return stripped;
  } catch {
    return stripped;
  }
}

const API_BASE = resolveApiBase();

function formatValidationErrorMessage(payload: {
  message?: string;
  details?: unknown;
} | null, status: number): string {
  const baseMessage = payload?.message || `Request failed with status ${status}`;
  if (!payload?.details || typeof payload.details !== 'object') {
    return baseMessage;
  }

  const detailsObj = payload.details as {
    fieldPaths?: Record<string, string[]>;
    fields?: Record<string, string[]>;
  };
  const fieldMap = detailsObj.fieldPaths ?? detailsObj.fields;
  if (!fieldMap || typeof fieldMap !== 'object') {
    return baseMessage;
  }

  const fieldMessages = Object.entries(fieldMap)
    .flatMap(([field, msgs]) =>
      Array.isArray(msgs) && msgs.length > 0 ? [`${field}: ${msgs[0]}`] : []
    )
    .slice(0, 4);

  if (fieldMessages.length === 0) {
    return baseMessage;
  }
  if (baseMessage.includes(fieldMessages[0])) {
    return baseMessage;
  }
  return `${baseMessage} (${fieldMessages.join('; ')})`;
}

const TOKEN_KEY = 'carevoice_jwt';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, status: number, code = 'API_ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiClientError(
      `Unable to reach CareVoice backend API (${API_BASE}). Please verify your network connection or backend deployment status.`,
      0,
      'NETWORK_ERROR'
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      // Clear stale token if server rejected auth
      if (!path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
        setStoredToken(null);
      }
    }
    throw new ApiClientError(
      formatValidationErrorMessage(payload, response.status),
      response.status,
      payload?.code || 'API_ERROR',
      payload?.details
    );
  }

  return payload?.data as T;
}

export { API_BASE };

