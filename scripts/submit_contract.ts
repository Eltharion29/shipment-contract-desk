import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const [contract, proof] = process.argv.slice(2);
if (!contract || !proof) throw new Error('Pass contract.pdf and delivery-proof file paths');
const response = await fetch('http://127.0.0.1:3001/contracts/sign', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    requestId: process.env.REQUEST_ID ?? randomUUID(), shipmentId: 'load-1042',
    contractPdf: (await readFile(contract)).toString('base64'),
    events: [{ kind: 'delivered', at: '2026-11-01T12:00:00Z' }],
    proofOfDelivery: [{ name: proof, data_base64: (await readFile(proof)).toString('base64') }],
  }),
});
const result: unknown = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
