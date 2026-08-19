param(
  [string]$PostgresBin = $env:POSTGRES_BIN,
  [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
$env:PG_RESTRICT_EXEC = '1'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $projectRoot '.pgdata'
$logPath = Join-Path $projectRoot 'work\postgresql.log'
if ([string]::IsNullOrWhiteSpace($PostgresBin)) { $PostgresBin = 'C:\Program Files\PostgreSQL\17\bin' }
$postgres = Join-Path $PostgresBin 'postgres.exe'
$pgReady = Join-Path $PostgresBin 'pg_isready.exe'

if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
  throw 'Cluster local ausente. Execute pnpm db:local:setup.'
}

& $pgReady -h 127.0.0.1 -p $Port | Out-Null
if ($LASTEXITCODE -ne 0) {
  $errorLogPath = Join-Path $projectRoot 'work\postgresql-error.log'
  $process = Start-Process -FilePath $postgres -ArgumentList @('-D', '.pgdata', '-p', "$Port", '-c', 'listen_addresses=127.0.0.1') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -PassThru
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 100
    & $pgReady -h 127.0.0.1 -p $Port | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ($process.HasExited) { throw "Falha ao iniciar o PostgreSQL local. Consulte $errorLogPath." }
  }
  if ($LASTEXITCODE -ne 0) { throw "Timeout ao iniciar o PostgreSQL local. Consulte $errorLogPath." }
}
& $pgReady -h 127.0.0.1 -p $Port
