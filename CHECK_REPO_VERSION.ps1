param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$expected = 'cwca-welcome-letter-check-restored-2026-06-05'
$versionFile = Join-Path $RepoRoot 'src\lib\version.ts'

if (-not (Test-Path $versionFile)) {
  Write-Host "NOT FOUND: $versionFile" -ForegroundColor Red
  Write-Host "This means the files were not copied into the repo root." -ForegroundColor Yellow
  exit 1
}

$content = Get-Content $versionFile -Raw
if ($content -match [regex]::Escape($expected)) {
  Write-Host "OK: Repo has the welcome-letter fix version." -ForegroundColor Green
  Write-Host $expected
  exit 0
}

Write-Host "OLD VERSION FOUND in $versionFile" -ForegroundColor Red
Write-Host $content
Write-Host "Copy this package contents into the repo root again, replacing existing files." -ForegroundColor Yellow
exit 1
