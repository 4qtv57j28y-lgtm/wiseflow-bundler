/**
 * API client — GDPR-compliant
 *
 * Auth: httpOnly cookie set by server (JS cannot read it — XSS safe)
 *       No token stored in localStorage or sessionStorage.
 *
 * Personal data: scores are held only in React component state
 *                and sent once to the server during generation.
 *                They are never written to localStorage, sessionStorage,
 *                IndexedDB, or any persistent browser storage.
 */

const BASE = import.meta.env.VITE_API_URL || ''

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',   // Send httpOnly cookie automatically
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (res.status === 401) {
    // Session expired — redirect to login without leaking URL state
    window.location.replace('/')
    return
  }
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function login(password) {
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  // No token stored — server set httpOnly cookie
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' })
  // Cookie cleared by server
}

export async function checkSession() {
  // Ping a protected endpoint to verify session is still valid
  try {
    await api('/api/runs')
    return true
  } catch {
    return false
  }
}

export async function listRuns() {
  return api('/api/runs')
}

export async function deleteRun(id) {
  await api(`/api/runs/${id}`, { method: 'DELETE' })
}

export async function startGeneration(zipFile, templateFile, scores, naming, prefix) {
  const fd = new FormData()
  fd.append('zip_file', zipFile)
  fd.append('template_file', templateFile)
  fd.append('naming', naming)
  fd.append('prefix', prefix)
  fd.append('scores_json', JSON.stringify(scores))

  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    credentials: 'include',
    body: fd,   // No Content-Type header — browser sets multipart boundary
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function pollJob(jobId) {
  return api(`/api/generate/${jobId}/status`)
}

export function downloadUrl(jobId) {
  // Returns URL for one-time download — server deletes ZIP after streaming
  return `${BASE}/api/generate/${jobId}/download`
}
