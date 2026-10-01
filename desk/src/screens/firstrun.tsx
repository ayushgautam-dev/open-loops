import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ArrowRight } from 'lucide-react'
import { runFn, sql } from '../lib'
import { SourceMark } from '../brand'
import { Orb } from '../ui'
import { ensureMyAutopilots, ensureSkills, loadCatalog, type CatalogEntry } from '../autopilot-sync'
import { quickStart, putSetting, unreadCount } from '../backfill'
import { useTeammateFace, useRenameTeammate } from '../teammate'

/* First run.
   Nobody should meet an empty product, and nobody should have to read to get in.

   Three rules shape these cards:
   - A card is a headline, a few words and one button. Anything that needs more than
     that is shown, not written.
   - Nothing here is mandatory. Mail is the source that makes the product work alone,
     but every button still moves forward.
   - Only the most recent few days are read here, so the desk opens in a couple of
     minutes. The older history carries on behind the product (see backfill.ts). */

type Step = 'welcome' | 'connect' | 'about' | 'working' | 'done'

interface Source {
  app: string
  label: string
  important?: boolean
  onboarding?: boolean
  connected?: boolean
  status?: string
}

interface Counts { emails: number; meetings: number; people: number; open_loops: number }
const ZERO: Counts = { emails: 0, meetings: 0, people: 0, open_loops: 0 }

/* Counted in the app, not in a pod function: a function runs under the pod's service
   identity and every table here belongs to its owner, so a count inside a function is
   always 0. This query runs as the signed-in person. */
const COUNTS_SQL = `
  select
    (select count(*) from interactions where source='gmail') as emails,
    (select count(*) from interactions where source='calendar') as meetings,
    (select count(*) from people) as people,
    (select count(*) from loops where status='open') as open_loops`

export async function needsFirstRun(): Promise<boolean> {
  try {
    // An explicit marker, so somebody who connected nothing is not asked again
    // every time they open the app.
    const done = await sql<{ n: number }>(
      `select count(*) as n from settings where key='onboarded_at'`)
    if (Number(done[0]?.n ?? 0) > 0) return false
    const rows = await sql<{ n: number }>(
      `select (select count(*) from people) + (select count(*) from loops) as n`)
    return Number(rows[0]?.n ?? 0) === 0
  } catch { return false }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Kinds of work, as things to tap. What is picked tells the teammate what to watch for. */
const WORK = ['Customers', 'Sales', 'Hiring', 'Product', 'Engineering', 'Marketing',
  'Finance', 'Operations', 'Partners', 'Investors', 'Legal', 'Support']

const STAGES = ['mail', 'calendar'] as const

const clock = (t?: [number, number][] | null) => {
  const [h, m] = t?.[0] ?? [NaN, 0]
  if (Number.isNaN(h)) return ''
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function FirstRun({ name, onDone }: { name: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** a sign-in link the browser would not open for us, offered as a plain link instead */
  const [blocked, setBlocked] = useState<{ app: string; url: string } | null>(null)
  const [note, setNote] = useState('')
  const [work, setWork] = useState<string[]>([])
  const { name: podName, icon } = useTeammateFace()
  const rename = useRenameTeammate()
  const [typed, setTyped] = useState<string | null>(null)
  const teammate = typed ?? podName
  const setTeammate = setTyped
  const [renaming, setRenaming] = useState(false)

  const [stage, setStage] = useState<string>('mail')
  const [counts, setCounts] = useState<Counts>(ZERO)
  const [trouble, setTrouble] = useState<string[]>([])
  const [shifts, setShifts] = useState<CatalogEntry[]>([])
  const [unread, setUnread] = useState(0)
  const started = useRef(false)

  const isOn = (s: Source) => Boolean(s.connected || s.status === 'connected')

  const load = useCallback(async (): Promise<Source[]> => {
    try {
      const out = await runFn<{ sources?: Source[] }>('sources_status', {})
      const all = (out.sources ?? []).filter((s) => s.onboarding !== false)
      setSources(all)
      return all
    } catch { setSources((s) => s ?? []); return [] }
  }, [])
  useEffect(() => { void load() }, [load])

  const connected = (sources ?? []).filter(isOn)

  /** Watch for the account to appear. The sign-in tab is on the provider's origin and
   *  cannot tell us anything, so we ask until it shows up (three minutes at most). */
  async function waitFor(app: string) {
    for (let i = 0; i < 90; i++) {
      await sleep(2000)
      const all = await load()
      if (all.some((s) => s.app === app && isOn(s))) { setBlocked(null); return true }
    }
    return false
  }

  /* Sign-in opens in a new tab. A browser only allows that as a direct result of the
     click, and the link is not known until the pod has answered, so the tab is opened
     first, empty, and pointed at the provider when the link arrives. If the browser
     refuses even that, the link is put on the card as an ordinary link to press. */
  async function connect(app: string) {
    if (busy) return
    setBusy(app); setNote(''); setBlocked(null)
    const tab = window.open('', '_blank')
    try { tab?.document.write('<p style="font:15px system-ui;padding:32px;color:#555">Opening sign-in…</p>') } catch { /* cosmetic */ }
    try {
      /* Installs the connector for the workspace if it is not there yet, then hands
         back a sign-in link: on a pod somebody just cloned nothing is installed, and
         none of it should mean a trip to an admin console. */
      const out = await runFn<{
        auth_url?: string; authorization_url?: string; already_connected?: boolean; explanation?: string
      }>('connect_source', { app })
      const url = out.auth_url || out.authorization_url
      if (out.already_connected || !url) {
        tab?.close()
        if (!out.already_connected) setNote(out.explanation || 'That one cannot be connected from here yet.')
        await load()
        return
      }
      if (tab && !tab.closed) { tab.opener = null; tab.location.href = url }
      else setBlocked({ app, url })
      if (!(await waitFor(app))) setNote('Still waiting. Finish signing in, then press it again.')
    } catch {
      tab?.close()
      setNote('That did not start. Try again.')
    } finally {
      setBusy(null)
    }
  }

  /* ---------------- the first read ---------------- */

  const refreshCounts = useCallback(async () => {
    try {
      const r = (await sql<Record<string, unknown>>(COUNTS_SQL))[0]
      if (!r) return
      const n = (k: string) => Number(r[k] ?? 0) || 0
      setCounts({ emails: n('emails'), meetings: n('meetings'), people: n('people'), open_loops: n('open_loops') })
    } catch { /* keep the last good numbers rather than flashing zeros */ }
  }, [])

  const begin = useCallback(async () => {
    if (started.current) return
    started.current = true
    setStep('working')
    const tick = setInterval(() => { void refreshCounts() }, 4000)
    const failed: string[] = []
    try {
      try {
        await runFn('bootstrap_me', { include_examples: false })
        // the skills before anything is read: the first reading pass loads one
        await ensureSkills()
        if (work.length) await putSetting('what_i_do', work.join(', '))
        if (typed && typed.trim() !== podName) await rename(typed)
      } catch (e) { failed.push(`Setup: ${(e as Error)?.message ?? 'did not finish'}`) }

      const out = await quickStart(connected.map((s) => s.app), setStage)
      failed.push(...out.trouble)

      /* Their own copy of every routine that starts on, at their local time, running as
         them. Read back from the menu so the last card shows what was really set up. */
      try {
        await ensureMyAutopilots()
        const menu = await loadCatalog()
        setShifts(menu.filter((e) => e.default_on && e.schedule_type === 'TIME' && !e.needs))
      } catch { /* the Shell sets these up on the next visit */ }
    } finally {
      clearInterval(tick)
    }
    await refreshCounts()
    setUnread(await unreadCount())
    setTrouble(failed)
    await putSetting('onboarded_at', new Date().toISOString())
    setStep('done')
  }, [connected, refreshCounts, work, typed, podName])

  /* ---------------- chrome ---------------- */

  const at = { welcome: 0, connect: 1, about: 2, working: 3, done: 3 }[step]
  const stageAt = Math.max(0, STAGES.indexOf(stage as typeof STAGES[number]))

  return (
    <div className="firstrun">
      <div className={`fr-card fr-${step}`}>
        <div className="fr-dots" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <i key={i} className={i <= at ? 'on' : ''} />)}
        </div>

        {step === 'welcome' && (
          <>
            <div className="fr-face">{icon ? <img src={icon} alt="" width={72} height={72} /> : <img src="/favicon.svg" alt="" width={72} height={72} />}</div>
            <h1>Hi {name}. I'm {teammate || podName}.</h1>
            <p className="fr-sub">I chase your loose ends.</p>
            {renaming && (
              <input className="fr-name" autoFocus value={teammate} maxLength={24} aria-label="Name your teammate"
                onChange={(e) => setTeammate(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setRenaming(false) }} />
            )}
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => setStep('connect')}>
                Start <ArrowRight size={15} strokeWidth={2} />
              </button>
              {!renaming && <button className="btn quiet" onClick={() => setRenaming(true)}>Rename</button>}
            </div>
          </>
        )}

        {step === 'connect' && (
          <>
            <h1>Connect your mail.</h1>
            <p className="fr-sub">Nothing sends without you.</p>
            <div className="fr-tiles">
              {sources === null && <div className="spinner" />}
              {(sources ?? []).map((s) => {
                const on = isOn(s)
                const link = blocked?.app === s.app ? blocked.url : null
                const inner = (
                  <>
                    <SourceMark app={s.app} label={s.label} />
                    <span className="fr-tile-n">{s.label}</span>
                    <span className="fr-tile-s">
                      {on ? <Check size={14} strokeWidth={2.8} /> : busy === s.app ? <span className="spinner sm" /> : link ? 'Open' : 'Connect'}
                    </span>
                  </>
                )
                const cls = `fr-tile${on ? ' is-on' : ''}${s.important ? ' is-key' : ''}`
                return link
                  ? <a key={s.app} className={cls} href={link} target="_blank" rel="noreferrer">{inner}</a>
                  : <button key={s.app} className={cls} disabled={on || !!busy} onClick={() => void connect(s.app)}>{inner}</button>
              })}
            </div>
            {note && <p className="fr-note">{note}</p>}
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => setStep('about')}>
                {connected.length === 0 ? 'Skip' : 'Continue'} <ArrowRight size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}

        {step === 'about' && (
          <>
            <h1>What is your work?</h1>
            <p className="fr-sub">Pick any that fit.</p>
            <div className="fr-chips">
              {WORK.map((w) => {
                const on = work.includes(w)
                return (
                  <button key={w} className={`fr-chip${on ? ' on' : ''}`} aria-pressed={on}
                    onClick={() => setWork(on ? work.filter((x) => x !== w) : [...work, w])}>{w}</button>
                )
              })}
            </div>
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => void begin()}>
                Continue <ArrowRight size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}

        {step === 'working' && (
          <>
            <div className="fr-face"><Orb live size={64} /></div>
            <h1>Collecting your week.</h1>
            <p className="fr-sub">About a minute.</p>
            <div className="fr-track" role="progressbar" aria-valuemin={0} aria-valuemax={STAGES.length} aria-valuenow={stageAt + 1}>
              {STAGES.map((s, i) => <i key={s} className={i < stageAt ? 'on' : i === stageAt ? 'going' : ''} />)}
            </div>
            <div className="fr-nums">
              <Num n={counts.emails} label="emails" />
              <Num n={counts.meetings} label="meetings" />
              <Num n={counts.people} label="people" />
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h1>{unread > 0 ? `Reading ${unread} ${unread === 1 ? 'message' : 'messages'}.`
              : counts.open_loops > 0 ? `${counts.open_loops} loose ${counts.open_loops === 1 ? 'end' : 'ends'} found.` : 'You are all set.'}</h1>
            <p className="fr-sub">{unread > 0 ? 'Loose ends appear as found.' : connected.length ? 'Older mail is still loading.' : 'Connect mail any time.'}</p>
            {shifts.length > 0 && (
              <div className="fr-shifts">
                <div className="fr-shifts-h">On shift for you</div>
                {shifts.slice(0, 6).map((e) => (
                  <div key={e.key} className="fr-shift">
                    <Check size={13} strokeWidth={2.8} />
                    <span>{e.name}</span>
                    <time>{clock(e.times)}</time>
                  </div>
                ))}
              </div>
            )}
            {trouble.length > 0 && <p className="fr-note">One thing will be retried: {trouble[0].split(':')[0]}.</p>}
            <div className="btn-row">
              <button className="btn primary lg" onClick={onDone}>
                Open my desk <ArrowRight size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Num({ n, label }: { n: number; label: string }) {
  return <div className="fr-num"><b>{n}</b><span>{label}</span></div>
}
