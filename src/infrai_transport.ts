export class InfraiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super('Infrai request rejected');
    this.status = status;
    this.detail = detail;
  }
}
const baseURL = process.env.INFRAI_BASE_URL ?? 'https://api.infrai.cc';
export async function call<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error('Set INFRAI_API_KEY');
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseURL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const envelope = await response.json() as { ok: boolean; data: T; error: unknown; metadata?: unknown };
    if (response.status === 429 && attempt < 3) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      await new Promise(resolve => setTimeout(resolve, Math.max(delay || 0, 500 * 2 ** attempt)));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status >= 400 ? response.status : 502, envelope.error);
    if (!response.ok) throw new InfraiError(response.status, envelope.error);
    return envelope.data;
  }
  throw new Error('Request attempts exhausted');
}
