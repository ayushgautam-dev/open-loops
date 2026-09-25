#input_type_name: TidyTimelineInput
#output_type_name: TidyTimelineResult

#function_name: tidy_timeline

import re
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# A timeline earns its place by reminding you of something before a call.
# v1 wrote a row per interaction and then re-extracted, so one coffee became four
# rows and a single day carried the same sentence three times over.
#
# Two narrow rules, both conservative, because deleting history is not reversible:
#   1. Same person, same day, same event  -> keep the fullest row, drop the rest.
#   2. Pure scheduling logistics          -> drop, but only when the meeting itself
#                                            is already on the timeline that day.

_STOP = {
    "the","a","an","and","or","to","for","of","on","in","with","from","at","by",
    "is","are","be","was","were","his","her","their","our","my","your","you","we",
    "it","that","this","as","so","but","has","have","had","will","would","about",
    "call","meeting","meet",
}

_LOGISTICS = re.compile(
    r"(proposed \d|lined up for today|planned for today|does \d|invite sent|"
    r"sending an invite|reschedul|moved to|moved us|time still to confirm|"
    r"accepted the invite|declined the invite|tentative|calendar invite)",
    re.I,
)


class TidyTimelineInput(BaseModel):
    dry_run: bool = False
    person_id: str | None = None


class Dropped(BaseModel):
    kept: str
    removed: str
    why: str


class TidyTimelineResult(BaseModel):
    scanned: int = 0
    merged: int = 0
    logistics_removed: int = 0
    dropped: list[Dropped] = Field(default_factory=list)
    note: str = ""


def _words(text):
    toks = re.findall(r"[a-z0-9']+", (text or "").lower())
    return {t for t in toks if t not in _STOP and len(t) > 2}


def _same_event(a, b):
    qa = (a.get("quote") or "").strip().lower()
    qb = (b.get("quote") or "").strip().lower()
    if qa and qa == qb:
        return True                      # the same sentence quoted twice
    wa, wb = _words(a.get("title", "")), _words(b.get("title", ""))
    if not wa or not wb:
        return False
    overlap = len(wa & wb) / min(len(wa), len(wb))
    return overlap >= 0.6


async def tidy_timeline(ctx: FunctionContext, data: TidyTimelineInput) -> TidyTimelineResult:
    pod = Pod.from_env()
    res = TidyTimelineResult()

    where = "where person_id is not null"
    if data.person_id:
        where += f" and person_id = '{data.person_id}'"

    rows = pod.query(
        "select id, person_id, type, title, quote, happened_at, source "
        f"from timeline_events {where} "
        "order by person_id, happened_at desc nulls last"
    ).to_dict()["items"]
    res.scanned = len(rows)

    # bucket by person + calendar day
    buckets = {}
    for r in rows:
        day = (r.get("happened_at") or "")[:10]
        buckets.setdefault((r.get("person_id"), day), []).append(r)

    doomed = []

    for _key, group in buckets.items():
        if len(group) < 2:
            continue

        # 1. merge duplicates — the longest title carries the most information
        group = sorted(group, key=lambda r: len(r.get("title") or ""), reverse=True)
        survivors = []
        for r in group:
            twin = next((s for s in survivors if _same_event(s, r)), None)
            if twin is None:
                survivors.append(r)
            else:
                doomed.append((twin, r, "the same thing is already recorded that day"))

        # 2. drop logistics once the event itself is present
        real = [s for s in survivors if not _LOGISTICS.search(s.get("title") or "")]
        if real:
            for s in survivors:
                if _LOGISTICS.search(s.get("title") or ""):
                    doomed.append((real[0], s, "arranging the meeting, not the meeting"))

    for keep, drop, why in doomed:
        if why.startswith("arranging"):
            res.logistics_removed += 1
        else:
            res.merged += 1
        res.dropped.append(Dropped(
            kept=(keep.get("title") or "")[:90],
            removed=(drop.get("title") or "")[:90],
            why=why,
        ))
        if not data.dry_run:
            pod.records.delete("timeline_events", drop["id"])

    res.note = (
        f"{res.scanned} entries, {res.merged} said the same thing twice, "
        f"{res.logistics_removed} were only arranging a meeting."
        + (" (dry run — nothing was changed.)" if data.dry_run else "")
    )
    return res
