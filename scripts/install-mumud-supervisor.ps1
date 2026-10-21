$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runner = Join-Path $PSScriptRoot 'run-mumud-supervisor.ps1'
$taskName = 'BigFishMumudSupervisor'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'BigFishMumudSupervisor.vbs'

$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'services[\\/]mumud[\\/]main\.mjs' }
foreach ($process in $existing) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$escapedRunner = $runner.Replace('"', '""')
$launcherContent = @"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$($projectRoot.Replace('"', '""'))"
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$escapedRunner""", 0, False
"@
Set-Content -LiteralPath $launcher -Value $launcherContent -Encoding ASCII

Start-Process -FilePath $powershell `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden

Write-Output "Installed startup supervisor $launcher and started mumud"
