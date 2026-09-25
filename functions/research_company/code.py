#input_type_name: ResearchCompanyInput
#output_type_name: ResearchCompanyResult
#function_name: research_company

# What is this company, from its domain alone.
#
# The company half of `research_person`, callable on its own — useful from the
# chat ("@researcher brief me on them") and for a company record you opened
# directly. Writes prose to `companies.research`.

import json
import urllib.error
import urllib.request

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

DEFAULT_BASE = "https://api.monid.ai"
DEFAULT_COMPANY_PATH = "/v1/enrich/company"
TIMEOUT = 25


class ResearchCompanyInput(BaseModel):
    company_id: str = ""
    domain: str = ""
    force: bool = False


class ResearchCompanyResult(BaseModel):
    ok: bool = False
    company: str = ""
    wrote: bool = False
    skipped_reason: str = ""
    research: str = ""
    errors: list[str] = []


def _web_lines(pod: Pod, domain: str, name: str, res) -> list[str]:
    """No research key? Lemma's own web search needs no credential.

    Rougher than the provider — prose and links instead of structured fields —
    but it means skipping the key costs a sharper answer rather than the feature.
    """
    query = f"{name or domain} company what they do".strip()
    try:
        found = pod.tools.web_search(query, max_results=5).to_dict()
    except Exception as exc:
        res.errors.append(f"web search: {str(exc)[:120]}")
        return []
    if found.get("error"):
        res.errors.append(f"web search: {str(found['error'])[:120]}")
        return []
    out: list[str] = []
    for item in (found.get("results") or [])[:5]:
        if not isinstance(item, dict):
            continue
        snippet = (item.get("snippet") or item.get("title") or "").strip()
        if not snippet:
            continue
        url = (item.get("url") or "").strip()
        out.append(f"- {snippet[:240]}" + (f" ([source]({url}))" if url else ""))
    return out


def _setting(pod: Pod, key: str, default: str = "") -> str:
    try:
        rows = pod.query(
            f"select value from settings where key='{key}' limit 1"
        ).to_dict()["items"]
        return (rows[0].get("value") or "").strip() if rows else default
    except Exception:
        return default


def _flatten(obj, depth: int = 0) -> list[str]:
    out: list[str] = []
    if depth > 3:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_") or k in {"id", "raw", "request_id"}:
                continue
            if isinstance(v, (str, int, float)) and str(v).strip():
                text = str(v).strip()
                if len(text) > 400:
                    text = text[:400] + "…"
                out.append(f"**{k.replace('_', ' ').capitalize()}:** {text}")
            elif isinstance(v, (dict, list)):
                out.extend(_flatten(v, depth + 1))
    elif isinstance(obj, list):
        for item in obj[:5]:
            out.extend(_flatten(item, depth + 1))
    return out


async def research_company(ctx: FunctionContext, data: ResearchCompanyInput) -> ResearchCompanyResult:
    pod = Pod.from_env()
    res = ResearchCompanyResult()

    row = None
    if data.company_id:
        rows = pod.query(
            "select id, name, domain, research from companies "
            f"where id = '{data.company_id}' limit 1"
        ).to_dict()["items"]
        row = rows[0] if rows else None
    elif data.domain:
        rows = pod.query(
            "select id, name, domain, research from companies "
            f"where lower(domain) = '{data.domain.lower()}' limit 1"
        ).to_dict()["items"]
        row = rows[0] if rows else None

    domain = (data.domain or (row or {}).get("domain") or "").strip().lower()
    if not domain:
        res.skipped_reason = "no domain to look up"
        return res
    res.company = (row or {}).get("name") or domain

    if row and row.get("research") and not data.force:
        res.ok = True
        res.research = row["research"]
        res.skipped_reason = "already researched"
        return res

    # No key is a normal state: fall back to web search rather than giving up.
    key = _setting(pod, "research_api_key")
    if not key:
        lines = _web_lines(pod, domain, (row or {}).get("name") or "", res)
        if not lines:
            res.skipped_reason = "nothing returned"
            return res
        research = "\n".join(lines[:12])[:4000]
        if row and row.get("id"):
            pod.records.update("companies", row["id"], {"research": research})
        res.ok = True
        res.wrote = bool(row and row.get("id"))
        res.research = research
        return res

    base = _setting(pod, "research_api_base", DEFAULT_BASE).rstrip("/")
    path = _setting(pod, "research_company_path", DEFAULT_COMPANY_PATH)

    try:
        req = urllib.request.Request(
            f"{base}{path}",
            data=json.dumps({"domain": domain}).encode(),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        res.errors.append(f"company lookup {exc.code}")
        res.skipped_reason = "lookup failed"
        return res
    except Exception as exc:
        res.errors.append(str(exc)[:150])
        res.skipped_reason = "lookup failed"
        return res

    lines = _flatten(body.get("data", body))
    if not lines:
        res.skipped_reason = "nothing returned"
        return res

    research = "\n".join(lines[:12])[:4000]
    if row and row.get("id"):
        pod.records.update("companies", row["id"], {"research": research})
        res.wrote = True
    res.ok = True
    res.research = research
    return res
