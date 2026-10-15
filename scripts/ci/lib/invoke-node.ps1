# Compartilhado pelos wrappers .ps1 da CI local (ci, doctor, clean).
# Compativel com Windows PowerShell 5.1 e PowerShell 7. So ASCII: o 5.1 le
# .ps1 sem BOM como ANSI.
#
# Nao devolve valor de proposito: o Node escreve direto no console (cores,
# progresso), e o chamador le o codigo em $LASTEXITCODE. Capturar a saida com
# `$x = Invoke-CiNode` misturaria o texto do Node com o codigo de saida.

function Invoke-CiNode {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @()
    )
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host '[ERRO] Node nao encontrado no PATH. Instale o Node 22 (ver .nvmrc) e abra um terminal novo.' -ForegroundColor Red
        $global:LASTEXITCODE = 1
        return
    }
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    Push-Location $repoRoot
    try {
        & $node.Source (Join-Path $repoRoot $Script) @Arguments
    }
    finally {
        Pop-Location
    }
}
