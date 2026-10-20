<#
.SYNOPSIS
    Limpeza MANUAL de artefatos. A CI nunca chama isto.

.DESCRIPTION
    Wrapper de scripts/ci/clean.mjs. Sem opcoes, remove .next, tsbuildinfo,
    saidas do Playwright, coverage e capturas de QA.

.PARAMETER NodeModules
    Remove tambem todos os node_modules (exige `corepack pnpm install` depois).

.PARAMETER Docker
    Remove tambem a imagem do executor, as tags *:ci e os volumes de cache da CI local.

.PARAMETER DryRun
    So lista o que seria removido.

.EXAMPLE
    .\scripts\clean.ps1 -DryRun
.EXAMPLE
    .\scripts\clean.ps1 -NodeModules -Docker
#>
[CmdletBinding()]
param(
    [switch]$NodeModules,
    [switch]$Docker,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ci\lib\invoke-node.ps1')

$nodeArgs = @()
if ($NodeModules) { $nodeArgs += '--node-modules' }
if ($Docker) { $nodeArgs += '--docker' }
if ($DryRun) { $nodeArgs += '--dry-run' }

Invoke-CiNode -Script 'scripts\ci\clean.mjs' -Arguments $nodeArgs
exit $LASTEXITCODE
