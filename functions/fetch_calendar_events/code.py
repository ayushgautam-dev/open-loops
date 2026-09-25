#input_type_name: FetchCalendarInput
#output_type_name: FetchCalendarResult
#function_name: fetch_calendar_events

# Deterministic Google Calendar pull. Returns a compact digest of recent + upcoming
# events (title, times, attendees, recurrence, meet link) plus recurring-series groups
# that are candidate Work projects. No judgment here — fetch + shape.

import re
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class FetchCalendarInput(BaseModel):
    past_days: int = 30
    future_days: int = 14
    max_events: int = 120


class Attendee(BaseModel):
    email: str
    name: str = ""


class EventOut(BaseModel):
    id: str
    title: str
    start: str
    end: str
    is_past: bool
    is_recurring: bool
    recurring_id: str = ""
    attendees: list[Attendee] = Field(default_factory=list)
    meet_link: str = ""


class SeriesOut(BaseModel):
    title: str
    occurrences: int
    attendees: list[str]
    last_at: str
    cadence: str


class FetchCalendarResult(BaseModel):
    my_email: str
    event_count: int
    events: list[EventOut]
    recurring_series: list[SeriesOut]


def _name_from(email: str) -> str:
    local = email.split("@")[0]
    return re.sub(r"[._]+", " ", local).title()


async def fetch_calendar_events(ctx: FunctionContext, data: FetchCalendarInput) -> FetchCalendarResult:
    pod = Pod.from_env()
    me = (ctx.user_email or "").lower()
    now = datetime.now(timezone.utc)
    tmin = (now - timedelta(days=data.past_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    tmax = (now + timedelta(days=data.future_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    resp = pod.connectors.execute("google_calendar", "GOOGLECALENDAR_EVENTS_LIST", {
        "calendarId": "primary", "timeMin": tmin, "timeMax": tmax,
        "maxResults": data.max_events, "singleEvents": True, "orderBy": "startTime",
    }).to_dict()
    r = resp.get("result", resp)
    body = r.get("data", r) if isinstance(r, dict) else {}
    items = body.get("items") or r.get("items") or []

    events: list[EventOut] = []
    series: dict[str, dict] = defaultdict(lambda: {"title": "", "occ": 0, "att": set(), "last": ""})
    for ev in items:
        if ev.get("status") == "cancelled":
            continue
        start = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date") or ""
        end = (ev.get("end") or {}).get("dateTime") or (ev.get("end") or {}).get("date") or ""
        atts = []
        for a in (ev.get("attendees") or []):
            em = (a.get("email") or "").lower()
            if not em or em == me or a.get("resource"):
                continue
            atts.append(Attendee(email=em, name=a.get("displayName") or _name_from(em)))
        rec_id = ev.get("recurringEventId") or ""
        title = (ev.get("summary") or "(untitled)").strip()
        is_past = start[:10] < now.strftime("%Y-%m-%d") if start else False
        events.append(EventOut(
            id=ev.get("id", ""), title=title, start=start, end=end, is_past=is_past,
            is_recurring=bool(rec_id), recurring_id=rec_id, attendees=atts,
            meet_link=ev.get("hangoutLink") or "",
        ))
        # group recurring series by title (stable attendee set → Work project candidate)
        if rec_id or True:
            key = title.lower()
            s = series[key]
            s["title"] = title
            s["occ"] += 1
            for a in atts:
                s["att"].add(a.email)
            if start > s["last"]:
                s["last"] = start

    recurring = []
    for s in series.values():
        if s["occ"] >= 2 and s["att"]:            # repeats, with a stable other-party set
            recurring.append(SeriesOut(
                title=s["title"], occurrences=s["occ"], attendees=sorted(s["att"])[:8],
                last_at=s["last"], cadence="weekly" if s["occ"] >= 3 else "recurring",
            ))

    return FetchCalendarResult(
        my_email=me, event_count=len(events), events=events[: data.max_events],
        recurring_series=recurring,
    )
