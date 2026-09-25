#input_type_name: WorkInput
#output_type_name: WorkResult
#function_name: ingest_work

# Deterministic writer for Work projects (recurring meetings discovered from the
# calendar). Upserts by title so re-runs refresh the rolling status instead of
# duplicating.

from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class ProjectIn(BaseModel):
    title: str
    attendees: list[str] = Field(default_factory=list)
    cadence: str | None = None
    stands: str | None = None
    since_last: str | None = None
    last_met_at: str | None = None
    decisions: list[str] = Field(default_factory=list)


class WorkInput(BaseModel):
    projects: list[ProjectIn] = Field(default_factory=list)


class WorkResult(BaseModel):
    created: int = 0
    updated: int = 0


async def ingest_work(ctx: FunctionContext, data: WorkInput) -> WorkResult:
    pod = Pod.from_env()
    res = WorkResult()
    existing = {r["title"].strip().lower(): r["id"]
                for r in pod.query("select id, title from work_projects").to_dict()["items"]}
    for p in data.projects:
        payload = {"title": p.title, "attendees": p.attendees, "archived": False}
        if p.cadence: payload["cadence"] = p.cadence
        if p.stands: payload["stands"] = p.stands
        if p.since_last: payload["since_last"] = p.since_last
        if p.last_met_at: payload["last_met_at"] = p.last_met_at
        if p.decisions: payload["decisions"] = [{"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "text": d} for d in p.decisions]
        key = p.title.strip().lower()
        if key in existing:
            pod.table("work_projects").update(existing[key], payload)
            res.updated += 1
        else:
            row = pod.table("work_projects").create(payload)
            existing[key] = row["id"]
            res.created += 1
    return WorkResult(created=res.created, updated=res.updated)
