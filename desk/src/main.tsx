import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard, useCurrentUser } from 'lemma-sdk/react'
import { Sun, Users, Layers, FileText, Zap, Moon, SunMedium, Search } from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { useSql, rev, firstName } from './lib'
import { ToastProvider, Avatar } from './ui'
import { NavProvider, useNav } from './nav'
import { FocusPanel } from './focus'
import { LemProvider, LemDock, useLem } from './lem'
import { CommandPalette } from './cmdk'
import { useRowKeys } from './items'
import { Today } from './screens/today'
import { Workstreams } from './screens/workstreams'
import { People } from './screens/people'
import { Docs } from './screens/docs'
import { Autopilots } from './screens/autopilots'
import { FirstRun, needsFirstRun } from './screens/firstrun'
import { CloneGate } from './gate'
import { Profile } from './profile'
import { ensureMyAutopilots, ensureSkills } from './autopilot-sync'
import './styles.css'

const queryClient = new QueryClient()

/** The loop mark: an almost-closed ring — the thing this product exists to close. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" strokeWidth="3.2"
        strokeLinecap="round" strokeDasharray="56 66" transform="rotate(-50 16 16)" />
      <circle cx="24.6" cy="9.6" r="2.6" fill="var(--ember)" />
    </svg>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && window.matchMedia?.('(prefers-color-scheme: dark)').matches))
  return (
    <button className="rail-btn" title={dark ? 'Light' : 'Dark'} onClick={() => {
      const n = dark ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', n)
      try { localStorage.setItem('desk-theme', n) } catch { /* fine */ }
      setDark(!dark)
    }}>
      {dark ? <SunMedium size={17} /> : <Moon size={17} />}
    </button>
  )
}

function Rail({ email, name }: { email: string; name: string }) {
  const { route, navigate, version } = useNav()
  const [me, setMe] = useState(false)
  const counts = useSql<{ mine: number; ready: number }>(rev(
    `select (select count(*) from loops where side='you' and status='open') as mine,
            (select count(*) from drafts where status='pending') as ready`,
    version))
  const c = counts.items[0]
  const is = (r: string) => (r === '/' ? route === '/' : route.startsWith(r))
  const Item = ({ to, label, icon: Icon, n }: { to: string; label: string; icon: typeof Sun; n?: number | null }) => (
    <button className={`rail-i${is(to) ? ' on' : ''}`} onClick={() => navigate(to)} aria-current={is(to) ? 'page' : undefined}>
      <span className="rail-ic"><Icon size={19} strokeWidth={1.8} />{n ? <span className="rail-n">{n}</span> : null}</span>
      <span className="rail-l">{label}</span>
    </button>
  )
  return (
    <nav className="rail" aria-label="Main">
      <button className="rail-mark" onClick={() => navigate('/')} title="Open Loops"><Mark /></button>
      <div className="rail-nav">
        <Item to="/" label="Today" icon={Sun} n={c ? Number(c.mine) || null : null} />
        <Item to="/workstreams" label="Work" icon={Layers} />
        <Item to="/people" label="People" icon={Users} />
        <Item to="/docs" label="Docs" icon={FileText} />
        <Item to="/autopilots" label="Auto" icon={Zap} />
      </div>
      <div className="rail-foot">
        <button className="rail-btn" title="Jump to (⌘K)"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>
          <Search size={17} />
        </button>
        <ThemeToggle />
        <button className="rail-me" title={`${email} — connected apps`} onClick={() => setMe(true)}><Avatar name={name} size="sm" /></button>
      </div>
      {me && <Profile name={name} email={email} onClose={() => setMe(false)} />}
    </nav>
  )
}

function Shell({ name, email }: { name: string; email: string }) {
  const { route } = useNav()
  const lem = useLem()
  useRowKeys()
  let screen: React.ReactNode
  if (route.startsWith('/workstreams')) screen = <Workstreams />
  else if (route.startsWith('/people')) screen = <People />
  else if (route.startsWith('/docs')) screen = <Docs />
  else if (route.startsWith('/autopilots')) screen = <Autopilots />
  else screen = <Today userName={name} />

  // back to the top when changing page
  useEffect(() => { document.querySelector('.main-scroll')?.scrollTo({ top: 0 }) }, [route])
  // anyone missing their own copy of a default autopilot (a teammate who joined before the
  // menu existed, say) gets it quietly; anything they switched off stays off
  useEffect(() => { void ensureSkills().catch(() => 0); void ensureMyAutopilots().catch(() => 0) }, [])

  return (
    <div className="shell">
      <Rail email={email} name={name} />
      <main className="main">
        <div className="main-scroll">{screen}</div>
        <LemDock />
      </main>
      <FocusPanel />
      <CommandPalette onAsk={(t) => lem.ask(t)} />
    </div>
  )
}

function App() {
  const { user } = useCurrentUser({ client: lemmaClient })
  const [fresh, setFresh] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    // `?onboarding=1` replays first run on a pod that already has data.
    if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
      setFresh(true)
      return () => { live = false }
    }
    needsFirstRun().then((v) => { if (live) setFresh(v) }).catch(() => { if (live) setFresh(false) })
    return () => { live = false }
  }, [])
  const u = user as { email?: string; name?: string } | undefined
  const email = u?.email ?? ''
  const name = firstName(u?.name || u?.email?.split('@')[0] || 'there').replace(/^\w/, (m) => m.toUpperCase())
  return (
    <NavProvider>
      <ToastProvider>
        <LemProvider>
          {fresh
            ? <FirstRun name={name} onDone={() => setFresh(false)} />
            : <Shell name={name} email={email} />}
        </LemProvider>
      </ToastProvider>
    </NavProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGuard
        client={lemmaClient}
        appName="Open Loops"
        loadingFallback={<div className="boot"><span className="orb live" style={{ width: 28, height: 28 }}><i /></span></div>}
        /* A visitor will never be let into somebody else's mail — offer their own copy instead. */
        accessRequestFallback={({ user }) => <CloneGate name={user?.name || user?.email || undefined} />}
      >
        <App />
      </AuthGuard>
    </QueryClientProvider>
  </React.StrictMode>,
)
