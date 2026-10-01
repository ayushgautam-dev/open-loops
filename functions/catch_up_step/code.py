#input_type_name: StepInput
#output_type_name: StepResult
#function_name: catch_up_step

"""One step of loading somebody's older history, run on a timer as that person.

First run loads only the most recent few days so the desk opens quickly. Everything
older arrives here, a few days at a time, whether or not the app is open: each
person's own schedule ticks the `catch_up` workflow, whose first node is this
function. It keeps its place in that person's `settings.catchup` row:

    {"covered": 6, "target": 21, "sources": ["gmail", ...], "extras": true,
     "done": false, "unread": 12, "reading_until": "...", "stuck": 0}

Each tick does at most one thing:
  * unread rows are waiting  -> ask for a reading pass (`read: true`), unless one was
    asked for recently and may still be going (`reading_until`);
  * calendar and meeting notes not loaded yet -> load them whole, once;
  * mail not back to `target` days yet -> load the next slice;
  * everything loaded and read -> mark done and let mail triggers resume.

Slices are small on purpose: one call that fetches a whole inbox outlives the
request limit. Duplicates are skipped by the ledger, so an overlap costs nothing.
"""

import json
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# A timer may tick at most every 15 minutes, so each tick takes a week of mail.
SLICE_DAYS = 7
SLICE_MAX = 80
READ_LEASE_MIN = 20
MAIL_FILTER = "-in:spam -in:trash -category:promotions -category:social -category:forums"


class StepInput(BaseModel):
    pass


class StepResult(BaseModel):
    read: bool = False
    # the workflow's rule tests this one: a rule matches on a true value, and "not read"
    # written as a negation in the rule never matched
    skip: bool = True
    did: str = ""
    covered: int = 0
    unread: int = 0
    done: bool = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _when(value) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _setting(pod: Pod, key: str) -> dict | None:
    rows = pod.query(
        f"select id, value from settings where key = '{key}' "
        "order by updated_at desc limit 1").to_dict()["items"]
    return rows[0] if rows else None


def _put(pod: Pod, key: str, value: str) -> None:
    row = _setting(pod, key)
    if row:
        pod.table("settings").update(row["id"], {"value": value})
    else:
        pod.table("settings").create({"key": key, "value": value})


def _unread(pod: Pod) -> int:
    rows = pod.query(
        "select count(*) as n from interactions where extracted_at is null").to_dict()["items"]
    return int((rows[0] or {}).get("n") or 0) if rows else 0


def _day(days_ago: int) -> str:
    d = _now() - timedelta(days=days_ago)
    return f"{d.year}/{d.month}/{d.day}"


async def catch_up_step(ctx: FunctionContext, data: StepInput) -> StepResult:
    pod = ctx.pod or Pod.from_env()
    try:
        row = _setting(pod, "catchup")
        state = json.loads(row["value"]) if row else None
    except Exception:
        state = None
    if not state or state.get("done"):
        return StepResult(did="nothing to do", done=True)

    sources = state.get("sources") or []
    target = int(state.get("target") or 21)
    covered = int(state.get("covered") or 0)
    res = StepResult(covered=covered)

    def save() -> None:
        state["unread"] = res.unread
        _put(pod, "catchup", json.dumps(state))

    def hold(minutes: int) -> None:
        # stand the per-mail trigger down for this person while rows land in bulk
        until = _now() + timedelta(minutes=minutes) if minutes else datetime.fromtimestamp(0, timezone.utc)
        _put(pod, "backfill_until", until.isoformat())

    unread = _unread(pod)
    res.unread = unread
    lease = _when(state.get("reading_until"))

    if unread > 0:
        if lease and lease > _now():
            res.did = "a reading pass is still going"
            save()
            return res
        # the lease ran out with the same rows still unread: the reader will never
        # claim them, so stop waiting on them and carry on loading
        if lease and unread == state.get("unread_at_lease"):
            state["stuck"] = int(state.get("stuck") or 0) + 1
        if int(state.get("stuck") or 0) < 2:
            hold(40)
            state["reading_until"] = (_now() + timedelta(minutes=READ_LEASE_MIN)).isoformat()
            state["unread_at_lease"] = unread
            res.read, res.skip, res.did = True, False, "asked for a reading pass"
            save()
            return res
    else:
        state["stuck"] = 0
    state.pop("reading_until", None)

    hold(40)
    landed = 0

    def load(name: str, payload: dict) -> None:
        # what a sync says it recorded is trusted over a count taken straight after it:
        # the rows are not always visible to a query in the same breath
        nonlocal landed
        try:
            out = pod.functions.run(name, payload).to_dict()
            landed += int((out.get("output_data") or {}).get("recorded") or 0)
        except Exception:
            pass

    if not state.get("extras"):
        if "google_calendar" in sources:
            load("sync_calendar", {
                "past_days": target, "future_days": 14, "max_events": 150, "batch_size": 10})
        if "granola" in sources:
            load("sync_granola", {"time_range": "last_30_days", "batch_size": 10})
        state["extras"] = True
        res.did = "loaded calendar and meeting notes"
    if covered < target:
        to = min(target, covered + SLICE_DAYS)
        if "gmail" in sources:
            load("sync_gmail", {
                "query": f"after:{_day(to + 1)} before:{_day(max(covered - 1, 0))} {MAIL_FILTER}",
                "max_messages": SLICE_MAX, "batch_size": 10})
        state["covered"] = res.covered = to
        res.did = (res.did + "; " if res.did else "") + f"loaded mail back to {to} days"
    elif not res.did:
        state["done"] = res.done = True
        hold(0)
        res.did = "finished"
        save()
        return res

    res.unread = max(_unread(pod), landed)
    if res.unread > 0:
        state["reading_until"] = (_now() + timedelta(minutes=READ_LEASE_MIN)).isoformat()
        state["unread_at_lease"] = res.unread
        res.read, res.skip = True, False
    save()
    return res
