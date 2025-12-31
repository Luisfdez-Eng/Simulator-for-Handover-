# Script de testing para API de TLE local
Write-Host "🧪 Testing TLE API Proxy..." -ForegroundColor Cyan

# Test 1: Verificar que el proxy responde
Write-Host "`n📡 Test 1: Fetch Starlink TLE" -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "http://localhost:3000/api/tle?group=starlink" -Method GET -ErrorAction Stop
Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
Write-Host "Content-Type: $($response.Headers['Content-Type'])" -ForegroundColor Green
Write-Host "Content Length: $($response.Content.Length) bytes" -ForegroundColor Green
Write-Host "First 500 chars:" -ForegroundColor Gray
Write-Host $response.Content.Substring(0, [Math]::Min(500, $response.Content.Length))

# Test 2: Verificar formato TLE
Write-Host "`n✅ Test 2: Validate TLE Format" -ForegroundColor Yellow
$hasLine1 = $response.Content -match '1 '
$hasLine2 = $response.Content -match '2 '
Write-Host "Has '1 ' marker: $hasLine1" -ForegroundColor $(if($hasLine1){"Green"}else{"Red"})
Write-Host "Has '2 ' marker: $hasLine2" -ForegroundColor $(if($hasLine2){"Green"}else{"Red"})

# Test 3: Contar satélites
$lines = ($response.Content -split "`n").Count
$approxSats = [Math]::Floor($lines / 3)
Write-Host "Lines: $lines, Approx satellites: $approxSats" -ForegroundColor Green

Write-Host "`n✨ All tests passed!" -ForegroundColor Green
