<p align="center">
  <a href="https://lemma.work/import/github/ayushgautam-dev/open-loops"><img alt="Install and Remix on Lemma" src="./docs/install-remix-on-lemma.svg" height="38"></a>
</p>

# Open Loops

A chief of staff that reads your mail, calendar and meeting notes, and keeps track of
what is still open — who is waiting on you, what you promised and by when, and what
other people owe you.

You open it in the morning and the reply you owe is already written, in your voice,
with real times from your calendar. You read it, change a word, press **Send**. That is
the whole product: **Lem prepares, you approve.** Nothing ever leaves without your Send.

---

## How it works

```
  Gmail · Google Calendar · Granola notes
            │
            │  every message lands as a row in `interactions`, as you
            ▼
   ┌───────────────────────┐   reads each new row (as its owner), keeps only what
   │  Loose Ends           │   is genuinely unfinished — a promise, a question
   │  (the one shared      │   asked of you, something you are waiting on — and
   │   trigger)            │   records who, since when, and the conversation it
   └──────────┬────────────┘   came from. Cold pitches and automated mail are dropped.
              ▼
   ┌───────────────────────┐   groups what is open into topics, writes the two lines
   │  your autopilots      │   that say where each stands, drafts the replies,
   │  (each person's own)  │   tidies what you already handled, briefs you at 7:30
   └──────────┬────────────┘
              ▼
   ┌───────────────────────┐
   │  you                  │   Send · Done · Snooze · Dismiss · "not right?"
   └───────────────────────┘
```

**Lem is one assistant** — the pod's own, which every Lemma pod already has. It runs
with *your* permissions, so it can only ever see your own rows. Its judgement lives in
[`files/memory/AGENTS.md`](files/memory/AGENTS.md) and five skills under
[`files/setup/skills/`](files/setup/skills/); the rules that matter most
(an invitation is not an offer, silence is not a rejection, never close something on a
guess) are enforced in code, in the functions, not left to a prompt.

**Corrections are the settings page.** Every line Lem writes has a quiet *not right?*.
Say what is wrong in your own words; Lem reads corrections before it writes anything
again.

### Private per person, shared by a team

One person installs it; everybody else in the organization can be added to the same pod.

- **Every table is row-level secured.** Each person sees only their own mail,
  commitments, people and drafts. The one exception is `autopilot_catalog` — the menu
  of autopilots — which holds no personal data.
- **Everyone gets their own autopilots.** A schedule runs as whoever created it: their
  mail, their inbox for the brief, their timezone. The first time each person opens
  the app it sets up their own copy of every autopilot that starts on. Switching one
  off pauses only theirs.

| On from the start | A switch away |
|---|---|
| Keep the Feed readable · Prepared replies · Morning Brief · Raise next time · Tidy Up · Nightly catch-up · Suggestions · Learn your voice | Cold Pitch Sweep · Check Slack · Watch mail (instant) · Watch calendar (instant) |

Anything you ask Lem to set up for you on top of these — "every Monday, tell me which
invoices are still unpaid" — is yours alone.

**What ships switched off, and why:** nothing on by default reaches another person.
The brief goes to your own inbox; drafts wait for your Send. The instant watchers are
off only because they bind to your own Gmail and Calendar accounts, which have to be
connected first.

## Install and remix on Lemma

<p>
  <a href="https://lemma.work/import/github/ayushgautam-dev/open-loops"><img alt="Install and Remix on Lemma" src="./docs/install-remix-on-lemma.svg" height="38"></a>
</p>

The button opens Lemma's import for this repository. When it finishes, open the app:
its first run connects Gmail (Calendar and Granola are optional), installs Lem's
skills, reads your last three weeks, and sets up your autopilots. There is no sample
data — what you see is your own mail from the first screen.

To have an agent set it up instead, paste [SETUP-PROMPT.md](SETUP-PROMPT.md) into a
fresh pod's chat. From a terminal:

```bash
git clone --depth 1 https://github.com/ayushgautam-dev/open-loops && cd open-loops
LEMMA_POD_ID=<pod> ./setup.sh
```

[`setup.sh`](setup.sh) imports everything with its files and the autopilot menu, names
the pod, checks every function kept its permissions, installs the skills, and ends with
a note telling whoever ran it what to say next. About three minutes.

**Adding your team:** add them to the pod. They open the same app and get their own
first run — their own accounts, their own rows, their own autopilots.

## What is in here

| Kind | What |
|---|---|
| tables | `interactions` (every message, the ledger everything reads from) · `loops` (commitments) · `situations` (topics) · `people` · `companies` · `drafts` · `deliverables` (documents Lem wrote) · `timeline_events` · `work_projects` (workstreams) · `tracks` / `stages` / `board_cards` (pipelines) · `corrections` · `suggestions` · `tasks` · `settings` · `autopilot_catalog` (the shared menu) and the rest |
| functions | Deterministic writers: `record_interaction`, `ingest_open_loops`, `autoresolve_loops`, `tidy_up`. Connectors: `sync_gmail`, `sync_calendar`, `sync_granola`, `get_email_thread`, `send_draft`, `send_invite`, `find_free_slots`. `connect_source` installs and connects a source from inside the app — nobody visits an admin console. `backfill_guard` keeps one person's first import from flooding the shared trigger. |
| workflows | One per autopilot. Most are a single step that wakes Lem with a precise instruction. |
| schedules | Only `autopilot_loose_ends` — the one trigger shared by the pod. Everyone's other autopilots are created per person, from the menu. |
| files | `/memory/AGENTS.md` (Lem) and `/setup/skills/*.md` (the skills, installed on first run) |
| apps | `open-loops-desk` and `open-loops` — two layouts over the same pod. Shipped **built**; the projects are in `desk/` and `app/`. |

## Changing it

The apps ship as built output so an import needs no build and nothing configured.
To change one, edit its project and rebuild:

```bash
cd desk && npm install && npm run dev     # signed in as whoever the Lemma CLI is
./desk/build.sh                           # rewrites apps/open-loops-desk/source/
```

`build.sh` unsets every `VITE_LEMMA_*` variable and moves any `.env` file aside first —
Vite would otherwise bake your pod's id into a public repository — and refuses to write
output that contains one. [AGENTS.md](AGENTS.md) has the rest: what each part is for,
and what has broken before.

**Remix it:** [fork the repository](https://github.com/ayushgautam-dev/open-loops/fork),
change what you like, and import your fork with
`https://lemma.work/import/github/<you>/<your-repo>`.

## Known limits

- **Gmail is the source that matters.** Without it there is very little to read.
- **Slack reads only channels the app was invited to.** Direct messages need a
  per-person Slack account, which is not wired yet.
- **Instant mail needs the watcher switched on.** Until then new mail is picked up by
  the nightly catch-up.
- **Research on new people needs a key.** Without one, Lem falls back to web search.

## Layout

```
README.md  AGENTS.md  SETUP-PROMPT.md  setup.sh  LICENSE
pod.json                     metadata + the two app-slug variables
tables/  functions/  workflows/  schedules/
files/memory/AGENTS.md       Lem
files/setup/skills/          the five skills, installed on first run
apps/*/source/               BUILT apps, uploaded as-is
app/  desk/                  the React + Vite projects they are built from (+ build.sh)
docs/                        the install button
```

Built with [Lemma](https://lemma.work). MIT licensed.
