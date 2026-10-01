import { useCallback, useEffect, useState } from 'react'
import { X, Check, RefreshCw, Moon, SunMedium } from 'lucide-react'
import { client, runFn } from './lib'
import { Avatar, useToast } from './ui'
import { SourceMark } from './brand'
import { tm } from './teammate'

/* You: who is signed in, and every app Lem works with — what's connected, what isn't,
   and a few worth adding.

   Status is read straight from the organisation's connected accounts, matched on the
   install's name (Granola is an install called "granola" on the shared "mcp" connector,
   so the connector id alone can't tell it apart).

   Connecting goes two ways:
   - The sources the pod already reads go through `connect_source`, exactly as first run
     does — it installs what's missing and hands back the provider's sign-in page.
   - The suggestions go straight to the platform (enable the app, open a connect request).
     Nothing reads them automatically yet; Lem can use them when asked. */

interface App { id: string; label: string; why: string; via: 'pod' | 'native'; connector?: string }

// what Lem reads to find what's unfinished
const SOURCES: App[] = [
  { id: 'gmail', label: 'Gmail', why: 'Threads, who spoke last, and what was asked of you.', via: 'pod' },
  { id: 'google_calendar', label: 'Google Calendar', why: 'Who you’re meeting, and what was agreed but never booked.', via: 'pod' },
  { id: 'granola', label: 'Granola', why: 'Meeting notes and action items — where a promise made out loud gets written down.', via: 'pod' },
  { id: 'googlemeet', label: 'Google Meet', why: 'Call transcripts, where Meet recorded one.', via: 'pod' },
  { id: 'slack', label: 'Slack', why: 'The channels you invited the app to, where the day’s asks land.', via: 'native', connector: 'slack' },
]
// where Lem puts finished work
const OUTPUTS: App[] = [
  { id: 'google_docs', label: 'Google Docs', why: 'Documents open as real Google Docs.', via: 'pod' },
  { id: 'google_drive', label: 'Google Drive', why: 'Share a document with just the people it’s for.', via: 'pod' },
]
// worth adding for this kind of work
const SUGGESTED: App[] = [
  { id: 'zoom', label: 'Zoom', why: 'Calls outside Google Meet — where half the promises are made out loud.', via: 'native', connector: 'zoom' },
  { id: 'calendly', label: 'Calendly', why: 'Offer your booking link instead of trading times by email.', via: 'native', connector: 'calendly' },
  { id: 'outlook', label: 'Outlook', why: 'Mail and calendar for anyone on Microsoft 365 instead of Google.', via: 'native', connector: 'outlook' },
]

type Status = 'connected' | 'reauth' | 'off'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function orgId(): Promise<string | null> {
  const c = client as unknown as { podId?: string; config?: { podId?: string }; pods: { get: (id: string) => Promise<{ organization_id?: string }> } }
  const pod = c.podId || c.config?.podId
  if (!pod) return null
  try { return (await c.pods.get(pod)).organization_id ?? null } catch { return null }
}

/** install name → how its account stands */
async function readStatus(org: string): Promise<Record<string, Status>> {
  const conn = client.connectors as unknown as {
    accounts: { list: (o: string) => Promise<{ items?: { auth_config_id: string; status: string }[] }> }
    authConfigs: { list: (o: string, opts?: { limit: number }) => Promise<{ items?: { id: string; name: string }[] }> }
  }
  const [cfgs, accts] = await Promise.all([conn.authConfigs.list(org, { limit: 100 }), conn.accounts.list(org)])
  const nameOf = new Map((cfgs.items ?? []).map((c) => [String(c.id), String(c.name).toLowerCase()]))
  const out: Record<string, Status> = {}
  for (const a of accts.items ?? []) {
    const n = nameOf.get(String(a.auth_config_id))
    if (!n) continue
    const s: Status = a.status === 'CONNECTED' ? 'connected' : a.status === 'REAUTH_REQUIRED' || a.status === 'EXPIRED' ? 'reauth' : 'off'
    if (out[n] !== 'connected') out[n] = s
  }
  return out
}

function Row({ app, status, busy, onConnect }: { app: App; status: Status | undefined; busy: string | null; onConnect: (a: App) => void }) {
  const waiting = busy === app.id
  return (
    <div className={`app-row${status === 'connected' ? ' on' : ''}`}>
      <SourceMark app={app.id} label={app.label} />
      <div className="app-t">
        <b>{app.label}</b>
        <small>{app.why}</small>
      </div>
      {status === 'connected'
        ? <span className="app-on"><Check size={13} strokeWidth={2.6} /> Connected</span>
        : (
          <button className={`btn sm ${status === 'reauth' ? 'ink' : 'line'}`} disabled={!!busy} onClick={() => onConnect(app)}>
            {waiting ? 'Waiting for sign-in…' : status === 'reauth' ? 'Sign in again' : 'Connect'}
          </button>
        )}
    </div>
  )
}

export function Profile({ name, email, onClose }: { name: string; email: string; onClose: () => void }) {
  const toast = useToast()
  const [org, setOrg] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, Status> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')

  const load = useCallback(async (o = org) => {
    if (!o) return
    try { setStatus(await readStatus(o)) } catch { setStatus({}) }
  }, [org])

  useEffect(() => { void orgId().then((o) => { setOrg(o); if (o) void load(o); else setStatus({}) }) }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  /** Open the provider's own sign-in, then watch for the account to appear. The window
   *  is opened on the click itself — one opened after an await gets blocked. */
  async function connect(app: App) {
    if (!org) return
    setBusy(app.id)
    const win = window.open('', '_blank', 'width=520,height=680')
    try {
      let url: string | null | undefined
      if (app.via === 'pod') {
        const out = await runFn<{ auth_url?: string; authorization_url?: string; already_connected?: boolean; explanation?: string }>('connect_source', { app: app.id })
        if (out.already_connected) { win?.close(); await load(); return }
        url = out.auth_url || out.authorization_url
        if (!url) { win?.close(); toast(out.explanation || `${app.label} can’t be connected from here yet`); return }
      } else {
        const conn = client.connectors as unknown as {
          enableApp: (o: string, id: string, opts?: { name?: string }) => Promise<{ id: string }>
          createConnectRequest: (o: string, i: { connector_id: string; auth_config_id?: string }) => Promise<{ authorization_url?: string | null }>
        }
        const cfg = await conn.enableApp(org, app.connector!, { name: app.id })
        url = (await conn.createConnectRequest(org, { connector_id: app.connector!, auth_config_id: cfg.id })).authorization_url
        if (!url) { win?.close(); toast(`${app.label} didn’t offer a sign-in page`); return }
      }
      if (win) win.location.href = url
      else { toast('Your browser blocked the sign-in window — allow pop-ups and try again'); return }
      // up to three minutes of consent, checked every couple of seconds
      for (let i = 0; i < 90; i++) {
        await sleep(2000)
        try {
          const s = await readStatus(org)
          setStatus(s)
          if (s[app.id] === 'connected') { toast(`${app.label} connected`); return }
        } catch { /* keep waiting */ }
      }
      toast('Still waiting on that one — press refresh once you’ve signed in')
    } catch (e) {
      win?.close()
      toast(`Couldn’t start that — ${(e as Error)?.message ?? 'try again'}`)
    } finally {
      setBusy(null)
    }
  }

  const toggleTheme = () => {
    const n = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', n)
    try { localStorage.setItem('desk-theme', n) } catch { /* fine */ }
    setDark(!dark)
  }

  const on = (a: App) => status?.[a.id] === 'connected'
  const reading = SOURCES.filter(on).length
  const sections: { title: string; apps: App[] }[] = [
    { title: `${tm()} reads from`, apps: SOURCES },
    { title: `${tm()} writes into`, apps: OUTPUTS },
    { title: 'Worth adding', apps: SUGGESTED },
  ]

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="profile" role="dialog" aria-label="You">
        <div className="profile-h">
          <Avatar name={name} size="lg" />
          <div className="hero-t">
            <h2>{name}</h2>
            <div className="hero-s">{email}</div>
          </div>
          <button className="icon-btn" title={dark ? 'Light' : 'Dark'} onClick={toggleTheme}>{dark ? <SunMedium size={16} /> : <Moon size={16} />}</button>
          <button className="icon-btn" title="Refresh" onClick={() => void load()}><RefreshCw size={15} /></button>
          <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="profile-b">
          {status === null ? <div className="skel"><div className="skel-row" /><div className="skel-row" style={{ width: '70%' }} /></div> : (
            <>
              <p className="profile-sum">
                {tm()} is reading <b>{reading}</b> of {SOURCES.length} sources
                {SOURCES.some((a) => status[a.id] === 'reauth') && <> · <span className="warn">one needs you to sign in again</span></>}
              </p>
              {sections.map((sec) => {
                // connected first, then what still needs doing
                const apps = [...sec.apps].sort((a, b) => Number(on(b)) - Number(on(a)))
                return (
                  <section key={sec.title} className="profile-sec">
                    <div className="sec-h">{sec.title}</div>
                    <div className="app-list">
                      {apps.map((a) => <Row key={a.id} app={a} status={status[a.id]} busy={busy} onConnect={(x) => void connect(x)} />)}
                    </div>
                  </section>
                )
              })}
            </>
          )}
        </div>
      </div>
    </>
  )
}
