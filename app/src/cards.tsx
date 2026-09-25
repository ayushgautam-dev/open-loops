import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Download, Copy, ExternalLink, FileText, CalendarPlus, Send, Check } from 'lucide-react'
import { useSql, records, runFn, rev, lit } from './lib'
import { Avatar, Markdown, useToast } from './ui'
import { useNav } from './nav'
import { renderToStaticMarkup } from 'react-dom/server'

/* The three shapes Lem prepares work in — an email, a meeting, a document — each
   rendered as the thing itself, not as a text box. The person reads it the way the
   recipient will, changes what they want, and presses the one button.
   Nothing here sends on its own: every send is this person's click, and even then it
   waits a few seconds so it can be taken back. */

export interface DraftRow {
  id: string
  loop_id?: string | null
  to_person_id?: string | null
  kind?: string | null
  subject?: string | null
  body?: string | null
  to_emails?: unknown
  cc_emails?: unknown
  meeting?: unknown
  note?: string | null
  status?: string | null
  person?: string | null
  person_email?: string | null
  avatar_url?: string | null
  thread_ref?: string | null
  obligation?: string | null
  [k: string]: unknown
}

export interface DocRow {
  id: string
  title: string
  body?: string | null
  doc_url?: string | null
  status?: string | null
  created_at?: string | null
  loop_id?: string | null
  [k: string]: unknown
}

interface Slot { start: string; end?: string }
interface Meeting { title?: string; duration_min?: number; attendees?: string[]; location?: string; slots?: Slot[] }

const DRAFT_SELECT = `
  select d.id, d.loop_id, d.to_person_id, d.kind, d.subject, d.body, d.to_emails, d.cc_emails,
         d.meeting, d.note, d.status, coalesce(p.name,'') as person, p.email as person_email,
         p.avatar_url, l.thread_ref, l.obligation
  from drafts d
  left join people p on p.id = d.to_person_id
  left join loops l on l.id = d.loop_id`

export const draftById = (id: string) => `${DRAFT_SELECT} where d.id = ${lit(id)} limit 1`
export const draftForLoop = (loopId: string) =>
  `${DRAFT_SELECT} where d.loop_id = ${lit(loopId)} and d.status = 'pending' order by d.created_at desc limit 1`

/* ---------------- small pieces ---------------- */

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) {
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(String) } catch { /* plain text */ }
    return v.split(/[,;\s]+/).filter((x) => x.includes('@'))
  }
  return []
}

function asMeeting(v: unknown): Meeting | null {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) as Meeting } catch { return null } }
  return v as Meeting
}

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())

/** Names and faces for a set of addresses, from the people Lem already knows. */
function usePeopleByEmail(emails: string[]) {
  const key = emails.map((e) => e.toLowerCase()).sort().join(',')
  const q = useSql<{ email: string; name: string; avatar_url?: string | null }>(
    emails.length
      ? `select lower(email) as email, name, avatar_url from people
         where lower(email) in (${emails.map((e) => lit(e.toLowerCase())).join(',')})`
      : null)
  return useMemo(() => {
    const m = new Map<string, { name: string; avatar_url?: string | null }>()
    for (const r of q.items) m.set(r.email, { name: r.name, avatar_url: r.avatar_url })
    return m
  }, [q.items, key])
}

/** The line Lem writes above what it prepared: what this is, in one sentence. */
export function LemNote({ text }: { text?: string | null }) {
  if (!text) return null
  return (
    <div className="lem-note">
      <span className="lem-dot" aria-hidden><i /></span>
      <span>{text}</span>
    </div>
  )
}

/** Where the commitment came from — the conversation, one click away. */
export function SourceStrip({ threadRef, label }: { threadRef?: string | null; label?: string | null }) {
  if (!threadRef) return null
  const gmail = /^[0-9a-f]{10,24}$/.test(threadRef)
  const kind = threadRef.startsWith('granola:') ? 'Meeting notes' : gmail ? 'Email' : 'Conversation'
  const href = gmail ? `https://mail.google.com/mail/u/0/#all/${threadRef}` : null
  return (
    <div className="src-strip">
      <span className="src-k">From</span>
      <span className={`src-ic ${gmail ? 'gm' : 'gr'}`} aria-hidden>{gmail ? 'M' : 'G'}</span>
      <span className="src-t">{label || kind}</span>
      {href && (
        <a className="src-go" href={href} target="_blank" rel="noreferrer">
          View {kind === 'Email' ? 'thread' : 'notes'} <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}

function Chips({ label, emails, onChange }: {
  label: string; emails: string[]; onChange: (next: string[]) => void
}) {
  const people = usePeopleByEmail(emails)
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  const commit = () => {
    const v = val.trim().toLowerCase()
    if (isEmail(v) && !emails.includes(v)) onChange([...emails, v])
    setVal(''); setAdding(false)
  }
  return (
    <div className="chips-row">
      <span className="chips-k">{label}</span>
      <div className="chips">
        {emails.map((e) => {
          const p = people.get(e.toLowerCase())
          return (
            <span key={e} className="chip" title={e}>
              <Avatar name={p?.name || e} src={p?.avatar_url} />
              <span>{p?.name || e}</span>
              <button aria-label={`Remove ${e}`} onClick={() => onChange(emails.filter((x) => x !== e))}>
                <X size={11} />
              </button>
            </span>
          )
        })}
        {adding ? (
          <input
            autoFocus className="chip-in" value={val} placeholder="name@company.com"
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() } if (e.key === 'Escape') { setVal(''); setAdding(false) } }}
          />
        ) : (
          <button className="chip-add" onClick={() => setAdding(true)} aria-label={`Add ${label}`}>
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Hold a send for a few seconds so it can be taken back — the spec's undo, done
 *  honestly: nothing has left until the countdown ends. */
function useHeldSend(seconds = 6) {
  const [left, setLeft] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const action = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])
  // The count lives in a ref and the send fires from the interval itself, never from a
  // state updater — StrictMode replays updaters, and a replayed send is a second email.
  const count = useRef(0)
  function start(run: () => Promise<void>) {
    if (timer.current) return
    action.current = run
    count.current = seconds
    setLeft(seconds)
    timer.current = window.setInterval(() => {
      count.current -= 1
      if (count.current > 0) { setLeft(count.current); return }
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      setLeft(null)
      const go = action.current
      action.current = null
      if (go) void go()
    }, 1000)
  }
  function cancel() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null; action.current = null; setLeft(null)
  }
  return { left, start, cancel }
}

async function closeAfterSend(d: DraftRow, how: string) {
  const now = new Date().toISOString()
  await records.update('drafts', d.id, { status: 'sent', subject: d.subject ?? '', body: d.body ?? '' })
  if (d.loop_id) {
    await records.update('loops', d.loop_id, {
      status: 'closed', closed_at: now, closed_by: 'manual', close_reason: how,
    })
  }
  if (d.to_person_id) {
    try {
      await records.create('timeline_events', {
        person_id: d.to_person_id, type: 'email', source: 'email', title: how, happened_at: now,
        ref: d.thread_ref || null,
      })
    } catch { /* the send is what matters */ }
  }
}

/* ---------------- email ---------------- */

/** A prepared document, rendered the way it will read inside the email — the document
 *  itself, nothing about how it was made. */
function docAsHtml(d: DocRow): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const inner = renderToStaticMarkup(<Markdown text={d.body ?? ''} />)
  return `<h2 style="font-size:18px;margin:0 0 12px">${esc(d.title)}</h2>${inner}`
}

/** The link block for a document shared as a Google Doc with the recipients. */
function docLinkHtml(title: string, url: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<p style="margin:0"><a href="${esc(url)}" style="font-weight:600">${esc(title)}</a></p>`
}

/* Anything that must never leave the building: unfilled blanks Lem left for the person,
   and traces of the workspace itself (file paths, ids). Send stays off until they're gone. */
const BLANK = /\[\s*(\.\.\.|…|link|tbd|todo|fill[^\]]*|name|date|amount|x+)\s*\]/i
const INTERNAL = /(^|[\s("'`])\/(me|memory|skills|pod)\/[\w./-]+|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
function problems(text: string): string[] {
  const out: string[] = []
  if (BLANK.test(text)) out.push('a blank left to fill in')
  if (INTERNAL.test(text)) out.push('an internal file path or id')
  return out
}

export function EmailCard({ draft, onSent, compact, docs = [] }: {
  draft: DraftRow; onSent?: () => void; compact?: boolean; docs?: DocRow[]
}) {
  const toast = useToast()
  const { bump } = useNav()
  const initialTo = asList(draft.to_emails)
  const [to, setTo] = useState<string[]>(initialTo.length ? initialTo : draft.person_email ? [draft.person_email] : [])
  const [cc, setCc] = useState<string[]>(asList(draft.cc_emails))
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>(draft.status === 'sent' ? 'sent' : 'idle')
  const held = useHeldSend()
  const [attach, setAttach] = useState<string[]>(docs.map((d) => d.id))
  // how a document travels: shared as a Google Doc with just these recipients (the
  // professional default), or written into the email itself
  const [route, setRoute] = useState<'share' | 'inline'>('share')
  const [needsDrive, setNeedsDrive] = useState(false)
  useEffect(() => { setAttach(docs.map((d) => d.id)) }, [docs.map((d) => d.id).join(',')])
  const area = useRef<HTMLTextAreaElement>(null)
  const isReply = !!draft.thread_ref && /^[0-9a-f]{10,24}$/.test(draft.thread_ref)
  const first = (draft.person || to[0] || '').split(/[\s@]/)[0]

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, compact ? 90 : 140)}px`
  }, [body, compact])

  const chosen = docs.filter((d) => attach.includes(d.id))
  const issues = problems([body, ...chosen.map((d) => d.body ?? '')].join('\n'))

  async function reallySend() {
    setState('sending')
    try {
      let appendix = ''
      if (chosen.length && route === 'share') {
        for (const d of chosen) {
          const sh = await runFn<{ url?: string; shared_with?: string[]; needs_connect?: string; error?: string }>(
            'share_document', { title: d.title, markdown: d.body ?? '', doc_url: /^https:/.test(d.doc_url ?? '') ? d.doc_url : null, recipients: [...to, ...cc] })
          if (!sh.url || sh.needs_connect || (sh.shared_with ?? []).length === 0) {
            setState('idle')
            if (sh.needs_connect) setNeedsDrive(true)
            toast(sh.needs_connect ? 'Connect Google Drive to share documents — or send it inside the email' : `Not sent — ${sh.error || 'could not share the document'}`)
            return
          }
          await records.update('deliverables', d.id, { doc_url: sh.url, shared_with: sh.shared_with ?? [] })
          appendix += docLinkHtml(d.title, sh.url)
        }
      } else if (chosen.length) {
        appendix = chosen.map(docAsHtml).join('<hr style="margin:24px 0">')
      }
      const out = await runFn<{ sent?: boolean; error?: string; mode?: string }>('send_draft', {
        draft_id: draft.id, subject, body,
        to_email: to[0], extra_to: to.slice(1), cc, thread_ref: draft.thread_ref ?? '',
        to_name: draft.person ?? '',
        appendix_html: appendix || null,
      })
      if (!out?.sent) {
        setState('idle')
        toast(out?.error ? `Not sent — ${out.error}` : 'Not sent — Gmail refused it')
        return
      }
      await closeAfterSend({ ...draft, subject, body },
        `You ${out.mode === 'reply' ? 'replied to' : 'wrote to'} ${draft.person || to[0]}`)
      setState('sent')
      toast(out.mode === 'reply' ? `Replied to ${draft.person || to[0]}` : `Sent to ${draft.person || to[0]}`)
      bump(); onSent?.()
    } catch (e) {
      setState('idle')
      toast(`Not sent — ${(e as Error)?.message ?? 'something went wrong'}`)
    }
  }

  async function discard() {
    await records.update('drafts', draft.id, { status: 'skipped' })
    toast('Draft discarded', async () => { await records.update('drafts', draft.id, { status: 'pending' }); bump() })
    bump()
  }

  if (state === 'sent') {
    return (
      <div className="pcard mail sent-state">
        <Check size={14} /> Sent to {draft.person || to[0]}
      </div>
    )
  }

  return (
    <div className="pcard mail">
      <div className="card-top">
        <span className="card-k">{isReply ? 'Reply' : 'New email'}{first ? ` · to ${first}` : ''}</span>
        {held.left !== null ? (
          <button className="pill ghost" onClick={held.cancel}>Sending in {held.left}s · Undo</button>
        ) : (
          <button className="pill" disabled={state === 'sending' || !to.length || !body.trim() || issues.length > 0}
            title={issues.length ? `Fix first: ${issues.join(', ')}` : undefined}
            onClick={() => held.start(reallySend)}>
            <Send size={12} /> {state === 'sending' ? 'Sending…' : isReply ? 'Send reply' : 'Send'}
          </button>
        )}
      </div>
      <Chips label="To" emails={to} onChange={setTo} />
      <Chips label="Cc" emails={cc} onChange={setCc} />
      {!isReply && (
        <div className="subj-row">
          <input value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      {isReply && subject && <div className="subj-row ro">{subject}</div>}
      <textarea ref={area} className="mail-body" value={body} onChange={(e) => setBody(e.target.value)} />
      {issues.length > 0 && (
        <div className="send-block">Before this can go: {issues.join(' and ')} — in the email or the document.</div>
      )}
      {docs.length > 0 && (
        <div className="attach-row">
          {chosen.length > 0 && (
            <div className="route">
              <button className={route === 'share' ? 'on' : ''} onClick={() => setRoute('share')}>Share as Google Doc</button>
              <button className={route === 'inline' ? 'on' : ''} onClick={() => setRoute('inline')}>Inside the email</button>
            </div>
          )}
          {needsDrive && route === 'share' && (
            <div className="send-block">
              Sharing needs Google Drive, once.{' '}
              <button className="inline-link" onClick={async () => {
                const c = await runFn<{ authorization_url?: string }>('connect_source', { app: 'google_drive' })
                if (c?.authorization_url) window.open(c.authorization_url, '_blank', 'noopener')
              }}>Connect Google Drive</button>
            </div>
          )}
          {docs.map((d) => attach.includes(d.id) ? (
            <span key={d.id} className="attach" title={route === 'share' ? 'Shared with the recipients as a Google Doc' : 'Written into the email, below your note'}>
              <FileText size={12} /> {d.title}
              <button aria-label="Don't include" onClick={() => setAttach((a) => a.filter((x) => x !== d.id))}><X size={11} /></button>
            </span>
          ) : (
            <button key={d.id} className="link-q" onClick={() => setAttach((a) => [...a, d.id])}>+ Include {d.title}</button>
          ))}
        </div>
      )}
      {!compact && (
        <div className="card-foot">
          <button className="link-q" onClick={() => void discard()}>Discard</button>
        </div>
      )}
    </div>
  )
}

/* ---------------- meeting ---------------- */

function slotParts(s: Slot, dur: number) {
  const a = new Date(s.start)
  const b = s.end ? new Date(s.end) : new Date(a.getTime() + dur * 60000)
  const day = a.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return { day, time: `${t(a)} – ${t(b)}`, ok: !Number.isNaN(a.getTime()) }
}

/** Wall-clock "YYYY-MM-DDTHH:MM" in the browser's zone, which is the zone we send. */
function localStamp(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function MeetingCard({ draft, onSent }: { draft: DraftRow; onSent?: () => void }) {
  const toast = useToast()
  const { bump } = useNav()
  const m = asMeeting(draft.meeting) ?? {}
  const dur = Number(m.duration_min) || 30
  const slots = (m.slots ?? []).filter((s) => s?.start && !Number.isNaN(Date.parse(s.start)))
  const [pick, setPick] = useState(0)
  const [guests, setGuests] = useState<string[]>(
    asList(m.attendees).length ? asList(m.attendees) : draft.person_email ? [draft.person_email] : [])
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>(draft.status === 'sent' ? 'sent' : 'idle')
  const held = useHeldSend()
  const people = usePeopleByEmail(guests)
  const title = m.title || draft.subject || 'Meeting'

  async function reallySend() {
    const s = slots[pick]
    if (!s) return
    setState('sending')
    try {
      const out = await runFn<{ sent?: boolean; error?: string; link?: string }>('send_invite', {
        title, start: localStamp(s.start), duration_min: dur,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        attendees: guests, description: draft.body ?? '',
      })
      if (!out?.sent) {
        setState('idle')
        toast(out?.error ? `Invite not sent — ${out.error}` : 'Invite not sent')
        return
      }
      const when = slotParts(s, dur)
      await closeAfterSend(draft, `Invite sent for ${when.day}, ${when.time}`)
      setState('sent')
      toast(`Invite sent — ${when.day}, ${when.time}`)
      bump(); onSent?.()
    } catch (e) {
      setState('idle')
      toast(`Invite not sent — ${(e as Error)?.message ?? 'something went wrong'}`)
    }
  }

  if (state === 'sent') {
    return <div className="pcard mail sent-state"><Check size={14} /> Invite sent</div>
  }

  return (
    <div className="pcard meet">
      <div className="card-top">
        <span className="card-k">Proposed times</span>
        {held.left !== null ? (
          <button className="pill ghost" onClick={held.cancel}>Sending in {held.left}s · Undo</button>
        ) : (
          <button className="pill" disabled={!slots.length || !guests.length || state === 'sending'}
            onClick={() => held.start(reallySend)}>
            <CalendarPlus size={12} /> {state === 'sending' ? 'Sending…' : 'Send invite'}
          </button>
        )}
      </div>
      <div className="meet-h">
        <div className="meet-t">{title}</div>
        <div className="meet-m">
          <span>{dur} min</span>
          {guests.slice(0, 3).map((g) => {
            const p = people.get(g.toLowerCase())
            return <span key={g} className="meet-g"><Avatar name={p?.name || g} src={p?.avatar_url} />{p?.name?.split(' ')[0] || g}</span>
          })}
          <span>{m.location || 'Google Meet'}</span>
        </div>
      </div>
      {slots.length === 0
        ? <div className="empty" style={{ padding: '8px 0', fontSize: 13 }}>No free times found — ask Lem for more.</div>
        : (
          <div className="slots" role="radiogroup">
            {slots.map((s, i) => {
              const p = slotParts(s, dur)
              return (
                <button key={i} role="radio" aria-checked={pick === i}
                  className={`slot${pick === i ? ' on' : ''}`} onClick={() => setPick(i)}>
                  <span className="radio" aria-hidden />
                  <span className="slot-d">{p.day}</span>
                  <span className="slot-t">{p.time}</span>
                </button>
              )
            })}
          </div>
        )}
      <Chips label="Guests" emails={guests} onChange={setGuests} />
    </div>
  )
}

/* ---------------- document ---------------- */

function download(name: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Word and Google Docs both open an HTML document saved as .doc, headings and lists
 *  intact — no library needed and nothing leaves the browser. */
function asWordHtml(title: string, el: HTMLElement | null) {
  const inner = el?.innerHTML ?? ''
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}</style>
</head><body><h1>${title.replace(/</g, '&lt;')}</h1>${inner}</body></html>`
}

export function DocCard({ doc, compact, open: startOpen }: { doc: DocRow; compact?: boolean; open?: boolean }) {
  const toast = useToast()
  const { openSheet, bump } = useNav()
  const [open, setOpen] = useState(!!startOpen)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState(/^https:\/\//.test(doc.doc_url ?? '') ? doc.doc_url! : '')
  const bodyRef = useRef<HTMLDivElement>(null)
  const safeName = (doc.title || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document'

  /** One button: open the doc in Google Docs, creating it the first time. The tab is
   *  opened on the click itself — one opened after the save finishes would be blocked. */
  async function toGoogle() {
    if (url) { window.open(url, '_blank', 'noopener'); return }
    const win = window.open('', '_blank')
    setBusy(true)
    try {
      const out = await runFn<{ saved?: boolean; url?: string; needs_connect?: boolean; error?: string }>(
        'save_google_doc', { title: doc.title, markdown: doc.body ?? '' })
      if (out?.saved && out.url) {
        setUrl(out.url)
        await records.update('deliverables', doc.id, { doc_url: out.url })
        bump()
        if (win) win.location.href = out.url
        return
      }
      if (out?.needs_connect) {
        const c = await runFn<{ authorization_url?: string }>('connect_source', { app: 'google_docs' })
        if (c?.authorization_url && win) { win.location.href = c.authorization_url; toast('Connect Google Docs, then press Open again') }
        else { win?.close(); toast('Google Docs is connected — press Open again') }
        return
      }
      win?.close()
      toast(out?.error || 'Could not create the Google Doc')
    } catch (e) {
      win?.close()
      toast((e as Error)?.message || 'Could not create the Google Doc')
    } finally { setBusy(false) }
  }

  return (
    <div className="pcard doc">
      <div className="card-top">
        <span className="card-k"><FileText size={13} /> {doc.title}</span>
        <button className="pill" disabled={busy} onClick={() => void toGoogle()}>
          <ExternalLink size={12} /> {busy ? 'Opening…' : 'Open in Google Docs'}
        </button>
      </div>
      <div ref={bodyRef} className={`doc-body${open ? ' open' : ''}${compact ? ' compact' : ''}`}>
        <Markdown text={doc.body ?? ''} />
      </div>
      <div className="card-foot">
        <button className="link-q" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Read all'}</button>
        <span style={{ flex: 1 }} />
        <button className="link-q" title="Download for Word or Google Docs"
          onClick={() => download(`${safeName}.doc`, 'application/msword', asWordHtml(doc.title, bodyRef.current))}>
          <Download size={12} /> .doc
        </button>
        <button className="link-q" onClick={() => download(`${safeName}.md`, 'text/markdown', `# ${doc.title}\n\n${doc.body ?? ''}`)}>
          <Download size={12} /> .md
        </button>
        <button className="link-q" onClick={() => { void navigator.clipboard.writeText(doc.body ?? ''); toast('Copied') }}>
          <Copy size={12} /> Copy
        </button>
        <button className="link-q" onClick={() => openSheet({ type: 'doc', id: doc.id })}>Full screen</button>
      </div>
    </div>
  )
}

/* ---------------- pick the right card ---------------- */

export function DraftCard({ draft, onSent, compact, docs }: { draft: DraftRow; onSent?: () => void; compact?: boolean; docs?: DocRow[] }) {
  if ((draft.kind ?? '') === 'meeting' && asMeeting(draft.meeting)?.slots?.length) {
    return <MeetingCard draft={draft} onSent={onSent} />
  }
  return <EmailCard draft={draft} onSent={onSent} compact={compact} docs={docs} />
}

/** What Lem prepared, referenced from chat by id (`[[draft:…]]` / `[[doc:…]]`): a small
 *  chip that opens the real thing in the workspace beside the chat, never inline. */
export function CardById({ kind, id }: { kind: 'draft' | 'doc'; id: string }) {
  const { version, openSheet } = useNav()
  const d = useSql<DraftRow>(rev(kind === 'draft' ? draftById(id) : null, version))
  const doc = useSql<DocRow>(rev(kind === 'doc'
    ? `select id, title, status, loop_id from deliverables where id=${lit(id)} limit 1`
    : null, version))
  if (kind === 'draft') {
    const row = d.items[0]
    if (!row) return null
    const first = (row.person || '').split(' ')[0]
    const meeting = row.kind === 'meeting'
    return (
      <button className="work-chip" onClick={() => row.loop_id && openSheet({ type: 'loop', id: row.loop_id })}>
        {meeting ? <CalendarPlus size={14} /> : <Send size={14} />}
        <span className="wc-t">{meeting ? `Proposed times${first ? ` with ${first}` : ''}` : `Email to ${first || 'them'}`}</span>
        <span className="wc-s">{row.status === 'sent' ? 'Sent' : 'Open'}</span>
      </button>
    )
  }
  const row = doc.items[0]
  if (!row) return null
  return (
    <button className="work-chip" onClick={() => openSheet({ type: 'doc', id: row.id })}>
      <FileText size={14} /><span className="wc-t">{row.title}</span><span className="wc-s">Open</span>
    </button>
  )
}

/** Documents Lem produced for one commitment. */
export function useDocsForLoop(loopId: string | null) {
  const { version } = useNav()
  return useSql<DocRow>(rev(loopId
    ? `select id, title, body, doc_url, status, created_at, loop_id from deliverables
       where loop_id=${lit(loopId)} and status <> 'discarded' order by created_at desc limit 3`
    : null, version))
}

