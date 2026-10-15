# Protecao da `main`

Este arquivo documenta a regra esperada no GitHub. Ele nao configura branch
protection sozinho; a regra precisa ser aplicada nas configuracoes do repositorio
por um mantenedor com permissao.

## Desde 2026-10-14: a CI roda na maquina local

O GitHub Actions deixou de ser usado (ver
[`docs/CI-MIGRATION-LOCAL.md`](../docs/CI-MIGRATION-LOCAL.md)). Nao existe mais
arquivo em `.github/workflows/`, entao nenhum push nem pull request dispara job no
GitHub. A validacao acontece antes do push, na maquina de quem muda o codigo:

```powershell
.\scripts\ci.ps1            # perfil padrao
.\scripts\ci.ps1 completo   # o job build inteiro do antigo workflow (container Linux)
.\scripts\ci.ps1 tudo       # build + backup-restore + docker-image
```

## Regra esperada

- Branch protegida: `main`.
- Merge apenas via pull request.
- Bloquear push direto para `main`, inclusive para administradores.
- Bloquear force push e exclusao da branch.
- **Nao** exigir status checks do GitHub Actions. Os tres contextos antigos
  (`Typecheck, lint, test, auditorias e build publico`,
  `Backup + restore real (fidelidade de dados, PostgreSQL 16)` e
  `Imagem Docker real (digest, nao-root, healthcheck)`) nunca mais serao
  reportados: se continuarem obrigatorios, todo PR fica parado em "Expected —
  Waiting for status to be reported" e nenhum merge acontece, nem por
  administrador (`enforce_admins`).

## Observacao operacional

Sem check obrigatorio, o GitHub nao impede o merge de um PR que nao passou na
CI local. A garantia passa a ser de processo: o pre-push (`corepack pnpm run
hooks:install`) e a regra do `CLAUDE.md` de rodar a CI local antes de concluir
qualquer tarefa. Quem abre o PR registra na descricao o perfil que rodou e o
resultado.
