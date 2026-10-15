<#
.SYNOPSIS
    CI local da Cinerie. Substitui o GitHub Actions: nada aqui fala com o GitHub.

.DESCRIPTION
    Wrapper de scripts/ci/pipeline.mjs. Os passos vivem em scripts/ci/steps.mjs
    (fonte unica); este arquivo so traduz os parametros.

    Perfis:
      rapido     typecheck, lint, test, auditorias, build do web (= hook pre-push)
      padrao     rapido + scripts .sh, CMS puro, prontidao, estilo, build do admin
      completo   o job build inteiro, com PostgreSQL 16 efemero (container Linux)
      backup     backup + restore real (container Linux)
      docker     imagens Docker reais, healthcheck e SIGTERM (container Linux)
      tudo       completo + backup + docker
      pre-commit eslint nos arquivos staged

    Sai 0 se tudo passou e 1 na primeira falha.

.EXAMPLE
    .\scripts\ci.ps1
.EXAMPLE
    .\scripts\ci.ps1 rapido
.EXAMPLE
    .\scripts\ci.ps1 completo -From seo-runtime
.EXAMPLE
    .\scripts\ci.ps1 -Only lint,test -SkipInstall
.EXAMPLE
    .\scripts\ci.ps1 padrao -List
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('rapido', 'padrao', 'completo', 'backup', 'docker', 'tudo', 'pre-commit')]
    [string]$Perfil = 'padrao',
    [string[]]$Only,
    [string]$From,
    [string[]]$Skip,
    [switch]$SkipInstall,
    [switch]$Container,
    [switch]$Native,
    [switch]$KeepEnv,
    [switch]$List
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ci\lib\invoke-node.ps1')

$nodeArgs = @($Perfil)
if ($Only) { $nodeArgs += @('--only', ($Only -join ',')) }
if ($From) { $nodeArgs += @('--from', $From) }
if ($Skip) { $nodeArgs += @('--skip', ($Skip -join ',')) }
if ($SkipInstall) { $nodeArgs += '--skip-install' }
if ($Container) { $nodeArgs += '--container' }
if ($Native) { $nodeArgs += '--native' }
if ($KeepEnv) { $nodeArgs += '--keep-env' }
if ($List) { $nodeArgs += '--list' }

Invoke-CiNode -Script 'scripts\ci\pipeline.mjs' -Arguments $nodeArgs
exit $LASTEXITCODE
