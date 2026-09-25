#input_type_name: AutoResolveInput
#output_type_name: AutoResolveResult

#function_name: autoresolve_loops

import re
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Closes loops the founder already dealt with in their inbox without ever opening the app.
#
# The rule is deliberately narrow and mechanical, because a wrongly-closed loop is the
# expensive mistake: for a loop on the founder's side, if they have sent a message on that
# thread *after* the loop opened, the obligation is discharged. Replying is the whole job
# for reply_owed/ack_owed; for a promise it is near enough that leaving it open is worse.
#
# Loops waiting on the other side are the mirror: they close when *they* finally write.
#
# Nothing is deleted and nothing is guessed — every close is written to activity_events
# with the date of the message that justified it, so a wrong call is visible and undoable.

RESOLVE_ON_MY_REPLY = {"reply_owed", "ack_owed", "promise", "intro_owed", "decision_owed"}

# Some obligations are discharged by *saying* something; others need a thing to exist.
# "Send Dev a fresh tax invoice" is not settled because you wrote back on the thread —
# and closing it on a reply is how a live ₹20,000 obligation silently disappeared.
# When the obligation names an artifact, a reply is not enough evidence: leave it open
# and let the person close it, or let it age out honestly.
_DELIVERABLE = re.compile(
    r"\b(invoice|deck|document|doc|proposal|contract|agreement|report|model|"
    r"one-?pager|spreadsheet|slides|quote|quotation|statement|certificate|"
    r"offer letter|nda|sow|estimate)\b",
    re.I,
)
RESOLVE_ON_THEIR_REPLY = {"awaiting_reply", "scheduling_stalled"}


class AutoResolveInput(BaseModel):
    dry_run: bool = False
    max_loops: int = 200


class Closed(BaseModel):
    obligation: str
    kind: str
    person: str = ""
    reason: str


class AutoResolveResult(BaseModel):
    checked: int = 0
    closed: int = 0
    skipped_no_thread: int = 0
    skipped_needs_artifact: int = 0
    details: list[Closed] = Field(default_factory=list)
    note: str = ""


def _addr(raw: str) -> str:
    raw = (raw or "").strip()
    m = re.match(r"^\s*.*?\s*<([^>]+)>\s*$", raw)
    return (m.group(1) if m else raw).strip().lower()


def _ts(value: str) -> float:
    v = (value or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(v[:19] if "T" in v and fmt != "%Y-%m-%d" else v[:10], fmt)
            return dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp()
        except Exception:
            continue
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


async def autoresolve_loops(ctx: FunctionContext, data: AutoResolveInput) -> AutoResolveResult:
    pod = Pod.from_env()
    my_email = (ctx.user_email or "").lower()
    res = AutoResolveResult()

    loops = pod.query(
        "select l.id, l.kind, l.side, l.obligation, l.thread_ref, l.opened_at, "
        "coalesce(p.name,'') as person "
        "from loops l left join people p on p.id=l.person_id "
        f"where l.status='open' and coalesce(l.thread_ref,'')<>'' limit {data.max_loops}"
    ).to_dict()["items"]

    for loop in loops:
        thread_ref = (loop.get("thread_ref") or "").strip()
        if not thread_ref:
            res.skipped_no_thread += 1
            continue
        res.checked += 1

        kind = loop.get("kind") or ""
        if kind in RESOLVE_ON_MY_REPLY:
            if _DELIVERABLE.search(loop.get("obligation") or ""):
                res.skipped_needs_artifact += 1
                continue
            want_from_me = True
        elif kind in RESOLVE_ON_THEIR_REPLY:
            want_from_me = False
        else:
            continue                      # going_cold has no reply that settles it

        try:
            resp = pod.connectors.execute("gmail", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", {
                "thread_id": thread_ref,
            }).to_dict()
        except Exception:
            continue
        r = resp.get("result", resp)
        body = r.get("data", r) if isinstance(r, dict) else {}
        msgs = body.get("messages") or r.get("messages") or []
        if not msgs:
            continue

        opened = _ts(loop.get("opened_at") or "")
        settled_on = ""
        for m in msgs:
            when = _ts(m.get("messageTimestamp") or "")
            if when <= opened:
                continue
            labels = m.get("labelIds") or []
            from_me = "SENT" in labels or _addr(m.get("sender", "")) == my_email
            if from_me == want_from_me:
                settled_on = (m.get("messageTimestamp") or "")[:10]
                break

        if not settled_on:
            continue

        who = "You replied" if want_from_me else f"{loop.get('person') or 'They'} replied"
        reason = f"{who} on this thread on {settled_on}, after the loop opened."
        res.details.append(Closed(
            obligation=(loop.get("obligation") or "")[:120],
            kind=kind, person=loop.get("person") or "", reason=reason,
        ))
        res.closed += 1

        if not data.dry_run:
            pod.table("loops").update(loop["id"], {
                "status": "closed",
                "closed_at": datetime.now(timezone.utc).isoformat(),
                "closed_by": "auto",
                "close_reason": reason[:200],
            })
            pod.table("activity_events").create({
                "icon": "check",
                "what": f"Closed automatically — {(loop.get('obligation') or '')[:110]}",
                "reason": reason,
                "happened_at": datetime.now(timezone.utc).isoformat(),
            })

    res.note = (
        f"{res.closed} of {res.checked} open email loops were already settled in the inbox."
        + (" (dry run — nothing was changed.)" if data.dry_run else "")
    )
    return res
