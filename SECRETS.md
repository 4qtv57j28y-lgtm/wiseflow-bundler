# Secrets — How They're Protected

## What goes where

| Secret | Where it lives | Who can read it |
|--------|---------------|-----------------|
| `APP_PASSWORD` | Google Secret Manager | Cloud Run only |
| `JWT_SECRET` | Google Secret Manager | Cloud Run only |
| `GCS_BUCKET` | Google Secret Manager | Cloud Run only |
| `GCP_PROJECT_ID` | GitHub Secrets | GitHub Actions only |
| `GCP_WORKLOAD_PROVIDER` | GitHub Secrets | GitHub Actions only |
| `GCP_DEPLOYER_SA` | GitHub Secrets | GitHub Actions only |

**Nothing sensitive is in the code, the workflow file, or the build logs.**

---

## Why this is secure

### No service account key file
Traditional Google Cloud setups give GitHub a JSON key file that never expires.
If that file leaks (e.g. accidentally committed), anyone can access your project forever.

This setup uses **Workload Identity Federation** instead. GitHub Actions gets a
short-lived token (expires in ~1 hour) automatically. There is no key file.

### Secrets in Secret Manager, not env vars
`APP_PASSWORD` and `JWT_SECRET` are stored in Google Secret Manager.
The deployment command references them by name (`bundler-app-password:latest`),
so their values never appear in the workflow, the build logs, or anywhere in GitHub.

Cloud Run fetches them directly from Secret Manager at startup.

### Principle of least privilege
Two separate service accounts:

| Account | Purpose | What it can do |
|---------|---------|----------------|
| `bundler-deployer` | GitHub Actions | Deploy to Cloud Run, push images |
| `bundler-runtime` | The running app | Read secrets, read/write Firestore + GCS |

GitHub Actions cannot read your secrets. The running app cannot deploy new versions.

---

## GitHub Secrets needed (only 3, none are sensitive values)

| Name | What it is |
|------|-----------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID (not sensitive) |
| `GCP_WORKLOAD_PROVIDER` | The WIF provider resource name (not sensitive) |
| `GCP_DEPLOYER_SA` | The deployer service account email (not sensitive) |

The setup script prints all three values for you to copy.

---

## Rotating secrets

To change your `APP_PASSWORD`:
```bash
echo -n "NEW_PASSWORD" | gcloud secrets versions add bundler-app-password --data-file=-
```
The next Cloud Run request will pick up the new version automatically.
No redeploy needed. Nothing touches GitHub.

---

## If something leaks

| What leaked | What to do |
|-------------|-----------|
| `APP_PASSWORD` | `gcloud secrets versions add bundler-app-password --data-file=-` with new value |
| `JWT_SECRET` | Same — all existing sessions immediately invalidated |
| `GCP_PROJECT_ID` (not sensitive) | Nothing — it's just a name |
| Workload Provider / Deployer SA (not sensitive) | Nothing — they only work from your specific GitHub repo |
