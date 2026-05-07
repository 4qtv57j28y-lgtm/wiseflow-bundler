import { useState } from 'react'
import { login } from '../lib/api'

export default function LoginPage({ onLogin }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setLoading(true)
    try { await login(pw); onLogin() }
    catch { setErr('Incorrect password. Try again.') }
    finally { setLoading(false) }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        {/* Logo strip */}
        <div style={styles.strip}>
          <div style={styles.dot} />
          <div style={styles.dot} />
          <div style={styles.dot} />
        </div>

        <div style={styles.body}>
          <h1 style={styles.title}>MCQ Bundler</h1>
          <p style={styles.sub}>Leeds International Study Centre</p>

          <form onSubmit={submit} style={styles.form}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="Enter access password"
              style={styles.input}
              autoFocus
            />
            {err && <p style={styles.err}>{err}</p>}
            <button type="submit" disabled={loading} style={styles.btn}>
              {loading ? 'Verifying…' : 'Sign In →'}
            </button>
          </form>
        </div>
      </div>

      {/* Background grid */}
      <svg style={styles.grid} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,229,255,0.04)" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>
    </div>
  )
}

const styles = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', position: 'relative', overflow: 'hidden',
    background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 60%, #091221 100%)',
  },
  grid: { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 },
  card: {
    position: 'relative', zIndex: 1,
    width: 380, borderRadius: 16, overflow: 'hidden',
    border: '1px solid rgba(0,229,255,0.15)',
    boxShadow: '0 0 60px rgba(0,229,255,0.06), 0 24px 48px rgba(0,0,0,0.4)',
    background: 'rgba(11,22,44,0.9)',
    backdropFilter: 'blur(20px)',
  },
  strip: {
    height: 6, background: 'linear-gradient(90deg, #00e5ff, #1565c0, #00e5ff)',
    display: 'flex', gap: 0,
  },
  dot: { width: 6, height: 6, borderRadius: '50%' },
  body: { padding: '36px 32px 32px' },
  title: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px', color: '#fff' },
  sub:   { fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 32, letterSpacing: 1, textTransform: 'uppercase' },
  form:  { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase' },
  input: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 15, padding: '12px 14px',
    outline: 'none', transition: 'border 0.2s',
    fontFamily: 'Sora, sans-serif',
  },
  err: { fontSize: 12, color: 'var(--red)', margin: 0 },
  btn: {
    marginTop: 8, padding: '13px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #1565c0, #00bcd4)',
    color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
    letterSpacing: 0.3, transition: 'opacity 0.2s',
    fontFamily: 'Sora, sans-serif',
  },
}
