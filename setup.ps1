# Native Windows x64 / Windows PowerShell 5.1+. No WSL, Ubuntu or Docker.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Run this installer in Windows PowerShell.' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { throw 'This installer currently supports Windows x64 only.' }
$Root = $PSScriptRoot
$State = Join-Path $Root '.portable\windows'
New-Item -ItemType Directory -Force -Path $State | Out-Null
if ((Get-Item $State).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked runtime directory.' }
$Lock = $null
try {
    $Lock = [IO.File]::Open((Join-Path $State 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $Git = (Get-Command git.exe -ErrorAction Stop).Source
    $GitRoot = Split-Path (Split-Path $Git)
    $Bash = Join-Path $GitRoot 'bin\bash.exe'
    if (!(Test-Path $Bash)) { throw 'Install Git for Windows (including Git Bash), reopen PowerShell, then retry.' }
    function Run([string]$Program, [string[]]$Arguments) {
        & $Program @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE. Installation stopped; rerun after resolving the error." }
    }
    function Fetch([string]$Url, [string]$Hash, [string]$File) {
        if ((Test-Path $File) -and ((Get-FileHash $File -Algorithm SHA256).Hash -eq $Hash)) { return }
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$File.part"
        if ((Get-FileHash "$File.part" -Algorithm SHA256).Hash -ne $Hash) { throw "Checksum mismatch: $Url" }
        Move-Item -Force "$File.part" $File
    }
    Fetch 'https://nodejs.org/dist/v25.6.1/node-v25.6.1-win-x64.zip' '0ae2300cdf44c399b5b351edbefb3534d1342a6fabd64302ca8c8e2fb86b0445' (Join-Path $State 'node.zip')
    Expand-Archive -Force (Join-Path $State 'node.zip') $State
    $NodeDir = Join-Path $State 'node-v25.6.1-win-x64'
    $Node = Join-Path $NodeDir 'node.exe'
    $Npm = Join-Path $NodeDir 'npm.cmd'
    $env:PATH = "$NodeDir;$GitRoot\bin;$env:PATH"
    $env:npm_config_script_shell = $Bash
    $Source = Join-Path $State 'pi-source'
    if (!(Test-Path $Source)) {
        Run $Git @('-c', 'core.autocrlf=false', 'clone', '--config', 'core.autocrlf=false', '--depth', '1', '--branch', 'v1.5.2', 'https://github.com/earendil-works/pi.git', $Source)
    }
    $Revision = & $Git -C $Source rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $Revision -ne 'b4afdddf44e059c67ccf5097e5317d913521b470') { throw 'Unexpected Pi source revision; source left untouched.' }
    $Patch = Join-Path $Root 'portable\pi-1.5.2-chat-frame.patch'
    # PowerShell 5.1 promotes redirected native stderr under Stop; a failed
    # reverse-check is expected on the first installation, not an install error.
    $SavedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Git -C $Source apply --reverse --check $Patch 2>$null
        $AlreadyPatched = $LASTEXITCODE -eq 0
    } finally { $ErrorActionPreference = $SavedPreference }
    if (!$AlreadyPatched) {
        Run $Git @('-C', $Source, 'apply', '--check', $Patch)
        Run $Git @('-C', $Source, 'apply', $Patch)
    }
    Push-Location $Source
    try {
        Run $Npm @('ci', '--ignore-scripts')
        Run $Npm @('run', 'hydrate:model-data')
        Run $Npm @('run', 'build:offline')
    } finally { Pop-Location }
    Fetch 'https://github.com/astral-sh/uv/releases/download/0.12.23/uv-x86_64-pc-windows-msvc.zip' '75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90' (Join-Path $State 'uv.zip')
    Expand-Archive -Force (Join-Path $State 'uv.zip') (Join-Path $State 'uv')
    $Uv = (Get-ChildItem (Join-Path $State 'uv') -Filter uv.exe -Recurse | Select-Object -First 1).FullName
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $State 'python-downloads'
    $env:UV_PROJECT_ENVIRONMENT = Join-Path $State 'python'
    Run $Uv @('python', 'install', '3.13.16')
    Run $Uv @('sync', '--project', (Join-Path $Root 'portable\python'), '--python', '3.13.16', '--frozen', '--no-dev')
    $Browser = Join-Path $State 'browser'
    New-Item -ItemType Directory -Force -Path $Browser | Out-Null
    Copy-Item (Join-Path $Root 'portable\browser\package*.json') $Browser -Force
    Push-Location $Browser
    try { Run $Npm @('ci', '--ignore-scripts') } finally { Pop-Location }
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $State 'browsers'
    Run $Node @((Join-Path $Browser 'node_modules\playwright\cli.js'), 'install', 'chromium')
    Fetch 'https://github.com/Gaurav-Gosain/tuios/releases/download/v0.12.1/tuios_0.12.1_Windows_x86_64.tar.gz' '7f0a782183897773fae6308df6be7213df126fd7ecd534c7d84747e745ffdfcd' (Join-Path $State 'tuios.tar.gz')
    $Tuios = Join-Path $State 'tuios'
    New-Item -ItemType Directory -Force -Path $Tuios | Out-Null
    Run 'tar.exe' @('-xzf', (Join-Path $State 'tuios.tar.gz'), '-C', $Tuios)
    Run $Node @((Join-Path $Root 'portable\configure-windows.mjs'), $Bash)
    Run $Node @((Join-Path $Source 'packages\coding-agent\dist\cli.js'), '--version')
    Write-Host 'Installed native Windows Pi. Start .\pi.cmd or .\tuios.cmd. In Pi: /login.'
    Write-Warning 'Lightpanda and ZAP are NOT configured by this Windows installer. Playwright, Serena and document tools are installed. No scans are started.'
} finally {
    if ($null -ne $Lock) { $Lock.Dispose() }
}
