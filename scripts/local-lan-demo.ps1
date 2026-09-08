<#
.SYNOPSIS
  One-shot local-chain-over-LAN test rig: chain + deploy + gateway + seed + install on a real
  phone, all pointed at this machine's LAN IP instead of the emulator's 10.0.2.2 alias or the
  (deliberately dropped - see docs/SWARM-API.md) Amoy testnet. Local-only, self-hosted over
  your own hotspot/LAN, matching CLAUDE.md invariant 6: the demo must work with no internet.

.PARAMETER LanIp
  This machine's IPv4 address on the network your phone is also on (e.g. your hotspot's
  gateway IP, printed by `ipconfig`). Required for a real install - run with -ListIps first if
  you don't already know it.

.PARAMETER ListIps
  Print candidate IPv4 addresses on this machine and exit. Doesn't start anything.

.PARAMETER SkipInstall
  Do everything except the final `gradlew installDebug` - chain, deploy, gateway and seed only.
  Useful if you just want the backend up, or are building separately / for the emulator instead.

.PARAMETER Stop
  Kill the chain and gateway processes a previous run of this script started (tracked in
  scripts/.local-lan-demo.pids) and exit. Doesn't touch anything you started by hand.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/local-lan-demo.ps1 -ListIps

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/local-lan-demo.ps1 -LanIp 172.20.10.4

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/local-lan-demo.ps1 -Stop
#>

param(
    [string]$LanIp,
    [switch]$ListIps,
    [switch]$SkipInstall,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$PidFile = Join-Path $PSScriptRoot ".local-lan-demo.pids"
$DemoLot = "0x018f2c0000000000000000000000b027"  # TRUCK lot - scripts/seed.ts

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

if ($ListIps) {
    Write-Host "Candidate IPv4 addresses on this machine (pick the one on your phone's network):"
    Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL" } |
        Select-Object InterfaceAlias, IPAddress |
        Format-Table -AutoSize
    exit 0
}

if ($Stop) {
    if (Test-Path $PidFile) {
        Get-Content $PidFile | ForEach-Object {
            $procId = $_.Trim()
            if ($procId) {
                try {
                    Stop-Process -Id $procId -Force -ErrorAction Stop
                    Write-Host "stopped PID $procId"
                } catch {
                    Write-Host "PID $procId already gone"
                }
            }
        }
        Remove-Item $PidFile
    } else {
        Write-Host "No tracked PIDs ($PidFile not found) - nothing to stop."
    }
    exit 0
}

if (-not $SkipInstall -and -not $LanIp) {
    Write-Host "Pass -LanIp <this machine's IP on the phone's network>, or -SkipInstall to just bring up the backend." -ForegroundColor Yellow
    Write-Host "Run with -ListIps to see candidates." -ForegroundColor Yellow
    exit 1
}
if ($LanIp -and $LanIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    Write-Host "-LanIp '$LanIp' doesn't look like an IPv4 address." -ForegroundColor Red
    exit 1
}

function Wait-ForPort($port, $timeoutSeconds, $label) {
    Write-Host "  waiting for $label on port $port..."
    $elapsed = 0
    while (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
        Start-Sleep -Seconds 1
        $elapsed++
        if ($elapsed -ge $timeoutSeconds) {
            throw "$label did not come up on port $port within ${timeoutSeconds}s"
        }
    }
    Write-Host "  $label is up (${elapsed}s)"
}

$startedPids = @()

# --- 1. .env ---
Write-Step ".env"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  created .env from .env.example (defaults are demo-ready for local-only use)"
} else {
    Write-Host "  .env already exists, leaving it alone"
}

# --- 2. local chain, bound to 0.0.0.0 so the phone can reach it ---
Write-Step "local chain (0.0.0.0:8545)"
if (Get-NetTCPConnection -LocalPort 8545 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "  already listening on 8545, reusing it"
} else {
    $chainProc = Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$RepoRoot'; npm run chain -w contracts -- --hostname 0.0.0.0"
    ) -PassThru -WindowStyle Normal
    $startedPids += $chainProc.Id
    Wait-ForPort 8545 30 "local chain"
}

# --- 3. deploy contracts; read BatchAnchor back from the file deploy.ts writes, not the console ---
Write-Step "deploy contracts"
npm run deploy:local
if ($LASTEXITCODE -ne 0) { throw "deploy:local failed (see output above)" }
$addresses = Get-Content "deployments/localhost/addresses.json" | ConvertFrom-Json
$batchAnchor = $addresses.contracts.BatchAnchor
Write-Host "  BatchAnchor: $batchAnchor"

# Persist LanIp + BatchAnchor into apps/android/local.properties (gitignored - see
# apps/android/.gitignore) so a later plain `./gradlew installDebug`, with no -P flags, keeps
# pointing at this LAN setup instead of falling back to the checked-in emulator default. Only
# the four krishichain.* keys are touched; anything else already in the file (e.g. sdk.dir) is
# left alone. build.gradle.kts's `gradleProp()` reads this layer automatically.
if ($LanIp) {
    Write-Step "writing apps\android\local.properties"
    $localPropsPath = "apps\android\local.properties"
    $keep = @()
    if (Test-Path $localPropsPath) {
        $keep = Get-Content $localPropsPath | Where-Object {
            $_ -notmatch '^krishichain(GatewayUrl|VerifyRpcUrl|VerifyChainId|BatchAnchorAddress)='
        }
    }
    $lines = $keep + @(
        "krishichainGatewayUrl=http://${LanIp}:8080",
        "krishichainVerifyRpcUrl=http://${LanIp}:8545",
        "krishichainVerifyChainId=31337",
        "krishichainBatchAnchorAddress=$batchAnchor"
    )
    Set-Content -Path $localPropsPath -Value $lines -Encoding ascii
    Write-Host "  wrote LAN config - a plain 'gradlew installDebug' (no flags) now uses it too"
}

# --- 4. gateway - already binds 0.0.0.0, no flag needed ---
Write-Step "gateway (0.0.0.0:8080)"
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "  already listening on 8080, reusing it"
} else {
    $gatewayProc = Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$RepoRoot'; npm run dev:gateway"
    ) -PassThru -WindowStyle Normal
    $startedPids += $gatewayProc.Id
    Wait-ForPort 8080 20 "gateway"
}

if ($startedPids.Count -gt 0) {
    $startedPids | Out-File -FilePath $PidFile -Encoding ascii
    Write-Host "  tracked $($startedPids.Count) new process(es) in $PidFile - stop them later with -Stop"
}

# --- 5. seed a demo lot ---
Write-Step "seed demo lot"
npm run seed
if ($LASTEXITCODE -ne 0) { throw "seed failed (see output above)" }

# --- 6. wait for the first batch to anchor (BATCH_MAX_SECONDS=60 in .env.example, plus slack) ---
Write-Step "waiting for the first batch to anchor (up to 90s)"
$anchored = $false
$summary = $null
for ($i = 0; $i -lt 90; $i++) {
    try {
        $summary = Invoke-RestMethod -Uri "http://localhost:8080/ops/summary" -TimeoutSec 3
        if ($summary.batches -ge 1) { $anchored = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if ($anchored) {
    Write-Host "  batch anchored ($($summary.batches) closed)"
} else {
    Write-Host "  no batch closed yet after 90s - the app will honestly show PENDING_ANCHOR until one does; that's not a bug" -ForegroundColor Yellow
}

# --- 7. build + install on the phone ---
if (-not $SkipInstall) {
    Write-Step "adb device check"
    $deviceLines = (& adb devices) | Select-String "\tdevice$"
    if ($deviceLines.Count -eq 0) {
        Write-Host "  no device found via adb. Plug in the phone with USB debugging on (or pair wireless adb) and re-run." -ForegroundColor Red
        exit 1
    } elseif ($deviceLines.Count -gt 1) {
        Write-Host "  more than one adb target connected - installDebug will land on whichever adb defaults to. Disconnect the emulator if you want this to definitely hit the phone." -ForegroundColor Yellow
    }

    Write-Step "gradlew installDebug -> $LanIp"
    $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
    Push-Location "apps\android"
    try {
        & .\gradlew.bat installDebug `
            "-PkrishichainGatewayUrl=http://${LanIp}:8080" `
            "-PkrishichainVerifyRpcUrl=http://${LanIp}:8545" `
            "-PkrishichainVerifyChainId=31337" `
            "-PkrishichainBatchAnchorAddress=$batchAnchor"
        if ($LASTEXITCODE -ne 0) { throw "gradlew installDebug failed (see output above)" }
    } finally {
        Pop-Location
    }
}

Write-Step "done"
if ($LanIp) {
    Write-Host "  gateway:      http://${LanIp}:8080"
    Write-Host "  chain RPC:    http://${LanIp}:8545"
}
Write-Host "  BatchAnchor:  $batchAnchor"
Write-Host "  demo lot:     $DemoLot"
Write-Host "  On the phone: Verify tab -> that lot id (or type it manually, no QR needed)."
Write-Host "  Firewall: Windows may prompt the first time the phone hits 8080/8545 from the LAN - allow it."
Write-Host "  When you're done testing: powershell -File scripts/local-lan-demo.ps1 -Stop"
