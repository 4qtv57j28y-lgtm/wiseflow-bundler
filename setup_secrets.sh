#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  WISEflow Bundler — Secure One-Time Setup               ║
# ║  Run this ONCE locally. Never commit this file          ║
# ║  with real values filled in.                            ║
# ╚══════════════════════════════════════════════════════════╝
#
# BEFORE RUNNING:
#   1. Install gcloud CLI:  https://cloud.google.com/sdk/docs/install
#   2. Run:  gcloud auth login
#   3. Fill in the variables below

set -euo pipefail

# ── EDIT THESE ───────────────────────────────────────────────
PROJECT_ID="wiseflow-bundler-YOUR_INITIALS"    # e.g. wiseflow-bundler-sa
GITHUB_REPO="YOUR_USERNAME/wiseflow-bundler"   # e.g. saman-aravinda/wiseflow-bundler
REGION="europe-west2"                          # London
APP_PASSWORD="CHOOSE_A_STRONG_PASSWORD"        # your login password
# ─────────────────────────────────────────────────────────────

JWT_SECRET=$(openssl rand -hex 32)
GCS_BUCKET="${PROJECT_ID}-outputs"

echo ""
echo "=== Setting up project: $PROJECT_ID ==="

# 1. Create & configure project
gcloud projects create "$PROJECT_ID" --name="WISEflow Bundler" 2>/dev/null || true
gcloud config set project "$PROJECT_ID"

echo "→ Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  containerregistry.googleapis.com \
  --quiet

# 2. Firestore & Storage
echo "→ Creating Firestore database..."
gcloud firestore databases create --location="$REGION" --quiet 2>/dev/null || true

echo "→ Creating GCS bucket..."
gsutil mb -l "$REGION" "gs://$GCS_BUCKET" 2>/dev/null || true
# Lifecycle: auto-delete ZIPs older than 90 days
cat > /tmp/lifecycle.json <<EOF
{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}
EOF
gsutil lifecycle set /tmp/lifecycle.json "gs://$GCS_BUCKET"

# 3. Secret Manager — store secrets, never in code or logs
echo "→ Storing secrets in Secret Manager..."

store_secret() {
  local NAME="$1" VALUE="$2"
  echo -n "$VALUE" | gcloud secrets create "$NAME" \
    --data-file=- --replication-policy=automatic 2>/dev/null || \
  echo -n "$VALUE" | gcloud secrets versions add "$NAME" --data-file=-
}

store_secret "bundler-app-password" "$APP_PASSWORD"
store_secret "bundler-jwt-secret"   "$JWT_SECRET"
store_secret "bundler-gcs-bucket"   "$GCS_BUCKET"

# 4. Workload Identity Federation — no SA key file needed
echo "→ Setting up Workload Identity Federation..."

WIF_POOL="github-pool"
WIF_PROVIDER="github-provider"

gcloud iam workload-identity-pools create "$WIF_POOL" \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --quiet 2>/dev/null || true

POOL_ID=$(gcloud iam workload-identity-pools describe "$WIF_POOL" \
  --location=global --format="value(name)")

gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIF_POOL" \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --quiet 2>/dev/null || true

PROVIDER_ID=$(gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIF_POOL" \
  --format="value(name)")

# 5. Service account for Cloud Run (runtime identity)
SA_NAME="bundler-runtime"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "→ Creating service account..."
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Bundler Runtime" --quiet 2>/dev/null || true

# Grant SA access to secrets
for SECRET in bundler-app-password bundler-jwt-secret bundler-gcs-bucket; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" --quiet
done

# Grant SA access to Firestore + GCS
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role="roles/datastore.user" --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin" --quiet

# 6. Allow GitHub Actions to deploy (via WIF — no key file)
GITHUB_SA_NAME="bundler-deployer"
GITHUB_SA="${GITHUB_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$GITHUB_SA_NAME" \
  --display-name="Bundler Deployer (GitHub Actions)" --quiet 2>/dev/null || true

for ROLE in \
  roles/run.admin \
  roles/storage.admin \
  roles/iam.serviceAccountUser \
  roles/containerregistry.ServiceAgent; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$GITHUB_SA" --role="$ROLE" --quiet
done

# Allow GitHub repo to impersonate the deployer SA
gcloud iam service-accounts add-iam-policy-binding "$GITHUB_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --quiet

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DONE. Add these 3 secrets to GitHub:                  ║"
echo "║  Settings → Secrets → Actions → New repository secret  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║"
echo "║  GCP_PROJECT_ID    =  $PROJECT_ID"
echo "║"
echo "║  GCP_WORKLOAD_PROVIDER  ="
echo "║    $PROVIDER_ID"
echo "║"
echo "║  GCP_DEPLOYER_SA   =  $GITHUB_SA"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  APP_PASSWORD and JWT_SECRET are already in Secret Manager."
echo "  They never need to go into GitHub."
echo ""
echo "  JWT_SECRET (saved for your reference — don't share):"
echo "  $JWT_SECRET"
