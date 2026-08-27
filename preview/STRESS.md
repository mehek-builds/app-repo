# Popup stress gallery

This dev-only page renders the real popup components in isolated iframes. It is not included in the WXT extension build.

## Run it

```bash
npm run preview
```

Open `http://localhost:4700/preview-stress.html`.

The existing preview command starts the shared mock server, but this gallery uses its own browser-local fixture layer. The fixture layer intercepts only known popup API paths, returns deterministic data, holds selected requests pending for loading states, and fails closed for any unknown popup API request. It never calls production data.

## Coverage

The gallery includes:

- Signup, returning sign-in, missing or invalid resume, long filename, verification code, and resume parsing
- Every answer-setup step, plus no experience, many entries, loading, load error, save pending, save error, completion, sign-out confirmation, plan lock, earned-consent lock, and earned permission
- Main-screen zero, one, and very large draft counts, long job content, recent-event error, contact loading, and contact permission denial
- Contacts with loading, zero, one incomplete record, and many records
- Drafts with zero generated content, loading, error, permission denial, one complete draft, long incomplete content, and a pending sent-status write
- Email history with loading, error, zero, one incomplete event, many events, and a pending status update
- Free, trial, paid, checkout pending, and checkout error plan states
- 320px and the shipped 380px popup widths

Every gallery card has `data-stress-card`, `data-stress-component`, and `data-stress-width`. Each iframe has `data-stress-frame`. Inside each iframe, automation can wait for `[data-stress-status="ready"]` and fail if `[data-stress-status="driver-error"]` appears.

## Intentional exclusions

Dark mode is skipped because the extension does not support it.

Employer-page cards are not recreated here. Their renderers are nested inside WXT content entrypoints and are not importable as real components. A lookalike would not test the shipped surface. Test those cards with the real built WXT extension against local employer fixture pages at their actual injected width.
