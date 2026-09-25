#input_type_name: MarkInput
#output_type_name: MarkResult
#function_name: mark_extracted

# Closes the loop on extraction: stamps which rows have been read and by which
# version of the extractor, and stores the one-line summary the agent wrote.
#
# The version stamp is what makes re-extraction possible. When the extractor gets
# better, rows carrying an older version can be fed back through it, so history
# improves instead of staying frozen at whatever quality we had the day we read it.

from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class MarkItem(BaseModel):
    id: str
    summary: str | None = None


class MarkInput(BaseModel):
    items: list[MarkItem] = Field(default_factory=list)
    version: str = "v1"


class MarkResult(BaseModel):
    marked: int = 0
    errors: list[str] = Field(default_factory=list)


async def mark_extracted(ctx: FunctionContext, data: MarkInput) -> MarkResult:
    pod = Pod.from_env()
    res = MarkResult()
    now = datetime.now(timezone.utc).isoformat()

    for item in data.items:
        payload: dict = {"extracted_at": now, "extractor_version": data.version[:40]}
        if item.summary:
            payload["summary"] = item.summary.strip()[:1000]
        try:
            pod.records.update("interactions", item.id, payload)
            res.marked += 1
        except Exception as exc:
            res.errors.append(f"{item.id[:8]}: {str(exc)[:100]}")
    return res
