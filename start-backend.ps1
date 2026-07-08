# G-Labs BW backend watchdog — keeps API :8765 + Auth :18923 alive
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\Users\Admin\Desktop\g-labs-bw" }
$Bat = Join-Path $Root "run-api.bat"
$LogDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir "backend.log"

function Log($m) {
  $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$t $m" | Tee-Object -FilePath $Log -Append
}

function BackendUp {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:8765/api/health" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function KillPorts {
  foreach ($port in 8765, 18923) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
}

Write-Host "G-Labs BW Backend Watchdog"
Write-Host "  Keep this window open."
Write-Host "  API http://127.0.0.1:8765  Auth http://127.0.0.1:18923"
Write-Host ""

$proc = $null
while ($true) {
  if (-not (BackendUp)) {
    Log "DOWN — restarting via run-api.bat"
    if ($proc -and -not $proc.HasExited) {
      try { $proc.Kill() } catch {}
    }
    KillPorts
    Start-Sleep 1
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c `"$Bat`"" `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -PassThru
    $ok = $false
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep 1
      if (BackendUp) { $ok = $true; break }
      if ($proc.HasExited) { break }
    }
    if ($ok) { Log "UP pid=$($proc.Id)" } else { Log "FAILED exit=$($proc.ExitCode) — retry 5s"; Start-Sleep 5; continue }
  }
  Start-Sleep 5
}
