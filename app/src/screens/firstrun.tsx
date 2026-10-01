import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ArrowRight, RefreshCw, Sparkles } from 'lucide-react'
import { client, runFn, records, sql } from '../lib'
import { SourceMark } from '../brand'
import { ensureMyAutopilots, ensureSkills } from '../autopilot-sync'

/* First run.
   Nobody should meet an empty product. Connect what you have, say one sentence
   about your work, and by the time the Feed opens Lem has already read three
   weeks of it and worked out what is unfinished.

   Two rules shape this screen:
   - Nothing here is mandatory. Gmail is urged because it is the one source that
     makes the product work alone, but every button past it still moves forward.
   - The progress step reports counted rows, never "the call returned". A sync can
     answer cheerfully and have written nothing, and saying "done" over that is how
     somebody lands on an empty Feed wondering what they did wrong. */

type Step = 'welcome' | 'connect' | 'about' | 'research' | 'working' | 'done'

interface Source {
  app: string
  label: string
  why: string
  important?: boolean
  onboarding?: boolean
  connected?: boolean
  status?: string
  needs_manual_setup?: boolean
}

interface Counts {
  interactions: number; emails: number; meetings: number; notes: number
  people: number; open_loops: number; situations: number; workstreams: number
}

const ZERO: Counts = {
  interactions: 0, emails: 0, meetings: 0, notes: 0, people: 0, open_loops: 0,
  situations: 0, workstreams: 0,
}

/* Counted in the app, not in a pod function.
   A function runs under the pod's service identity, and every table here is RLS'd
   to its owner — so `select count(*)` inside a function returns 0 however much
   data the person actually has. (Verified against a pod holding 331 interactions:
   the function said 0, this same query said 331.) The datastore query below runs
   as the signed-in user, which is the only context that can see their own rows. */
/** Interactions nothing has read yet — the honest measure of "still working". */
async function unreadCount(): Promise<number> {
  try {
    const rows = await sql<{ n: number }>(
      `select count(*) as n from interactions where extracted_at is null`)
    return Number(rows[0]?.n ?? 0) || 0
  } catch { return 0 }
}

const COUNTS_SQL = `
  select
    (select count(*) from interactions) as interactions,
    (select count(*) from interactions where source='gmail') as emails,
    (select count(*) from interactions where source='calendar') as meetings,
    (select count(*) from interactions where source='granola') as notes,
    (select count(*) from people) as people,
    (select count(*) from loops where status='open') as open_loops,
    (select count(*) from situations) as situations,
    (select count(*) from work_projects) as workstreams`

/** Three weeks. Long enough that nothing live is missed, short enough that the
 *  backfill finishes while somebody is still watching it. */
const WINDOW_DAYS = 21

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

/* While this person's import runs, Loose Ends must not also fire once per new mail row
   (the first run of this put 149 rows in and got 151 concurrent agent runs, until the
   platform disabled the trigger). That trigger is shared by everybody in the pod, so
   switching it off paused mail reading for the whole team while one person set up.
   Instead this person gets a private flag in `settings`; the workflow's first step
   (`backfill_guard`) reads it, as the row's owner, and only their triggered runs stand
   down. The import's own reading passes carry no trigger row, so they always go ahead.
   The flag expires on its own after an hour, in case this tab is closed mid-import. */
async function setBackfillFlag(until: Date | null) {
  const value = (until ?? new Date(0)).toISOString()
  try {
    const rows = await sql<{ id: string }>(`select id from settings where key='backfill_until' limit 1`)
    if (rows[0]) await records.update('settings', rows[0].id, { value })
    else await records.create('settings', { key: 'backfill_until', value })
  } catch { /* not fatal: the import still runs, only busier */ }
}

/** Run a workflow and wait for it, but never let a slow agent hold the door shut. */
async function runWorkflow(name: string, budgetMs = 90_000): Promise<void> {
  const wf = client.workflows as unknown as {
    runs: {
      create: (n: string) => Promise<{ id?: string; run_id?: string; status?: string }>
      get: (id: string) => Promise<{ status?: string }>
    }
  }
  const run = await wf.runs.create(name)
  const id = run.id || run.run_id
  if (!id) return
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    await sleep(3000)
    try {
      const r = await wf.runs.get(id)
      const s = (r.status || '').toUpperCase()
      // WAITING means the run is parked on a human form. None of the onboarding
      // workflows has one, but if that ever changes, nobody is sitting on this
      // screen to fill it in — so treat it as done rather than hanging here.
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING'].includes(s)) return
    } catch { return }
  }
}

export function FirstRun({ name, onDone }: { name: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [busyWord, setBusyWord] = useState('Setting up…')
  const [note, setNote] = useState('')
  const [work, setWork] = useState('')
  const [researchKey, setResearchKey] = useState('')

  const [phase, setPhase] = useState('')
  const [done, setDone] = useState<string[]>([])
  const [counts, setCounts] = useState<Counts>(ZERO)
  const [trouble, setTrouble] = useState<string[]>([])
  const [leftover, setLeftover] = useState(0)
  const started = useRef(false)

  const load = useCallback(async () => {
    try {
      const out = await runFn<{ sources?: Source[] }>('sources_status', {})
      setSources((out.sources ?? []).filter((s) => s.onboarding !== false))
    } catch { setSources([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  const somethingToShow = counts.open_loops > 0 || counts.situations > 0 || counts.people > 0
  const isOn = (s: Source) => Boolean(s.connected || s.status === 'connected')
  const connected = (sources ?? []).filter(isOn)
  const hasGmail = connected.some((s) => s.app === 'gmail')

  /** Open the provider's own consent screen, then watch for the account to appear.
   *  We poll rather than rely on the popup telling us anything — it is on the
   *  provider's origin, so it cannot talk back to us. */
  async function connect(app: string) {
    setBusy(app); setBusyWord('Setting up…'); setNote('')
    // opened on the click itself and pointed at the provider once the link is known:
    // a tab opened after waiting on the pod is what browsers block
    const win = window.open('', '_blank')
    try {
      /* This installs the connector for the workspace if it is not there yet and
         then hands back a sign-in link — on a pod somebody just cloned, nothing is
         installed, and none of it should mean a trip to an admin console. */
      const out = await runFn<{
        auth_url?: string; authorization_url?: string; already_connected?: boolean
        needs_manual_setup?: boolean; explanation?: string; installed_now?: boolean
      }>('connect_source', { app })

      if (out.already_connected) { win?.close(); await load(); return }
      const url = out.auth_url || out.authorization_url
      if (!url) {
        setNote(out.explanation
          || 'That source cannot be connected from here yet. You can add it later from Settings.')
        win?.close()
        return
      }
      if (win && !win.closed) { win.opener = null; win.location.href = url }
      else { setNote('Your browser blocked the sign-in tab. Allow pop-ups for this page and press Connect again.'); return }
      setBusyWord('Waiting for sign-in…')

      // Up to three minutes of consent, checked every couple of seconds.
      for (let i = 0; i < 90; i++) {
        await sleep(2000)
        try {
          const st = await runFn<{ sources?: Source[] }>('sources_status', {})
          const all = st.sources ?? []
          setSources(all.filter((s) => s.onboarding !== false))
          if (all.some((s) => s.app === app && (s.connected || s.status === 'connected'))) return
        } catch { /* keep waiting; a hiccup is not a failure */ }
      }
      setNote('Still waiting on that one. If you finished signing in, press Refresh.')
    } catch (e) {
      setNote(`Could not start that — ${(e as Error)?.message ?? 'try again'}`)
    } finally {
      setBusy(null)
      void load()
    }
  }

  /* ---------------- the backfill ---------------- */

  const refreshCounts = useCallback(async () => {
    try {
      const rows = await sql<Record<string, unknown>>(COUNTS_SQL)
      const r = rows[0]
      if (!r) return
      const n = (k: string) => Number(r[k] ?? 0) || 0
      setCounts({
        interactions: n('interactions'), emails: n('emails'), meetings: n('meetings'),
        notes: n('notes'), people: n('people'), open_loops: n('open_loops'),
        situations: n('situations'), workstreams: n('workstreams'),
      })
    } catch { /* keep the last good numbers rather than flashing zeros */ }
  }, [])

  const runBackfill = useCallback(async () => {
    if (started.current) return
    started.current = true
    setStep('working')

    const mark = (label: string) => setDone((d) => (d.includes(label) ? d : [...d, label]))
    const failed: string[] = []

    /* Every step is isolated. One source refusing is a missing paragraph, not a
       failed onboarding — the rest still runs and the person still gets a Feed. */
    const stage = async (label: string, phaseText: string, fn: () => Promise<unknown>) => {
      setPhase(phaseText)
      try { await fn() } catch (e) { failed.push(`${label}: ${(e as Error)?.message ?? 'did not finish'}`) }
      mark(label)
      await refreshCounts()
    }

    /* Reading is normally event-driven: a DATASTORE schedule fires the extractor
       the moment rows land in `interactions`. That is right for the two emails
       that arrive while you are working and catastrophic for a backfill — the
       first run of this put 149 rows in and got 151 concurrent agent runs, all
       competing over the same rows, none finishing, until the platform disabled
       the schedule. It looked, from the outside, exactly like nothing happened.
       So: flag this person as mid-import, load everything, read it in a few
       deliberate passes, and clear the flag for normal life (see setBackfillFlag). */
    await setBackfillFlag(new Date(Date.now() + 60 * 60000))

    try {
      await stage('Workspace', 'Setting up your workspace…', async () => {
        await runFn('bootstrap_me', { include_examples: false })
        // Lem's skills before anything is read — the first reading pass loads one
        await ensureSkills()
        if (work.trim()) {
          await records.create('settings', { key: 'what_i_do', value: work.trim() })
        }
        if (researchKey.trim()) {
          await records.create('settings', { key: 'research_api_key', value: researchKey.trim() })
        }
      })

      const on = (app: string) => connected.some((s) => s.app === app)

      if (on('gmail')) {
        await stage('Mail', 'Reading the last three weeks of your mail…', () =>
          runFn('sync_gmail', { days: WINDOW_DAYS, max_messages: 200, batch_size: 10 }))
      }
      if (on('google_calendar')) {
        await stage('Calendar', 'Going through your calendar…', () =>
          runFn('sync_calendar', {
            past_days: WINDOW_DAYS, future_days: 14, max_events: 150, batch_size: 10,
          }))
      }
      if (on('granola')) {
        // Granola's window is a closed enum — last_30_days is the nearest thing
        // to three weeks it will accept.
        await stage('Meeting notes', 'Picking up your meeting notes…', () =>
          runFn('sync_granola', { time_range: 'last_30_days', batch_size: 10 }))
      }

      /* One pass reads a bounded slice, so repeat while it is still making
         progress. Stops on: nothing left, no progress (the remainder is
         something the extractor will never claim), or the budget. */
      await stage('Reading', 'Working out what is actually unfinished…', async () => {
        let previous = -1
        for (let pass = 0; pass < 6; pass++) {
          const left = await unreadCount()
          if (left === 0) break
          if (left === previous) break
          previous = left
          setPhase(`Working out what is actually unfinished… (${left} left)`)
          await runWorkflow('autopilot_loose_ends', 240_000)
          await refreshCounts()
        }
      })

      await stage('Grouping', 'Grouping it into what you are working on…', () =>
        runWorkflow('autopilot_situations', 180_000))

      /* Every draft is only worth sending if it already sounds like them, and the
         mail we just read is the best sample of their writing we will ever get. */
      await stage('Voice', 'Learning how you write from your sent mail…', () =>
        runWorkflow('autopilot_learn_voice', 180_000))

      /* Their own copy of every autopilot that starts on, at their local time, running
         as them. Last, so the routines start on top of what was just read. */
      await stage('Autopilots', 'Setting up your autopilots…', () => ensureMyAutopilots())
    } finally {
      // Whatever happened above, normal life resumes: their mail is read as it lands.
      await setBackfillFlag(null)
    }

    await refreshCounts()
    setLeftover(await unreadCount())
    setTrouble(failed)

    try {
      await records.create('settings', {
        key: 'onboarded_at', value: new Date().toISOString(),
      })
    } catch { /* the marker is a convenience; never block on it */ }

    setPhase('')
    setStep('done')
  }, [connected, refreshCounts, work, researchKey])

  /* ---------------- chrome ---------------- */

  const StepDots = ({ at }: { at: number }) => (
    <div className="fr-dots" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <i key={i} className={i <= at ? 'on' : ''} />)}
    </div>
  )

  return (
    <div className="firstrun">
      <div className="fr-card">

        {step === 'welcome' && (
          <>
            <StepDots at={0} />
            <div className="fr-badge"><Sparkles size={13} strokeWidth={2} /> Open Loops</div>
            <h1>Hello {name}.</h1>
            <p className="fr-line">
              This is a place for everything you have half-finished — the replies you owe,
              the things you said you would send, the people waiting on you.
              Connect what you already use and it will be here when you open it.
            </p>
            <p className="fr-line" style={{ marginTop: -8 }}>
              Nothing is ever sent without you pressing send.
            </p>
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => setStep('connect')}>
                Get started <ArrowRight size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}

        {step === 'connect' && (
          <>
            <StepDots at={1} />
            <h1>Connect what you use.</h1>
            <p className="fr-line">
              Gmail is the one that matters most — it is where most of what you owe people
              is written down. The rest only make it sharper, and you can add any of them
              later. Each one signs you in with your own account; there is nothing to set
              up anywhere else.
            </p>

            <div className="fr-sources">
              {sources === null && <div className="empty"><div className="spinner" /></div>}
              {(sources ?? []).map((s) => {
                const on = isOn(s)
                const waiting = busy === s.app
                return (
                  <div key={s.app} className={`fr-src${s.important ? ' key' : ''}`}>
                    <SourceMark app={s.app} label={s.label} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">
                        {s.label}
                        {s.important && !on && <span className="tag">Recommended</span>}
                      </div>
                      <div className="ds">{s.why}</div>
                    </div>
                    {on ? (
                      <span className="fr-on"><Check size={14} strokeWidth={2.6} /> Connected</span>
                    ) : (
                      <button className={`btn${s.important ? ' primary' : ''}`} disabled={waiting}
                        onClick={() => void connect(s.app)}>
                        {waiting ? busyWord : 'Connect'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {note && <p className="fr-note">{note}</p>}

            <div className="btn-row">
              <button className="btn primary lg" onClick={() => setStep('about')}>
                {connected.length === 0 ? 'Continue without connecting' : 'Continue'}
                <ArrowRight size={15} strokeWidth={2} />
              </button>
              <button className="btn quiet" onClick={() => void load()}>
                <RefreshCw size={14} strokeWidth={2} /> Refresh
              </button>
            </div>
            {connected.length > 0 && !hasGmail && (
              <p className="fr-note" style={{ marginTop: 12 }}>
                Without Gmail there is a lot Lem simply cannot see. You can connect it now
                or from Settings whenever you like.
              </p>
            )}
          </>
        )}

        {step === 'about' && (
          <>
            <StepDots at={2} />
            <h1>What do you spend your time on?</h1>
            <p className="fr-line">
              A sentence is enough. It tells Lem what to pay attention to and, just as
              usefully, what to leave alone.
            </p>
            <div className="ask" style={{ marginBottom: 18 }}>
              <textarea
                autoFocus rows={3} value={work}
                placeholder="Running a small team, hiring two people, and three customer pilots."
                onChange={(e) => setWork(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => setStep('research')}>
                Continue <ArrowRight size={15} strokeWidth={2} />
              </button>
              <button className="btn quiet" onClick={() => setStep('research')}>Skip</button>
            </div>
          </>
        )}

        {step === 'research' && (
          <>
            <StepDots at={2} />
            <h1>Know who you are meeting.</h1>
            <p className="fr-line">
              With a Monid key, Lem looks a new person up before you meet them — their
              role, their company, what changed recently. Without one it falls back to
              web search, which is rougher but free.
            </p>
            <div className="fr-key">
              <input
                type="password" autoComplete="off" spellCheck={false}
                value={researchKey} placeholder="Monid API key"
                onChange={(e) => setResearchKey(e.target.value)}
              />
            </div>
            <p className="fr-hint">
              Get one at <a href="https://monid.ai" target="_blank" rel="noreferrer">monid.ai</a> —
              sign up, then copy the key from Settings.
            </p>
            <div className="btn-row">
              <button className="btn primary lg" onClick={() => void runBackfill()}>
                Done <ArrowRight size={15} strokeWidth={2} />
              </button>
              <button className="btn quiet" onClick={() => void runBackfill()}>
                Skip, use web search
              </button>
            </div>
          </>
        )}

        {step === 'working' && (
          <>
            <StepDots at={3} />
            <h1>Give me a minute.</h1>
            <p className="fr-line">
              Reading the last three weeks so there is something real here when you arrive.
              You do not have to wait on this screen.
            </p>

            <div className="fr-steps">
              {done.map((d) => (
                <div key={d} className="fr-step done">
                  <Check size={14} strokeWidth={2.8} /> <span>{d}</span>
                </div>
              ))}
              {phase && (
                <div className="fr-step now">
                  <span className="spinner sm" /> <span>{phase}</span>
                </div>
              )}
            </div>

            {counts.interactions > 0 && (
              <div className="fr-tally">
                <Tally n={counts.emails} one="email" many="emails" />
                <Tally n={counts.meetings} one="meeting" many="meetings" />
                <Tally n={counts.notes} one="note" many="notes" />
                <Tally n={counts.people} one="person" many="people" />
              </div>
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <StepDots at={3} />
            <h1>{somethingToShow ? 'Here is what I found.' : 'You are all set.'}</h1>

            {somethingToShow ? (
              <div className="fr-found">
                <Found n={counts.open_loops} one="open commitment" many="open commitments" />
                <Found n={counts.people} one="person" many="people" />
                <Found n={counts.situations} one="situation" many="situations" />
                <Found n={counts.workstreams} one="workstream" many="workstreams" />
              </div>
            ) : (
              <p className="fr-line">
                Nothing needed your attention in the last three weeks — or there was not
                much to read yet. Connect a source from Settings and it will fill in.
              </p>
            )}

            {leftover > 0 && (
              <p className="fr-note">
                {leftover} {leftover === 1 ? 'message is' : 'messages are'} still being read.
                That carries on in the background — the Feed fills in as it goes.
              </p>
            )}

            {trouble.length > 0 && (
              <p className="fr-note">
                One thing did not finish: {trouble[0]}. It will be retried automatically,
                and everything else came through.
              </p>
            )}

            <div className="btn-row" style={{ marginTop: 22 }}>
              <button className="btn primary lg" onClick={onDone}>
                Open my feed <ArrowRight size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Tally({ n, one, many }: { n: number; one: string; many: string }) {
  if (!n) return null
  return <span className="tally"><b>{n}</b> {n === 1 ? one : many}</span>
}

function Found({ n, one, many }: { n: number; one: string; many: string }) {
  if (!n) return null
  return (
    <div className="found">
      <b>{n}</b>
      <span>{n === 1 ? one : many}</span>
    </div>
  )
}
