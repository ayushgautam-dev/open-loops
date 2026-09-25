import { useLayoutEffect, useRef, useState } from 'react'
import { records } from './lib'
import { useToast } from './ui'

/* Corrections are how this product is configured. There is no settings page for
   behaviour: you tell Lem it got something wrong, in your own words, and it
   reads that before it writes anything again. */

export function Correctable({ text, about, kind, subjectId, className }: {
  text: string
  about: string
  kind: 'situation' | 'workstream' | 'person' | 'commitment' | 'draft' | 'other'
  subjectId?: string | null
  className?: string
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  // Long summaries fold to two lines and open on click — never on hover, which made
  // everything below jump a line every time the pointer crossed a block.
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
    toast('Noted — Lem will not write it that way again')
  }

  return (
    <div className={`correctable${className ? ` ${className}` : ''}`}>
      <div className="corr-row">
        <p ref={pRef} className={`summary${full ? '' : ' folded'}${long && !full ? ' faded' : ''}`}
          onClick={() => (long || full) && setFull((v) => !v)}
          title={long && !full ? 'Show all' : undefined}>{text}</p>
        {!open && (
          <button className="fix-link" onClick={() => setOpen(true)}>
            {sent ? 'Noted' : 'not right?'}
          </button>
        )}
      </div>
      {open && (
        <div className="fixit">
          <textarea
            autoFocus
            rows={2}
            value={note}
            placeholder="What's wrong, or what should Lem know? (e.g. 'already made the group on WhatsApp')"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="btn-row" style={{ marginTop: 7 }}>
            <button className="btn primary" onClick={() => void save()}>Tell Lem</button>
            <button className="btn quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
