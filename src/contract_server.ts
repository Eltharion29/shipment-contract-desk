import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { releaseDecision } from './delivery_decision.ts';
import { call, InfraiError } from './infrai_transport.ts';

const file = z.object({ name: z.string().min(1), data_base64: z.string().min(1) }).strict();
const requestBody = z.object({
  requestId: z.string().uuid(),
  shipmentId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  contractPdf: z.string().min(1),
  events: z.array(z.object({ kind: z.enum(['picked_up', 'delivered', 'exception', 'resolved']), at: z.string().datetime() }).strict()).min(1),
  proofOfDelivery: z.array(file),
}).strict();
const bucket = process.env.CONTRACT_BUCKET ?? 'shipment-contracts';
// Provision storage before accepting shipment requests.
await call('/v1/storage/bucket/create', { name: bucket });
const cert_pem = await readFile(process.env.SIGN_CERT_PATH ?? 'cert.pem', 'utf8');
const key_pem = await readFile(process.env.SIGN_KEY_PATH ?? 'key.pem', 'utf8');
const operations = new Map<string, { payload: string; result: Promise<unknown> }>();

async function signDelivery(input: z.infer<typeof requestBody>) {
  const events = input.events.map(({ kind, at }) => ({ kind, at })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (releaseDecision(events, input.proofOfDelivery.length) === 'hold') {
    return { shipmentId: input.shipmentId, state: 'held', nextAction: 'Record delivery, attach proof, and resolve open exceptions' };
  }
  const signed = await call<{ pdf: string }>('/v1/pdf/sign', {
    pdf: input.contractPdf, cert_pem, key_pem, reason: `Delivery ${input.shipmentId}`, retention_days: 7,
  });
  const signedPdf = z.string().min(1).parse(signed.pdf);
  const prefix = `${input.shipmentId}/${input.requestId}`;
  async function store(key: string, data: string, contentType: string) {
    const path = `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;
    const upload = await call<{ url: string }>(path, { op: 'put', expires_seconds: 900, content_type: contentType, idempotency_key: `${input.requestId}:${key}` });
    const bytes = Buffer.from(data, 'base64');
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
      if (response.ok) return path;
      if (response.status !== 429 || attempt === 3) throw new Error('Document upload rejected');
      const retry = response.headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      await new Promise(resolve => setTimeout(resolve, Math.max(delay || 0, 500 * 2 ** attempt)));
    }
    throw new Error('Upload attempts exhausted');
  }
  for (const [index, proof] of input.proofOfDelivery.entries()) {
    await store(`${prefix}/proof-${index}`, proof.data_base64, 'application/octet-stream');
  }
  const path = await store(`${prefix}/signed.pdf`, signedPdf, 'application/pdf');
  const download = await call<{ url: string }>(path, { op: 'get', expires_seconds: 900 });
  return { shipmentId: input.shipmentId, state: 'signed', downloadUrl: download.url, expiresSeconds: 900 };
}
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST' || req.url !== '/contracts/sign') { res.writeHead(404).end(); return; }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const input = requestBody.parse(JSON.parse(Buffer.concat(chunks).toString()));
    const payload = JSON.stringify(input);
    let operation = operations.get(input.requestId);
    if (operation && operation.payload !== payload) { res.writeHead(409).end(JSON.stringify({ error: 'Request ID already used for another payload' })); return; }
    if (!operation) {
      operation = { payload, result: signDelivery(input) };
      operations.set(input.requestId, operation);
    }
    res.end(JSON.stringify(await operation.result));
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof InfraiError ? (error.status >= 500 ? 502 : error.status) : 502;
    res.writeHead(status).end(JSON.stringify({ error: error instanceof InfraiError ? error.detail : error instanceof Error ? error.message : 'Request failed' }));
  }
}).listen(3001, '127.0.0.1', () => console.log('Contract desk listening on 3001'));
