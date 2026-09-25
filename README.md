<h1 align="center">Open Loops</h1>

<p align="center"><b>A chief of staff for your inbox.</b><br>
It reads your mail, calendar and meeting notes, keeps track of what you owe people and
what they owe you — and has the reply written before you ask.</p>

<p align="center">
  <a href="https://lemma.work/import/github/ayushgautam-dev/open-loops"><img alt="Install and Remix on Lemma" src="./docs/install-remix-on-lemma.svg" height="38"></a>
</p>

<p align="center">
  <img src="./docs/today.svg" alt="The Today page: a morning greeting, what is on you, two replies Lem has already written, and one topic with its open items. All names are invented." width="100%">
</p>

---

## Why it exists

Most of what slips is not hard work. It is the reply you meant to send after the call,
the deck you said you would share on Friday, the person who is still waiting to hear
back from you — spread across a hundred threads, and remembered only when someone
chases.

Open Loops reads where those promises are actually made — your mail, your calendar,
your meeting notes — and keeps one list of everything still open, in plain sentences:

> **Send Sam the pilot terms** — *you, 2 days*<br>
> **Waiting on Maya for the signed agreement** — *Maya, 1 week*

And it does not stop at the list. For the replies you owe, **Lem** — the assistant
inside it — has already written the email, in your voice, with real free times from your
calendar. You read it, change a word, press **Send**.

**Lem prepares, you approve.** Nothing ever leaves without your Send.

## What a morning looks like

- **Today** — the day's meetings as a ribbon, one line of counts (*4 on you · 3 waiting
  on others*), and the replies Lem already wrote, as letters waiting for a yes.
- **Topics** — everything open, grouped the way you think about it: a customer, a hiring
  round, a project. Two lines on where each stands. Switch to *by person* or *by
  company* in one click; open any of them as a tab.
- **The item** — why it is open, quoted from the conversation it came from, the whole
  email thread, and the draft underneath. **Send**, or **Done · Snooze · Dismiss**.
- **Morning brief** — one email at 7:30 with the day's meetings and what you owe
  each person. Nothing else interrupts you.
- **Pipelines** — hiring and sales as boards, with how long each card has sat in its
  stage. Stages come from what actually happened in your mail, not a template.
- **Ask Lem** — "what did I promise on my last call?", "draft a reply to Maya that
  pushes to Thursday". It works with your permissions only.

## How it works

```
  Gmail · Google Calendar · Granola notes
            │
            │  every message lands as a row in `interactions`, as you
            ▼
   ┌───────────────────────┐   reads each new row as its owner and keeps only what
   │  Loose Ends           │   is genuinely unfinished — a promise, a question asked
   │  (one shared trigger) │   of you, something you are waiting on — with who, since
   └──────────┬────────────┘   when, and the conversation it came from
              ▼
   ┌───────────────────────┐   group what is open into topics, write where each
   │  your autopilots      │   stands, draft the replies, tidy what you already
   │  (each person's own)  │   handled, brief you each morning
   └──────────┬────────────┘
              ▼
   ┌───────────────────────┐
   │  you                  │   Send · Done · Snooze · Dismiss · "not right?"
   └───────────────────────┘
```

**Careful by construction.** The mistakes that cost trust are handled in code, not left
to a prompt: an invitation is not an offer, silence is not a rejection, nothing is closed
on a guess, and nothing is saved without the conversation it came from — so it can
close itself when you reply. Cold pitches and automated mail never become commitments.

**Corrections are the settings page.** Every line Lem writes has a quiet *not right?*.
Say what is wrong in your own words, and Lem reads it before it writes anything again.

## Private per person, ready for a team

One person installs it; anyone else in the organization can be added to the same pod.

- **Every table is row-level secured.** Each person sees only their own mail,
  commitments, people and drafts — nobody else's, including the person who installed it.
- **Everyone gets their own autopilots.** The first time each person opens the app, it
  sets up their own copy of every autopilot below, in their own timezone, running as
  them. Switching one off pauses only theirs.

| On from the start | A switch away |
|---|---|
| Keep topics readable · Prepared replies · Morning brief · Raise next time · Tidy up · Nightly catch-up · Suggestions · Learn your voice | Cold-pitch sweep · Check Slack · Watch mail instantly · Watch calendar instantly |

Nothing that is on by default reaches another person: the brief goes to your own inbox,
and drafts wait for your Send. Anything you ask Lem to set up on top — *"every Monday,
tell me which invoices are still unpaid"* — is yours alone.

## Install and remix on Lemma

<p>
  <a href="https://lemma.work/import/github/ayushgautam-dev/open-loops"><img alt="Install and Remix on Lemma" src="./docs/install-remix-on-lemma.svg" height="38"></a>
</p>

Press the button, then open the app. Its first run:

1. connects **Gmail** — Google Calendar and Granola are optional, and each is one sign-in;
2. asks one question: *what do you spend your time on?*;
3. reads your last three weeks and shows you what is still open.

There is no sample data. The first screen you see is your own.

**To add your team**, add them to the pod. They open the same app and get their own
first run — their own accounts, their own rows, their own autopilots.

<details>
<summary>Set it up with an agent, or from a terminal</summary>

Paste [SETUP-PROMPT.md](SETUP-PROMPT.md) into a fresh pod's chat and the pod's own
assistant does the rest. Or:

```bash
git clone --depth 1 https://github.com/ayushgautam-dev/open-loops && cd open-loops
LEMMA_POD_ID=<pod> ./setup.sh
```

[`setup.sh`](setup.sh) imports everything with its files and the autopilot menu, names
the pod, checks every function kept its permissions, installs Lem's skills, and ends
with a note telling whoever ran it what to say next. About three minutes.

</details>

## Make it yours

1. [Fork the repository](https://github.com/ayushgautam-dev/open-loops/fork).
2. Change what Lem is told ([`files/memory/AGENTS.md`](files/memory/AGENTS.md) and the
   skills beside it), the autopilots, the tables or the app.
3. Import your fork with `https://lemma.work/import/github/<you>/<your-repo>`.
4. When it is useful, [show your version here](https://github.com/ayushgautam-dev/open-loops/issues/new?template=show-your-version.yml&title=%5BRemix%5D+).

The apps ship built so an import needs no build and nothing configured. To change one,
edit its project and rebuild:

```bash
cd desk && npm install && npm run dev     # signed in as whoever the Lemma CLI is
./desk/build.sh                           # rewrites apps/open-loops-desk/source/
```

`build.sh` clears every `VITE_LEMMA_*` setting and moves `.env` files aside first — Vite
would otherwise bake your pod's id into the build — and refuses to write output that
contains one. [AGENTS.md](AGENTS.md) covers what each part is for and what has broken
before.

## What is in here

| | |
|---|---|
| **tables** | `interactions` (every message — the ledger everything reads) · `loops` (commitments) · `situations` (topics) · `people` · `companies` · `drafts` · `deliverables` (documents Lem wrote) · `timeline_events` · `work_projects` · `tracks`, `stages`, `board_cards` (pipelines) · `corrections` · `autopilot_catalog` (the shared menu) · … |
| **functions** | Deterministic writers — `record_interaction`, `ingest_open_loops`, `autoresolve_loops`, `tidy_up`. Connectors — `sync_gmail`, `sync_calendar`, `sync_granola`, `get_email_thread`, `send_draft`, `send_invite`, `find_free_slots`. `connect_source` installs and connects a source from inside the app, so nobody visits an admin console. |
| **workflows** | One per autopilot; most wake Lem with one precise instruction. |
| **schedules** | Only `autopilot_loose_ends`, the trigger the pod shares. Everyone's autopilots are created per person, from the menu. |
| **files** | `/memory/AGENTS.md` — Lem — and `/setup/skills/`, the five skills, installed on first run. |
| **apps** | `open-loops-desk` and `open-loops` — two layouts over the same pod, shipped built. Their projects are `desk/` and `app/`. |

## Known limits

- **Gmail is the source that matters.** Without it there is very little to read.
- **Instant mail is a switch.** Until you turn *Watch mail* on, new mail is picked up by
  the nightly catch-up.
- **Slack reads only channels the app was invited to**; direct messages are not wired yet.
- **Research on new people needs a key.** Without one, Lem falls back to web search.

## Share

<p>
  <a href="https://twitter.com/intent/tweet?text=Open%20Loops%3A%20a%20chief%20of%20staff%20that%20reads%20your%20mail%2C%20tracks%20what%20you%20owe%20people%2C%20and%20writes%20the%20reply%20before%20you%20ask.&amp;url=https%3A%2F%2Fgithub.com%2Fayushgautam-dev%2Fopen-loops"><img alt="Share on X" src="https://img.shields.io/badge/Share_on_X-111111?style=for-the-badge&amp;logo=x"></a>
  <a href="https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fgithub.com%2Fayushgautam-dev%2Fopen-loops"><img alt="Share on LinkedIn" src="https://img.shields.io/badge/Share_on_LinkedIn-0A66C2?style=for-the-badge&amp;logo=linkedin"></a>
</p>

Built with [Lemma](https://lemma.work) · [MIT licensed](LICENSE)
