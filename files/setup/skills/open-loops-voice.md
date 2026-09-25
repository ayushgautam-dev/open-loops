---
name: open-loops-voice
description: "Learn how the person writes email from their own sent mail and keep /me/voice.md current. Use on first run after the backfill, when asked to learn or refresh their voice, and monthly. Every draft reads the result."
---

# Learning the person's voice

Drafts only earn a Send if they already sound like the person. You learn that from what
they have actually sent — never from what they say about themselves.

## Read

- Pull their **sent** mail: the `interactions` rows with `direction='outbound'` and
  `source` in (`gmail`,`email`), newest first, and read the raw bodies from each row's
  `body_ref` file. Take **40–60 real messages** from at least 10 different recipients.
  If the ledger has fewer, search Gmail's sent folder for more.
- **Skip** anything that is not them writing to a person: automated mail sent from their
  address (briefs, notifications, forwarding to a bot), one-word replies, calendar noise.
- Strip quoted replies (`On … wrote:` and below) and signatures before you read the style.

## Work out

Measure; do not guess. Count where you can.

1. **Greeting** — "Hi Priya," / "Hey," / none. How it changes with seniority or familiarity.
2. **Sign-off** — exact form and frequency ("Best regards, Sam" vs just the name).
3. **Length** — typical sentences per email; the longest they write when it matters.
4. **Register** — formal/informal, contractions, how they say no, how they chase, how they
   thank, how they apologise (if ever).
5. **Their phrases** — the handful of openings and closings they really reuse, verbatim.
6. **Things they never do** — exclamation marks, emojis, bullet points, "circling back".
7. **Language** — if they write in more than one language (e.g. Hinglish to some people),
   say to whom and how.

## Write `/me/voice.md`

- A short style guide (15–25 lines) in the headings above, each point backed by a count
  or a quote ("signs off 'Best regards, Sam' in 31 of 44").
- **Six to eight real examples, verbatim**, trimmed to the body: two replies, two chases,
  one decline, one scheduling message, one thank-you — whatever exists. Names and amounts
  can stay; these are the person's own words and never leave the pod.
- A last line: `Learned from N sent emails, <date range>, on <today>.`

Then set `settings` `voice_doc` **only if it is empty** — that key holds the person's own
rules and always wins over what you learned. Never overwrite it.

Reply in one line: how many messages you learned from and the two most distinctive traits.


## Style rules have a scope

A preference like "no em dashes", "no hyphens", "no exclamation marks" or "never say
circling back" is about **the person's own prose**. It never changes:
- names of people, companies, products, programmes or roles ("Blue-Harbor Capital",
  "Founder-in-Residence", "open-source" in a product name);
- titles of documents, subject lines of existing threads, quoted words, email addresses,
  URLs, numbers, dates or amounts.
Write around the punctuation in your own sentences; leave proper names exactly as their
owners write them. When you record such a preference, record its scope with it.

