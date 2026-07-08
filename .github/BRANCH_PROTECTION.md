# Protecao da `main`

Este arquivo documenta a regra esperada no GitHub. Ele nao configura branch
protection sozinho; a regra precisa ser aplicada nas configuracoes do repositorio
ou via GitHub API por um mantenedor com permissao.

## Regra obrigatoria

- Branch protegida: `main`.
- Merge apenas via pull request.
- Bloquear push direto para `main`, inclusive para administradores quando
  possivel.
- Exigir que a branch esteja atualizada antes do merge.
- Exigir o workflow `CI`.
- Exigir o status check do job:
  `Typecheck, lint, test, auditorias e build publico`.

Esse job roda, nesta ordem: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm audit:invariants`, `pnpm audit:render` e `pnpm build`.

## Observacao operacional

Se o nome exibido pelo GitHub incluir o prefixo do workflow, use o check
`CI / Typecheck, lint, test, auditorias e build publico` como required check.
Sem essa regra habilitada no GitHub, o workflow existe, mas nao protege a `main`
contra merge/push sem checks verdes.
