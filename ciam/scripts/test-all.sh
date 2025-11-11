#!/usr/bin/env bash
set -euo pipefail

export BASE=${BASE:-http://localhost:3001}
export USER=${USER:-u1}

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need curl; need jq

echo "[0] Smoke: start with $BASE as issuer"

echo "[1] CIBA positive"
AUTH=$(curl -s "$BASE/backchannel/authentication" -H 'Content-Type: application/json' -d '{"client_id":"web","scope":"openid profile","login_hint":"'"$USER"'","binding_message":"Login approval?"}')
AUTH_ID=$(echo "$AUTH" | jq -r .auth_req_id)
test -n "$AUTH_ID"
curl -s -X POST "$BASE/ciba/approve/$AUTH_ID?action=approve&user_id=$USER" >/dev/null
TOK=$(curl -s -X POST "$BASE/oauth/token" -H 'Content-Type: application/json' -d '{"grant_type":"ciba","auth_req_id":"'"$AUTH_ID"'"}')
AT=$(echo "$TOK" | jq -r .access_token)
test -n "$AT" || { echo "No access_token"; exit 1; }
echo "$TOK" | jq '{acr, access_token:(.access_token|.[0:24]+"..."), id_token:(.id_token|.[0:24]+"...")}'

echo "[2] /userinfo"
curl -s -H "Authorization: Bearer $AT" "$BASE/userinfo" | jq '{sub,name,given_name,family_name,acr}'

echo "[3] CIBA slow_down"
AUTH=$(curl -s "$BASE/backchannel/authentication" -H 'Content-Type: application/json' -d '{"client_id":"web","scope":"openid","login_hint":"'"$USER"'"}')
AUTH_ID=$(echo "$AUTH" | jq -r .auth_req_id)
curl -s -X POST "$BASE/oauth/token" -H 'Content-Type: application/json' -d '{"grant_type":"ciba","auth_req_id":"'"$AUTH_ID"'"}' | jq .
curl -s -X POST "$BASE/oauth/token" -H 'Content-Type: application/json' -d '{"grant_type":"ciba","auth_req_id":"'"$AUTH_ID"'"}' | jq .

echo "[4] Gateway minimal allow"
curl -s -X POST "$BASE/gateway/check" -H "Authorization: Bearer $AT" -H "Fineract-Platform-TenantId: bank-demo" -H "Content-Type: application/json" -d '{"route":"profile-read"}' | jq .

echo "[5] Health & metrics"
curl -s "$BASE/health" | jq .
curl -s "$BASE/metrics" | sed -n '1,20p'

echo "[6] Visibility"
code_demo=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/demo-dpop")
echo "demo-dpop -> $code_demo"
for p in challenge confirm verify; do code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/txn/$p"); echo "/txn/$p -> $code"; done

echo "ALL TESTS PASSED (baseline)"

