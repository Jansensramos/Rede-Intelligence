param(
  [string]$PostgresBin = $env:POSTGRES_BIN,
  [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
$env:PG_RESTRICT_EXEC = '1'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $projectRoot '.pgdata'
$workPath = Join-Path $projectRoot 'work'
$logPath = Join-Path $workPath 'postgresql.log'

if ([string]::IsNullOrWhiteSpace($PostgresBin)) {
  $PostgresBin = 'C:\Program Files\PostgreSQL\17\bin'
}

$initdb = Join-Path $PostgresBin 'initdb.exe'
$postgres = Join-Path $PostgresBin 'postgres.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$pgReady = Join-Path $PostgresBin 'pg_isready.exe'

foreach ($binary in @($initdb, $postgres, $psql, $pgReady)) {
  if (-not (Test-Path -LiteralPath $binary)) {
    throw "PostgreSQL não encontrado em $PostgresBin. Defina POSTGRES_BIN."
  }
}

New-Item -ItemType Directory -Force -Path $workPath | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
  $passwordFile = Join-Path $workPath 'postgres-bootstrap-password.txt'
  Set-Content -LiteralPath $passwordFile -Value 'rede_postgres_admin_2026' -NoNewline
  try {
    & $initdb --pgdata $dataPath --username postgres --pwfile $passwordFile --auth-local trust --auth-host scram-sha-256 --encoding UTF8 --locale C
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar o cluster PostgreSQL.' }
  } finally {
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
  }
}

& $pgReady -h 127.0.0.1 -p $Port | Out-Null
if ($LASTEXITCODE -ne 0) {
  $errorLogPath = Join-Path $workPath 'postgresql-error.log'
  $process = Start-Process -FilePath $postgres -ArgumentList @('-D', '.pgdata', '-p', "$Port", '-c', 'listen_addresses=127.0.0.1') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -PassThru
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 100
    & $pgReady -h 127.0.0.1 -p $Port | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ($process.HasExited) { throw "Falha ao iniciar o PostgreSQL local. Consulte $errorLogPath." }
  }
  if ($LASTEXITCODE -ne 0) { throw "Timeout ao iniciar o PostgreSQL local. Consulte $errorLogPath." }
}

$env:PGPASSWORD = 'rede_postgres_admin_2026'
$roleExists = (& $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -t -A -c "SELECT 1 FROM pg_roles WHERE rolname='rede_app'") -join ''
if ($roleExists.Trim() -ne '1') {
  & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE rede_app LOGIN PASSWORD 'rede_local_2026'"
}

$databaseExists = (& $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='rede_intelligence'") -join ''
if ($databaseExists.Trim() -ne '1') {
  & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE rede_intelligence OWNER rede_app"
}

& $pgReady -h 127.0.0.1 -p $Port
