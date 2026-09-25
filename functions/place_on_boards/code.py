#input_type_name: BoardInput
#output_type_name: BoardResult
#function_name: place_on_boards

# Deterministic writer for board cards + per-track signals. The board_curator agent
# does the judgment (which stage, which anomaly); this resolves natural keys to FKs,
# upserts cards (one per counterparty+track), only advances a card's stage forward,
# stamps the move reason + days-in-stage clock, and replaces the live signals.

from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class CardIn(BaseModel):
    track_slug: str
    subject_type: str                 # person | company
    person_email: str | None = None
    company_domain: str | None = None
    stage_name: str
    reason: str | None = None


class SignalIn(BaseModel):
    track_slug: str
    fact: str
    why: str | None = None
    arithmetic: str | None = None
    action_label: str | None = None
    person_email: str | None = None
    company_domain: str | None = None


class BoardInput(BaseModel):
    cards: list[CardIn] = Field(default_factory=list)
    signals: list[SignalIn] = Field(default_factory=list)
    replace_signals: bool = True


class BoardResult(BaseModel):
    cards_created: int = 0
    cards_moved: int = 0
    signals_created: int = 0
    notes: list[str] = Field(default_factory=list)


def _dom(d: str | None) -> str:
    d = (d or "").strip().lower()
    return (d.split("@")[-1] if "@" in d else d).lstrip("www.")


async def place_on_boards(ctx: FunctionContext, data: BoardInput) -> BoardResult:
    pod = Pod.from_env()
    res = BoardResult()
    rows = lambda q: pod.query(q).to_dict()["items"]

    track_by_slug = {r["slug"]: r["id"] for r in rows("select id, slug from tracks")}
    people = {r["email"]: r["id"] for r in rows("select id, email from people where email is not null")}
    companies = {r["domain"]: r["id"] for r in rows("select id, domain from companies where domain is not null")}
    stages_by_track: dict[str, dict] = {}
    stage_pos: dict[str, int] = {}
    for r in rows("select id, track_id, name, position from stages"):
        stages_by_track.setdefault(r["track_id"], {})[r["name"].lower()] = r["id"]
        stage_pos[r["id"]] = r["position"]

    existing: dict[tuple, dict] = {}
    for r in rows("select id, track_id, person_id, company_id, stage_id from board_cards"):
        key = (r["track_id"], r.get("person_id") or r.get("company_id"))
        existing[key] = r

    now = datetime.now(timezone.utc).isoformat()
    for c in data.cards:
        tid = track_by_slug.get(c.track_slug)
        if not tid:
            res.notes.append(f"unknown track {c.track_slug}"); continue
        subj_id = people.get((c.person_email or "").lower()) if c.subject_type == "person" else companies.get(_dom(c.company_domain))
        if not subj_id:
            res.notes.append(f"unknown subject for {c.track_slug} card"); continue
        stage_id = stages_by_track.get(tid, {}).get(c.stage_name.lower())
        if not stage_id:
            res.notes.append(f"unknown stage {c.stage_name} in {c.track_slug}"); continue
        key = (tid, subj_id)
        payload = {
            "track_id": tid, "subject_type": c.subject_type, "stage_id": stage_id,
            "person_id": subj_id if c.subject_type == "person" else None,
            "company_id": subj_id if c.subject_type == "company" else None,
            "entered_stage_at": now, "last_move_reason": c.reason or "Placed by extraction",
        }
        if key in existing:
            cur = existing[key]
            # only advance forward; never regress automatically
            if cur.get("stage_id") != stage_id and stage_pos.get(stage_id, 0) > stage_pos.get(cur.get("stage_id"), -1):
                pod.table("board_cards").update(cur["id"], {"stage_id": stage_id, "entered_stage_at": now, "last_move_reason": c.reason or "Advanced"})
                res.cards_moved += 1
        else:
            row = pod.table("board_cards").create(payload)
            existing[key] = {"id": row["id"], "stage_id": stage_id, **payload}
            res.cards_created += 1

    if data.replace_signals and data.signals:
        tracks_touched = {track_by_slug[s.track_slug] for s in data.signals if s.track_slug in track_by_slug}
        for tid in tracks_touched:
            for r in rows(f"select id from signals where track_id='{tid}' and dismissed=false"):
                pod.table("signals").delete(r["id"])
    for s in data.signals:
        tid = track_by_slug.get(s.track_slug)
        if not tid:
            continue
        payload = {"track_id": tid, "fact": s.fact, "dismissed": False}
        if s.why: payload["why"] = s.why
        if s.arithmetic: payload["arithmetic"] = s.arithmetic
        if s.action_label: payload["action_label"] = s.action_label
        pid = people.get((s.person_email or "").lower()) if s.person_email else None
        if pid: payload["person_id"] = pid
        cid = companies.get(_dom(s.company_domain)) if s.company_domain else None
        if cid: payload["company_id"] = cid
        pod.table("signals").create(payload)
        res.signals_created += 1

    pod.table("activity_events").create({
        "icon": "▦", "what": f"Boards updated — {res.cards_created} placed, {res.cards_moved} moved",
        "reason": f"{res.signals_created} signals refreshed across tracks.", "happened_at": now,
    })
    return res
