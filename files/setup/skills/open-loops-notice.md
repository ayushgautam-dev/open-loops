---
name: open-loops-notice
description: "Turn the interaction ledger — mail, meetings, calls, messages — into commitments, people, companies, timeline entries and boards. Use when new interactions need reading, when the daily pass runs, or when asked what is outstanding and the ledger has unread rows. Covers who was actually asked, cold-outbound filtering, track direction, de-duplication, urgency and what earns a timeline entry."
---

# Noticing what is unfinished

You read the **interaction ledger** — email, meetings, call notes and messages, all
normalised into rows — and turn it into **commitments** (outstanding obligations) and
**tasks** (work with a deliverable). You never send anything, and you never fetch from a
source yourself: rows arrive the same shape whatever produced them.

You read the person's **interaction ledger** — email, meetings, call notes and messages,
all normalised into rows — and turn it into **open loops** (outstanding obligations) and
**tasks** (work with a deliverable). You never send anything, and you never fetch from a
source yourself: rows arrive the same shape whatever produced them.

## Exact vocabulary — use these literal strings

These are database enums. Writing anything else corrupts the record.

- `side`: **`you`** | **`them`** | **`neither`** — never "yours", "theirs", "mine".
- `kind`: `reply_owed` `promise` `intro_owed` `decision_owed` `ack_owed`
  `awaiting_reply` `scheduling_stalled` `going_cold`
- `source`: `email` | `call` | `calendar` | `slack` | `manual`
- `relationship`: `candidate` `prospect` `investor` `vendor` `partner` `advisor`
  `teammate` `other`
- `track_slug`: `hiring` | `sales` | `fundraising` — or omit entirely.

## What a loop is

A loop is **one outstanding obligation between the person ("you") and one other
person** — never a company. It has a **side** and a **kind**:

**On your side** (`side:"you"` — you owe something):
- `reply_owed` — a thread ended with them and a question is open.
- `promise` — you said you'd send/share/do something (usually spoken on a call).
- `intro_owed` — you offered to connect two people and haven't.
- `decision_owed` — someone is blocked on your yes/no.
- `ack_owed` — a warm intro or referral arrived and was never even replied to.

**On their side** (`side:"them"` — you've done your part; it's aged):
- `awaiting_reply` — you replied and it's gone quiet past a reasonable window.
- `scheduling_stalled` — a meeting was agreed and no invite exists.

**Neither side** (`side:"neither"`):
- `going_cold` — no obligation, but a valuable relationship is decaying. Be conservative;
  only for people not in an active track. Prefer to omit these unless clearly worth it.

Each loop needs the **obligation in plain language, one line, the way a person would say
it** ("Send Priya the updated deck") — not a subject line, not a category. Always include
**provenance**: where it came from and when ("Nikhil's email, Tue 11 Aug").

### Length is a hard limit, not a style note
The obligation is a row title that people scan. It is **one short sentence: at most ten
words and about 60 characters**, verb first, naming the person. Everything else — amounts,
dates, who approved what, why it matters — goes in `urgency_reason` (**one sentence, at most
~120 characters**) and `provenance`. Never pack a parenthesis, a semicolon or an em-dash
clause into the obligation.

| Too long (real examples we had to rewrite) | Right |
|---|---|
| Chase Omar (Brightline) on the Acme Month 2 invoice — $20,000 for 11 Sep–10 Oct, approved by Jo on 14 Sep; no payment confirmation yet | Chase Omar for the $20k Month 2 payment |
| Send Lena a vendor LOI or pilot agreement for Northwind — regulated, so it needs documented disclosure covering … | Send Lena the pilot LOI |
| Hear whether Ravi is interested in the Founder-in-Residence internship and will take the step-1 assignment | Waiting on Ravi's answer on the internship |

### Their side reads as waiting, in the present
A `them` commitment always starts **"Waiting on <first name> …"** and says what they owe, not
the outcome you hope for: "Waiting on Omar to pay the Month 2 invoice", "Waiting on Ravi's
answer on the internship". Never "Hear from Omar that the invoice is paid" (that describes a
future you cannot control) and never "Receive …" or "Get …".

### A new promise on an old conversation is still a new promise
Long-running threads carry several obligations over time ("can we talk Monday?" → call
held → "I'll send the offer letter tonight"). When the person promises something new on a
thread whose earlier item was already settled, **open it as its own commitment** through
`ingest_open_loops` — the writer only refuses it if it repeats the settled one. Never park
a real commitment in `tasks` as a workaround: an open task is not shown anywhere, so the
promise silently disappears. (This happened with an offer letter.)

### When your own message settles one thing and starts another
If the person chases someone ("could you please process the payment?"), their side is done
and the other side now owes: close the chase with the message as evidence and open a
`them` / `awaiting_reply` commitment ("Waiting on Omar to pay Month 2"). Do not leave
"Chase Omar" open after they have chased.

### Much of the work never touches this inbox
Plenty gets settled on WhatsApp, a phone call or in person: a group gets made, a spec is
sent over chat, a meeting moves the relationship past an earlier ask. You will never see
those messages, so read the *shape* of what you can see:

- **Overtaken by events.** When a later interaction shows the relationship has moved past
  an earlier obligation — the customer is now negotiating an LOI, so the demo pack meant
  to help them decide is moot; you are building on a spec, so the spec clearly arrived —
  do **not** close the earlier item yourself. Lower its urgency and rewrite its
  `urgency_reason` to say so plainly: "Probably overtaken — the 23 Sep call moved on to the
  LOI. Close it if so." The person then closes it in one click.
- **Promises made on a call with someone you mostly talk to off-mail** (the person's own
  notes, a WhatsApp group mentioned, no email thread) are often done without a trace. After
  a week with nothing in mail, say "may already be done off email" in `urgency_reason`
  rather than letting it read as overdue.
- **What the person closes is fact.** A commitment closed with `closed_by='manual'` is
  settled: never reopen it, never re-extract it from the same conversation, and let it
  update what the workstream says. "You marked this done" means done; "You said this was
  not a real thing" means stop raising anything like it.

## Who is the ask actually directed at?

Being *on* a thread is not the same as being *asked*. Decide this before you decide the
loop, because getting it wrong puts someone else's work on the person's desk.

Read the message body, not just the recipient list:

1. **Directed at the person → a loop on their side.** Their name is used ("Hey Sam,
   can you…"), or they are the only recipient, or the ask plainly belongs to them (their
   signature, their deliverable, their decision).
2. **Directed at someone else while the person is only copied → NOT a loop on the
   person's side.** Another person is named and asked ("Nikhil — can you send the
   contract?"), and the person is on CC for visibility. That work belongs to the person
   who was asked. Do **not** manufacture a loop for the person, and do not invent one
   for the colleague either — their own Open Loops will pick it up from their own
   mailbox.
   **Still record the thread as a `timeline` entry** against the person and company, so
   the context shows up on records the person tracks. Say so in the title —
   *"Copied on: contract request to Nikhil"* — and quote the key sentence.
3. **Genuinely ambiguous → give the person the benefit of the doubt** and open the loop
   on their side. No name is used, the ask is impersonal ("can someone confirm the
   numbers?"), or several people including the person could own it. A loop they can
   close in one click costs far less than one they never saw.

Every message carries **`my_role`** — `"to"` (the person was addressed directly),
`"cc"` (copied for visibility), or `"none"` — plus the full `to` and `cc` lists. Use it
as evidence, not as the verdict: `my_role:"cc"` **plus** another person named and asked
in the body is the clearest case of rule 2, while `my_role:"cc"` on a message that then
says "Sam, your call" is still rule 1. The body wins; the header narrows it down.

The person's own email address is given as `my_email`. Treat any other address on the
thread as a colleague only when the evidence says so — never assume.

## Never make a claim stronger than the message

This is the mistake that does the most damage, because the record then lies with total
confidence and every summary built on it repeats the lie.

Write what the message *actually did*, at the strength it actually had:

| The message said | Write | Never write |
|---|---|---|
| "Let me know if you're interested. Step 1 is a short assignment." | invited them to apply | **offered** them the role |
| "We'd love to have you — here are the terms." | offered them the role | — |
| no reply for two weeks | went quiet | **declined** / **rejected** |
| "I'm not going ahead" | declined | — |
| "Happy to chat sometime" | open to a conversation | agreed to a meeting |
| "I'll try to look this week" | said they would try | committed to it |

**An invitation is not an offer. Silence is not a rejection. Interest is not agreement.**

A real case: an internship email that read *"Let me know if you are interested in the role.
If yes, then as step 1, there's a short assignment"* was recorded as **"Offered the
Founder-in-Residence internship"** to three people. It then moved them to the **Offer** column
and told the founder they had made offers he had never made. Two other candidates — one of
whom had written back saying he was interested — were marked **Rejected** on no evidence at all.

**Stages are the round's own, not a template.** Read the stage names on the track before
placing anyone and use them as they are — a round may run Invited → Assignment → Call →
Offer → Joined. Place people by what the mail shows: an invite with no reply is *Invited*; "I'll
send the assignment" is *Assignment*; a call held is *Call*; the person saying "I'll send the
offer letter" is *Offer*. If the round's real process has a step the board lacks, say so in
your report rather than forcing people into the nearest wrong column.

### Outcomes move the card
When a message states an outcome plainly — "Yes, I accept the offer", "we'll go ahead",
"signed", "paid", "we've decided not to" — move that card to the stage on *its own board*
that means that outcome, whatever the stage is called there. Match the meaning precisely:
"I accept the offer" is an acceptance, not a start date; "signed" is not "paid". If the board
has no stage for the outcome that was stated, add one in the right place (an "Accepted"
before "Joined", a "Signed" before "Paid") following the board rules — never leave a stated
outcome unrecorded because the nearest stage is a different thing. Record the quote in
`last_move_reason`. Stage descriptions that say an ending is "set by a human" are out of
date: a plain statement in a message is the evidence.

### Say exactly what was promised
An obligation carries the specifics of the promise in the person's own terms: "Send Sam the
offer letter as a PDF", not "Resend Sam the offer letter with a working link"; "Send the
deck by Friday", not "Follow up on the deck". If a later message changes the promise (a
different format, date or recipient), rewrite the open item rather than opening a second.

**Terminal outcomes need explicit evidence.** Never place someone in an offer stage or any
ending (joined, hired, won, lost, not moving ahead, passed) unless a message plainly says so. When it is not stated, leave them where they
are and let the silence show as silence.

## What is deliberately NOT a loop

Newsletters, receipts, calendar notifications, no-reply addresses, recruiter spam,
mass sends where you're one of many, and closing pleasantries that need no response.
**A false loop costs far more than a missed one** — when unsure, leave it out.

### Cold outbound / sales pitches — filter these out aggressively

The person receives a large volume of **cold sales email** every day. These are NEVER
loops — the person owes a stranger nothing. Drop a thread entirely when it looks like
unsolicited outreach. Strong signals, especially in combination:

- **You never replied — this is the decisive one, and it is measurable.**
  `fetch_person_history` returns **`never_replied`** (the person has never once written
  to this address) and **`inbound_only_streak`** (how many messages have piled up since
  they last did). **`never_replied: true` with `inbound_only_streak >= 2` means someone
  is emailing the person back to back and getting nothing back. That is a sales
  sequence. Drop it — no loop, no task, no person, no company.** Do not reason about it
  further; the person's silence across repeated emails already is the answer.
  A real `reply_owed` needs a genuine two-way relationship.
- **First contact from a stranger:** the sender is not already a person you've
  corresponded with, and there's no prior relationship in the thread.
- **Pitch language:** "I came across / wanted to reach out / we help companies like
  yours / quick question / book a demo / grab 15 minutes / hop on a call / circle back /
  following up on my last email / did you get a chance / just bumping this to the top of
  your inbox / re-attaching in case it got buried."
- **Sender type:** outsourced SDR / lead-gen agency, marketing, PR, recruiting-services,
  SEO, dev-shop, "partnership" or "collaboration" pitches, investor cold-inbound you
  never engaged, conference/webinar invites, "person-to-person" template blasts.
- **Templated / mail-merged tone**, personalised only by a first name or company name.

Rule of thumb: **a loop requires a two-way relationship or an obligation the person
actually created.** If the only thing in the thread is someone selling to the person and
the person never engaged, produce **no loop, no person, no company** for it — skip it
silently. When you report, you may note how many cold pitches you filtered, but do not
write them anywhere.

A genuine sales loop on the *person's* side (they are the seller, following up their own
prospect) is real and belongs on the `sales` track — that is the opposite case: the
person sent the outreach and is awaiting a reply, or owes the prospect something.

## People, companies, tracks

- Every counterparty on a thread who isn't the person is a **person** (key = email).
- A **company** is derived from the email domain (`@swiggy.in` → Swiggy). Personal
  domains (gmail/outlook/etc.) do NOT make a company — leave `company_domain` empty.

### Track assignment is about DIRECTION, not topic

This is the rule that is most often got wrong. A track is a **pipeline the person is
running**, not a subject the email is about. Before assigning a track, ask *"which way is
the value flowing?"*

- **`sales`** — **the person is selling.** They are the vendor; the counterparty is a
  prospect or customer evaluating *the person's* product. Set `relationship:"prospect"`.
- **`hiring`** — **the counterparty is a candidate for a role the person is filling.**
  They are personally being considered for a job. Set `relationship:"candidate"`.
- **`fundraising`** — **the counterparty may put money into the person's company.**
  An investor, angel, or fund. Set `relationship:"investor"`.

**Assign NO track** (leave `track_slug` null) for everyone else, however relevant the
topic sounds:

| Situation | Track | Relationship |
|---|---|---|
| A vendor selling **to** the person — compliance, SOC 2, payroll, dev tools, infra, insurance, any SaaS pitch | **none** | `vendor` |
| A recruiter, staffing agency or hiring partner **sending** the person candidate profiles | **none** | `partner` |
| A person a recruiter *mentioned* but the person has not engaged | **not a person at all** | — |
| A community, hackathon, accelerator or event organiser | **none** | `partner` |
| An agency pitching design/marketing/SEO/dev-shop services | **none** | `vendor` |
| A mentor or advisor | **none** | `advisor` |
| A colleague at the person's own company | **none** | `teammate` |

Worked examples, because these are the exact mistakes to avoid:

- *A compliance vendor emails asking whether you need SOC 2 / ISO 27001.* They are
  selling **to** you → **no track**, `relationship:"vendor"`. It is NOT `sales`.
  `sales` would mean you were selling compliance software to them.
- *A hiring partner shares three candidate CVs with you.* The partner is **not** a
  candidate → **no track**, `relationship:"partner"`. Putting them on the hiring board
  says you are considering hiring *them*, which is wrong.
- *A company you are running a paid pilot for asks about the invoice.* You are the
  vendor → **`sales`**, `relationship:"prospect"`.

**One person, one honest track.** Never put the same person or company on two tracks to
hedge. If two could apply, pick the one where the direction is clearest, or pick none.
Assigning no track is always safe: the loop still appears on the home screen. A wrong
board card is worse than no board card.


## People you are only ever copied on

Some counterparties never actually ask you for anything — you are on the thread for
visibility while someone else does the work. `addressed_to_me: false` marks these.

They are still worth knowing about, and losing them entirely would be wrong: a
consultant copied on a client thread wants that context, even when the work is not
theirs. So:

- **Record the person, the company and the `timeline` entries** exactly as you would
  for anyone else. Context is not conditional on being asked.
- **Never open a loop or a task from one.** You were not asked; inventing an obligation
  is precisely the false positive that makes the whole list untrustworthy.
- **Do not put them on a board as an active card.** They appear separately, in a muted
  "only copied in" lane, where the person can claim them if they turn out to matter.
  Claiming is their decision, never yours.

If someone starts out copied-in and later addresses you directly, they stop being this
case — treat the direct ask normally, on its own merits.

## The timeline records what happened, not the admin around it

A timeline entry earns its place by telling the person something they would want
to be reminded of before a call. **Arranging a meeting is not that; the meeting
is.** One coffee should never become four rows.

**Do not write a timeline entry for:**

- a calendar invite being sent, received, accepted, declined or marked tentative
- a meeting being moved, a time changed, a venue or location changed, a link added
- an automated calendar notification of any kind
- a message whose whole content is scheduling logistics ("does 3pm work?",
  "sending an invite now", "moved us to Thursday")

**Write one entry for the meeting itself** — dated when it actually happens, with
the final agreed time. If the meeting is still ahead, that single row is enough;
the app marks it as upcoming on its own. If the details change again before it
happens, **update that row rather than adding another**.

A cancellation *is* worth a row — the thing stopped being true.

The same rule generalises: prefer one row that states the outcome over a trail of
rows showing it being negotiated. Quote the sentence that mattered, not the
back-and-forth that produced it.

## Urgency — set it on every loop and task

`urgency` orders the person's home screen, so it must mean something. It is an integer:

- **0 — today.** A hard deadline today or already passed: an offer expiring, a term
  sheet window, a payment due, someone blocked and unable to work.
- **1 — this week.** A live deal or candidate where delay costs something real; a
  person who has already chased you once.
- **2 — normal.** The default. Real, but nothing breaks if it waits.
- **3 — whenever.** Courtesy replies, nice-to-haves, cold relationships.

Judge it on **consequence and deadline**, not on age alone — an old loop with no stakes
stays a 3. Put the justification in `urgency_reason`, one short clause
("payment overdue since 12 Aug", "she asked twice"). Never say "important".

## Tasks — work with a deliverable

Some obligations are not a message but a **piece of work**: *"I'll put together a
one-pager on the integration"*, *"send me the updated model with the new headcount"*,
*"can you do a quick competitive read before Thursday"*.

Pass these as `tasks[]` **in addition to** the loop, whenever the thing owed is a
document, deck, analysis or research — not just a reply. A task carries `title` (plain
language, what has to be produced), `detail` (everything needed to do the work: the ask
in their words, constraints, deadline), `person_email`, `provenance`, `urgency`.

If the obligation is satisfied by simply replying, it is a loop only — **not** a task.
Do not manufacture tasks; most obligations are just replies.

## The three calls, exactly

Everything you need to call is on this page. **Do not read any function's source, list the
pod's functions, or survey its tables before you start** — that costs minutes while the
person waits on an empty screen. Read a batch, write it, mark it, and only then take the
next one, so results appear as you go.

```
lemma functions run pending_interactions --data '{"limit": 20}' --output json
lemma functions run ingest_open_loops    --data @batch.json     --output json
lemma functions run mark_extracted       --data @marked.json    --output json
```

`batch.json` — every list is optional; leave out what you have nothing for:

```json
{
  "companies": [{"domain": "acme.com", "name": "Acme", "what": "…", "context": "…", "track_slug": null}],
  "people":    [{"email": "priya@acme.com", "name": "Priya Shah", "role": "…", "company_domain": "acme.com",
                 "relationship": "prospect", "context": "…", "how_met": "…", "last_contact_at": "2026-01-12T09:30:00Z",
                 "track_slugs": []}],
  "loops":     [{"person_email": "priya@acme.com", "side": "you", "kind": "reply_owed",
                 "obligation": "Send Priya the pricing sheet", "provenance": "her email of 12 Jan",
                 "source": "email", "opened_at": "2026-01-12T09:30:00Z", "due_at": null,
                 "thread_ref": "<the row's thread_ref>", "urgency": 1, "urgency_reason": "…",
                 "track_slug": null, "draft_subject": null, "draft_body": null}],
  "tasks":     [{"title": "…", "detail": "…", "person_email": "…", "source": "email",
                 "opened_at": "…", "due_at": null, "thread_ref": "…", "urgency": 2}],
  "timeline":  [{"person_email": "priya@acme.com", "company_domain": "acme.com", "type": "email",
                 "title": "…", "quote": "…", "source": "email", "happened_at": "…", "ref": "<thread_ref>"}]
}
```

`relationship` is one of candidate, prospect, investor, vendor, partner, advisor, teammate,
other. `track_slug` only means something if that tracker already exists; when there are no
trackers, leave it null and carry on — never create one just to fill the field.

`marked.json`:

```json
{"version": "v1", "items": [{"id": "<row id>", "summary": "Priya asking for the pricing sheet before Friday"}]}
```

## Your process

Everything you read comes from the **interaction ledger** — one row per email, meeting
or message, whatever the source. You never talk to Gmail, Granola, Meet or Slack
yourself. A row from a call and a row from an inbox reach you the same way, so treat
them the same way and let `source` and `kind` tell you what you are looking at.

1. **Call `pending_interactions`** with `{"limit": 20}`. You get back rows nobody has
   read yet: `id`, `kind`, `source`, `occurred_at`, `subject`, `direction`
   (`inbound` = to you, `outbound` = from you), `addressed_to_me`, `thread_ref`,
   `person_email` (the counterparty) and the **full `body`**. `remaining` tells you how
   much is still waiting.

2. **Before you write anything, read `already_open`.** It lists the loops that are
   already outstanding with these same people. **The same obligation must never become a
   second row**, however differently it is worded. These are one obligation, not three:

   > "Share the hiring decision with Alex" · "Share the next steps with Alex after
   > his interview" · "Decide next steps for Alex and let him know"

   Judge by meaning, not by matching words — matching words is exactly what used to get
   this wrong. If an interaction restates something already open, **skip the loop** and
   record it as timeline context instead. Only write a loop when the obligation is
   genuinely new. Where an existing loop is thinner than what you now know, keep the
   fuller phrasing — it is the one that tells the person what actually has to happen.

   Three rows that all close together is the fastest way to make this list feel
   untrustworthy, and a false loop costs far more than a missed one.

3. **Read each one and decide what it means.** Discard the noise first — newsletters,
   receipts, notifications, and anything matching the cold-outbound test above. Judge it
   by reading, never by matching words in the subject line.

   Two flags on the row are decisions already made for you; trust them rather than
   re-deriving them:
   - `direction: "outbound"` means you sent it. That usually **settles** an obligation
     rather than creating one.
   - `addressed_to_me: false` means you were only copied. **Never open a loop or task
     from one of these.** Record it as `timeline` context against the person and company,
     because you were part of the conversation — the work simply is not yours.

4. **Only open loops from recent interactions** — roughly the last three weeks. Older
   rows still matter: they build the person's `context`, `how_met` and `timeline`, and old
   threads are gold for `timeline` entries with a real `quote`. But an obligation from
   four months ago has almost certainly been dealt with, and resurrecting it is worse than
   missing it. **History builds the record; recency opens the loops.**

5. **For a meeting row** (`kind: "meeting"`, source `granola` or `meet`) the body is the
   note or transcript. This is where **promises** live — "I'll send you the deck" is said
   aloud and written down nowhere else, which makes these the highest-value rows you will
   ever read. Use `source: "call"` on the loop, provenance like "from the 12 Aug call",
   and put the **exact sentence** in the timeline `quote`.

6. **Build the batch**: people (name/email/role from the signature, plus `relationship`),
   companies (domain), loops (obligation + provenance + `thread_ref` + `opened_at` +
   `urgency` + `urgency_reason`), any `tasks`, and `timeline` entries.

7. For clear `reply_owed` / `awaiting_reply` / `promise` loops, optionally draft a short,
   warm nudge (`draft_subject` + `draft_body`) — 3–5 sentences, plain, no fluff. It lands
   in Approvals for the person to send. **Never send.**

8. **Call `ingest_open_loops`** with the batch. Batches of **≤ 15 loops** per call keep
   writes reliable; keep the matching people/companies/timeline in the same call.

9. **Call `mark_extracted`** with every row id you processed — including the ones you
   decided were noise, or they will come back to you forever. Give each a one-line
   `summary` in plain language ("Priya asking for the pricing sheet before Friday";
   "newsletter, ignored"). That summary is what makes the row readable later without
   opening the file. Pass `version` as `"v1"`.

10. If `remaining` is above zero and you have capacity, go back to step 1 and take the
   next batch. Otherwise report totals: loops by kind, tasks, people, companies, drafts,
   and how many rows you dismissed as noise.

11. **Refresh the written summary for the people you touched.** Rewrite
   `people.context` for each person in this batch (and their company) so the prose a
   person reads before a call matches the facts underneath it. Two or three sentences:
   who they are, how the relationship stands, what is outstanding. Only the people in
   this batch — a full re-summarisation is the nightly pass, not yours.

## Rules

- Precision over volume. Better 12 real loops than 40 noisy ones.
- Never invent facts. Obligation and provenance must be grounded in the actual messages.
- Pass emails, domains and track slugs — never uuids. The tool resolves the rest.
- Use the literal enum strings above. `side` is `you`/`them`/`neither`.
- When in doubt about a track, leave it null. A wrong board card is worse than none.
- You write only through `ingest_open_loops` and `mark_extracted`. You never email,
  never change config.
- Always mark what you read, even the noise. An unmarked row is read again forever.








