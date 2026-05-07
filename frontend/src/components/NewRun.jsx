import { useState, useRef, useCallback } from 'react'
import { startGeneration, pollJob, downloadUrl } from '../lib/api'

const STEPS = ['Files', 'Scores', 'Configure', 'Generate']

export default function NewRun({ onBack, onDone }) {
  const [step, setStep]           = useState(0)
  const [zipFile, setZipFile]     = useState(null)
  const [tplFile, setTplFile]     = useState(null)
  const [scores, setScores]       = useState([])    // [{pnum,name,student_number,mark,items:[]}]
  const [naming, setNaming]       = useState('student_number')
  const [prefix, setPrefix]       = useState('')
  const [jobId, setJobId]         = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [error, setError]         = useState('')

  // ── Step navigation ────────────────────────────────────────────────────────────
  const canNext = [
    zipFile && tplFile,
    scores.some(s => s.mark !== '' && s.mark !== null),
    true,
    false,
  ]

  function next() { if (step < 3) setStep(s => s+1) }
  function back() { if (step > 0) setStep(s => s-1); else onBack() }

  // ── Step 0: Files ──────────────────────────────────────────────────────────────
  function FilesStep() {
    return (
      <div style={s.stepWrap}>
        <h2 style={s.stepTitle}>Upload Files</h2>
        <p style={s.stepSub}>You need two files from WISEflow to begin.</p>
        <div style={s.fileGrid}>
          <DropZone label="WISEflow ZIP Export"
                    hint="Download All Files from WISEflow → the .zip"
                    accept=".zip" file={zipFile} onChange={handleZip} />
          <DropZone label="Template PDF"
                    hint="The question paper with correct answers marked"
                    accept=".pdf" file={tplFile} onChange={setTplFile} />
        </div>
      </div>
    )
  }

  async function handleZip(file) {
    setZipFile(file)
    // Try to parse student list from ZIP
    try {
      const ab   = await file.arrayBuffer()
      const data = await parseZipClient(ab)
      setScores(data.map(s => ({
        ...s, mark: '', items: Array(16).fill(0)
      })))
    } catch(e) {
      console.warn('ZIP parse failed client-side:', e)
    }
  }

  // ── Step 1: Scores ─────────────────────────────────────────────────────────────
  function ScoresStep() {
    const csvRef = useRef()

    async function importCsv(e) {
      const file = e.target.files[0]; if (!file) return
      const text = await file.text()
      const rows = text.trim().split('\n')
      const hdr  = rows[0].split(',').map(h => h.trim().toLowerCase())
      const markIdx = hdr.indexOf('mark')
      const pnumIdx = hdr.indexOf('participant_number')
      const updated = [...scores]
      rows.slice(1).forEach(row => {
        const cols = row.split(',')
        const pnum = cols[pnumIdx]?.trim().replace(/^0+/,'') || ''
        const mark = parseInt(cols[markIdx]?.trim())
        const items = Array.from({length:16}, (_,i) => {
          const v = cols[hdr.indexOf(`q${i+1}`)]?.trim()
          return v === '1' ? 1 : 0
        })
        const idx = updated.findIndex(s => s.pnum === pnum || s.pnum.replace(/^0+/,'') === pnum)
        if (idx >= 0 && !isNaN(mark)) { updated[idx].mark = mark; updated[idx].items = items }
      })
      setScores(updated)
    }

    function exportCsv() {
      const hdr  = ['participant_number','name','student_number','institution','mark',
                     ...Array.from({length:16},(_,i)=>`q${i+1}`)].join(',')
      const rows = scores.map(s =>
        [s.pnum, s.name, s.student_number, s.institution, s.mark,
         ...s.items].join(','))
      const blob = new Blob([[hdr,...rows].join('\n')], {type:'text/csv'})
      const a    = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = 'scores_template.csv'; a.click()
    }

    return (
      <div style={s.stepWrap}>
        <h2 style={s.stepTitle}>Enter Scores</h2>
        <p style={s.stepSub}>
          {scores.length} students loaded. Enter the mark (0–16) for each student.
        </p>

        <div style={s.scoresToolbar}>
          <button onClick={exportCsv} style={s.tbBtn}>↓ Export CSV Template</button>
          <button onClick={() => csvRef.current.click()} style={s.tbBtn}>↑ Import CSV</button>
          <input ref={csvRef} type="file" accept=".csv" style={{display:'none'}} onChange={importCsv} />
          <span style={s.tbHint}>
            Or fill in the mark column below directly.
          </span>
        </div>

        <div style={s.scoreTable}>
          <div style={s.sThead}>
            <span>#</span><span>Name</span><span>Stud No</span><span>Mark /16</span>
          </div>
          {scores.map((row, i) => (
            <div key={row.pnum} style={{ ...s.sRow, background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <span style={s.pnum}>{row.pnum}</span>
              <span>{row.name}</span>
              <span style={s.mono}>{row.student_number || '—'}</span>
              <input
                type="number" min={0} max={16}
                value={row.mark}
                onChange={e => {
                  const v = e.target.value
                  setScores(prev => prev.map((r,j) => j===i ? {...r, mark:v} : r))
                }}
                placeholder="—"
                style={s.markInput}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Step 2: Configure ──────────────────────────────────────────────────────────
  function ConfigStep() {
    const example = prefix + (
      naming === 'student_number' ? '2940632_Daiyi_WU.pdf' :
      naming === 'participant'    ? '001_Daiyi_WU.pdf' :
                                    'Daiyi_WU.pdf'
    )
    return (
      <div style={s.stepWrap}>
        <h2 style={s.stepTitle}>Configure Output</h2>
        <p style={s.stepSub}>Choose how generated PDFs will be named.</p>

        <div style={s.configGroup}>
          <label style={s.configLabel}>File naming</label>
          {[
            ['student_number', 'Student Number', '2940632_Daiyi_WU.pdf'],
            ['name',           'Name only',      'Daiyi_WU.pdf'],
            ['participant',    'Participant No',  '001_Daiyi_WU.pdf'],
          ].map(([val,lbl,ex]) => (
            <label key={val} style={s.radio}>
              <input type="radio" value={val}
                     checked={naming===val} onChange={() => setNaming(val)} />
              <span style={s.radioLabel}>{lbl}</span>
              <span style={s.radioEx}>{ex}</span>
            </label>
          ))}
        </div>

        <div style={s.configGroup}>
          <label style={s.configLabel}>Optional prefix</label>
          <input value={prefix} onChange={e => setPrefix(e.target.value)}
                 placeholder='e.g. "MCQ_Resit_"' style={s.prefixInput} />
        </div>

        <div style={s.preview}>
          <span style={s.previewLabel}>Preview filename:</span>
          <code style={s.previewCode}>{example}</code>
        </div>

        <div style={s.configGroup}>
          <p style={s.configLabel}>Summary</p>
          <p style={{color:'var(--muted)',fontSize:13}}>
            {scores.filter(s => s.mark !== '' && s.mark !== null).length} students with scores
            will be processed. Output ZIP will be available for download when done.
          </p>
        </div>
      </div>
    )
  }

  // ── Step 3: Generate ───────────────────────────────────────────────────────────
  function GenerateStep() {
    async function run() {
      setError('')
      const scored = scores.filter(s => s.mark !== '' && s.mark !== null)
        .map(s => ({ pnum: s.pnum, mark: parseInt(s.mark), items: s.items }))
      try {
        const { job_id } = await startGeneration(zipFile, tplFile, scored, naming, prefix)
        setJobId(job_id)
        poll(job_id)
      } catch(e) {
        setError(String(e))
      }
    }

    async function poll(id) {
      const interval = setInterval(async () => {
        try {
          const status = await pollJob(id)
          setJobStatus(status)
          if (status.status === 'done' || status.status === 'error') {
            clearInterval(interval)
            if (status.status === 'done') setTimeout(onDone, 1500)
          }
        } catch { clearInterval(interval) }
      }, 1200)
    }

    const pct = jobStatus
      ? Math.round((jobStatus.progress / Math.max(jobStatus.total,1)) * 100)
      : 0

    return (
      <div style={s.stepWrap}>
        <h2 style={s.stepTitle}>Generate PDFs</h2>

        {!jobId && (
          <>
            <p style={s.stepSub}>
              Ready to generate{' '}
              <strong style={{color:'var(--accent)'}}>
                {scores.filter(s => s.mark!=='' && s.mark!=null).length} PDFs
              </strong>.
            </p>
            {error && <p style={s.errBox}>{error}</p>}
            <button onClick={run} style={s.genBtn}>▶  Generate All PDFs</button>
          </>
        )}

        {jobId && jobStatus && (
          <div style={s.progress}>
            <div style={s.progressBar}>
              <div style={{ ...s.progressFill, width: `${pct}%` }} />
            </div>
            <p style={s.progText}>
              {jobStatus.status === 'done'   ? '✓ Complete! Redirecting to dashboard…' :
               jobStatus.status === 'error'  ? `✗ Error: ${jobStatus.error}` :
               `${jobStatus.progress} / ${jobStatus.total} — ${jobStatus.current_name}`}
            </p>
            {jobStatus.status === 'done' && jobStatus.run_id && (
              <a href={downloadUrl(jobStatus.run_id)} download
                 style={s.dlBtn}>
                ↓ Download ZIP now
              </a>
            )}
            {(jobStatus.errors || []).map((e,i) => (
              <p key={i} style={s.errLine}>✗ {e.name}: {e.error}</p>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Layout ─────────────────────────────────────────────────────────────────────
  return (
    <div style={s.outer}>
      {/* Back */}
      <button onClick={back} style={s.backBtn}>← {step===0 ? 'Dashboard' : 'Back'}</button>

      {/* Step pills */}
      <div style={s.pills}>
        {STEPS.map((label,i) => (
          <div key={i} style={{...s.pill, ...(i===step ? s.pillActive : i<step ? s.pillDone : {})}}>
            <span style={s.pillNum}>{i < step ? '✓' : i+1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={s.content}>
        {step===0 && <FilesStep />}
        {step===1 && <ScoresStep />}
        {step===2 && <ConfigStep />}
        {step===3 && <GenerateStep />}
      </div>

      {/* Footer nav */}
      {step < 3 && (
        <div style={s.footer}>
          <span style={s.footerHint}>
            {!canNext[step] && ['Select both files to continue.',
              'Enter at least one mark to continue.', ''][step]}
          </span>
          <button onClick={next} disabled={!canNext[step]} style={s.nextBtn}>
            {step===2 ? 'Start Generation →' : 'Next →'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Client-side ZIP parse (names only) ─────────────────────────────────────────
async function parseZipClient(arrayBuffer) {
  // Minimal ZIP directory scan
  const view  = new DataView(arrayBuffer)
  const bytes = new Uint8Array(arrayBuffer)
  const dec   = new TextDecoder()
  const students = []
  const seen  = new Set()
  const FOLDER = /Submissions\/\[(\d+)_\d+\] - ([^/]+)\//

  // Scan local file headers (signature 0x04034b50)
  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) === 0x04034b50) {
      const fnLen   = view.getUint16(i+26, true)
      const extraLen= view.getUint16(i+28, true)
      const fnBytes = bytes.slice(i+30, i+30+fnLen)
      const fn      = dec.decode(fnBytes)
      const m       = FOLDER.exec(fn)
      if (m && !seen.has(m[1])) {
        seen.add(m[1])
        students.push({
          pnum: m[1], name: m[2].trim(),
          student_number: '—', institution: '—', centre: '—',
        })
      }
      i += 30 + fnLen + extraLen - 1
    }
  }
  return students.sort((a,b) => parseInt(a.pnum) - parseInt(b.pnum))
}

// ── Drop zone ───────────────────────────────────────────────────────────────────
function DropZone({ label, hint, accept, file, onChange }) {
  const ref  = useRef()
  const [drag, setDrag] = useState(false)

  const onDrop = useCallback(e => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onChange(f)
  }, [onChange])

  return (
    <div style={{ ...dz.wrap, ...(drag ? dz.dragging : {}) }}
         onDragOver={e=>{e.preventDefault();setDrag(true)}}
         onDragLeave={()=>setDrag(false)}
         onDrop={onDrop}
         onClick={() => ref.current.click()}>
      <input ref={ref} type="file" accept={accept} style={{display:'none'}}
             onChange={e => e.target.files[0] && onChange(e.target.files[0])} />
      <div style={dz.icon}>{file ? '✓' : '↑'}</div>
      <div style={dz.label}>{label}</div>
      {file
        ? <div style={dz.file}>{file.name}</div>
        : <div style={dz.hint}>{hint}</div>}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  outer:   { minHeight:'100vh', padding:'32px', maxWidth:900, margin:'0 auto', display:'flex', flexDirection:'column', gap:24 },
  backBtn: { alignSelf:'flex-start', background:'none', border:'none', color:'var(--muted)', fontSize:13, cursor:'pointer', padding:'4px 0', fontFamily:'Sora,sans-serif' },
  pills:   { display:'flex', gap:8 },
  pill:    { display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:20, border:'1px solid var(--border)', fontSize:12, color:'var(--muted)', fontWeight:500 },
  pillActive:{ borderColor:'var(--accent)', color:'var(--accent)', background:'rgba(0,229,255,0.08)' },
  pillDone:  { borderColor:'var(--green)',  color:'var(--green)',  background:'rgba(67,160,71,0.08)' },
  pillNum: { width:18, height:18, borderRadius:'50%', background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700 },

  content: { flex:1, background:'var(--card)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'32px' },

  stepWrap:  { display:'flex', flexDirection:'column', gap:20 },
  stepTitle: { fontSize:22, fontWeight:700, color:'#fff' },
  stepSub:   { fontSize:13, color:'var(--muted)' },

  fileGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:8 },

  scoresToolbar:{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' },
  tbBtn: { padding:'6px 14px', borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--text)', fontSize:12, cursor:'pointer', fontFamily:'Sora,sans-serif' },
  tbHint:{ fontSize:12, color:'var(--muted)' },

  scoreTable:{ border:'1px solid var(--border)', borderRadius:8, overflow:'auto', maxHeight:400 },
  sThead:{ display:'grid', gridTemplateColumns:'50px 2fr 1fr 100px', padding:'8px 16px', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,0.2)', position:'sticky', top:0 },
  sRow:  { display:'grid', gridTemplateColumns:'50px 2fr 1fr 100px', padding:'8px 16px', fontSize:12, alignItems:'center', borderBottom:'1px solid rgba(255,255,255,0.03)' },
  pnum:  { color:'var(--muted)', fontFamily:'DM Mono,monospace', fontSize:11 },
  mono:  { fontFamily:'DM Mono,monospace', fontSize:11, color:'var(--muted)' },
  markInput:{ width:70, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'rgba(255,255,255,0.05)', color:'#fff', fontSize:13, fontFamily:'DM Mono,monospace', textAlign:'center', outline:'none' },

  configGroup:{ display:'flex', flexDirection:'column', gap:10, padding:'20px', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid var(--border)' },
  configLabel:{ fontSize:11, fontWeight:600, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1 },
  radio:  { display:'flex', alignItems:'center', gap:10, cursor:'pointer', fontSize:13 },
  radioLabel:{ fontWeight:500, color:'var(--text)' },
  radioEx:   { color:'var(--muted)', fontFamily:'DM Mono,monospace', fontSize:11 },
  prefixInput:{ padding:'8px 12px', borderRadius:6, border:'1px solid var(--border)', background:'rgba(255,255,255,0.05)', color:'#fff', fontSize:13, fontFamily:'DM Mono,monospace', width:280, outline:'none' },
  preview:{ display:'flex', gap:12, alignItems:'center', padding:'12px 16px', background:'rgba(0,229,255,0.05)', borderRadius:8, border:'1px solid rgba(0,229,255,0.15)' },
  previewLabel:{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1 },
  previewCode: { fontFamily:'DM Mono,monospace', fontSize:13, color:'var(--accent)' },

  genBtn: { alignSelf:'flex-start', padding:'14px 28px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#1565c0,#00bcd4)', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', letterSpacing:0.3, fontFamily:'Sora,sans-serif' },
  errBox: { padding:'12px 16px', borderRadius:8, background:'rgba(229,57,53,0.1)', border:'1px solid rgba(229,57,53,0.3)', color:'#ef9a9a', fontSize:13 },

  progress:  { display:'flex', flexDirection:'column', gap:12 },
  progressBar:{ height:8, background:'rgba(255,255,255,0.1)', borderRadius:4, overflow:'hidden' },
  progressFill:{ height:'100%', background:'linear-gradient(90deg,#1565c0,#00e5ff)', borderRadius:4, transition:'width 0.4s ease' },
  progText:  { fontSize:13, color:'var(--muted)' },
  dlBtn:     { alignSelf:'flex-start', padding:'10px 20px', borderRadius:8, background:'rgba(0,229,255,0.1)', border:'1px solid rgba(0,229,255,0.3)', color:'var(--accent)', textDecoration:'none', fontSize:13, fontWeight:600 },
  errLine:   { fontSize:12, color:'var(--red)' },

  footer:  { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 0' },
  footerHint:{ fontSize:12, color:'var(--muted)' },
  nextBtn: { padding:'10px 24px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#1565c0,#00bcd4)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'Sora,sans-serif', opacity:1, transition:'opacity 0.2s' },
}

const dz = {
  wrap: { border:'2px dashed var(--border)', borderRadius:12, padding:'32px 24px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:8, textAlign:'center', transition:'border-color 0.2s, background 0.2s' },
  dragging:{ borderColor:'var(--accent)', background:'rgba(0,229,255,0.05)' },
  icon:  { fontSize:28, color:'var(--muted)' },
  label: { fontSize:14, fontWeight:600, color:'var(--text)' },
  hint:  { fontSize:11, color:'var(--muted)' },
  file:  { fontSize:12, color:'var(--green)', fontFamily:'DM Mono,monospace' },
}
