param([string]
)
Set-Location 
$env:CIAM_PORT='3001'
$env:CIAM_BASE_URL='http://localhost:3001'
$env:WEBAUTHN_RP_ID='localhost'
$env:WEBAUTHN_ORIGIN='http://localhost:3001'
$env:TENANT_ID='bank-demo'
$env:ENABLE_TXN_SIGNING='false'
$env:ENFORCE_TX_SIGNATURE='false'
$env:ENFORCE_L3_STRICT='false'
$env:REQUIRE_DPOP='false'
$env:SHOW_DEMOS='demo-web,demo-approver,demo-dpop'
$env:DEMO_PRESEED='true'
npm run dev 2>&1 | Tee-Object -FilePath dev.log
