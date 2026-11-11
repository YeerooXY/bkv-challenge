param(
    [string]$VmKeys = 'C:\Users\7yeer\Projects\FamilyHub\.local\vm'
)
$ErrorActionPreference = 'Stop'
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$tailscale = "$env:ProgramFiles\Tailscale\tailscale.exe"
$runtime = Join-Path $env:LOCALAPPDATA 'BkvChallenge'
$key = Join-Path $VmKeys 'id_ed25519'
$knownHosts = Join-Path $VmKeys 'known_hosts'
foreach ($file in @($ssh, $tailscale, $key, $knownHosts)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Required file missing: $file" }
}
if (Get-NetTCPConnection -State Listen -LocalPort 18766 -ErrorAction SilentlyContinue) {
    throw 'Port 18766 already has a listener. Inspect it before starting another tunnel.'
}
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$sshArgs = @(
    '-N', '-T', '-L', '127.0.0.1:18766:127.0.0.1:8001',
    '-i', ('"' + $key + '"'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3', '-o', 'HostKeyAlias=familyhub-dev',
    '-o', 'StrictHostKeyChecking=yes', '-o', ('"UserKnownHostsFile=' + $knownHosts + '"'),
    'familyhub@familyhub-dev.mshome.net'
)
$tunnel = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $runtime 'tunnel.log')
try {
    $health = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ($tunnel.HasExited) { throw 'SSH tunnel exited. Check the local tunnel.log.' }
        try { $health = Invoke-RestMethod http://127.0.0.1:18766/v1/health -TimeoutSec 2 } catch {}
        if ($health.schemaVersion -eq 1 -and $health.live -eq $true) { break }
        Start-Sleep -Milliseconds 500
    }
    if ($health.schemaVersion -ne 1 -or $health.live -ne $true) { throw 'BKV API health check failed.' }
    & $tailscale serve --bg --yes --https=8445 http://127.0.0.1:18766
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve did not accept the separate BKV route.' }
    Write-Output "BKV tunnel PID $($tunnel.Id). Verify the private HTTPS endpoint before publishing apiBase."
} catch {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
    throw
}
