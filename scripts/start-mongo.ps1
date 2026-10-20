$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$mongoDirectory = Join-Path $workspace '.local\mongodb'
New-Item -ItemType Directory -Force -Path $mongoDirectory | Out-Null
$mongoCommand = Get-Command mongod -ErrorAction Stop
$listening = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue

if (-not $listening) {
    $logPath = Join-Path $mongoDirectory 'mongod.log'
    $argsList = @(
        '--replSet', 'gauamrut-rs',
        '--bind_ip', '127.0.0.1',
        '--port', '27018',
        '--dbpath', $mongoDirectory,
        '--logpath', $logPath,
        '--logappend'
    )
    $mongoProcess = Start-Process -FilePath $mongoCommand.Source -ArgumentList $argsList -WindowStyle Hidden -PassThru
    $mongoProcess.Id | Set-Content -Path (Join-Path $mongoDirectory 'process.pid')

    # Wait up to 15 seconds for port 27018 to start listening
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        $listening = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
        if ($listening) { break }
    }
    if (-not $listening) {
        throw "mongod failed to bind to 127.0.0.1:27018. Check $logPath for details."
    }
}

Push-Location $workspace
try {
    node scripts/init-mongo.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Replica-set initialization failed. Check .local/mongodb/mongod.log.' }
} finally { Pop-Location }
