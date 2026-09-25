import { useLayoutEffect, useRef, useState } from 'react'
import { records } from './lib'
import { useToast } from './ui'

/* Corrections are how this product is configured: say what's wrong in your own words,
   and Lem reads it before writing anything again. Same `corrections` write as before. */

export function Correctable({ text, about, kind, subjectId, lines = 2 }: {
  text: string
  about: string
  kind: 'situation' | 'workstream' | 'person' | 'commitment' | 'draft' | 'other'
  subjectId?: string | null
  lines?: number
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [full, setFull] = useState(false)
  const [long, setLong] = useState(false)
  const pRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = pRef.current
    if (el && !full) setLong(el.scrollHeight > el.clientHeight + 2)
  }, [text, full])

  async function save() {
    const v = note.trim()
    if (!v) return
    await records.create('corrections', {
      about, was: text.slice(0, 900), correction: v,
      subject_kind: kind, subject_id: subjectId ?? null, applied: false,
    })
    setSent(true); setOpen(false); setNote('')
    toast('Noted — Lem won’t write it that way again')
  }

  return (
    <div className="lemline">
      <p ref={pRef} className={`lemline-p${full ? '' : ' folded'}${long && !full ? ' faded' : ''}`}
        style={{ ['--lines' as string]: lines }}
        onClick={() => (long || full) && setFull((v) => !v)}
        title={long && !full ? 'Read all' : undefined}>
        {text}
      </p>
      {!open && (
        <button className="fix" onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
          {sent ? 'Noted' : 'not right?'}
        </button>
      )}
      {open && (
        <div className="fixit" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus rows={2} value={note}
            placeholder="What’s wrong, or what should Lem know? — “already made the group on WhatsApp”"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
            }}
          />
          <div className="row-gap">
            <button className="btn ink sm" onClick={() => void save()}>Tell Lem</button>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
