# Apaga as branches remotas cujo ultimo PR foi MERGED (squash-merge: o conteudo
# ja esta na main; cada PR mantem o botao "Restore branch" no GitHub).
# Protege main e qualquer branch com PR aberto no momento da execucao.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\cleanup-merged-branches.ps1

$ErrorActionPreference = 'Stop'
git fetch --prune | Out-Null

$prs = gh pr list --state all --limit 400 --json headRefName,state | ConvertFrom-Json
$latest = @{}
foreach ($pr in $prs) {
    if (-not $latest.ContainsKey($pr.headRefName)) { $latest[$pr.headRefName] = $pr.state }
}

$remote = git branch -r --format='%(refname:short)' |
    Where-Object { $_ -like 'origin/*' -and $_ -ne 'origin/main' -and $_ -notlike '*HEAD*' } |
    ForEach-Object { $_ -replace '^origin/', '' }

$deletable = $remote | Where-Object { $latest[$_] -eq 'MERGED' }
$kept      = $remote | Where-Object { $latest[$_] -ne 'MERGED' }

Write-Host "Mantidas (PR aberto/sem PR): $($kept.Count)" -ForegroundColor Yellow
$kept | ForEach-Object { Write-Host "  $_" }
Write-Host "Apagando $($deletable.Count) branches com PR mergeado..." -ForegroundColor Cyan

for ($i = 0; $i -lt $deletable.Count; $i += 30) {
    $batch = $deletable[$i..([Math]::Min($i + 29, $deletable.Count - 1))]
    git push origin --delete @batch
}

git fetch --prune | Out-Null
Write-Host "Concluido. Branches remotas restantes:" -ForegroundColor Green
git branch -r
