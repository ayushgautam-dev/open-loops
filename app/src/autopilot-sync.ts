import { client, sql } from './lib'

/* Everyone's own autopilots, from one shared menu.

   `autopilot_catalog` is the menu: what exists, when it runs in local time, and
   whether it starts on. It holds no personal data, so it is the one table everybody in
   the pod can read.

   A person's switch is *their own schedule* for that entry. A schedule runs as whoever
   created it — their mail, their rows, their inbox for the brief — so each person needs
   their own copy, and one person's toggle never touches anybody else's.

   - First run (and a quiet check on every visit) creates your copy of every entry that
     starts on, at your local time, unless you already have one.
   - Switching off pauses your copy; it stays paused. Only a missing copy is set up.
   - Custom autopilots (one person's money-owed sweep) are simply that person's own
     schedules; they are not on the menu.
   - The pod-wide trigger that reads each new mail row (as that row's owner) is not a
     menu entry: it is created once with the pod and belongs to whoever set the pod up. */

export interface CatalogEntry {
  key: string
  name: string
  what?: string | null
  workflow_name: string
  schedule_type: 'TIME' | 'WEBHOOK'
  times?: [number, number][] | null
  days?: string | null
  default_on: boolean
  needs?: string | null
  connector_trigger_id?: string | null
  trigger_source?: string | null
  position?: number | null
}

export interface Sched {
  id: string
  name?: string | null
  workflow_name?: string | null
  agent_name?: string | null
  schedule_type?: string | null
  is_active?: boolean
  config?: { cron?: string; timezone?: string; table_name?: string; operations?: string[]; source?: string } | null
  user_id?: string | null
  [k: string]: unknown
}

type Schedules = {
  list: (o?: { limit?: number }) => Promise<{ items?: Sched[] }>
  create: (p: Record<string, unknown>) => Promise<Sched>
  update: (id: string, p: Record<string, unknown>) => Promise<Sched>
}
const schedules = () => client.schedules as unknown as Schedules

let uid: Promise<string> | null = null
/** The signed-in person's id — the owner every schedule is matched against. */
export function myId(): Promise<string> {
  uid ??= (client as unknown as { users: { current: () => Promise<{ id: string }> } })
    .users.current().then((u) => String(u.id))
  uid.catch(() => { uid = null })
  return uid
}

export async function loadCatalog(): Promise<CatalogEntry[]> {
  try {
    const rows = await sql<CatalogEntry & { times?: unknown }>(
      'select key, name, what, workflow_name, schedule_type, times, days, default_on, needs, ' +
      'connector_trigger_id, trigger_source, position from autopilot_catalog order by position')
    return rows.map((r) => ({
      ...r,
      times: typeof r.times === 'string' ? JSON.parse(r.times) : (r.times as [number, number][] | null),
      default_on: r.default_on === true || String(r.default_on) === 'true',
    }))
  } catch { return [] }   // a pod from before the menu existed simply has no menu
}

export async function listSchedules(): Promise<Sched[]> {
  const res = await schedules().list({ limit: 200 })
  return res.items ?? []
}

/** The person's own clock. A schedule carries a `timezone`, so the cron stays in local
 *  time — "7:30 on weekdays" — and the platform does the conversion, including across
 *  midnight and daylight saving. */
export const myTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function localCron(times: [number, number][], days: string): string {
  const t = times.length ? times : [[9, 0]] as [number, number][]
  const mins = t[0][1]
  const hours = t.map(([h]) => h).join(',')
  if (days === '1st') return `${mins} ${hours} 1 * *`
  if (!days || days === '*') return `${mins} ${hours} * * *`
  return `${mins} ${hours} * * ${days}`
}

/** Local times → a UTC cron, for schedules made before timezones were stored. */
export function utcCron(times: [number, number][], days: string): string {
  const pts = (times.length ? times : [[9, 0]] as [number, number][]).map(([h, m]) => {
    const d = new Date(); d.setHours(h, m, 0, 0); return d
  })
  const mins = pts[0].getUTCMinutes()
  const hours = pts.map((d) => d.getUTCHours()).join(',')
  if (days === '1st') return `${mins} ${hours} 1 * *`
  if (!days || days === '*') return `${mins} ${hours} * * *`
  const shift = pts[0].getUTCDay() - pts[0].getDay()          // -1, 0 or +1
  const moved = days.replace(/\d/g, (x) => String((Number(x) + shift + 7) % 7))
  return `${mins} ${hours} * * ${moved}`
}

const tagOf = (id: string) => id.replace(/-/g, '').slice(0, 8)

/** My copy of a menu entry, if I have one. */
export const myCopy = (e: CatalogEntry, mine: Sched[]) =>
  mine.find((s) => s.workflow_name === e.workflow_name)

async function myConnectedAccount(installName: string, me: string): Promise<string | null> {
  const c = client as unknown as {
    podId?: string; config?: { podId?: string }
    pods: { get: (id: string) => Promise<{ organization_id?: string }> }
    connectors: {
      accounts: { list: (o: string) => Promise<{ items?: { id: string; auth_config_id: string; status: string; user_id?: string }[] }> }
      authConfigs: { list: (o: string, opts?: { limit: number }) => Promise<{ items?: { id: string; name: string }[] }> }
    }
  }
  const pod = c.podId || c.config?.podId
  if (!pod) return null
  const org = (await c.pods.get(pod)).organization_id
  if (!org) return null
  const [cfgs, accts] = await Promise.all([c.connectors.authConfigs.list(org, { limit: 100 }), c.connectors.accounts.list(org)])
  const cfg = (cfgs.items ?? []).find((x) => String(x.name).toLowerCase() === installName.toLowerCase())
  if (!cfg) return null
  const acct = (accts.items ?? []).find((a) => a.auth_config_id === cfg.id && a.status === 'CONNECTED' && (!a.user_id || a.user_id === me))
  return acct?.id ?? null
}

/** Create my own schedule for a menu entry, switched on. */
export async function createMine(e: CatalogEntry, me: string): Promise<Sched> {
  const name = `${e.workflow_name}__${tagOf(me)}`
  if (e.schedule_type === 'WEBHOOK') {
    const account = e.needs ? await myConnectedAccount(e.needs, me) : null
    if (!account) throw new Error(`connect ${e.needs === 'google_calendar' ? 'Google Calendar' : e.needs === 'gmail' ? 'Gmail' : e.needs} first`)
    return schedules().create({
      name, schedule_type: 'WEBHOOK', workflow_name: e.workflow_name,
      config: { source: e.trigger_source }, connector_trigger_id: e.connector_trigger_id, account_id: account,
    })
  }
  return schedules().create({
    name, schedule_type: 'TIME', workflow_name: e.workflow_name,
    config: { cron: localCron(e.times ?? [], e.days ?? '*'), timezone: myTimezone() },
  })
}

/** Switch one of my autopilots on or off — creating my copy the first time it goes on. */
export async function setMine(e: CatalogEntry | null, existing: Sched | undefined, on: boolean): Promise<void> {
  if (existing) { await schedules().update(existing.id, { is_active: on }); return }
  if (!on || !e) return
  await createMine(e, await myId())
}

/** Make sure I have my own copy of every menu entry that starts on. Never re-enables one
 *  I switched off (that copy exists, paused), and only sets up TIME entries — the
 *  watchers need an account and are always a choice. Safe to call often: it runs once
 *  per visit, and concurrent callers share the same pass. */
let pass: Promise<number> | null = null
export function ensureMyAutopilots(): Promise<number> {
  if (pass) return pass
  pass = (async () => {
    const me = await myId()
    const [menu, all] = await Promise.all([loadCatalog(), listSchedules()])
    const mine = all.filter((s) => s.user_id === me)
    let made = 0
    for (const e of menu) {
      if (!e.default_on || e.schedule_type !== 'TIME' || e.needs) continue
      if (myCopy(e, mine)) continue
      try { await createMine(e, me); made++ } catch { /* one refusal is not the whole set */ }
    }
    return made
  })()
  pass.catch(() => { pass = null })
  return pass
}

/* Lem's skills.

   Skills live under /skills, which is a read-only system folder as far as an import is
   concerned — a bundle that tries to write there fails outright. So the bundle ships
   copies at /setup/skills/<name>.md and the first person to open the app installs
   them as /skills/<name>/SKILL.md. Anything already installed is left alone, so a
   skill somebody has since edited is never overwritten. Nothing here is needed on a
   pod set up by setup.sh, which installs them itself; this is what makes the one-click
   import work on its own. */
const SKILL_SOURCE = '/setup/skills'

type Files = {
  list: (o?: { directoryPath?: string; limit?: number }) => Promise<{ items?: { name: string; path: string; kind?: string }[] }>
  get: (path: string) => Promise<unknown>
  download: (path: string) => Promise<Blob>
  upload: (file: Blob, o?: { name?: string; directoryPath?: string; searchEnabled?: boolean }) => Promise<unknown>
  folder: { create: (name: string, o?: { directoryPath?: string }) => Promise<unknown> }
}

let skillPass: Promise<number> | null = null
export function ensureSkills(): Promise<number> {
  if (skillPass) return skillPass
  skillPass = (async () => {
    const files = client.files as unknown as Files
    let shipped: { name: string; path: string; kind?: string }[] = []
    try { shipped = (await files.list({ directoryPath: SKILL_SOURCE, limit: 100 })).items ?? [] } catch { return 0 }
    let installed = 0
    for (const f of shipped) {
      if (!f.name.endsWith('.md') || (f.kind && f.kind !== 'FILE')) continue
      const name = f.name.replace(/\.md$/, '')
      try { await files.get(`/skills/${name}/SKILL.md`); continue } catch { /* not there yet */ }
      try {
        const body = await files.download(f.path || `${SKILL_SOURCE}/${f.name}`)
        try { await files.folder.create(name, { directoryPath: '/skills' }) } catch { /* may exist */ }
        await files.upload(new File([body], 'SKILL.md', { type: 'text/markdown' }), { directoryPath: `/skills/${name}` })
        installed++
      } catch { /* only an admin can write /skills; the next admin visit tries again */ }
    }
    return installed
  })()
  skillPass.catch(() => { skillPass = null })
  return skillPass
}
