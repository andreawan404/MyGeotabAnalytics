// Single wrapper around the MyGeotab host API. No other module may call
// api.call / api.multiCall directly (see root CLAUDE.md).

export interface GeotabApi {
  call: (method: string, params: object, cb: (result: any) => void, errCb?: (error: any) => void) => void;
  multiCall: (calls: [string, object][], cb: (results: any[]) => void, errCb?: (error: any) => void) => void;
}

let geotabApi: GeotabApi | null = null;

/** Called once from addin.ts initialize(api, ...) to store the host-injected api. */
export function initGeotabClient(api: GeotabApi): void {
  geotabApi = api;
}

function getApi(): GeotabApi {
  if (!geotabApi) {
    // Programming mistake (initGeotabClient not called before use), not a runtime scenario — throw, don't swallow.
    throw new Error('geotabClient not initialized: call initGeotabClient(api) from addin.ts initialize() first');
  }
  return geotabApi;
}

/** MyGeotab errors are shaped {name, message, errors}. No name, or a name that looks
 * like a transport hiccup, is worth retrying. A recognized exception name (e.g.
 * InvalidUserException) is a real failure — don't retry it. */
export function isTransientError(error: any): boolean {
  return !error?.name || /timeout|unavailable|connection/i.test(error.name);
}

const MAX_ATTEMPTS = 3;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS || !isTransientError(err)) throw err;
    }
  }
  throw lastError;
}

export function callApi<T = any>(method: string, params: object = {}): Promise<T> {
  const api = getApi(); // synchronous throw if not initialized
  return withRetry(
    () => new Promise<T>((resolve, reject) => {
      api.call(method, params, resolve, reject);
    })
  );
}

export function multiCall<T extends any[] = any[]>(calls: [string, object][]): Promise<T> {
  const api = getApi(); // synchronous throw if not initialized
  return withRetry(
    () => new Promise<T>((resolve, reject) => {
      api.multiCall(calls, (results) => resolve(results as T), reject);
    })
  );
}
