param([string]$PostgresBin = $env:POSTGRES_BIN)

$ErrorActionPreference = 'Stop'
$env:PG_RESTRICT_EXEC = '1'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $projectRoot '.pgdata'
if ([string]::IsNullOrWhiteSpace($PostgresBin)) { $PostgresBin = 'C:\Program Files\PostgreSQL\17\bin' }
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'

if (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid')) {
  & $pgCtl -D $dataPath stop -m fast
}
