# Vercel execution check

This public sample folder is for a single approved native Vercel code call. The local synthetic model in `tests/helpers/vercel-live-model.ts` supplies a fixed calculation and text input. It requests no file reads, uploads, model account usage, or additional sandbox calls.

Expected output:

```text
A0 SLIM VERCEL EXECUTION CHECK
42
```

Check the execution receipt for **passed / deleted**, then revoke Vercel usage for this test project. A synthetic model reply alone is not evidence that the cloud call succeeded.
