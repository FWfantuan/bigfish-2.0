param(
    [string]$MaaRoot = $(if ($env:MAA_ROOT) { $env:MAA_ROOT } else { Join-Path $HOME 'Desktop\maa' })
)

$ErrorActionPreference = 'Stop'
$version = 'v0.7.7'
$asset = "maa_cli-$version-x86_64-pc-windows-msvc.zip"
$expectedSha256 = '769719108609B48E18D7EBD88855F6125BD455D3B32D051866DAFB8E896254C1'
$url = "https://github.com/MaaAssistantArknights/maa-cli/releases/download/$version/$asset"

if (-not (Test-Path -LiteralPath $MaaRoot)) {
    throw "MAA root does not exist: $MaaRoot"
}

$bootstrap = Join-Path $MaaRoot ("maa-cli-bootstrap-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
$zipPath = Join-Path $bootstrap $asset
New-Item -ItemType Directory -Path $bootstrap | Out-Null

try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
    if ($actualSha256 -ne $expectedSha256) {
        throw "maa-cli checksum mismatch: expected $expectedSha256, got $actualSha256"
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $bootstrap -Force
    $maaExe = Get-ChildItem -LiteralPath $bootstrap -Recurse -File -Filter 'maa.exe' |
        Select-Object -First 1
    if (-not $maaExe) {
        throw "maa.exe was not found in the verified archive"
    }

    Copy-Item -LiteralPath $maaExe.FullName -Destination (Join-Path $MaaRoot 'maa.exe') -Force
    $env:MAA_DATA_DIR = $MaaRoot
    & (Join-Path $MaaRoot 'maa.exe') version
} finally {
    if (Test-Path -LiteralPath $bootstrap) {
        $resolvedRoot = [IO.Path]::GetFullPath($MaaRoot).TrimEnd('\') + '\'
        $resolvedBootstrap = [IO.Path]::GetFullPath($bootstrap)
        if ($resolvedBootstrap.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedBootstrap -Recurse -Force
        }
    }
}
