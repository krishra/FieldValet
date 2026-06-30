# FieldValet

Navigation shell for the FieldValet janitorial-operations app. Page bodies are
intentionally empty — this scaffolds the structure from the product wireframes.

## Navigation

- **Dashboard**
- **Sales** — Leads · Bids · Proposals · Pipeline
- **Sites** — Site info · Security wall · Work orders
- **Chats**
- **Scheduling** — Calendar · Time clock · Coverage
- **Hiring**

Plain static site (HTML/CSS/vanilla JS), no build step. Routing is hash-based
(`#/sales/bids`) so it works on any static host.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
# visit http://localhost:8080
```

## QuickBooks Online (QBO) integration — Phase 1

Sandbox-only OAuth connection plus a placeholder bid calculator, ahead of real
Estimate/Invoice automation. Sales › Bids now has a working rule-based
calculator (`api/shared/bidCalculator.js`) standing in for the real Excel-based
pricing logic.

**App settings required** (add to `api/local.settings.json` for local dev, and
to the Static Web App's configuration in the Azure Portal for deployed envs —
never commit real secrets):

| Setting | Purpose |
|---|---|
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | From your app at developer.intuit.com |
| `QBO_REDIRECT_URI` | Must exactly match the redirect URI registered with Intuit, e.g. `https://<site>/api/qbo/callback` |
| `QBO_ENV` | `sandbox` (default) or `production` |
| `QBO_INCOME_ACCOUNT_ID` | A QBO Account ID (Income type) that newly-created Items post to — grab one from `/api/qbo/accounts`, required for Phase 2 (work order submission) |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | From the Intuit dashboard's Webhooks tab, after registering the deployed `/api/qbo/webhook` URL — required for Phase 3 (webhook signature verification) |

**Endpoints:**
- `GET /api/qbo/connect` — starts the OAuth flow against Intuit (auth-gated; redirects to Intuit's consent screen).
- `GET /api/qbo/callback` — OAuth redirect target; exchanges the code for tokens and stores them per tenant.
- `GET /api/qbo/accounts` — smoke test; lists the connected sandbox company's chart of accounts.
- `POST /api/bids/calculate` — placeholder bid calculator; `{ squareFootage, frequency, serviceTypes[] }` → line items + total.
- `POST /api/workorders` — creates a draft work order (customer + location + bid calculator input → priced line items).
- `GET /api/workorders` — lists work orders for the tenant.
- `POST /api/workorders/{id}/submit` — finds-or-creates the QBO Customer and Items, then creates a QBO Estimate from the work order's line items.
- `POST /api/workorders/{id}/invoice` — creates a QBO Invoice linked to the work order's Estimate (status must be `submitted` or `approved`).
- `POST /api/qbo/webhook` — anonymous; Intuit calls this when subscribed entities (Estimate, Invoice, Payment) change. Verifies the `intuit-signature` header, then advances work order status (`approved` on Estimate acceptance, `paid` on linked Payment).
- `ReconcileQBO` — timer-triggered (nightly, 3am), not HTTP. Polls QBO's CDC endpoint for anything the webhook missed and runs it through the same status-update logic.

**Work order status flow:** `draft` → `submitted` (Estimate created) → `approved`
(QBO Estimate accepted, detected via webhook or nightly reconciliation) →
`invoiced` (Invoice created) → `paid` (QBO Payment detected).

To test locally: create a Sandbox company at developer.intuit.com, register the
redirect URI, set the app settings above, sign in to FieldValet, then visit
`/api/qbo/connect` to complete the consent flow, followed by `/api/qbo/accounts`
to confirm the connection works. From Sites › Work orders, create a draft,
click "Submit to QuickBooks" to create a real Estimate, then "Create Invoice"
once it's submitted/approved.

**Webhook/reconciliation can only be tested live once deployed** — Intuit
can't deliver webhooks to `localhost`. After deploying (see below), register
the live `/api/qbo/webhook` URL in the Intuit dashboard's Webhooks tab,
subscribe to Estimate/Invoice/Payment, and copy the Verifier Token it gives
you into `QBO_WEBHOOK_VERIFIER_TOKEN` in the Azure Portal's Configuration.

## Deploy — Azure Static Web Apps

This repo includes `.github/workflows/azure-static-web-apps.yml`. To deploy:

1. Create a **Static Web App** in the Azure Portal and connect it to this
   GitHub repo (`krishra/FieldValet`), or run:
   ```bash
   az staticwebapp create -n fieldvalet -g <resource-group> \
     -s https://github.com/krishra/FieldValet -b main \
     --app-location "/" --login-with-github
   ```
2. Azure adds the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret to the repo.
3. Every push to `main` builds and deploys automatically.
