$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$logDirectory = Join-Path $projectRoot 'data'
$logFile = Join-Path $logDirectory 'mumud-supervisor.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$mutex = [System.Threading.Mutex]::new($false, 'Local\BigFishMumudSupervisor')
if (-not $mutex.WaitOne(0)) {
    exit 0
}

try {
    Set-Location -LiteralPath $projectRoot
    while ($true) {
        $existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
            Where-Object { $_.CommandLine -match 'services[\\/]mumud[\\/]main\.mjs' } |
            Select-Object -First 1
        if ($existing) {
            Start-Sleep -Seconds 2
            continue
        }
        $startedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        "[$startedAt] starting mumud" | Out-File -LiteralPath $logFile -Append -Encoding utf8
        try {
            & $pnpm 'play:start' *>> $logFile
            $exitCode = $LASTEXITCODE
            $stoppedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            "[$stoppedAt] mumud exited with code $exitCode" | Out-File -LiteralPath $logFile -Append -Encoding utf8
        }
        catch {
            $failedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            "[$failedAt] mumud supervisor error: $($_.Exception.Message)" |
                Out-File -LiteralPath $logFile -Append -Encoding utf8
        }
        Start-Sleep -Seconds 5
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
