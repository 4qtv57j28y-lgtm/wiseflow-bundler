# GDPR Compliance — WISEflow MCQ Bundler

## Lawful basis

Processing is carried out under **Article 6(1)(c)** — legal obligation (assigning
marks and returning assessed work to students) — and **Article 6(1)(e)** — public task
(educational assessment within a university context).

---

## Personal data involved

| Data | Category | Source | Purpose |
|------|----------|--------|---------|
| Student full name | Personal | WISEflow ZIP | PDF filename / cover sheet |
| Student number | Personal | WISEflow ZIP | PDF filename / cover sheet |
| Institution | Personal | WISEflow ZIP | Cover sheet display |
| Exam scores (0/1 per question) | Personal | Manually entered | Badge overlay |

---

## Data flow — where data goes and does NOT go

```
Lecturer's browser
      │
      │  Upload (HTTPS, encrypted in transit)
      ▼
Cloud Run — RAM only
      │
      │  Process: ZIP + Template + Scores → PDFs → output ZIP
      │
      │  No disk writes (template tmpfile deleted immediately in finally block)
      │  No database writes of personal data
      │  No GCS uploads of personal data
      │
      │  Stream ZIP back (HTTPS)
      ▼
Lecturer's browser — download starts
      │
      ▼
ZIP deleted from Cloud Run RAM immediately after streaming

```

---

## What is stored (and what is not)

### Run history database (Firestore / SQLite)

Stores per run:
- ✅ Run ID (UUID — not linked to any individual)
- ✅ Timestamp
- ✅ Naming convention used
- ✅ Optional prefix used
- ✅ Count of PDFs generated
- ✅ Count of errors

Does NOT store:
- ❌ Student names
- ❌ Student numbers
- ❌ Institutions
- ❌ Exam scores
- ❌ PDF files
- ❌ ZIP files

**Run history records are automatically deleted after 90 days.**

### Server logs

Cloud Run logs are filtered before writing.
Any log line containing the words "student", "name", "number", "institution",
or "centre" is replaced with `[log suppressed — potential personal data]`.

Logs contain only:
- ✅ HTTP status codes
- ✅ Run UUIDs
- ✅ PDF counts
- ✅ Error types (not messages)

### Browser (frontend)

- ❌ No token in localStorage or sessionStorage
- ❌ No student data in localStorage or sessionStorage
- ✅ Session managed via httpOnly cookie (not readable by JavaScript)
- ✅ Scores held only in React state (cleared when browser tab closes)

---

## Retention

| Data | Retention | Deletion mechanism |
|------|-----------|-------------------|
| Uploaded files (RAM) | Duration of generation (~minutes) | Explicit `del` + GC |
| Generated ZIP (RAM) | Until first download | Removed from dict on first access |
| Job state (RAM) | 1 hour maximum | Auto-purged by `_purge_old_jobs()` |
| Run metadata (DB) | 90 days | `_purge_old()` called on every list request |
| Firestore / SQLite | 90 days | Auto-deletion policy |

---

## Technical security measures

| Measure | Implementation |
|---------|---------------|
| Encryption in transit | HTTPS enforced via Cloud Run + HSTS header |
| Encryption at rest | Cloud Run memory not persisted; Firestore encrypted at rest by Google |
| XSS protection | httpOnly cookie (JWT inaccessible to JS); CSP header |
| CSRF protection | SameSite=Strict cookie |
| Clickjacking | X-Frame-Options: DENY |
| Timing attack | hmac.compare_digest for password check |
| CORS | Exact origin match — no wildcard |
| Secrets | Google Secret Manager — never in code or logs |
| Least privilege | Separate deploy SA and runtime SA |

---

## Data Processing Agreement

This application runs on **Google Cloud (europe-west2 — London region)**.
Google Cloud is covered by Google's Data Processing Addendum (DPA) which satisfies
Article 28 GDPR requirements.

Reference: https://cloud.google.com/terms/data-processing-addendum

Data **never leaves the UK / EEA region** — `europe-west2` is London.

---

## Data subject rights

Because no personal data is stored beyond the duration of a single generation job:

| Right | Response |
|-------|----------|
| Right of access (Art. 15) | No stored personal data to provide |
| Right to erasure (Art. 17) | Nothing to delete — data is already gone |
| Right to rectification (Art. 16) | Not applicable |
| Right to portability (Art. 20) | Not applicable |

---

## Incident response

If a breach is suspected:

1. Rotate `APP_PASSWORD` and `JWT_SECRET` immediately in Secret Manager
2. All active sessions are invalidated (JWT secret changed)
3. Review Cloud Run logs for anomalous access patterns
4. Notify DPO within 72 hours if personal data exposure is confirmed (Art. 33)

---

*Last reviewed: May 2026 · Maintainer: Saman Aravinda · Leeds ISC*
