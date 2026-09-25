#input_type_name: TidyInput
#output_type_name: TidyResult

#function_name: tidy_up

import re
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# The other half of auto-resolve.
#
# autoresolve_loops answers "did somebody reply?" by reading the thread. This answers the
# three questions that need no inbox at all, and that v1 never asked:
#
#   1. Has a later arrangement already replaced this one?   (the "7 PM today" bug)
#   2. Is the same thread sitting in the list twice, once as mine and once as theirs?
#   3. Has this simply gone stale?
#
# Nothing here guesses at meaning. Each rule is narrow, and each writes down what it did
# so a wrong call is visible and undoable. Aged-out items become 'dropped', never deleted.

AGE_OUT_DAYS = 28

# Words that mean "we are arranging a time". Deliberately narrow: a false positive here
# closes a real obligation, which is the expensive mistake.
_TIME_WORDS = re.compile(
    r"\b(call|meet|meeting|slot|time|schedule|reschedule|invite|calendar|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{1,2}\s*(am|pm)|tomorrow|today)\b",
    re.I,
)
_SCHEDULING_KINDS = {"scheduling_stalled"}


class TidyInput(BaseModel):
    dry_run: bool = False
    age_out_days: int = AGE_OUT_DAYS


class Change(BaseModel):
    action: str
    obligation: str
    person: str = ""
    reason: str


class TidyResult(BaseModel):
    superseded: int = 0
    collapsed: int = 0
    aged_out: int = 0
    drafts_retired: int = 0
    considered: int = 0
    changes: list[Change] = Field(default_factory=list)
    note: str = ""


def _is_scheduling(row: dict) -> bool:
    if (row.get("kind") or "") in _SCHEDULING_KINDS:
        return True
    return bool(_TIME_WORDS.search(row.get("obligation") or ""))


def _moment(row: dict, *keys: str) -> str:
    for k in keys:
        v = row.get(k)
        if v:
            return str(v)
    return ""


async def tidy_up(ctx: FunctionContext, data: TidyInput) -> TidyResult:
    pod = Pod.from_env()
    res = TidyResult()
    now = datetime.now(timezone.utc).isoformat()

    rows = pod.query(
        "select l.id, l.kind, l.side, l.status, l.obligation, l.person_id, l.thread_ref, "
        "l.opened_at, l.closed_at, l.created_at, coalesce(p.name,'') as person "
        "from loops l left join people p on p.id = l.person_id "
        "where l.status in ('open','closed') "
        "order by coalesce(l.opened_at, l.created_at) asc"
    ).to_dict()["items"]

    open_rows = [r for r in rows if r.get("status") == "open"]
    res.considered = len(open_rows)
    retired: set[str] = set()

    def retire(row: dict, status: str, closed_by: str, reason: str, replaced_by: str | None = None):
        if row["id"] in retired:
            return
        retired.add(row["id"])
        patch = {
            "status": status,
            "closed_at": now,
            "closed_by": closed_by,
            "close_reason": reason[:200],
        }
        if replaced_by:
            patch["superseded_by"] = replaced_by
        if not data.dry_run:
            pod.records.update("loops", row["id"], patch)
            pod.table("activity_events").create({
                "icon": "check",
                "what": f"{'Retired' if closed_by == 'superseded' else 'Closed'} — {(row.get('obligation') or '')[:110]}",
                "reason": reason[:200],
                "happened_at": now,
            })
        res.changes.append(Change(
            action=closed_by,
            obligation=(row.get("obligation") or "")[:120],
            person=row.get("person") or "",
            reason=reason,
        ))

    # ---- 1. age out -------------------------------------------------------------------
    # Run first: something a month cold should be reported as stale, not dressed up as
    # "replaced by" an item that is about to go stale itself.
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=int(data.age_out_days))
    ).isoformat()

    for r in open_rows:
        if r["id"] in retired:
            continue
        mark = _moment(r, "opened_at", "created_at")
        if mark and mark < cutoff:
            retire(
                r, "dropped", "aged_out",
                f"No activity for over {data.age_out_days} days — assuming this was handled "
                f"somewhere we cannot see.",
            )
            res.aged_out += 1

    # ---- 2. scheduling supersession -------------------------------------------------
    # A person can only owe you one arrangement at a time. If a later scheduling item
    # exists — open or already settled — the earlier ones are history.
    by_person: dict[str, list[dict]] = {}
    for r in rows:
        pid = r.get("person_id")
        if pid and _is_scheduling(r):
            by_person.setdefault(pid, []).append(r)

    for _pid, group in by_person.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda r: _moment(r, "opened_at", "created_at"))
        newest = group[-1]
        for older in group[:-1]:
            if older.get("status") != "open" or older["id"] == newest["id"]:
                continue
            if older["id"] in retired or newest["id"] in retired:
                continue
            later_mark = _moment(newest, "closed_at", "opened_at", "created_at")
            older_mark = _moment(older, "opened_at", "created_at")
            if later_mark and older_mark and later_mark <= older_mark:
                continue
            if newest.get("status") == "closed":
                why = (f"A later arrangement with {newest.get('person') or 'them'} was already "
                       f"settled — \"{(newest.get('obligation') or '')[:80]}\"")
            else:
                why = (f"Replaced by a newer arrangement — "
                       f"\"{(newest.get('obligation') or '')[:80]}\"")
            retire(older, "closed", "superseded", why, replaced_by=newest["id"])
            res.superseded += 1

    # ---- 3. same thread, listed twice ------------------------------------------------
    # If you owe a reply on a thread, you are not also "waiting on them" for it.
    by_thread: dict[str, list[dict]] = {}
    for r in open_rows:
        t = (r.get("thread_ref") or "").strip()
        if t and r["id"] not in retired:
            by_thread.setdefault(t, []).append(r)

    # Only the reply ping-pong collapses: "you owe a reply" + "waiting on their reply" on
    # one EMAIL thread. A meeting (granola:/gcal:) routinely leaves obligations on both
    # sides — "send Priya the contract" and "Priya sends her deck" are two real things, and
    # collapsing them silently closed the second one on 23 Sep.
    for _t, group in by_thread.items():
        if not re.fullmatch(r"[0-9a-f]{10,24}", _t):
            continue
        mine = [r for r in group if r.get("side") == "you" and (r.get("kind") or "") in ("reply_owed", "ack_owed")]
        theirs = [r for r in group if r.get("side") == "them" and (r.get("kind") or "") == "awaiting_reply"]
        if mine and theirs:
            keep = mine[0]
            for r in theirs:
                retire(
                    r, "closed", "superseded",
                    f"The same thread is already on your list as \"{(keep.get('obligation') or '')[:80]}\"",
                    replaced_by=keep["id"],
                )
                res.collapsed += 1

    # ---- 4. drafts outlive their commitment -------------------------------------------
    # A reply written for something that has since settled still shows as "ready to send",
    # which is how a person ends up sending a chase for an invoice that was already paid.
    stale = pod.query(
        "select d.id, coalesce(p.name,'') as person, coalesce(l.status,'gone') as loop_status "
        "from drafts d "
        "left join loops l on l.id = d.loop_id "
        "left join people p on p.id = d.to_person_id "
        "where d.status='pending' and (l.id is null or l.status <> 'open')"
    ).to_dict()["items"]

    for d in stale:
        res.drafts_retired += 1
        res.changes.append(Change(
            action="draft_retired",
            obligation=f"unsent reply to {d.get('person') or 'them'}",
            person=d.get("person") or "",
            reason="what it was written for is no longer open",
        ))
        if not data.dry_run:
            pod.records.update("drafts", d["id"], {"status": "skipped"})

    res.note = (
        f"{res.superseded} replaced by a later arrangement, {res.collapsed} listed twice, "
        f"{res.aged_out} aged out, {res.drafts_retired} unsent replies retired, from {res.considered} open."
        + (" (dry run — nothing was changed.)" if data.dry_run else "")
    )
    return res
