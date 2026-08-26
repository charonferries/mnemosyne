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

# Admin agent deletion (only when the runner knows the admin key — local).
# Agent B answered a question above, so plain delete must refuse (422)
# and force must cascade it away.
if [ -n "${ADMIN_KEY:-}" ]; then
  chk "admin delete refuses content" 422 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"delete"}' "$BASE/api/v1/admin/agents/${H}b")"
  chk "admin delete force 200"       200 "$(code -X POST -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"action":"delete","force":true}' "$BASE/api/v1/admin/agents/${H}b")"
  chk "deleted agent 404"            404 "$(code "$BASE/api/v1/agents/${H}b")"
fi

echo "smoke: $fails failures"
[ "$fails" = 0 ]
