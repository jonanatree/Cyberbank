#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")"/.. && pwd)"
cd "$DIR"
echo "== CIAM Demo Bootstrap =="
if ! command -v mkcert >/dev/null 2>&1; then
  echo "[i] mkcert 未安装，跳过 TLS 证书生成（可手动安装后重跑）。"
else
  mkdir -p certs
  pushd certs >/dev/null
  echo "[i] 生成 demo 证书 (*.<bank.local>)"
  mkcert -install || true
  mkcert bank.local "*.bank.local" localhost 127.0.0.1 ::1
  popd >/dev/null
fi
echo "[i] 安装依赖"
npm i
echo "[i] 启动开发服务 (ENV 最小闭环)"
export CIAM_PORT=${CIAM_PORT:-3001}
export CIAM_BASE_URL=${CIAM_BASE_URL:-http://localhost:$CIAM_PORT}
export WEBAUTHN_RP_ID=${WEBAUTHN_RP_ID:-localhost}
export WEBAUTHN_ORIGIN=${WEBAUTHN_ORIGIN:-$CIAM_BASE_URL}
export TENANT_ID=${TENANT_ID:-bank-demo}
export ENABLE_TXN_SIGNING=${ENABLE_TXN_SIGNING:-false}
export ENFORCE_TX_SIGNATURE=${ENFORCE_TX_SIGNATURE:-false}
export ENFORCE_L3_STRICT=${ENFORCE_L3_STRICT:-false}
export REQUIRE_DPOP=${REQUIRE_DPOP:-false}
export SHOW_DEMOS=${SHOW_DEMOS:-demo-web,demo-approver,demo-dpop}
export DEMO_PRESEED=${DEMO_PRESEED:-true}
echo "[i] 访问: $CIAM_BASE_URL/demo-web  和  $CIAM_BASE_URL/demo-approver  以及  $CIAM_BASE_URL/demo-dpop"
npm run dev

