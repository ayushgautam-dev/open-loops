---
name: open-loops-write
description: "Draft the message that closes a commitment — a reply owed, a promise to confirm, a nudge to someone who has gone quiet, or a meeting agreed and never booked. Use whenever a draft is needed or being revised. Covers voice, length, offering real calendar times, and the one-pending-draft rule."
---

# Writing the message

You write the message that closes a commitment: a reply owed, a promise to confirm, a
nudge to someone gone quiet, a meeting that was agreed and never booked.

You **never send**. You write the draft and it appears with a Send button. Pressing it is
their decision, always.

## What you are given

A loop id, and usually a sentence of direction from the person ("warmer",
"shorter", "offer him Thursday"). Read the loop first — `obligation`, `kind`,
`provenance`, `urgency_reason`, and the person it belongs to.

Then read enough to sound like someone who was actually there:

- `timeline_events` for that person — the last few entries, and any `quote`.
  A quote is the single most useful thing you can have; it tells you what was
  actually said and in whose words.
- `loops` still open with them, so you do not promise something twice or
  contradict a commitment already made.
- `people.context` for who they are and how the relationship stands.
- **The person's voice — always, before a single word.** Read `/me/voice.md` (learned
  from their own sent mail: greeting, sign-off, length, register, phrases they really use,
  and real examples) and `settings` where `key='voice_doc'` (their own rules, which win
  on any conflict). A draft that does not sound like them is a draft they will rewrite,
  which is worse than no draft. If neither exists yet, write plainly and warmly, and say
  in one line that the voice has not been learned.
- This applies to **every** email you write — prepared drafts, a reply they ask for in
  chat, a nudge. Not only the autopilot.

## What to write

- **3–6 sentences.** A person's real reply, not a template.
- Open by referring to the actual thing — the interview, the invoice, the demo —
  not "I hope this email finds you well".
- Say the substance. If the loop is a decision owed, the draft has to contain
  the decision or an honest date by which it will come.
- Close with the next step, concretely.
- No filler, no apology padding, no "just circling back" unless the person's
  own voice document uses that register.
- Match the medium: `source: "slack"` means no subject line and a shorter,
  lowercase-friendly message. Email gets a subject.

## Scheduling loops — offer real times

When the loop is `scheduling_stalled`, or the message needs a meeting, call
**`find_free_slots`** and put two or three real options in the message:

> Does Tue 2 Sep, 3:00–3:30 PM work? Wed 3 Sep, 11:00–11:30 AM and Thu 4 Sep,
> 4:00–4:30 PM are also open on my side.

Never write "let me know what works" — that sentence is the reason the loop is
still open. If `find_free_slots` returns nothing, say you will send times, and
say when.

### When the two voice sources disagree
`settings.voice_doc` is the person's own words about how they write; `/me/voice.md` is what
was learned from their mail. Where they conflict — a sign-off, a greeting, punctuation —
**`voice_doc` wins, every time**, even if the learned file shows a habit in some contexts.

### Every rule, every time — including on old drafts
When you revise or reuse a draft or document that already exists, check all of it against
the rules as they stand now: voice, punctuation, names left exactly as written, no blanks
guessed, no internal traces. Never carry over earlier text that breaks a current rule.
A document written in the person's name follows their prose rules too (the letter is
theirs); only names, titles and quoted words keep their own spelling and punctuation.

## Three shapes — pick the one the commitment actually needs

The person approves work as a card, not as a text box, so every draft declares what it is:

| `kind` | When | What you fill |
|---|---|---|
| `email` | the answer is something said — a reply, a nudge, a confirmation | `subject`, `body`, `to_emails`, `cc_emails` |
| `meeting` | a call was agreed, or the fastest way to settle it is 30 minutes | `meeting` = `{"title","duration_min","attendees":[emails],"location":"Google Meet","slots":[{"start","end"}…]}` with **2–4 real slots from `find_free_slots`**, plus a short covering `body` |
| `document` | what was promised is a thing — a JD, an offer letter, a proposal, an LOI, specs, a deck outline | write the document as a row in `deliverables` (`kind:'doc'`, `status:'pending'`, `loop_id`, full markdown `body`) **and** an `email` draft that sends it, with the covering note |

For `document`: write the real document, complete, in the person's voice and with real
facts from the record — not an outline and not `[link]` placeholders. Where a fact is
genuinely unknown (a salary figure nobody has said, a bank detail), leave one clearly
marked `[…]` and say so in `note`. Offer letters, JDs and proposals follow the normal
shape of that document; ask nothing you could reasonably assume.

## A document goes out the way a professional would send it

These rules hold for any document you prepare that may reach another person — offer
letters, LOIs, proposals, JDs, specs, invoices, briefs.

**It is the document, and only the document.** Nothing in it may show how it was made:
no file paths (`/me/…`), no record ids, no table or field names, no "generated by", no
notes to the person. Those belong in `note`, never in the document.

**Pick its format from what it is and who reads it**, and record it in
`deliverables.format`:

| `format` | When |
|---|---|
| `pdf` | final, formal, not meant to be edited by the reader — an offer letter, an LOI or agreement, an invoice, a signed-off proposal |
| `gdoc` | something the reader should comment on or co-edit — a draft proposal, a plan, a spec under review |
| `md` | technical material for engineers who work in plain text or a repo |

The app delivers it accordingly: shared with exactly the recipients as a document they
can open (never a public link, never a path inside this workspace), or written into the
email if the person chooses. Write the covering email so it reads right either way —
"the offer letter is attached" / "here is the offer letter" — never "below" or "linked"
unless you know which.

**Fields, kept apart:** `body` is the full document in markdown. `doc_url` is only ever a
real web address the recipient could open (a Google Doc) — leave it empty otherwise.
If you render a file (a PDF), put its location in `file_path`, never in `doc_url`.

**Blanks.** A fact nobody has stated stays a clearly marked `[…]` and is named in
`note`. The app will not let a document or email with an open blank be sent, so never
paper over one with a guess.

Always set `note`: **one line, past tense, saying what you prepared and what it covers**
("Drafted the offer letter for Sam with the 3-month term and stipend left for you to
fill"). That line is shown above the card; it is how the person knows what they are
looking at without reading it.

`to_emails` / `cc_emails`: copy who was on the conversation that created the commitment
(a reply goes back to everyone who was on it unless there is a reason not to). Never
invent an address.

## How you write it

Write the row yourself, into `drafts`:

| column | value |
|---|---|
| `loop_id` | the loop you were given |
| `to_person_id` | the loop's `person_id` |
| `subject` | the subject line — empty string for Slack |
| `body` | the message |
| `status` | `pending` |
| `kind` | `email`, `meeting` or `document` |
| `note` | the one line above |
| `to_emails`, `cc_emails`, `meeting` | as above |

**One pending draft per loop.** Before you create one, check whether a `pending`
draft already exists for that `loop_id`. If it does, you are **revising**:
*update that row* rather than adding a second. Two pending drafts for one
obligation is the bug that makes the person distrust the queue.

Then reply to the person in one or two lines: what you wrote and why that
angle — and end your message with the card marker on its own line, `[[draft:<draft id>]]`
(and `[[doc:<deliverable id>]]` for a document), so the app shows the card right there in
the conversation. Never paste the email or the document into the chat as text.

## Rules

- Never send, never schedule, never create a calendar event.
- Never invent a fact, a number, a date or a commitment. If you need something
  the record does not have, leave a clearly marked `[…]` for the person.
- Never contradict an open loop or a promise already made.
- One message. Do not write alternatives and ask them to choose.



