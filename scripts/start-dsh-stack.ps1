$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$logRoot = Join-Path $projectRoot 'work'
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$envFile = Join-Path $dshHome '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing DSH environment file: $envFile" }
$dshEnv = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $dshEnv[$matches[1]] = $matches[2]
    }
}
$botQq = $dshEnv['BIGFISH_BOT_QQ']
if (-not $botQq) { throw 'BIGFISH_BOT_QQ is missing from DSH_HOME/.env' }

function Start-HiddenService {
    param(
        [string]$Name,
        [string]$Arguments,
        [int]$Port
    )

    if ($Port -gt 0 -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        Write-Output "$Name is already listening on $Port"
        return
    }

    $stdout = Join-Path $logRoot "$Name.stdout.log"
    $stderr = Join-Path $logRoot "$Name.stderr.log"
    $process = Start-Process -FilePath $pnpm `
        -ArgumentList $Arguments.Split(' ') `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    Write-Output "$Name started with PID $($process.Id)"
}

$napcatMain = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'NapCatWinBootMain.exe' -and $_.CommandLine -match "-q $botQq" } |
    Select-Object -First 1
if (-not $napcatMain) {
    $launcher = 'C:\Users\Administrator\AppData\Local\NapCat\launcher-win10-user.bat'
    Start-Process -FilePath $launcher `
        -ArgumentList @('-q', $botQq) `
        -WorkingDirectory 'C:\Users\Administrator\AppData\Local\NapCat' `
        -WindowStyle Hidden
    Write-Output 'NapCat bot instance starting'
} else {
    Write-Output "NapCat bot instance is running with PID $($napcatMain.ProcessId)"
}

Start-HiddenService -Name 'brain' -Arguments 'brain:start' -Port 15621
Start-HiddenService -Name 'dsh-web' -Arguments 'dsh:web' -Port 3180
$sociald = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'services[\\/]sociald[\\/]main\.mjs' } |
    Select-Object -First 1
if ($sociald) {
    Write-Output "sociald is running with PID $($sociald.ProcessId)"
} else {
    Start-HiddenService -Name 'sociald' -Arguments 'social:start' -Port 0
}

$replyd = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'services[\\/]replyd[\\/]main\.mjs' } |
    Select-Object -First 1
if ($replyd) {
    Write-Output "replyd is running with PID $($replyd.ProcessId)"
} else {
    Start-HiddenService -Name 'replyd' -Arguments 'reply:start' -Port 0
}

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'NapCat DSH WebSocket server did not open on port 3001'
}
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 3180 -State Listen -ErrorAction SilentlyContinue) {
        break
    }
    Start-Sleep -Milliseconds 500
}
if (-not (Get-NetTCPConnection -LocalPort 3180 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'DSH Web did not open on port 3180'
}

Write-Output 'BigFish DSH stack is ready.'
