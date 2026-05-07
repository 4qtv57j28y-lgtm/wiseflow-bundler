import { useEffect, useState } from 'react'
import { listRuns, deleteRun, downloadUrl } from '../lib/api'
import { formatDistanceToNow } from 'date-fns'

const STATUS_COLOUR = { ok: '#43a047', error: '#e53935', partial: '#f57c00' }

function RunCard({ run, onDelete, onSelect }) {
  const errCount = run.errors || 0
  const okCount  = run.ok    || 0
  const status   = errCount === 0 ? 'ok' : okCount === 0 ? 'error' : 'partial'
  const created  = run.created_at
    ? formatDistanceToNow(new Date(run.created_at), { addSuffix: true })
    : '—'

  return (
    <div style={card.wrap} onClick={() => onSelect(run.run_id)}>
      {/* Left accent bar */}
      <div style={{ ...card.bar, background: STATUS_COLOUR[status] }} />

      <div style={card.body}>
        <div style={card.row}>
          <span style={card.date}>{created}</span>
          <span style={{ ...card.badge, background: STATUS_COLOUR[status] + '22',
                          color: STATUS_COLOUR[status] }}>
            {status === 'ok' ? '✓ Complete' : status === 'error' ? '✗ Failed' : '⚠ Partial'}
          </span>
        </div>

        <div style={card.stats}>
          <Stat label="PDFs" value={okCount} />
          <Stat label="Errors" value={errCount} accent={errCount > 0 ? '#e53935' : undefined} />
          <Stat label="Naming" value={run.naming?.replace('_',' ') || '—'} />
          {run.prefix && <Stat label="Prefix" value={`"${run.prefix}"`} />}
        </div>
      </div>

      {/* Actions */}
      <div style={card.actions} onClick={e => e.stopPropagation()}>
        <a href={downloadUrl(run.run_id)} download
           style={card.btn} title="Download ZIP">
          ↓
        </a>
        <button onClick={() => onDelete(run.run_id)} style={card.del} title="Delete">
          ✕
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div style={card.stat}>
      <span style={{ ...card.statVal, ...(accent ? { color: accent } : {}) }}>
        {value}
      </span>
      <span style={card.statLabel}>{label}</span>
    </div>
  )
}

export default function Dashboard({ onNewRun }) {
  const [runs, setRuns]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  async function load() {
    setLoading(true)
    try { const d = await listRuns(); setRuns(d.runs || []) }
    catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    if (!confirm('Delete this run and its ZIP?')) return
    await deleteRun(id); load()
  }

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={hdr.outer}>
        <div>
          <h1 style={hdr.title}>MCQ Script Bundler</h1>
          <p style={hdr.sub}>Leeds International Study Centre · WISEflow Export Processor</p>
        </div>
        <button onClick={onNewRun} style={hdr.btn}>
          + New Run
        </button>
      </div>

      {/* Stats strip */}
      <div style={strip.row}>
        {[
          { label: 'Total Runs',   val: runs.length },
          { label: 'PDFs Created', val: runs.reduce((a,r) => a+(r.ok||0),0) },
          { label: 'Students',     val: new Set(runs.flatMap(r => (r.students||[]).map(s=>s.student_number))).size },
        ].map(({label,val}) => (
          <div key={label} style={strip.card}>
            <span style={strip.val}>{val}</span>
            <span style={strip.label}>{label}</span>
          </div>
        ))}
      </div>

      {/* Run list */}
      <div style={list.outer}>
        <div style={list.hdr}>
          <span style={list.title}>Run History</span>
          <button onClick={load} style={list.refresh}>↺ Refresh</button>
        </div>

        {loading && <p style={empty}>Loading…</p>}
        {!loading && runs.length === 0 && (
          <div style={emptyState}>
            <div style={emptyIcon}>📄</div>
            <p>No runs yet. Click <strong>+ New Run</strong> to generate your first batch of PDFs.</p>
          </div>
        )}

        {runs.map(r => (
          <RunCard key={r.run_id} run={r}
                   onDelete={handleDelete}
                   onSelect={setSelected} />
        ))}
      </div>

      {/* Detail drawer */}
      {selected && (
        <RunDetail runId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function RunDetail({ runId, onClose }) {
  const [run, setRun] = useState(null)
  useEffect(() => {
    import('../lib/api').then(a => a.getRun(runId)).then(setRun)
  }, [runId])

  if (!run) return null
  const students = run.students || []

  return (
    <div style={drawer.overlay} onClick={onClose}>
      <div style={drawer.panel} onClick={e => e.stopPropagation()}>
        <div style={drawer.hdr}>
          <span style={drawer.title}>Run Detail</span>
          <button onClick={onClose} style={drawer.close}>✕</button>
        </div>
        <div style={drawer.meta}>
          <span>Run ID: <code style={drawer.code}>{runId.slice(0,8)}</code></span>
          <span>{run.ok} PDFs · {run.errors} errors</span>
          <a href={downloadUrl(runId)} download style={drawer.dlBtn}>↓ Download ZIP</a>
        </div>
        <div style={drawer.table}>
          <div style={drawer.thead}>
            <span>Name</span><span>Stud No</span><span>Institution</span><span>Mark</span><span>File</span>
          </div>
          {students.map((s,i) => (
            <div key={i} style={{ ...drawer.row,
                                   background: s.status==='error' ? 'rgba(229,57,53,0.08)' :
                                               i%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <span>{s.name}</span>
              <span style={drawer.mono}>{s.student_number||'—'}</span>
              <span>{s.institution||'—'}</span>
              <span style={{ color: '#00e5ff', fontWeight: 600 }}>{s.mark!=null ? `${s.mark}/16` : '—'}</span>
              <span style={drawer.mono}>{s.filename || (s.error ? '✗ ' + s.error : '—')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────────
const wrap = { minHeight: '100vh', padding: '32px', maxWidth: 1100, margin: '0 auto' }

const hdr = {
  outer: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:32 },
  title: { fontSize:32, fontWeight:700, letterSpacing:-1, color:'#fff' },
  sub:   { fontSize:12, color:'var(--muted)', marginTop:4, letterSpacing:0.5 },
  btn:   { padding:'10px 22px', borderRadius:8, border:'1px solid rgba(0,229,255,0.3)',
            background:'rgba(0,229,255,0.08)', color:'var(--accent)',
            fontSize:14, fontWeight:600, cursor:'pointer', letterSpacing:0.3,
            fontFamily:'Sora,sans-serif' },
}

const strip = {
  row:  { display:'flex', gap:16, marginBottom:32 },
  card: { flex:1, background:'var(--card)', border:'1px solid var(--border)',
           borderRadius:'var(--radius)', padding:'20px 24px',
           display:'flex', flexDirection:'column', gap:4 },
  val:  { fontSize:32, fontWeight:700, color:'var(--accent)', letterSpacing:-1 },
  label:{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1 },
}

const list = {
  outer:   { display:'flex', flexDirection:'column', gap:10 },
  hdr:     { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  title:   { fontSize:14, fontWeight:600, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1 },
  refresh: { fontSize:12, color:'var(--muted)', background:'none', border:'none',
              cursor:'pointer', padding:'4px 8px', borderRadius:4,
              fontFamily:'Sora,sans-serif' },
}

const card = {
  wrap: { display:'flex', background:'var(--card)', border:'1px solid var(--border)',
           borderRadius:'var(--radius)', overflow:'hidden', cursor:'pointer',
           transition:'border-color 0.2s, box-shadow 0.2s',
           ':hover': { borderColor:'rgba(0,229,255,0.3)' } },
  bar:  { width:4, flexShrink:0 },
  body: { flex:1, padding:'16px 20px', display:'flex', flexDirection:'column', gap:10 },
  row:  { display:'flex', justifyContent:'space-between', alignItems:'center' },
  date: { fontSize:12, color:'var(--muted)' },
  badge:{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, letterSpacing:0.5 },
  stats:{ display:'flex', gap:24 },
  stat: { display:'flex', flexDirection:'column', gap:2 },
  statVal:  { fontSize:18, fontWeight:700, color:'#fff' },
  statLabel:{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1 },
  actions:{ display:'flex', flexDirection:'column', borderLeft:'1px solid var(--border)' },
  btn: { flex:1, display:'flex', alignItems:'center', justifyContent:'center',
          width:44, fontSize:18, color:'var(--accent)',
          textDecoration:'none', borderBottom:'1px solid var(--border)' },
  del: { flex:1, display:'flex', alignItems:'center', justifyContent:'center',
          width:44, fontSize:14, color:'var(--muted)', background:'none',
          border:'none', cursor:'pointer', fontFamily:'Sora,sans-serif' },
}

const empty = { color:'var(--muted)', textAlign:'center', padding:40 }
const emptyState = {
  textAlign:'center', padding:'60px 20px',
  color:'var(--muted)', border:'2px dashed var(--border)', borderRadius:12,
  display:'flex', flexDirection:'column', alignItems:'center', gap:12,
}
const emptyIcon = { fontSize:40 }

const drawer = {
  overlay:{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
             backdropFilter:'blur(4px)', zIndex:100, display:'flex',
             justifyContent:'flex-end' },
  panel:  { width:'min(680px, 95vw)', background:'var(--navy2)', borderLeft:'1px solid var(--border)',
             height:'100vh', overflow:'auto', display:'flex', flexDirection:'column' },
  hdr:    { display:'flex', justifyContent:'space-between', alignItems:'center',
             padding:'24px 24px 16px', borderBottom:'1px solid var(--border)' },
  title:  { fontSize:18, fontWeight:600 },
  close:  { background:'none', border:'none', color:'var(--muted)', fontSize:18,
             cursor:'pointer', padding:4, fontFamily:'Sora,sans-serif' },
  meta:   { display:'flex', gap:16, alignItems:'center', flexWrap:'wrap',
             padding:'16px 24px', borderBottom:'1px solid var(--border)',
             fontSize:13, color:'var(--muted)' },
  code:   { fontFamily:'DM Mono,monospace', color:'var(--accent)', fontSize:12 },
  dlBtn:  { marginLeft:'auto', padding:'6px 14px', borderRadius:6,
             background:'rgba(0,229,255,0.1)', color:'var(--accent)',
             textDecoration:'none', fontSize:12, fontWeight:600 },
  table:  { flex:1, overflow:'auto' },
  thead:  { display:'grid', gridTemplateColumns:'2fr 1fr 1fr 60px 2fr',
             padding:'8px 24px', fontSize:11, color:'var(--muted)',
             textTransform:'uppercase', letterSpacing:1, borderBottom:'1px solid var(--border)',
             position:'sticky', top:0, background:'var(--navy2)' },
  row:    { display:'grid', gridTemplateColumns:'2fr 1fr 1fr 60px 2fr',
             padding:'10px 24px', fontSize:12, alignItems:'center',
             borderBottom:'1px solid rgba(255,255,255,0.03)' },
  mono:   { fontFamily:'DM Mono,monospace', fontSize:11, color:'var(--muted)' },
}
