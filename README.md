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
