$Root = $PSScriptRoot
if (-not $Root) { $Root = "c:\Users\Admin\Desktop\glabsbw" }

$AUTH_BRIDGE_PORT = 18923
$EnvFile = "$Root\.env"
if (Test-Path $EnvFile) {
    $envContent = Get-Content $EnvFile -Raw
    if ($envContent -match "AUTH_BRIDGE_URL=[^\r\n]+") {
        $url = $Matches[0].Split("=")[1].Trim()
        if ($url -match ":(\d+)") {
            $AUTH_BRIDGE_PORT = [int]$Matches[1]
        }
    }
}
$Bat = "$Root\run-api.bat"
$LogDir = "$Root\data\logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}
$Log = "$LogDir\backend.log"

function Log($m) {
    $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    try {
        "$t $m" | Out-File -FilePath $Log -Append -ErrorAction SilentlyContinue
    } catch {}
    Write-Host "$t $m"
}

function BackendUp {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:8765/api/health" -UseBasicParsing -TimeoutSec 10
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function KillPorts {
    foreach ($port in @(8765, $AUTH_BRIDGE_PORT)) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "G-Labs BW Backend Watchdog"
Write-Host "  Keep this window open."
Write-Host "  API http://127.0.0.1:8765  Auth http://127.0.0.1:$AUTH_BRIDGE_PORT"
Write-Host ""

$proc = $null
$consecutive_failures = 0
while ($true) {
    if (BackendUp) {
        $consecutive_failures = 0
    } else {
        $consecutive_failures++
        Log "Health check failed (consecutive=$consecutive_failures/3)"
        if ($consecutive_failures -ge 3) {
            Log "DOWN (3 consecutive failures) - restarting via run-api.bat"
            $consecutive_failures = 0
            if ($proc -and -not $proc.HasExited) {
                try { $proc.Kill() } catch {}
            }
            KillPorts
            Start-Sleep 1
            $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$Bat`"" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
            $ok = $false
            for ($i = 0; $i -lt 20; $i++) {
                Start-Sleep 1
                if (BackendUp) {
                    $ok = $true
                    break
                }
                if ($proc.HasExited) {
                    break
                }
            }
            if ($ok) {
                Log "UP pid=$($proc.Id)"
            } else {
                Log "FAILED exit=$($proc.ExitCode) - retry 5s"
                Start-Sleep 5
            }
        }
    }
    Start-Sleep 10
}
