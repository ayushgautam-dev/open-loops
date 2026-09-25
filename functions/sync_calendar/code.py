#input_type_name: SyncCalendarInput
#output_type_name: SyncCalendarResult
#function_name: sync_calendar

# Google Calendar -> the interaction ledger. A meeting becomes an interaction like
# anything else, so the extractor treats a call and an email the same way.
#
# The body is what we know about the meeting from the calendar alone: title, when,
# who came, the agenda if there is one. The actual notes arrive separately, from
# Granola or Meet, once the call has happened.
#
# No judgment here. Whether a meeting mattered, whether a standing series is a real
# project, whether anything was promised — all of that is read later, from the row.

from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class SyncCalendarInput(BaseModel):
    past_days: int = 30
    future_days: int = 7
    max_events: int = 120
    batch_size: int = 15


class SyncCalendarResult(BaseModel):
    fetched: int = 0
    shaped: int = 0
    recorded: int = 0
    skipped_duplicate: int = 0
    files_written: int = 0
    errors: list[str] = []


def _name_from(email: str) -> str:
    local = (email or "").split("@")[0]
    return local.replace(".", " ").replace("_", " ").title()


async def sync_calendar(ctx: FunctionContext, data: SyncCalendarInput) -> SyncCalendarResult:
    pod = Pod.from_env()
    res = SyncCalendarResult()
    me = (ctx.user_email or "").lower()
    now = datetime.now(timezone.utc)

    tmin = (now - timedelta(days=data.past_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    tmax = (now + timedelta(days=data.future_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        resp = pod.connectors.execute("google_calendar", "GOOGLECALENDAR_EVENTS_LIST", {
            "calendarId": "primary", "timeMin": tmin, "timeMax": tmax,
            "maxResults": data.max_events, "singleEvents": True, "orderBy": "startTime",
        }).to_dict()
    except Exception as exc:
        res.errors.append(str(exc)[:200])
        return res

    r = resp.get("result", resp)
    body = r.get("data", r) if isinstance(r, dict) else {}
    items = body.get("items") or r.get("items") or []
    res.fetched = len(items)

    interactions: list[dict] = []
    for ev in items:
        if ev.get("status") == "cancelled" or not ev.get("id"):
            continue
        start = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date") or ""
        if not start:
            continue

        attendees = []
        for a in (ev.get("attendees") or []):
            em = (a.get("email") or "").strip().lower()
            if not em or em == me or a.get("resource"):
                continue
            attendees.append({"email": em, "name": a.get("displayName") or _name_from(em),
                              "role": "attendee"})

        title = (ev.get("summary") or "(untitled)").strip()
        # A one-to-one is with that person. A group meeting has no single counterparty,
        # so leave it unattached rather than guessing.
        counterpart = attendees[0]["email"] if len(attendees) == 1 else ""

        lines = [f"Meeting: {title}", f"When: {start}"]
        if ev.get("location"):
            lines.append(f"Where: {ev['location']}")
        if ev.get("hangoutLink"):
            lines.append(f"Meet link: {ev['hangoutLink']}")
        if ev.get("recurringEventId"):
            lines.append("This is one occurrence of a recurring series.")
        if attendees:
            lines.append("Attendees: " + ", ".join(
                f"{a['name']} <{a['email']}>" for a in attendees[:20]))
        if (ev.get("description") or "").strip():
            lines.append("\nAgenda / description:\n" + ev["description"].strip()[:4000])

        interactions.append({
            "kind": "meeting",
            "source": "calendar",
            "external_id": f"gcal:{ev['id']}",
            "thread_ref": ev.get("recurringEventId") or f"gcal:{ev['id']}",
            "occurred_at": start,
            "subject": title,
            "body": "\n".join(lines),
            "direction": "internal",
            "addressed_to_me": True,
            "person_email": counterpart,
            "company_domain": counterpart.split("@")[-1] if "@" in counterpart else None,
            "participants": attendees,
        })

    res.shaped = len(interactions)
    for i in range(0, len(interactions), data.batch_size):
        chunk = interactions[i:i + data.batch_size]
        try:
            out = pod.functions.run("record_interaction", {"interactions": chunk}).to_dict()
        except Exception as exc:
            res.errors.append(f"batch at {i}: {str(exc)[:150]}")
            continue
        d = out.get("output_data") or {}
        res.recorded += d.get("created", 0)
        res.skipped_duplicate += d.get("skipped_duplicate", 0)
        res.files_written += d.get("files_written", 0)

    return res
