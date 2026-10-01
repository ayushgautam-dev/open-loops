import { createContext, useContext, useEffect, useState } from 'react'
import { client, runFn, records, sql, lit } from './lib'
import { setCatchUpSchedule } from './autopilot-sync'

/* Getting somebody's history in, without making them watch.

   First run used to load three weeks in one go and hold the person on a progress screen
   until every message had been read, which could be half an hour. Now it is two parts:

   - quickStart: the most recent few days are loaded and the desk opens. Reading them is
     started but not waited for: a careful read of even twenty messages takes several
     minutes, and what it finds shows up on the desk as it goes.
   - catch-up: everything older, a few days at a time. It runs in the pod, not in this
     tab: the person's own `catch_up` schedule ticks a workflow whose first step loads the
     next slice and whose second reads it. Where it has got to lives in `settings` under
     `catchup`, so it carries on with the app closed. The Shell only watches (useCatchUp),
     groups what was read into topics, and switches the schedule off at the end.

   Mail is pulled in small slices because one function call that fetches a whole inbox
   outlives the 30 second request limit ("Mail: Request timed out after 30000ms"). */

export const WINDOW_DAYS = 21
const SLICE_DAYS = 4
const SLICE_MAX = 40

export interface CatchUp {
  /** how many days back have been loaded */
  covered: number
  target: number
  sources: string[]
  /** calendar and meeting notes are loaded whole, once */
  extras: boolean
  /** the first slice has been grouped into what the person is working on (kept beside
   *  the state, in its own setting, because the pod rewrites the state itself) */
  grouped?: boolean
  done: boolean
  /** messages loaded but not read yet, for whoever is showing progress */
  unread?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function getSetting(key: string): Promise<{ id: string; value: string } | null> {
  try {
    const rows = await sql<{ id: string; value: string }>(
      `select id, value from settings where key=${lit(key)} limit 1`)
    return rows[0] ?? null
  } catch { return null }
}

export async function putSetting(key: string, value: string): Promise<void> {
  try {
    const row = await getSetting(key)
    if (row) await records.update('settings', row.id, { value })
    else await records.create('settings', { key, value })
  } catch { /* a setting that did not save is retried by whoever needs it next */ }
}

/** Interactions nothing has read yet: the honest measure of "still working". */
export async function unreadCount(): Promise<number> {
  try {
    const rows = await sql<{ n: number }>(`select count(*) as n from interactions where extracted_at is null`)
    return Number(rows[0]?.n ?? 0) || 0
  } catch { return 0 }
}

/* While an import runs, the pod-wide trigger must not also fire once per new mail row.
   The person gets a private flag; `backfill_guard` reads it and stands their triggered
   runs down. It expires on its own, so a closed tab never leaves mail unread for long. */
export const holdTrigger = (minutes: number) =>
  putSetting('backfill_until', new Date(minutes > 0 ? Date.now() + minutes * 60000 : 0).toISOString())

type Run = { id?: string; run_id?: string; status?: string }
const wf = () => client.workflows as unknown as {
  runs: {
    create: (n: string) => Promise<Run>
    get: (id: string) => Promise<Run>
    list: (n: string, o?: { limit?: number }) => Promise<{ items?: Run[] }>
  }
}
const OVER = ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING']

/** A run of this workflow that is still going, if there is one. Two readers on the same
 *  unread rows only get in each other's way, so nothing here starts a second. */
async function activeRun(name: string): Promise<string | null> {
  try {
    const out = await wf().runs.list(name, { limit: 40 })
    const r = (out.items ?? []).find((x) => (x.status || '').toUpperCase() === 'RUNNING')
    return r?.id || r?.run_id || null
  } catch { return null }
}

/** Start a workflow unless it is already running. Does not wait for it. */
export async function startWorkflow(name: string): Promise<string | null> {
  const going = await activeRun(name)
  if (going) return going
  const run = await wf().runs.create(name)
  return run.id || run.run_id || null
}

/** Wait for a run that is already going, without starting one. True when none is left. */
async function settle(name: string, budgetMs: number): Promise<boolean> {
  const id = await activeRun(name)
  if (!id) return true
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    await sleep(3000)
    try {
      if (OVER.includes(((await wf().runs.get(id)).status || '').toUpperCase())) return true
    } catch { return true }
  }
  return false
}

/** Run a workflow (or join the run already going) and wait for it, but never let a slow
 *  run hold the door shut. Returns whether it finished inside the budget. */
export async function runWorkflow(name: string, budgetMs = 90_000): Promise<boolean> {
  const id = await startWorkflow(name)
  if (!id) return true
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    await sleep(3000)
    try {
      if (OVER.includes(((await wf().runs.get(id)).status || '').toUpperCase())) return true
    } catch { return true }
  }
  return false
}

/** A request that timed out is still running on the other side, so it is not a failure;
 *  whatever it had not written yet is picked up by the next slice (duplicates are skipped). */
async function sync(name: string, input: Record<string, unknown>): Promise<{ recorded: number; seen: number }> {
  try {
    const out = await runFn<{ recorded?: number; skipped_duplicate?: number }>(name, input)
    const recorded = Number(out.recorded ?? 0) || 0
    return { recorded, seen: recorded + (Number(out.skipped_duplicate ?? 0) || 0) }
  } catch (e) {
    if (/timed out|timeout/i.test((e as Error)?.message ?? '')) return { recorded: 0, seen: 0 }
    throw e
  }
}

const MAIL_FILTER = '-in:spam -in:trash -category:promotions -category:social -category:forums'
const gmailDay = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86400000)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** Mail between `from` and `to` days ago (to > from). The edges overlap by a day on purpose. */
const mailSlice = (from: number, to: number) =>
  sync('sync_gmail', {
    query: from <= 0
      ? `newer_than:${to}d ${MAIL_FILTER}`
      : `after:${gmailDay(to + 1)} before:${gmailDay(from - 1)} ${MAIL_FILTER}`,
    max_messages: SLICE_MAX, batch_size: 10,
  })

export interface QuickResult { trouble: string[] }

/** The first minute: the most recent mail and this week's calendar. Reading them, and
 *  everything older, is handed to the pod so the desk can open straight away. */
export async function quickStart(sources: string[], say: (phase: string) => void): Promise<QuickResult> {
  const trouble: string[] = []
  const on = (app: string) => sources.includes(app)
  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (e) { trouble.push(`${label}: ${(e as Error)?.message ?? 'did not finish'}`) }
  }
  let covered = 2
  await holdTrigger(60)

  if (on('gmail')) {
    say('mail')
    await attempt('Mail', async () => {
      const first = await mailSlice(0, 2)
      // a quiet weekend is not an empty inbox: reach back until there is something to read
      if (first.seen < 15) { await mailSlice(0, 5); covered = 5 }
    })
  }
  if (on('google_calendar')) {
    say('calendar')
    await attempt('Calendar', () =>
      sync('sync_calendar', { past_days: covered, future_days: 14, max_events: 60, batch_size: 10 }))
  }

  const unread = await unreadCount()
  const state: CatchUp = { covered, target: WINDOW_DAYS, sources, extras: false, done: false, unread }
  await putSetting('catchup', JSON.stringify(state))
  await putSetting('catchup_grouped', '')
  await putSetting('catchup_wrapped', '')

  /* Hand over to the pod: this person's own timer, and one run now so reading starts
     without waiting for the first tick. A pod from before the catch-up workflow existed
     has neither, so there the plain reader is started and the nightly pass does the rest. */
  try {
    await setCatchUpSchedule(true)
    await startWorkflow('catch_up')
  } catch {
    if (unread) await attempt('Reading', () => startWorkflow('autopilot_loose_ends'))
  }
  return { trouble }
}

export async function readCatchUp(): Promise<CatchUp | null> {
  const row = await getSetting('catchup')
  if (!row) return null
  try {
    const s = JSON.parse(row.value) as CatchUp
    s.grouped = !!(await getSetting('catchup_grouped'))?.value
    return s
  } catch { return null }
}

/* One tab does the app's small share of the work. A second tab only watches. */
const LOCK = 'desk-catchup-beat'
const beat = () => { try { localStorage.setItem(LOCK, String(Date.now())) } catch { /* fine */ } }
const someoneElseIsOnIt = () => {
  try { return Date.now() - Number(localStorage.getItem(LOCK) || 0) < 45000 } catch { return false }
}

/** Watches the pod load the older history. `onProgress` refreshes the pages as rows land.
 *  The app's own part is small: group the first slice into topics once it has been read,
 *  and at the very end group again, learn how the person writes, and stop the timer. */
export function useCatchUp(onProgress: () => void): CatchUp | null {
  const [state, setState] = useState<CatchUp | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      let last = ''
      let nudged = Date.now()
      // long enough for three weeks of slow reading; the pod carries on regardless
      for (let i = 0; live && i < 720; i++) {
        const s = await readCatchUp()
        if (!live || !s) return
        const wrapped = !!(await getSetting('catchup_wrapped'))?.value
        if (s.done && wrapped) { setState(null); return }
        setState(s)
        const sig = `${s.covered}:${s.unread}:${s.extras}:${s.done}`
        if (sig !== last) { last = sig; onProgress() }

        if (!someoneElseIsOnIt()) {
          beat()
          const unread = await unreadCount()
          if (!s.grouped && unread === 0) {
            // what was just read, grouped, so the desk has shape before older mail arrives
            await putSetting('catchup_grouped', '1')
            await runWorkflow('autopilot_situations', 180_000).catch(() => null)
            onProgress()
          } else if (!s.done && Date.now() - nudged > 120_000) {
            /* More to load or to read: do not wait for the timer's next tick. This joins a
               run that is already going, and a run that finds a reader still at work
               stands down by itself, so asking again every couple of minutes is safe. */
            nudged = Date.now()
            await startWorkflow('catch_up').catch(() => null)
          } else if (s.done) {
            await putSetting('catchup_wrapped', '1')
            await setCatchUpSchedule(false).catch(() => null)
            await runWorkflow('autopilot_situations', 180_000).catch(() => null)
            // every draft is only worth sending if it sounds like them; their sent mail is the sample
            await runWorkflow('autopilot_learn_voice', 180_000).catch(() => null)
            onProgress()
            if (live) setState(null)
            return
          }
        }
        await sleep(20000)
      }
    })()
    return () => { live = false }
  }, [])
  return state && !state.done ? state : null
}

/** Whether history is still loading, for pages that would otherwise say "nothing here". */
export const CatchUpCtx = createContext<CatchUp | null>(null)
export const useCatching = () => useContext(CatchUpCtx)
