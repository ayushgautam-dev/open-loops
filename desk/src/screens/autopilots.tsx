import { useEffect, useState } from 'react'
import {
  Sparkles, Sun, Layers, Mail, CalendarClock, MessageSquare, MoonStar,
  PenLine, ArrowUpRight, Lightbulb, Zap, Plus, type LucideIcon,
} from 'lucide-react'
import {
  ensureMyAutopilots, loadCatalog, listSchedules, myId, myCopy, setMine, localCron, myTimezone,
  type CatalogEntry, type Sched as MySched, CATCH_UP } from '../autopilot-sync'
import { Empty, Loading, Orb, useToast } from '../ui'
import { useLem } from '../lem'

/* What runs on its own, read like a schedule. Routines that run to a clock, and
   watchers that sit and wait. Created and changed by talking to Lem — no builder.
   The names, descriptions and cron reading are the existing app's. */

/** A row on the page: my own schedule, or a menu entry I have no copy of yet (off). */
interface Sched extends MySched {
  entry?: CatalogEntry | null
  copy?: MySched
}

interface Meta { name: string; what: string; icon: LucideIcon; tint: string }

const LABELS: Record<string, Meta> = {
  autopilot_tidy_up: {
    name: 'Tidy Up',
    what: 'Closes what you already handled, retires anything a later arrangement replaced, and ages out what has gone cold.',
    icon: Sparkles, tint: 'green',
  },
  autopilot_loose_ends: {
    name: 'Loose Ends',
    what: 'Reads anything new in your mail and meetings and opens what is genuinely unfinished.',
    icon: Layers, tint: 'amber',
  },
  autopilot_morning_brief: {
    name: 'Morning Brief',
    what: "Today's meetings, what you owe each person, and anything overdue. Emailed to you alone.",
    icon: Sun, tint: 'amber',
  },
  autopilot_situations: {
    name: 'Keep the Feed readable',
    what: 'Groups what is open into workstreams — customers, hiring, meetings — and writes the two lines that say where each stands.',
    icon: Layers, tint: 'blue',
  },
  autopilot_drafts: {
    name: 'Prepared replies',
    what: 'Writes the reply before you ask for it, with real times from your own calendar. Nothing sends itself.',
    icon: PenLine, tint: 'violet',
  },
  autopilot_raise_next: {
    name: 'Raise next time',
    what: 'Works out what is worth bringing up at your next recurring meeting.',
    icon: ArrowUpRight, tint: 'blue',
  },
  autopilot_suggestions: {
    name: 'Suggestions',
    what: 'Notices the things you would probably want done, and offers rather than acts.',
    icon: Lightbulb, tint: 'amber',
  },
  autopilot_cold_pitches: {
    name: 'Cold Pitch Sweep',
    what: 'Lists everyone who has pitched you three or more times without a reply, with a one-line decline ready for each.',
    icon: Mail, tint: 'grey',
  },
  autopilot_money_owed: {
    name: 'Money Owed',
    what: 'Every Monday, lists every invoice or agreement you are still waiting to be paid on, with a reminder drafted for each.',
    icon: Sparkles, tint: 'green',
  },
  autopilot_learn_voice: {
    name: 'Learn your voice',
    what: 'Re-reads your sent mail once a month so every draft keeps sounding like you.',
    icon: PenLine, tint: 'violet',
  },
  mail_arrived: { name: 'Watch mail', what: 'Picks up new mail the moment it lands.', icon: Mail, tint: 'grey' },
  calendar_changed: { name: 'Watch calendar', what: 'Notices when something on your calendar changes.', icon: CalendarClock, tint: 'grey' },
  nightly_catchup: { name: 'Nightly catch-up', what: 'Re-reads the last few days in case a webhook was missed.', icon: MoonStar, tint: 'grey' },
  slack_poll: { name: 'Check Slack', what: 'Reads the channels it was invited to, twice a day.', icon: MessageSquare, tint: 'grey' },
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Cron, said out loud.
 *  A hand-written table only ever covers the expressions you happened to have on
 *  the day you wrote it — three of ours fell straight through and showed the user
 *  "0 7 * * 1-5". This reads the parts instead, so a new autopilot is legible the
 *  moment it exists. Anything genuinely odd still falls back to the raw string,
 *  which is at least honest. */
function humanCron(cron: string, local = false): string {
  const p = cron.trim().split(/\s+/)
  if (p.length < 5) return cron
  const [min, hourList, dom, mon] = p
  let dow = p[4]
  const hours = hourList.split(',')
  if (!/^\d+$/.test(min) || !hours.every((h) => /^\d+$/.test(h))) return cron
  if (mon !== '*' || (dom !== '*' && dom !== '1')) return cron

  // A schedule that stores its timezone is already in the person's own clock. An older
  // one runs on UTC, so say it in theirs (a "6:30am" brief is noon in India), and move
  // the weekdays with it if that crosses midnight.
  const at = hours.map((h) => (local
    ? new Date(2026, 0, 5, Number(h), Number(min))
    : new Date(Date.UTC(2026, 0, 5, Number(h), Number(min)))))   // a Monday
  const shift = local ? 0 : at[0].getDay() - 1
  if (shift && dow !== '*') {
    const moved = dow.replace(/\d/g, (x) => String((Number(x) + shift + 7) % 7))
    dow = moved === '2-6' ? '1-5' : moved   // keep "weekdays" readable when it is still weekdays
  }
  const clockOf = (d: Date) => { const h = d.getHours(), m = d.getMinutes(); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` }
  const clock = at.map(clockOf).join(' and ')
  const h = at[0].getHours()
  const partOfDay = at.length > 1 ? 'Twice a day' : h < 5 ? 'Overnight' : h < 12 ? 'Every morning' : h < 17 ? 'Every afternoon' : 'Every evening'

  if (dom === '1') return `On the 1st of each month, ${clock}`
  if (dow === '*') return `${partOfDay}, ${clock}`
  if (dow === '1-5') {
    const when = at.length > 1 ? 'Twice each weekday' : h < 5 ? 'Overnight' : h < 12 ? 'Weekday mornings' : h < 17 ? 'Weekday afternoons' : 'Weekday evenings'
    return `${when}, ${clock}`
  }
  if (/^\d$/.test(dow)) return `${DAYS[Number(dow) % 7]}s, ${clock}`
  if (/^[\d,]+$/.test(dow)) {
    const names = dow.split(',').map((d) => DAYS[Number(d) % 7]?.slice(0, 3)).filter(Boolean)
    return `${names.join(', ')}, ${clock}`
  }
  return `${partOfDay}, ${clock}`
}

function whenOf(s: Sched): string {
  if (s.schedule_type === 'DATASTORE') return 'When something new arrives'
  if (s.schedule_type === 'WEBHOOK') return 'The moment it happens'
  const cron = s.config?.cron
  if (!cron) return ''
  const map: Record<string, string> = {
    '0 9,17 * * 1-5': 'Twice each weekday',
  }
  return map[cron] ?? humanCron(cron, !!s.config?.timezone)
}

/** A schedule created per user is named `thing__ayush`; the label lives on the stem. */
function keyOf(s: Sched): string {
  const raw = s.workflow_name || s.agent_name || s.name || ''
  return raw.replace(/__[^_]*$/, '')
}

function metaOf(s: Sched): Meta {
  const k = keyOf(s)
  return LABELS[k] ?? { name: k || 'Autopilot', what: '', icon: Zap, tint: 'grey' }
}

function Row({ s, onToggle }: { s: Sched; onToggle: (s: Sched) => void }) {
  const m = metaOf(s)
  const Icon = m.icon
  return (
    <div className={`auto${s.is_active ? '' : ' off'}`}>
      <span className={`auto-ic tint-${m.tint}`}><Icon size={17} strokeWidth={1.9} /></span>
      <div className="auto-body">
        <div className="auto-name">{m.name}</div>
        {m.what && <p className="auto-what">{m.what}</p>}
      </div>
      <div className="auto-right">
        {whenOf(s) && <span className="auto-when">{whenOf(s)}</span>}
        <button className={`sw${s.is_active ? ' on' : ''}`} role="switch" aria-checked={s.is_active ? 'true' : 'false'}
          aria-label={`${m.name}, ${s.is_active ? 'on' : 'off'}`} onClick={() => onToggle(s)}><i /></button>
      </div>
    </div>
  )
}

export function Autopilots() {
  const toast = useToast()
  const lem = useLem()
  const [rows, setRows] = useState<Sched[] | null>(null)

  /* The menu, each entry showing *my* copy (or off, if I have none yet), then my own
     schedules that aren't on the menu — custom ones, and the pod-wide mail reader for
     whoever set the pod up. Nobody else's schedules are listed, so nobody can switch
     off somebody else's brief. */
  async function load() {
    try {
      const [me, menu, all] = await Promise.all([myId(), loadCatalog(), listSchedules()])
      const mine = all.filter((s) => s.user_id === me)
      const fromMenu: Sched[] = menu.map((e) => {
        const c = myCopy(e, mine)
        return {
          ...(c ?? {}), id: c?.id ?? `menu:${e.key}`, workflow_name: e.workflow_name,
          schedule_type: c?.schedule_type ?? e.schedule_type, is_active: !!c?.is_active,
          config: c?.config ?? (e.schedule_type === 'TIME' ? { cron: localCron(e.times ?? [], e.days ?? '*'), timezone: myTimezone() } : null),
          entry: e, copy: c,
        }
      })
      const covered = new Set(fromMenu.map((r) => r.copy?.id).filter(Boolean))
      const own: Sched[] = mine.filter((s) => !covered.has(s.id) && s.workflow_name !== CATCH_UP).map((s) => ({ ...s, entry: null, copy: s }))
      setRows([...fromMenu, ...own])
    } catch { setRows([]) }
  }
  useEffect(() => { void ensureMyAutopilots().catch(() => 0).finally(() => void load()) }, [])

  async function toggle(s: Sched) {
    // flip locally first: a toggle that waits on a round trip feels broken
    setRows((r) => (r ?? []).map((x) => (x.id === s.id ? { ...x, is_active: !x.is_active } : x)))
    try {
      await setMine(s.entry ?? null, s.copy, !s.is_active)
      toast(s.is_active ? 'Turned off' : 'Turned on')
    } catch (e) {
      setRows((r) => (r ?? []).map((x) => (x.id === s.id ? { ...x, is_active: s.is_active } : x)))
      toast(`Could not change that — ${(e as Error)?.message ?? 'try again'}`)
    }
    void load()
  }

  const watching = (rows ?? []).filter((s) => s.schedule_type === 'WEBHOOK' || s.schedule_type === 'DATASTORE')
  const running = (rows ?? []).filter((s) => !watching.includes(s))
  const on = (rows ?? []).filter((r) => r.is_active).length

  return (
    <div className="page">
      <header className="page-h">
        <h1 className="display sm">Autopilots</h1>
        {rows && <span className="muted">{on} of {rows.length} on</span>}
      </header>

      <button className="make-auto" onClick={() => lem.ask(
        'I want a new autopilot. Ask me what it should do and when it should run, then '
        + 'build it for real in this pod — create the workflow and its schedule — and show me '
        + 'the plain-English version before you switch it on.',
      )}>
        <Orb size={22} />
        <span><b>Describe a new autopilot</b><small>“Every Friday, tell me which deals went quiet this week.”</small></span>
        <Plus size={16} />
      </button>

      {rows === null ? <Loading rows={5} /> : rows.length === 0 ? <Empty line="Nothing runs automatically yet." /> : (
        <>
          {running.length > 0 && (
            <section className="auto-sec">
              <div className="sec-h">On a schedule</div>
              <div className="card flush">{running.map((s) => <Row key={s.id} s={s} onToggle={toggle} />)}</div>
            </section>
          )}
          {watching.length > 0 && (
            <section className="auto-sec">
              <div className="sec-h">Watching</div>
              <div className="card flush">{watching.map((s) => <Row key={s.id} s={s} onToggle={toggle} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
