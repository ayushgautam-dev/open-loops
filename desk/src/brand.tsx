/* Source marks for the connect screens.
   Gmail and Google Calendar are drawn to their real brand geometry and colours so
   they read instantly. Granola has no published SVG mark, so it gets an honest
   monogram tile in its own palette rather than a guessed-at imitation of a logo. */

export type SourceId = 'gmail' | 'google_calendar' | 'granola' | 'googlemeet' | 'slack'

function Gmail() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#fff" d="M6 12h36v26H6z" />
      <path fill="#4285F4" d="M6 38V16.5l6 4.5v17z" />
      <path fill="#34A853" d="M42 38V16.5L36 21v17z" />
      <path fill="#FBBC04" d="M36 38h4.5A1.5 1.5 0 0 0 42 36.5V16.5L36 21z" />
      <path fill="#C5221F" d="M12 38H7.5A1.5 1.5 0 0 1 6 36.5V16.5L12 21z" />
      <path fill="#EA4335" d="M6 16.5v-3A3.5 3.5 0 0 1 11.6 10.7L24 20l12.4-9.3A3.5 3.5 0 0 1 42 13.5v3L24 30z" />
    </svg>
  )
}

function GoogleCalendar() {
  /* The 2020-on Calendar mark: a white sheet with coloured edge accents and the
     date in blue. Drawn as thin edges rather than solid quarters — at 22px the
     solid version swamped the numeral and the whole thing read as a smudge. */
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <rect x="10" y="10" width="28" height="28" rx="3" fill="#fff" />
      <path fill="#4285F4" d="M10 13a3 3 0 0 1 3-3h4v6h-7z" />
      <path fill="#EA4335" d="M17 10h14v6H17z" />
      <path fill="#FBBC04" d="M31 10h4a3 3 0 0 1 3 3v3h-7z" />
      <path fill="#34A853" d="M10 32h7v6h-4a3 3 0 0 1-3-3z" />
      <path fill="#188038" d="M31 32h7v3a3 3 0 0 1-3 3h-4z" />
      <path fill="#1967D2" d="M17 32h14v6H17z" opacity=".0" />
      <text x="24" y="31" textAnchor="middle" fontFamily="Inter, Arial, sans-serif"
        fontSize="15" fontWeight="700" fill="#4285F4">31</text>
    </svg>
  )
}

function Granola() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <rect x="6" y="6" width="36" height="36" rx="9" fill="#1F1B16" />
      <path d="M17 19h14M17 25h14M17 31h9" stroke="#F0E5D2" strokeWidth="2.6"
        strokeLinecap="round" />
    </svg>
  )
}

function Meet() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#00832D" d="M10 16h18v16H10z" />
      <path fill="#0066DA" d="M6 20a4 4 0 0 1 4-4v16a4 4 0 0 1-4-4z" />
      <path fill="#E94235" d="M28 24l10-7v14z" />
      <path fill="#FFBA00" d="M28 16h6a4 4 0 0 1 4 4v-3z" />
    </svg>
  )
}

function SlackMark() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#E01E5A" d="M14 27a3 3 0 1 1-3-3h3zm1.5 0a3 3 0 0 1 6 0v7.5a3 3 0 0 1-6 0z" />
      <path fill="#36C5F0" d="M21 14a3 3 0 1 1 3-3v3zm0 1.5a3 3 0 0 1 0 6h-7.5a3 3 0 0 1 0-6z" />
      <path fill="#2EB67D" d="M34 21a3 3 0 1 1 3 3h-3zm-1.5 0a3 3 0 0 1-6 0v-7.5a3 3 0 0 1 6 0z" />
      <path fill="#ECB22E" d="M27 34a3 3 0 1 1-3 3v-3zm0-1.5a3 3 0 0 1 0-6h7.5a3 3 0 0 1 0 6z" />
    </svg>
  )
}

/* Simple, honest marks in each product's own colours — recognisable at 22px, not traced logos. */
function Docs() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#4285F4" d="M12 6h17l9 9v25a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path fill="#A1C2FA" d="M29 6l9 9h-7a2 2 0 0 1-2-2z" />
      <path d="M16 23h16M16 28h16M16 33h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function Drive() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#0F9D58" d="M17 8h14l12 21h-14z" />
      <path fill="#FBBC04" d="M17 8L5 29l7 12 12-21z" />
      <path fill="#4285F4" d="M12 41h24l7-12H19z" />
    </svg>
  )
}

function Zoom() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="11" fill="#2D8CFF" />
      <rect x="11" y="17" width="18" height="14" rx="3" fill="#fff" />
      <path fill="#fff" d="M31 22l6-4v12l-6-4z" />
    </svg>
  )
}

function Calendly() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="#006BFF" />
      <path d="M31 17.5a9.5 9.5 0 1 0 0 13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function Outlook() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <rect x="18" y="10" width="24" height="28" rx="3" fill="#28A8EA" />
      <path fill="#0364B8" d="M18 24h24v11a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" />
      <rect x="6" y="14" width="22" height="22" rx="3" fill="#0078D4" />
      <ellipse cx="17" cy="25" rx="5" ry="6" fill="none" stroke="#fff" strokeWidth="3" />
    </svg>
  )
}

const MARKS: Partial<Record<string, () => React.JSX.Element>> = {
  google_docs: Docs,
  google_drive: Drive,
  zoom: Zoom,
  calendly: Calendly,
  outlook: Outlook,
  gmail: Gmail,
  google_calendar: GoogleCalendar,
  granola: Granola,
  googlemeet: Meet,
  slack: SlackMark,
}

/** The icon tile used by both onboarding and the Powers-style rows. */
export function SourceMark({ app, label }: { app: string; label?: string }) {
  const Mark = MARKS[app]
  return (
    <span className="mark" aria-hidden={label ? undefined : 'true'}
      aria-label={label}>
      {Mark ? <Mark /> : <span className="mark-fallback">{(label || app).charAt(0).toUpperCase()}</span>}
    </span>
  )
}
