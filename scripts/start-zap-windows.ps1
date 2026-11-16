$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'OomAgent'
$java = Join-Path $base 'java-17.0.21\jdk-17.0.21+9-jre\bin\java.exe'
$jar = Join-Path $base 'zap-2.17.0\ZAP_2.17.0\zap-2.17.0.jar'

if (!(Test-Path -LiteralPath $java) -or !(Test-Path -LiteralPath $jar)) {
    throw 'Portable Java/ZAP is missing. See the Windows MCP setup in README.md.'
}
foreach ($port in @(8282, 18080)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use; not starting another ZAP instance."
    }
}

$logs = Join-Path $base 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = [Guid]::NewGuid().ToString('N')
# Only loopback listeners, authenticated MCP, no target and no scan arguments.
# HTTP matches the existing local Pi endpoint; never expose port 8282 externally.
$arguments = @(
    '-jar', ('"' + $jar + '"'), '-daemon', '-silent',
    '-host', '127.0.0.1', '-port', '18080',
    '-config', 'mcp.enabled=true',
    '-config', 'mcp.port=8282',
    '-config', 'mcp.securityKeyEnabled=true',
    '-config', 'mcp.secureOnly=false',
    '-config', 'mcp.recordInHistory=false'
)
$process = Start-Process -FilePath $java -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "zap-$stamp.out.log") `
    -RedirectStandardError (Join-Path $logs "zap-$stamp.err.log")
Write-Output "ZAP started (PID $($process.Id)); verify with pi mcp list. No scan was started."
