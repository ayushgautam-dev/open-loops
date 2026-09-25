#input_type_name: IngestInput
#output_type_name: IngestResult
#function_name: ingest_open_loops

# Deterministic writer for the Open Loops model. The extractor agent does the
# judgment (what's a loop, who's the person); this function resolves natural keys
# to FKs and upserts idempotently, so re-running the backfill never duplicates.
#
# Natural keys: company=domain, person=email, loop=(thread_ref, kind, person),
# timeline=ref. Everything is resolved here, so the agent only passes emails,
# domains and track slugs — never uuids.

import re
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class CompanyIn(BaseModel):
    domain: str
    name: str
    what: str | None = None
    context: str | None = None
    track_slug: str | None = None


class PersonIn(BaseModel):
    email: str
    name: str
    role: str | None = None
    company_domain: str | None = None
    context: str | None = None
    how_met: str | None = None
    track_slugs: list[str] = Field(default_factory=list)
    last_contact_at: str | None = None
    relationship: str | None = None  # candidate|prospect|investor|vendor|partner|advisor|teammate|other


class LoopIn(BaseModel):
    person_email: str
    side: str                       # you | them | neither
    kind: str                       # reply_owed | promise | intro_owed | decision_owed | ack_owed | awaiting_reply | scheduling_stalled | going_cold
    obligation: str
    track_slug: str | None = None
    provenance: str | None = None
    source: str = "email"           # email | call | calendar | slack | manual
    opened_at: str | None = None
    due_at: str | None = None
    thread_ref: str | None = None
    urgency: int | None = None      # 0 = drop everything … 3 = whenever
    urgency_reason: str | None = None
    draft_subject: str | None = None
    draft_body: str | None = None


class TaskIn(BaseModel):
    """Work with a deliverable — not just a reply."""
    title: str
    detail: str | None = None
    person_email: str | None = None
    track_slug: str | None = None
    provenance: str | None = None
    source: str = "email"
    opened_at: str | None = None
    due_at: str | None = None
    thread_ref: str | None = None
    urgency: int | None = None


class TimelineIn(BaseModel):
    person_email: str | None = None
    company_domain: str | None = None
    type: str                       # email | meeting | stage_change | note | loop_opened | loop_closed
    title: str
    quote: str | None = None
    source: str = "email"
    happened_at: str | None = None
    ref: str | None = None


class IngestInput(BaseModel):
    companies: list[CompanyIn] = Field(default_factory=list)
    people: list[PersonIn] = Field(default_factory=list)
    loops: list[LoopIn] = Field(default_factory=list)
    tasks: list[TaskIn] = Field(default_factory=list)
    timeline: list[TimelineIn] = Field(default_factory=list)


class IngestResult(BaseModel):
    companies_created: int = 0
    people_created: int = 0
    loops_created: int = 0
    loops_skipped: int = 0
    tasks_created: int = 0
    drafts_created: int = 0
    timeline_created: int = 0
    notes: list[str] = Field(default_factory=list)


def _norm_email(e: str | None) -> str:
    return (e or "").strip().lower()


def _norm_domain(d: str | None) -> str:
    d = (d or "").strip().lower()
    if "@" in d:
        d = d.split("@")[-1]
    return d.lstrip("www.")


# The agent writes in human words; the schema speaks enums. Normalise here so a
# vocabulary drift never fails a whole batch (this used to drop real loops).
_SIDE = {
    "you": "you", "yours": "you", "your": "you", "mine": "you", "me": "you",
    "my": "you", "founder": "you", "us": "you", "on your side": "you",
    "them": "them", "theirs": "them", "their": "them", "they": "them",
    "other": "them", "counterparty": "them", "on their side": "them",
    "neither": "neither", "none": "neither", "no one": "neither", "nobody": "neither",
}
_SIDE_BY_KIND = {
    "reply_owed": "you", "promise": "you", "intro_owed": "you",
    "decision_owed": "you", "ack_owed": "you",
    "awaiting_reply": "them", "scheduling_stalled": "them",
    "going_cold": "neither",
}
_SOURCES = {"email", "call", "calendar", "slack", "manual"}
_RELATIONSHIPS = {
    "candidate", "prospect", "investor", "vendor",
    "partner", "advisor", "teammate", "other",
}

# A track is a pipeline the founder runs, so membership is only meaningful for the
# relationship that pipeline is about. Enforced here rather than in a prompt: the
# extractor used to put vendors who pitch the founder on `sales` and recruiters who
# forward CVs on `hiring`, which is the one mistake that makes the boards untrustworthy.
_TRACK_ALLOWS = {
    "sales": {"prospect"},
    "hiring": {"candidate"},
    "fundraising": {"investor"},
}


def _track_allowed(slug: str, relationship: str | None) -> bool:
    allowed = _TRACK_ALLOWS.get(slug)
    if allowed is None:
        return True          # a track the founder added themselves — no opinion
    if not relationship:
        return False         # unclassified people never land on a board
    return relationship in allowed


# Verbs that only make sense as something *the person* does. If the obligation opens
# with one of these, the obligation is theirs to discharge no matter what side the
# extractor claimed.
#
# This exists because of a real and expensive miss: "Send the client a fresh tax invoice ...
# so they can process the pilot payment" was written as side=them/awaiting_reply.
# autoresolve then closed it the moment Dev replied — the reply rule for "them" is "they
# wrote back", and he had. A live ₹20,000 obligation disappeared silently.
#
# Deliberately excludes waiting words ("hear", "await", "get"): "Hear whether a
# candidate is interested" really is on their side.
_YOU_VERBS = (
    "send", "share", "reply", "respond", "write", "email", "draft", "chase",
    "follow up", "confirm", "approve", "decline", "decide", "introduce", "intro",
    "schedule", "book", "invite", "prepare", "come back to", "get back to",
    "answer", "pay", "sign", "submit", "deliver", "let them know", "tell",
)


def _side_from_obligation(obligation: str | None) -> str | None:
    text = (obligation or "").strip().lower()
    if not text:
        return None
    for prefix in ("you need to ", "you should ", "you must ", "you "):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    return "you" if text.startswith(_YOU_VERBS) else None


def _norm_side(side: str | None, kind: str | None, obligation: str | None = None) -> str:
    # The sentence wins. What it says the person has to do is harder evidence than a
    # label, and getting this wrong closes real obligations behind their back.
    forced = _side_from_obligation(obligation)
    if forced:
        return forced
    s = _SIDE.get((side or "").strip().lower())
    if s:
        return s
    # Fall back to what the kind implies rather than rejecting the row.
    return _SIDE_BY_KIND.get((kind or "").strip().lower(), "you")


def _norm_source(src: str | None) -> str:
    s = (src or "email").strip().lower()
    if s in ("meeting", "transcript", "granola", "fireflies"):
        s = "call"
    return s if s in _SOURCES else "email"


_STOP = {
    "the", "a", "an", "and", "or", "to", "for", "of", "on", "in", "with", "from",
    "at", "by", "is", "are", "be", "his", "her", "their", "our", "my", "your",
    "send", "get", "ask", "them", "him", "it", "that", "this", "so", "as",
}


def _fingerprint(text: str) -> frozenset[str]:
    """Content words of an obligation, for spotting the same thing said twice."""
    words = re.findall(r"[a-z0-9₹]+", (text or "").lower())
    return frozenset(w for w in words if len(w) > 2 and w not in _STOP)


def _is_near_duplicate(fp: frozenset[str], seen: list[frozenset[str]]) -> bool:
    """The same obligation often arrives from two threads — one invoice request in
    email and again in a reply chain — and lands as two rows the founder has to
    dismiss twice. Treat heavy content-word overlap with an existing open loop for
    the same person as the same obligation."""
    if len(fp) < 3:
        return False
    for other in seen:
        if len(other) < 3:
            continue
        overlap = len(fp & other)
        smaller = min(len(fp), len(other))
        if overlap / smaller >= 0.7:
            return True
    return False


_TIMELINE_TYPES = {"email", "meeting", "stage_change", "note", "loop_opened", "loop_closed"}
_TIMELINE_ALIASES = {
    "call": "meeting", "transcript": "meeting", "catchup": "meeting", "sync": "meeting",
    "message": "email", "slack": "email", "thread": "email", "mail": "email",
    "stage": "stage_change", "move": "stage_change",
    "opened": "loop_opened", "closed": "loop_closed",
}


_TIMELINE_SOURCES = {"email", "call", "calendar", "slack", "system"}


def _norm_timeline_source(src: str | None) -> str:
    """timeline_events allows `system` where loops allow `manual` — map, don't guess."""
    s = _norm_source(src)          # collapses meeting/granola/fireflies -> call
    return "system" if s == "manual" else (s if s in _TIMELINE_SOURCES else "email")


def _norm_timeline_type(kind: str | None) -> str:
    """Anything the agent invents ('achievement', 'milestone') becomes a note rather
    than failing the batch — the title and quote carry the meaning anyway."""
    k = (kind or "").strip().lower()
    if k in _TIMELINE_TYPES:
        return k
    return _TIMELINE_ALIASES.get(k, "note")


def _norm_urgency(u: int | None) -> int:
    try:
        return max(0, min(3, int(u)))
    except (TypeError, ValueError):
        return 2


async def ingest_open_loops(ctx: FunctionContext, data: IngestInput) -> IngestResult:
    pod = Pod.from_env()
    res = IngestResult()

    def rows(sql: str) -> list[dict]:
        return pod.query(sql).to_dict()["items"]

    # ---- lookups ----
    track_by_slug = {r["slug"]: r["id"] for r in rows("select id, slug from tracks")}
    company_by_domain = {r["domain"]: r["id"] for r in rows("select id, domain from companies where domain is not null")}
    person_by_email = {r["email"]: r["id"] for r in rows("select id, email from people where email is not null")}

    # ---- companies (upsert by domain) ----
    for c in data.companies:
        dom = _norm_domain(c.domain)
        if not dom:
            continue
        payload = {"domain": dom, "name": c.name}
        if c.what:
            payload["what"] = c.what
        if c.context:
            payload["context"] = c.context
        if c.track_slug and c.track_slug in track_by_slug:
            payload["primary_track_id"] = track_by_slug[c.track_slug]
        if dom in company_by_domain:
            pod.table("companies").update(company_by_domain[dom], payload)
        else:
            row = pod.table("companies").create(payload)
            company_by_domain[dom] = row["id"]
            res.companies_created += 1

    # ---- people (upsert by email) ----
    existing_pt = set(
        (r["person_id"], r["track_id"]) for r in rows("select person_id, track_id from person_tracks")
    )
    existing_rel = {
        r["id"]: r.get("relationship")
        for r in rows("select id, relationship from people")
    }
    for p in data.people:
        em = _norm_email(p.email)
        if not em:
            continue
        payload = {"email": em, "name": p.name}
        if p.role:
            payload["role"] = p.role
        if p.context:
            payload["context"] = p.context
        if p.how_met:
            payload["how_met"] = p.how_met
        if p.last_contact_at:
            payload["last_contact_at"] = p.last_contact_at
        rel = (p.relationship or "").strip().lower()
        if rel in _RELATIONSHIPS:
            payload["relationship"] = rel
        dom = _norm_domain(p.company_domain) if p.company_domain else ""
        if dom and dom in company_by_domain:
            payload["company_id"] = company_by_domain[dom]
        if em in person_by_email:
            pid = person_by_email[em]
            pod.table("people").update(pid, payload)
        else:
            row = pod.table("people").create(payload)
            pid = row["id"]
            person_by_email[em] = pid
            res.people_created += 1
        # track memberships (set semantics; first one primary), gated on relationship
        effective_rel = payload.get("relationship") or existing_rel.get(pid)
        kept = 0
        for slug in p.track_slugs or []:
            tid = track_by_slug.get(slug)
            if not tid:
                continue
            if not _track_allowed(slug, effective_rel):
                res.notes.append(
                    f"{em}: not added to '{slug}' — relationship is "
                    f"'{effective_rel or 'unset'}', not a {slug} counterparty"
                )
                continue
            if (pid, tid) not in existing_pt:
                pod.table("person_tracks").create(
                    {"person_id": pid, "track_id": tid, "is_primary": kept == 0}
                )
                existing_pt.add((pid, tid))
            kept += 1

        # and drop memberships that the (possibly updated) relationship contradicts
        if effective_rel:
            for slug, tid in track_by_slug.items():
                if (pid, tid) in existing_pt and not _track_allowed(slug, effective_rel):
                    for row in rows(
                        "select id from person_tracks "
                        f"where person_id='{pid}' and track_id='{tid}'"
                    ):
                        pod.table("person_tracks").delete(row["id"])
                    existing_pt.discard((pid, tid))
                    res.notes.append(f"{em}: removed from '{slug}' — now a {effective_rel}")

    # relationships as they stand *after* the people pass, for the track guard below
    current_rel = {
        r["id"]: r.get("relationship")
        for r in rows("select id, relationship from people")
    }

    # ---- loops (dedup by thread_ref + kind + person) ----
    # An OPEN loop on the same key always blocks. A CLOSED one only blocks a
    # near-identical obligation: re-reading an old message must not resurrect what
    # was settled, but a genuinely new promise on a long-running thread must land.
    # (23 Sep: "I will send the offer letter this evening" was dropped because a
    # closed scheduling loop already held that person's thread + kind.)
    existing_loops = set()
    closed_by_key: dict[tuple, list[frozenset[str]]] = {}
    open_by_person: dict[str, list[frozenset[str]]] = {}
    for r in rows("select thread_ref, kind, person_id, obligation, status from loops"):
        k = (r.get("thread_ref") or "", r.get("kind") or "", r.get("person_id") or "")
        if r.get("status") == "open":
            existing_loops.add(k)
            open_by_person.setdefault(r.get("person_id") or "", []).append(
                _fingerprint(r.get("obligation") or "")
            )
        else:
            closed_by_key.setdefault(k, []).append(_fingerprint(r.get("obligation") or ""))

    for l in data.loops:
        em = _norm_email(l.person_email)
        pid = person_by_email.get(em)
        if not pid:
            res.notes.append(f"loop skipped — unknown person {em}: {l.obligation[:60]}")
            res.loops_skipped += 1
            continue
        key = (l.thread_ref or "", l.kind, pid)
        if key in existing_loops:
            res.loops_skipped += 1
            continue
        fp = _fingerprint(l.obligation)
        if _is_near_duplicate(fp, closed_by_key.get(key, [])):
            res.loops_skipped += 1
            res.notes.append(f"skipped: '{l.obligation[:60]}' was already settled on this conversation")
            continue
        if _is_near_duplicate(fp, open_by_person.get(pid, [])):
            res.loops_skipped += 1
            res.notes.append(f"deduped: '{l.obligation[:60]}' repeats an open loop for {em}")
            continue
        payload = {
            "side": _norm_side(l.side, l.kind, l.obligation),
            "kind": l.kind,
            "status": "open",
            "obligation": l.obligation,
            "person_id": pid,
            "source": _norm_source(l.source),
            "urgency": _norm_urgency(l.urgency),
            "owner": _norm_email(ctx.user_email),
        }
        if l.urgency_reason:
            payload["urgency_reason"] = l.urgency_reason
        # a loop only carries a track when the person genuinely belongs to that pipeline
        if l.track_slug and l.track_slug in track_by_slug:
            if _track_allowed(l.track_slug, current_rel.get(pid)):
                payload["track_id"] = track_by_slug[l.track_slug]
        if l.provenance:
            payload["provenance"] = l.provenance
        if l.opened_at:
            payload["opened_at"] = l.opened_at
        if l.due_at:
            payload["due_at"] = l.due_at
        if l.thread_ref:
            payload["thread_ref"] = l.thread_ref
        loop_row = pod.table("loops").create(payload)
        existing_loops.add(key)
        open_by_person.setdefault(pid, []).append(fp)
        res.loops_created += 1
        # optional draft attached to this loop
        if l.draft_body:
            pod.table("drafts").create({
                "loop_id": loop_row["id"],
                "to_person_id": pid,
                "subject": l.draft_subject or "",
                "body": l.draft_body,
                "status": "pending",
            })
            res.drafts_created += 1

    # ---- tasks (work with a deliverable; dedup by thread_ref + title) ----
    existing_tasks = set()
    # Tasks need the same near-duplicate guard as loops: the extractor commonly phrases
    # one obligation three ways across three threads ("raise a fresh invoice", "prepare
    # and send the invoice", "raise a PoC invoice"), and the founder should see one task.
    open_task_fps: dict[str, list[frozenset[str]]] = {}
    for r in rows("select thread_ref, title, person_id, status from tasks"):
        existing_tasks.add(((r.get("thread_ref") or ""), (r.get("title") or "").strip().lower()))
        if r.get("status") not in ("done", "dropped"):
            open_task_fps.setdefault(r.get("person_id") or "", []).append(
                _fingerprint(r.get("title") or "")
            )

    for t in data.tasks:
        key = ((t.thread_ref or ""), t.title.strip().lower())
        if key in existing_tasks:
            continue
        t_pid = person_by_email.get(_norm_email(t.person_email)) if t.person_email else None
        t_fp = _fingerprint(t.title)
        if _is_near_duplicate(t_fp, open_task_fps.get(t_pid or "", [])):
            res.notes.append(f"deduped task: '{t.title[:60]}' repeats an open task")
            continue
        payload = {
            "title": t.title,
            "status": "open",
            "source": _norm_source(t.source),
            "urgency": _norm_urgency(t.urgency),
            "owner": _norm_email(ctx.user_email),
        }
        if t.detail:
            payload["detail"] = t.detail
        if t_pid:
            payload["person_id"] = t_pid
        if t.track_slug and t.track_slug in track_by_slug:
            payload["track_id"] = track_by_slug[t.track_slug]
        for fld in ("provenance", "opened_at", "due_at", "thread_ref"):
            val = getattr(t, fld, None)
            if val:
                payload[fld] = val
        pod.table("tasks").create(payload)
        existing_tasks.add(key)
        open_task_fps.setdefault(t_pid or "", []).append(t_fp)
        res.tasks_created += 1

    # ---- timeline (dedup by ref where present) ----
    existing_refs = set(
        r["ref"] for r in rows("select ref from timeline_events where ref is not null")
    )
    batch = []
    for t in data.timeline:
        if t.ref and t.ref in existing_refs:
            continue
        row = {
            "type": _norm_timeline_type(t.type),
            "title": t.title,
            "source": _norm_timeline_source(t.source),
        }
        if t.quote:
            row["quote"] = t.quote
        if t.happened_at:
            row["happened_at"] = t.happened_at
        if t.ref:
            row["ref"] = t.ref
            existing_refs.add(t.ref)
        pem = _norm_email(t.person_email) if t.person_email else ""
        if pem and pem in person_by_email:
            row["person_id"] = person_by_email[pem]
        dom = _norm_domain(t.company_domain) if t.company_domain else ""
        if dom and dom in company_by_domain:
            row["company_id"] = company_by_domain[dom]
        batch.append(row)
    if batch:
        pod.records.bulk_create("timeline_events", batch)
        res.timeline_created = len(batch)

    # ---- audit ----
    # Only say something when something happened. A run that found nothing is the normal
    # case (this fires on every incoming mail), and logging it buried the real entries:
    # the feed was dozens of "Ingested 0 loops and 0 tasks across 0 new people" a day.
    _touched = (res.loops_created + res.tasks_created + res.people_created
                + res.companies_created + res.drafts_created + res.timeline_created)
    if _touched == 0:
        return res

    pod.table("activity_events").create({
        "icon": "inbox",
        "what": f"Ingested {res.loops_created} loops and {res.tasks_created} tasks across {res.people_created} new people",
        "reason": f"From email/calls/Slack: {res.companies_created} companies, {res.drafts_created} drafts, {res.timeline_created} timeline events. {res.loops_skipped} skipped (dup/unknown).",
        "happened_at": datetime.now(timezone.utc).isoformat(),
    })
    return res
