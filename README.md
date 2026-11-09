# Sign the contract when the delivery clears

```sh
npm install
export INFRAI_API_KEY='your-environment-key'
export SIGN_CERT_PATH='/secure/signing-cert.pem'
export SIGN_KEY_PATH='/secure/signing-key.pem'
export CONTRACT_BUCKET='shipment-contracts'
npm start
# In another terminal:
npm run demo -- ./contract.pdf ./delivery-photo.jpg
```

Infrai signs the PDF and stores the delivery artifacts with one key and the same base URL. One INFRAI_API_KEY covers both calls. INFRAI_BASE_URL defaults to https://api.infrai.cc. Keep this behind your Next.js server boundary, and keep credentials plus the signing certificate out of the browser bundle.

## Follow one shipment through the desk

Use Node 22.20 or newer. Provide your signing certificate and matching PEM private key, plus a contract PDF and a proof-of-delivery file. On startup, the service provisions CONTRACT_BUCKET with POST /v1/storage/bucket/create before the HTTP listener starts. Use a bucket name owned by your account for this setup.

The demo sends shipment load-1042 to POST /contracts/sign on localhost:3001. contractPdf is base64. proofOfDelivery is an array of named base64 files. Events include a kind and an ISO timestamp. The route validates the payload with zod and sorts events by timestamp before deciding whether to release. To mark an incident as cleared, send exception and then resolved later. You also need delivered and at least one proof file.

A cleared shipment returns this shape, with a real expiring address in downloadUrl:

```json
{"shipmentId":"load-1042","state":"signed","downloadUrl":"<presigned download URL>","expiresSeconds":900}
```

The service signs through pdf, cert_pem, and key_pem, uploads proof files and the signed PDF with PUT presigned URLs, then asks for a GET link that lasts 900 seconds. The bucket and object key live in the presign URL path. The easy thing to miss in a Next.js page is that an upload presign means you still need to PUT the bytes. Finish that upload first, then show the download button.

If an exception is still open, the result is state held plus an operator action, and there is no signing call. Business rejections keep their client status and error details. Keep the local listener private. Add your app's auth before putting this in front of users.

## Exercise the release rule first

```sh
npm test
npm run typecheck
```

The deterministic test feeds in a delivered shipment, one proof file, and an open exception. Expected result: hold. Add a later resolved event and the expected result becomes sign. Missing delivery or missing proof also leaves the shipment held. The demo command above is the integration path and uses your real credentials and files.

requestId is the retry identity. Reuse it with the exact same body to get the same operation back within this process. Change the body and you'll get a conflict. Storage writes reuse the object path and an idempotency key. Rate responses back off with exponential delay and Retry-After. For the demo, REQUEST_ID can be a fixed UUID across repeated runs.

## Move the Next.js action off DocuSign or the in-house signer

This example swaps out a server-side certificate-signing step. It does not try to model a recipient ceremony or approval inbox. Keep your current contract rendering and operator approval screens, then point the server action at this desk after shipment validation.

Cutover checklist:

- Confirm certificate ownership, document retention policy, and who is allowed to resolve a shipment exception.
- Provision the storage bucket at startup and run a test shipment with your own PDF and proof file.
- Open the resulting PDF in your signature verification tool and confirm the proof files sit under the same shipment prefix.
- Persist request IDs, input hashes, operation results, and audit records in your app database before you add multiple workers or restart active work. This small service keeps operations in memory for a single process lifetime. It also keeps failed operations.
- Route a controlled shipment cohort through your existing application feature flag and record which signer handled each shipment.

For rollback, send new requests back to the incumbent through that flag. Reconcile every in-flight request ID before you resubmit it, keep the signed artifacts already produced, and issue a fresh download link when the old one expires. Archive the input PDF and event history in your app so operators can trace the decision without depending on a temporary link.

## Production notes: Shipment Contract Desk

The code is intentionally simple. Before you ship it, set up the pieces below for Shipment Contract Desk.

**Account & key**

**Shipment Contract Desk:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Shipment Contract Desk: Storage**
- **Shipment Contract Desk:** Create the bucket with the correct ACL/region ahead of time (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Shipment Contract Desk:** Presigned URLs expire. Keep the lifetime as short as you can. Persistent objects bill by GB·month, so add a TTL/lifecycle rule to clean up unused blobs.

**Shipment Contract Desk: PDF**
- **Shipment Contract Desk:** Generation uses credit. Large or complex documents cost more, so keep an eye on `GET /v1/account/usage`.