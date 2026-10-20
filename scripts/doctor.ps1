<#
.SYNOPSIS
    Confere se esta maquina tem o que a CI local precisa. Nao instala nada.

.DESCRIPTION
    Wrapper de scripts/ci/doctor.mjs. Mostra [OK], [AVISO], [ERRO] e [INFO];
    sai 1 se houver algum [ERRO].

.EXAMPLE
    .\scripts\doctor.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ci\lib\invoke-node.ps1')

Invoke-CiNode -Script 'scripts\ci\doctor.mjs'
exit $LASTEXITCODE
