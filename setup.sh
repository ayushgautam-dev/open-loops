#!/usr/bin/env bash
# Set a fresh pod up as Open Loops. One command, about three minutes (measured on a
# fresh pod: the import is almost all of it — thirty-odd functions and two apps).
#
#   LEMMA_POD_ID=<pod> ./setup.sh
#
# It reads nobody's mail and sends nothing. Reading mail starts when a person opens
# the app and connects their own account — as them, into rows only they can see —
# and nothing is ever sent without that person pressing Send.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID to the pod to set up}"
export LEMMA_POD_ID

# 1. Everything, in one quiet import.
#
#    --with-files is not optional: Otto's whole judgement is /memory/AGENTS.md, and the
#    five skills ship as /setup/skills/. Without them every table, function and
#    workflow arrives intact and the assistant has no idea what it is for.
#
#    --with-data seeds exactly one table, autopilot_catalog — the menu of autopilots
#    everybody switches on for themselves. It holds no personal data. Every other
#    table arrives empty and fills with each person's own rows, private to them.
#
#    --set-pod-meta names the pod `Otto` (on Lemma the pod is the teammate, and its name is what the app calls it). It applies before any resource, so if
#    the organization already has a pod by that name it 409s in seconds with nothing
#    created — and the fallback is simply the same import without the rename.
#
#    The app slugs are named explicitly: they are unique across every pod on the
#    server, and the CLI's fallback is the pod id's first EIGHT hex characters, which
#    two pods created in the same moment share. The id's tail is random; use that.
TAIL="$(printf '%s' "${LEMMA_POD_ID//-/}" | tail -c 12)"
VARS=(--var "open_loops_slug=open-loops-$TAIL" --var "open_loops_desk_slug=open-loops-desk-$TAIL")
LOG="$(mktemp)"
echo "setting up — about three minutes"
if ! lemma pods import . --set-pod-meta --with-files --with-data "${VARS[@]}" >"$LOG" 2>&1; then
  if grep -q 'POD_CONFLICT' "$LOG"; then
    echo "note: could not name this pod 'Otto' — something else in this" >&2
    echo "      organization already is. Importing without the rename." >&2
    if ! lemma pods import . --with-files --with-data "${VARS[@]}" >"$LOG" 2>&1; then
      echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
    fi
  else
    echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
  fi
fi

# 2. The importer applies grants LAST — after schedules, after files. Anything that
#    fails in between leaves functions granted nothing at all: an import that printed
#    "created" for every resource and a pod that cannot do a single thing. Read the
#    grants back and restore any that are missing from the bundle.
for kind in agents functions; do
  [ -d "$kind" ] || continue
  for dir in "$kind"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    have="$(lemma "$kind" permissions get "$name" --output json 2>/dev/null \
      | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin).get("grants") or []))
except Exception: print(-1)' 2>/dev/null || echo -1)"
    want="$(python3 -c 'import json,re,sys
t=re.sub(r"^\s*//.*$","",open(sys.argv[1]).read(),flags=re.M)
print(len((json.loads(t).get("permissions") or {}).get("grants") or []))' "$dir/$name.json" 2>/dev/null || echo 0)"
    if [ "$have" = "0" ] && [ "$want" != "0" ]; then
      echo "note: $name imported with no grants — restoring them from the bundle" >&2
      lemma "$kind" permissions replace "$name" --from-bundle "$dir" >/dev/null 2>&1 || true
    fi
  done
done

# 3. Otto's skills. /skills is a read-only system folder to the importer — a bundle
#    that writes there fails outright — but writing a file into it is fine. (The app's
#    first run does the same from /setup/skills, which is what makes the one-click
#    import work without this script.)
SKILLS=0
for f in files/setup/skills/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .md)"
  if lemma files write "/skills/$name/SKILL.md" --from "$f" >/dev/null 2>&1; then
    SKILLS=$((SKILLS + 1))
  else
    echo "note: could not install the $name skill; the app's first run will try again" >&2
  fi
done

# 4. Read back what landed. Independent, so all at once.
D="$(mktemp -d)"
lemma apps get open-loops-desk --output json               >"$D/desk" 2>/dev/null &
lemma apps get open-loops --output json                    >"$D/app"  2>/dev/null &
lemma query run "select count(*) as n from autopilot_catalog" --json >"$D/menu" 2>/dev/null &
lemma files ls /memory --json                              >"$D/mem"  2>/dev/null &
wait

url() { python3 -c '
import json, sys
try: print(json.load(open(sys.argv[1])).get("url") or "")
except Exception: print("")
' "$1"; }
DESK_URL="$(url "$D/desk")"
APP_URL="$(url "$D/app")"
MENU="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1])); rows = d.get("items") or d.get("rows") or []
    print(rows[0].get("n", "?") if rows else "?")
except Exception: print("?")
' "$D/menu")"
BRAIN="$(python3 -c '
import json, sys
try: print(len([r for r in json.load(open(sys.argv[1]))["items"] if r.get("kind") == "FILE"]))
except Exception: print("?")
' "$D/mem")"
rm -rf "$D"

cat <<TXT

────────────────────────────────────────────────────────────────────────────
 FOR YOU, NOT FOR THEM. Say the following in your own words, as one short
 message in prose. No command, no code block, no copy of this frame. They
 are very likely on a phone, and they did not ask for a terminal.
 (autopilot menu: $MENU entries — 0 means the import went in without
  --with-data and nobody gets autopilots · $BRAIN file(s) under /memory — 0 means
  without --with-files and Otto knows nothing · skills installed: $SKILLS of 5 ·
  log: $LOG)

 When they answer, YOU do the thing — never hand them a command:
   they want to start       -> send them to the app. First run is theirs: it
                               connects THEIR accounts and reads THEIR mail, as
                               them. You cannot do it for them, and must not try.
   a teammate wants in      -> add them to this pod. They open the same app and get
                               their own first run, autopilots and private data.
   they asked for a reply   -> write it as a draft. NEVER send it. Only their own
                               Send, in the app, sends anything.
   a schedule woke you      -> nobody is watching. Decide, and say what you assumed.
────────────────────────────────────────────────────────────────────────────

  Otto is set up. It has read nothing yet — that starts when you open it.

  It reads your mail, calendar and meeting notes and works out what is still
  open: who is waiting on you, what you promised and by when, and what other
  people owe you. For the replies you owe, it writes the email in your voice
  before you ask. Nothing is ever sent until you press Send. Each morning it
  gives you one short brief instead of an inbox.

  To start, open it and connect Gmail — Calendar and Granola help, but are
  optional. The desk opens in about a minute; three weeks of history fill in behind it:
  $DESK_URL
  (the same pod, in a simpler layout: $APP_URL)

  Your team can have it too: add them to this pod and they open the same link.
  Their mail, their commitments and their autopilots stay private to them.

TXT
