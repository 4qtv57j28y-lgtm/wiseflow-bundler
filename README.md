# WISEflow MCQ Script Bundler 🎓

> Private web app · FastAPI + React · Deployed on Google Cloud Run

Generates annotated PDF scripts for every student from a WISEflow MCQ export.
Each PDF includes the exact WISEflow cover sheet, formula sheet, and all 16 questions
with a green ✓ or red ✗ badge per question.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python 3.12) |
| PDF Engine | pypdf + reportlab + pdfminer |
| Frontend | React 18 + Vite |
| Storage | Google Firestore (history) + Cloud Storage (ZIPs) |
| Hosting | Google Cloud Run (serverless, scales to zero) |
| CI/CD | GitHub Actions → Cloud Run |

---

## One-time Setup

### 1 — Google Cloud Project

```bash
# Install gcloud CLI: https://cloud.google.com/sdk/docs/install

gcloud projects create wiseflow-bundler-YOUR_INITIALS
gcloud config set project wiseflow-bundler-YOUR_INITIALS

# Enable APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  containerregistry.googleapis.com

# Create Firestore database (Native mode)
gcloud firestore databases create --location=europe-west2

# Create GCS bucket for output ZIPs
gsutil mb -l europe-west2 gs://wiseflow-bundler-outputs
```

### 2 — Service Account (for GitHub Actions)

```bash
# Create service account
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Deployer"

SA=github-deployer@$(gcloud config get project).iam.gserviceaccount.com

# Grant required roles
for ROLE in \
  roles/run.admin \
  roles/storage.admin \
  roles/datastore.user \
  roles/iam.serviceAccountUser \
  roles/containerregistry.ServiceAgent; do
  gcloud projects add-iam-policy-binding $(gcloud config get project) \
    --member="serviceAccount:$SA" --role="$ROLE"
done

# Download key
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=$SA

cat sa-key.json   # ← copy this entire JSON blob
rm sa-key.json    # ← delete the local copy
```

### 3 — GitHub Secrets

In your repository → **Settings → Secrets → Actions**, add:

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_SA_KEY` | The entire JSON from step 2 |
| `APP_PASSWORD` | Your chosen login password |
| `JWT_SECRET` | Random string (run: `openssl rand -hex 32`) |
| `GCS_BUCKET` | `wiseflow-bundler-outputs` |

### 4 — Push to GitHub

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/wiseflow-bundler.git
git add .
git commit -m "Initial commit"
git push -u origin main
```

GitHub Actions deploys automatically. Watch the **Actions** tab.
When done, the URL appears in the deploy step log.

---

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
APP_PASSWORD=dev123 JWT_SECRET=dev uvicorn main:app --reload --port 8080

# Frontend (separate terminal)
cd frontend
npm install
VITE_API_URL=http://localhost:8080 npm run dev
# → opens http://localhost:5173
```

---

## Using the App

1. **Sign in** with your `APP_PASSWORD`
2. **Dashboard** shows all past runs with download buttons
3. **+ New Run** opens a 4-step wizard:
   - **Files** — drag & drop the WISEflow ZIP and Template PDF
   - **Scores** — the student list auto-loads; enter marks (0–16), or export/import CSV
   - **Configure** — choose naming convention and optional prefix
   - **Generate** — watch live progress, then download the ZIP
4. Past runs stay in the history and can be re-downloaded or deleted

---

## Files You Need Each Time

| File | Source |
|------|--------|
| `WISEflow_XXXX.zip` | WISEflow → Managing → Download all files |
| `Template.pdf` | The question paper PDF showing correct answers |
| Scores | Either from WISEflow Marking Overview PDF, or a CSV |

### Scores CSV format

```csv
participant_number,name,student_number,institution,mark,q1,q2,q3,...,q16
1,Daiyi WU,2940632,SGDL,8,0,0,0,0,0,0,1,1,1,1,1,1,0,1,0,1
2,Haozheng TIAN,2940633,SGDL,3,0,0,0,0,0,0,1,0,0,0,0,0,0,1,1,0
```

- `mark` = total correct out of 16
- `q1`–`q16` = 1 if correct, 0 if wrong/not attempted

---

## Costs (Google Cloud)

For typical usage (50–60 students, a few times per year):

| Service | Usage | Cost |
|---------|-------|------|
| Cloud Run | < 1000 requests/month | **Free** |
| Firestore | < 50K reads/day | **Free** |
| Cloud Storage | < 5 GB | **Free** |
| Container Registry | < 0.5 GB | **~$0.05/month** |

**Effectively free for this use case.**

---

## Project Structure

```
wiseflow-bundler/
├── backend/
│   ├── main.py            FastAPI app + auth + endpoints
│   ├── pdf_generator.py   All PDF generation logic
│   ├── history.py         Firestore / SQLite run storage
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── lib/api.js     API client
│   │   └── components/
│   │       ├── LoginPage.jsx
│   │       ├── Dashboard.jsx   Run history
│   │       └── NewRun.jsx      4-step wizard
│   └── package.json
├── .github/workflows/
│   └── deploy.yml         Auto-deploy on push to main
├── Dockerfile
└── README.md              ← you are here
```

---

## Giving Access to Another Person

Since this is password-protected with a single password:

- Just share the URL and the `APP_PASSWORD`
- To change the password: update the `APP_PASSWORD` GitHub secret and push any commit to trigger a redeploy

To make it fully multi-user with separate accounts, open an issue and that can be added.

---

© Leeds International Study Centre · Saman Aravinda · 2026
