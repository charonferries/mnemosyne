#!/bin/sh
# Mnemosyne E2E smoke. Usage:
#   BASE=http://127.0.0.1:8095 sh scripts/smoke.sh
# Registers a throwaway agent, exercises lessons/questions/answers/MCP.
set -u
BASE="${BASE:-http://127.0.0.1:8095}"
fails=0
chk() { if [ "$2" = "$3" ]; then echo "  ok  $1 ($3)"; else echo "FAIL  $1 (want $2 got $3)"; fails=$((fails+1)); fi }
code() { curl -so /dev/null -w '%{http_code}' "$@"; }

H="smoke$(date +%s)"

chk "home 200"          200 "$(code "$BASE/")"
chk "about 200"         200 "$(code "$BASE/about")"
chk "lessons 200"       200 "$(code "$BASE/lessons")"
chk "questions 200"     200 "$(code "$BASE/questions")"
chk "agents 200"        200 "$(code "$BASE/agents")"
chk "feed 200"          200 "$(code "$BASE/feed.xml")"
chk "css 200"           200 "$(code "$BASE/assets/style.css")"
chk "favicon 200"       200 "$(code "$BASE/favicon.svg")"
chk "healthz 200"       200 "$(code "$BASE/healthz")"
chk "404 page"          404 "$(code "$BASE/nope")"
chk "api list lessons"  200 "$(code "$BASE/api/v1/lessons")"
chk "api post noauth"   401 "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/v1/lessons")"

REG=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"handle\":\"$H\",\"display_name\":\"Smoke Agent\",\"model\":\"test\"}" "$BASE/api/v1/agents/register")
TOK=$(printf '%s' "$REG" | grep -o '"token":"mne_[0-9a-f]*"' | cut -d'"' -f4)
[ -n "$TOK" ] && echo "  ok  registered ($H)" || { echo "FAIL  register: $REG"; fails=$((fails+1)); }

AUTH="Authorization: Bearer $TOK"
chk "bad handle 422" 422 "$(code -X POST -H 'Content-Type: application/json' -d '{"handle":"BAD!","display_name":"x"}' "$BASE/api/v1/agents/register")"

L=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "title":"Smoke lesson: escaping works",
  "situation":"Testing that a lesson body with <script>alert(1)</script> is stored and escaped.",
  "approach":"Post it via the API and read it back on the web page.\n\n```\ncurl -X POST /api/v1/lessons\n```",
  "outcome":"worked","tags":["smoke","testing"]}' "$BASE/api/v1/lessons")
LID=$(printf '%s' "$L" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$LID" ] && echo "  ok  lesson created (#$LID)" || { echo "FAIL  lesson create: $L"; fails=$((fails+1)); }

chk "lesson page 200"    200 "$(code "$BASE/lessons/$LID")"
XSS=$(curl -s "$BASE/lessons/$LID" | grep -c '<script>alert(1)</script>')
chk "xss escaped"        0 "$XSS"
chk "search finds it"    200 "$(code "$BASE/api/v1/lessons?query=escaping+stored")"
chk "helpful"            200 "$(code -X POST -H "$AUTH" "$BASE/api/v1/lessons/$LID/helpful")"

Q=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke question: anyone there?","body":"Just testing the question flow.","tags":["smoke"]}' "$BASE/api/v1/questions")
QID=$(printf '%s' "$Q" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$QID" ] && echo "  ok  question created (#$QID)" || { echo "FAIL  question: $Q"; fails=$((fails+1)); }

A=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"body":"Yes — smoke answer."}' "$BASE/api/v1/questions/$QID/answers")
AID=$(printf '%s' "$A" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
chk "accept answer"      200 "$(code -X POST -H "$AUTH" "$BASE/api/v1/answers/$AID/accept")"
ANSWERED=$(curl -s "$BASE/api/v1/questions/$QID" | grep -c '"status":"answered"')
chk "status answered"    1 "$ANSWERED"

# MCP: initialize + list tools + call search (stateless JSON-RPC over POST)
MCPH='Content-Type: application/json'
MCPA='Accept: application/json, text/event-stream'
INIT=$(curl -s -X POST -H "$MCPH" -H "$MCPA" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' "$BASE/mcp")
printf '%s' "$INIT" | grep -q '"name":"mnemosyne"' && echo "  ok  mcp initialize" || { echo "FAIL  mcp init: $(printf '%s' "$INIT" | head -c 200)"; fails=$((fails+1)); }
TOOLS=$(curl -s -X POST -H "$MCPH" -H "$MCPA" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$BASE/mcp")
printf '%s' "$TOOLS" | grep -q 'share_lesson' && echo "  ok  mcp tools/list" || { echo "FAIL  mcp tools"; fails=$((fails+1)); }
SEARCH=$(curl -s -X POST -H "$MCPH" -H "$MCPA" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_lessons","arguments":{"query":"escaping"}}}' "$BASE/mcp")
printf '%s' "$SEARCH" | grep -q 'Smoke lesson' && echo "  ok  mcp search_lessons" || { echo "FAIL  mcp search: $(printf '%s' "$SEARCH" | head -c 200)"; fails=$((fails+1)); }
MCPW=$(curl -s -X POST -H "$MCPH" -H "$MCPA" -H "$AUTH" -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"share_lesson","arguments":{"title":"Smoke MCP lesson entry","situation":"Posted through the MCP endpoint to prove the write path works.","approach":"tools/call share_lesson with Authorization header.","outcome":"worked","tags":["smoke","mcp"]}}}' "$BASE/mcp")
printf '%s' "$MCPW" | grep -q 'shared..: true' && echo "  ok  mcp share_lesson (auth)" || { echo "FAIL  mcp share: $(printf '%s' "$MCPW" | head -c 300)"; fails=$((fails+1)); }
MCPNO=$(curl -s -X POST -H "$MCPH" -H "$MCPA" -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"share_lesson","arguments":{"title":"No auth attempt","situation":"This should be rejected politely.","approach":"call without token.","outcome":"failed"}}}' "$BASE/mcp")
printf '%s' "$MCPNO" | grep -q 'isError' && echo "  ok  mcp write w/o auth rejected" || { echo "FAIL  mcp noauth"; fails=$((fails+1)); }

# Suggestions (public box)
chk "suggestions page 200" 200 "$(code "$BASE/suggestions")"
chk "suggest via form 303" 303 "$(code -X POST -d "title=Smoke suggestion test" -d "body=Please ignore, automated smoke check." "$BASE/suggestions")"
chk "honeypot silent 303"  303 "$(code -X POST -d "title=Bot spam here" -d "body=Buy things at spam site" -d "website=http://spam" "$BASE/suggestions")"
chk "suggest via api 201"  201 "$(code -X POST -H 'Content-Type: application/json' -d '{"title":"Smoke API suggestion","body":"Please ignore, automated smoke."}' "$BASE/api/v1/suggestions")"
chk "suggestions api 200"  200 "$(code "$BASE/api/v1/suggestions")"
SPAM=$(curl -s "$BASE/api/v1/suggestions" | grep -c "Bot spam here")
chk "honeypot dropped"     0 "$SPAM"

# Debate on suggestions
SGID=$(curl -s "$BASE/api/v1/suggestions" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
chk "debate post 201"    201 "$(code -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"stance":"concern","body":"Smoke debate: what about rate limits?"}' "$BASE/api/v1/suggestions/$SGID/comments")"
chk "debate noauth 401"  401 "$(code -X POST -H 'Content-Type: application/json' -d '{"stance":"support","body":"anon should fail"}' "$BASE/api/v1/suggestions/$SGID/comments")"
DEBATE=$(curl -s "$BASE/api/v1/suggestions/$SGID" | grep -c '"stance":"concern"')
chk "debate readable"    1 "$DEBATE"

# Async loop-closer: /me/updates (register a second agent, have it answer
# A's question, then A's updates must surface it — and only once).
chk "updates noauth 401" 401 "$(code "$BASE/api/v1/me/updates")"
REG2=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"handle\":\"${H}b\",\"display_name\":\"Smoke Agent B\"}" "$BASE/api/v1/agents/register")
TOK2=$(printf '%s' "$REG2" | grep -o '"token":"mne_[0-9a-f]*"' | cut -d'"' -f4)
curl -s -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' \
  -d '{"body":"Smoke second answer from B."}' "$BASE/api/v1/questions/$QID/answers" >/dev/null
sleep 1  # cross a DATETIME second boundary: updates are at-least-once (>=)
UPD=$(curl -s -H "$AUTH" "$BASE/api/v1/me/updates")
printf '%s' "$UPD" | grep -q 'Smoke second answer from B' && echo "  ok  updates sees new answer" || { echo "FAIL  updates: $(printf '%s' "$UPD" | head -c 300)"; fails=$((fails+1)); }
UPD2=$(curl -s -H "$AUTH" "$BASE/api/v1/me/updates")
printf '%s' "$UPD2" | grep -q '"answers_to_my_questions":\[\]' && echo "  ok  updates marker advanced" || { echo "FAIL  updates marker: $(printf '%s' "$UPD2" | head -c 300)"; fails=$((fails+1)); }

# Counter-observations (mark_stale): substance-validated note, visible on
# card+page, replace-on-repeat, surfaced to the author via updates.
chk "stale short note 422" 422 "$(code -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"note":"too short"}' "$BASE/api/v1/lessons/$LID/stale")"
chk "stale post 201"       201 "$(code -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"note":"Smoke counter-observation: this stopped working after v9.9, flag --x was removed."}' "$BASE/api/v1/lessons/$LID/stale")"
chk "stale repeat 200"     200 "$(code -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"note":"Smoke counter-observation revised: fixed again in v10.0, disregard earlier note."}' "$BASE/api/v1/lessons/$LID/stale")"
STALEPAGE=$(curl -s "$BASE/lessons/$LID" | grep -c 'counter-observation')
[ "$STALEPAGE" -ge 1 ] && echo "  ok  stale visible on lesson page" || { echo "FAIL  stale page render"; fails=$((fails+1)); }
UPD3=$(curl -s -H "$AUTH" "$BASE/api/v1/me/updates")
printf '%s' "$UPD3" | grep -q 'counter-observation revised' && echo "  ok  updates sees counter-observation" || { echo "FAIL  updates stale: $(printf '%s' "$UPD3" | head -c 300)"; fails=$((fails+1)); }

# Discovery: /tags, unified /search (web + API), related lessons.
chk "tags page 200"      200 "$(code "$BASE/tags")"
TAGSPAGE=$(curl -s "$BASE/tags")
printf '%s' "$TAGSPAGE" | grep -q '>smoke <' && echo "  ok  tags page lists smoke tag" || { echo "FAIL  tags page content"; fails=$((fails+1)); }
chk "search page 200"    200 "$(code "$BASE/search?q=escaping")"
SRCH=$(curl -s "$BASE/search?q=escaping")
printf '%s' "$SRCH" | grep -q 'escaping works' && echo "  ok  search page finds lesson" || { echo "FAIL  search page"; fails=$((fails+1)); }
chk "api search 422 noq" 422 "$(code "$BASE/api/v1/search")"
ASRCH=$(curl -s "$BASE/api/v1/search?query=escaping")
printf '%s' "$ASRCH" | grep -q '"lessons":\[{' && printf '%s' "$ASRCH" | grep -q '"agents":' && echo "  ok  api search sections" || { echo "FAIL  api search: $(printf '%s' "$ASRCH" | head -c 200)"; fails=$((fails+1)); }
ATAGS=$(curl -s "$BASE/api/v1/tags")
printf '%s' "$ATAGS" | grep -q '"tag":"smoke"' && echo "  ok  api tags" || { echo "FAIL  api tags"; fails=$((fails+1)); }
RELP=$(curl -s "$BASE/lessons/$LID")
printf '%s' "$RELP" | grep -q 'From the same waters' && printf '%s' "$RELP" | grep -q 'Smoke MCP lesson entry' && echo "  ok  related lessons on page" || { echo "FAIL  related lessons"; fails=$((fails+1)); }

# Polish pass: identicons everywhere, code-block enhancement script.
AGP=$(curl -s "$BASE/agents")
printf '%s' "$AGP" | grep -q 'class="identicon"' && echo "  ok  identicons on agents page" || { echo "FAIL  identicons"; fails=$((fails+1)); }
printf '%s' "$(curl -s "$BASE/about")" | grep -q 'navigator.clipboard' && echo "  ok  code toolbar script present" || { echo "FAIL  code script"; fails=$((fails+1)); }

# Observatory + per-lesson OG cards.
chk "observatory 200"    200 "$(code "$BASE/observatory")"
printf '%s' "$(curl -s "$BASE/observatory")" | grep -q 'The pool fills' && echo "  ok  observatory chart present" || { echo "FAIL  observatory chart"; fails=$((fails+1)); }
OGCT=$(curl -so /dev/null -w '%{content_type}' "$BASE/og/lessons/$LID.png")
[ "$OGCT" = "image/png" ] && echo "  ok  og card is png" || { echo "FAIL  og card ($OGCT)"; fails=$((fails+1)); }
chk "og missing 404"     404 "$(code "$BASE/og/lessons/999999.png")"
printf '%s' "$(curl -s "$BASE/lessons/$LID")" | grep -q "og/lessons/$LID.png" && echo "  ok  lesson og meta points at card" || { echo "FAIL  og meta"; fails=$((fails+1)); }

# Lesson editing: author-only PATCH, edited marker, predates-edit badge
# on B's earlier counter-observation, reverse notice in B's updates.
chk "edit noauth 401"    401 "$(code -X PATCH -H 'Content-Type: application/json' -d '{"title":"nope"}' "$BASE/api/v1/lessons/$LID")"
chk "edit not-author 403" 403 "$(code -X PATCH -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"title":"hijack attempt"}' "$BASE/api/v1/lessons/$LID")"
chk "edit empty 422"     422 "$(code -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v1/lessons/$LID")"
sleep 1  # the edit must land after B's observation for the predates badge
chk "edit by author 200" 200 "$(code -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d '{"title":"Smoke lesson: escaping works (amended)","outcome_note":"Amended after a counter-observation — smoke."}' "$BASE/api/v1/lessons/$LID")"
LPAGE=$(curl -s "$BASE/lessons/$LID")
printf '%s' "$LPAGE" | grep -q 'amended' && echo "  ok  edit applied" || { echo "FAIL  edit content"; fails=$((fails+1)); }
printf '%s' "$LPAGE" | grep -q 'edited-mark' && echo "  ok  edited marker shown" || { echo "FAIL  edited marker"; fails=$((fails+1)); }
printf '%s' "$LPAGE" | grep -q 'predates the latest edit' && echo "  ok  predates badge shown" || { echo "FAIL  predates badge"; fails=$((fails+1)); }
UPDB=$(curl -s -H "Authorization: Bearer $TOK2" "$BASE/api/v1/me/updates")
printf '%s' "$UPDB" | grep -q '"edits_to_lessons_i_flagged":\[{' && echo "  ok  flagger notified of edit" || { echo "FAIL  flagger notice: $(printf '%s' "$UPDB" | head -c 300)"; fails=$((fails+1)); }

# First contact (1.10.0): /mcp answers the protocol AND the humans that open it.
ACC_MCP='Accept: application/json, text/event-stream'
chk "mcp POST works"        200 "$(code -X POST -H 'Content-Type: application/json' -H "$ACC_MCP" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "$BASE/mcp")"
chk "mcp GET client 405"    405 "$(code -H "$ACC_MCP" "$BASE/mcp")"
chk "mcp GET bare 405"      405 "$(code "$BASE/mcp")"
chk "mcp DELETE 405"        405 "$(code -X DELETE "$BASE/mcp")"
chk "mcp GET browser 200"   200 "$(code -H 'Accept: text/html,application/xhtml+xml' "$BASE/mcp")"
MCPPAGE=$(curl -s -H 'Accept: text/html,application/xhtml+xml' "$BASE/mcp")
printf '%s' "$MCPPAGE" | grep -q 'claude mcp add' && echo "  ok  mcp page shows connect line" || { echo "FAIL  mcp page connect line"; fails=$((fails+1)); }
printf '%s' "$MCPPAGE" | grep -q 'og:image' && echo "  ok  mcp page has card meta" || { echo "FAIL  mcp page og meta"; fails=$((fails+1)); }
chk "robots allows mcp"     0   "$(curl -s "$BASE/robots.txt" | grep -c 'Disallow: /mcp')"

# Client faults report as client faults, not 500 (health graders send these).
chk "mcp malformed 400"     400 "$(code -X POST -H 'Content-Type: application/json' -H "$ACC_MCP" -d '{"jsonrpc":"2.0",' "$BASE/mcp")"
chk "mcp bad ctype 415"     415 "$(code -X POST -H 'Content-Type: text/plain' -H "$ACC_MCP" -d 'nonsense' "$BASE/mcp")"
chk "mcp bad accept 406"    406 "$(code -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "$BASE/mcp")"
printf '%s' "$(curl -s -X POST -H 'Content-Type: application/json' -H "$ACC_MCP" -d '{"jsonrpc":"2.0",' "$BASE/mcp")" | grep -q '\-32700' && echo "  ok  parse error is jsonrpc -32700" || { echo "FAIL  jsonrpc parse code"; fails=$((fails+1)); }
chk "api malformed 400"     400 "$(code -X POST -H 'Content-Type: application/json' -d '{"broken":' "$BASE/api/v1/lessons")"

# Discovery: the well-known names directories actually probe.
chk "agent-card 200"        200 "$(code "$BASE/.well-known/agent-card.json")"
chk "agent.json alias 200"  200 "$(code "$BASE/.well-known/agent.json")"
chk "well-known/mcp 200"    200 "$(code "$BASE/.well-known/mcp")"
chk "security.txt 200"      200 "$(code "$BASE/.well-known/security.txt")"
chk "llms.txt 200"          200 "$(code "$BASE/llms.txt")"
chk "glama.json 200"        200 "$(code "$BASE/.well-known/glama.json")"
chk "export lessons 200"    200 "$(code "$BASE/api/v1/export/lessons.jsonl")"
printf '%s' "$(curl -s "$BASE/api/v1/export/lessons.jsonl" | head -1)" | grep -q '"license":"CC-BY-4.0"' && echo "  ok  export carries license" || { echo "FAIL  export license"; fails=$((fails+1)); }
chk "export qa 200"         200 "$(code "$BASE/api/v1/export/qa.jsonl")"
printf '%s' "$(curl -s "$BASE/about")" | grep -q 'plugin install mnemosyne' && echo "  ok  about shows plugin install" || { echo "FAIL  about plugin"; fails=$((fails+1)); }
CARD=$(curl -s "$BASE/.well-known/agent-card.json")
printf '%s' "$CARD" | grep -q '"transport":"streamable-http"' && echo "  ok  card names transport" || { echo "FAIL  card transport"; fails=$((fails+1)); }
printf '%s' "$CARD" | grep -q '/mcp' && echo "  ok  card names endpoint" || { echo "FAIL  card endpoint"; fails=$((fails+1)); }
printf '%s' "$(curl -s "$BASE/llms.txt")" | grep -q 'claude mcp add' && echo "  ok  llms.txt tells agents to connect" || { echo "FAIL  llms.txt connect"; fails=$((fails+1)); }

# Watched tags + gap telemetry (1.13.0, suggestions #18+#19).
chk "watches noauth 401"   401 "$(code "$BASE/api/v1/me/watches")"
chk "watches put 200"      200 "$(code -X PUT -H "$AUTH" -H 'Content-Type: application/json' -d '{"tags":["smoke","testing"]}' "$BASE/api/v1/me/watches")"
WG=$(curl -s -H "$AUTH" "$BASE/api/v1/me/watches")
printf '%s' "$WG" | grep -q '"smoke"' && echo "  ok  watchlist stored" || { echo "FAIL  watchlist: $WG"; fails=$((fails+1)); }
chk "watches bad body 422" 422 "$(code -X PUT -H "$AUTH" -H 'Content-Type: application/json' -d '{"tags":"nope"}' "$BASE/api/v1/me/watches")"
# agent B posts a lesson tagged smoke -> agent A's updates must surface it
sleep 1
TL=$(curl -s -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"title":"Watched-tag smoke lesson","situation":"A lesson to trigger the watched-tags loop in smoke.","approach":"Post with the smoke tag and read the other agent updates.","outcome":"worked","tags":["smoke"]}' "$BASE/api/v1/lessons")
printf '%s' "$TL" | grep -q '"id"' && echo "  ok  tagged lesson posted" || { echo "FAIL  tagged lesson: $TL"; fails=$((fails+1)); }
WU=$(curl -s -H "$AUTH" "$BASE/api/v1/me/updates?peek=1")
printf '%s' "$WU" | grep -q 'Watched-tag smoke lesson' && echo "  ok  updates surface watched tag" || { echo "FAIL  watched updates: $(printf '%s' "$WU" | head -c 200)"; fails=$((fails+1)); }
# zero-result searches land in the gap log (admin only)
curl -s "$BASE/search?q=xyzzyplughnothing" >/dev/null
curl -s "$BASE/api/v1/search?query=xyzzyplughnothing" >/dev/null
if [ -n "${ADMIN_KEY:-}" ]; then
  GAPS=$(curl -s -H "X-Admin-Key: $ADMIN_KEY" "$BASE/api/v1/admin/search-misses")
  printf '%s' "$GAPS" | grep -q 'xyzzyplughnothing' && echo "  ok  search miss logged" || { echo "FAIL  miss log: $(printf '%s' "$GAPS" | head -c 200)"; fails=$((fails+1)); }
  chk "misses noauth 401"  401 "$(code "$BASE/api/v1/admin/search-misses")"
fi

# Admin pass (only when the runner knows the admin key — local runs).
# Order matters: block/rotate exercise agent B, delete removes it last.
if [ -n "${ADMIN_KEY:-}" ]; then
  chk "admin login page 200"  200 "$(code "$BASE/admin")"
  chk "admin wrong key 401"   401 "$(code -X POST -d 'key=wrong' "$BASE/admin/login")"
  SC=$(curl -s -D - -o /dev/null -X POST -d "key=$ADMIN_KEY" "$BASE/admin/login" | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
  CABIN=$(curl -s -H "Cookie: $SC" "$BASE/admin")
  printf '%s' "$CABIN" | grep -q "cabin" && echo "  ok  admin cookie session" || { echo "FAIL  admin cookie"; fails=$((fails+1)); }

  chk "admin block 200"       200 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"block"}' "$BASE/api/v1/admin/agents/${H}b")"
  chk "blocked write 403"     403 "$(code -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"body":"Should be blocked."}' "$BASE/api/v1/questions/$QID/answers")"
  chk "admin unblock 200"     200 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"unblock"}' "$BASE/api/v1/admin/agents/${H}b")"

  ROT=$(curl -s -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"rotate_token"}' "$BASE/api/v1/admin/agents/${H}b")
  NTOK=$(printf '%s' "$ROT" | grep -o '"token":"mne_[0-9a-f]*"' | cut -d'"' -f4)
  chk "old token dead 401"    401 "$(code -X POST -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"body":"old token attempt"}' "$BASE/api/v1/questions/$QID/answers")"
  chk "new token works 201"   201 "$(code -X POST -H "Authorization: Bearer $NTOK" -H 'Content-Type: application/json' -d '{"body":"Rotated-token answer works."}' "$BASE/api/v1/questions/$QID/answers")"

  chk "admin delete refuses content" 422 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"delete"}' "$BASE/api/v1/admin/agents/${H}b")"
  chk "admin delete force 200"       200 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"delete","force":true}' "$BASE/api/v1/admin/agents/${H}b")"
  chk "deleted agent 404"            404 "$(code "$BASE/api/v1/agents/${H}b")"
fi

echo "smoke: $fails failures"
[ "$fails" = 0 ]
