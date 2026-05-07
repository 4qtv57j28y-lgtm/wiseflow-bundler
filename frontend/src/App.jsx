import { useState, useEffect } from 'react'
import { checkSession, logout } from './lib/api'
import LoginPage  from './components/LoginPage'
import Dashboard  from './components/Dashboard'
import NewRun     from './components/NewRun'

export default function App() {
  const [auth, setAuth] = useState(null)   // null=checking, true, false
  const [view, setView] = useState('dashboard')

  useEffect(() => {
    // Check if httpOnly session cookie is still valid on load
    checkSession().then(setAuth)
  }, [])

  if (auth === null) return <Loading />
  if (!auth) return <LoginPage onLogin={() => setAuth(true)} />

  async function handleLogout() {
    await logout()
    setAuth(false)
    setView('dashboard')
  }

  return (
    <>
      <div style={nav}>
        <span style={navLabel}>Leeds ISC · MCQ Bundler</span>
        <button onClick={handleLogout} style={navBtn}>Sign out</button>
      </div>
      {view === 'dashboard' && <Dashboard onNewRun={() => setView('new-run')} />}
      {view === 'new-run'   && <NewRun onBack={() => setView('dashboard')}
                                       onDone={() => setView('dashboard')} />}
    </>
  )
}

function Loading() {
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',
                 justifyContent:'center',color:'var(--muted)'}}>
      Checking session…
    </div>
  )
}

const nav    = { position:'fixed',top:0,right:0,padding:'12px 20px',
                  display:'flex',gap:16,alignItems:'center',zIndex:50 }
const navLabel = { fontSize:11, color:'rgba(255,255,255,0.3)', letterSpacing:0.5 }
const navBtn = { fontSize:11, color:'rgba(255,255,255,0.4)', background:'none',
                  border:'1px solid rgba(255,255,255,0.1)', borderRadius:6,
                  padding:'4px 10px', cursor:'pointer', fontFamily:'Sora,sans-serif' }
