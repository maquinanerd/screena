# @screena/admin

Painel interno da Cinerie. Duas metades no mesmo app, atrás do mesmo portão:

- **Painel operacional** (`/`, desde 2026-09-15) — o estado real do catálogo, das
  filas, das cotas, dos serviços e dos usuários, e o botão de forçar a atualização
  de um título ou de uma fila sem abrir terminal. Contrato:
  [`docs/operations/admin-operacional.md`](../../docs/operations/admin-operacional.md).
- **Painel editorial** (`/editorial` e as telas de revisão) — `content_blocks` e
  `article_translations`, com escrita editorial atrás de
  `ADMIN_EDITORIAL_ACTIONS_ENABLED` (desligada por padrão).

`@screena/admin` é namespace técnico legado; a marca pública é **Cinerie**.
Implantação: [`docs/operations/admin-deploy.md`](../../docs/operations/admin-deploy.md).

## Telas do painel operacional

| Rota | O que responde |
| --- | --- |
| `/` | O que está quebrado agora (em vermelho, com o motivo escrito) + cobertura, filas, cotas e serviços |
| `/filas`, `/filas/<fila>` | Cadência, teto por ciclo, universo, volta declarada e medida, última execução, próxima, trabalho em `catalog_jobs`, dead-letter por motivo, gasto por dia |
| `/cotas` | Gasto de hoje (UTC), teto, folga, 30 dias, recusas do fornecedor; alerta de contador subcontando |
| `/servicos` | No ar, CPU, memória, commit rodando (pela impressão digital do código, não por env var), commits atrás do main, credenciais por nome/presença/formato |
| `/cobertura` | Por tipo e idioma: título, sinopse, pôster, trailer, nota exibível, indexável; retrato diário e medida ao vivo |
| `/titulos`, `/titulos/<filme\|serie>/<id>` | Busca e ficha de diagnóstico: ids, sinopse e payload, notas e por que não aparecem, mídia, jobs e posição na fila, indexação |
| `/usuarios` | Contas, cadastros por dia, ativos, e-mails (na tela, sem exportação), avaliações, listas e o que não existe |
| `/logs` | `api_sync_logs` e `catalog_jobs` com filtros e cursor |
| `/acoes`, `/acoes/<id>` | Toda ação do painel, o custo mostrado, o desfecho e o que o job fez depois |

## Regras que o código trava

| Regra | Onde |
| --- | --- |
| Todo número mostra fonte e momento; medida que falha diz "não determinado", nunca zero | `src/lib/ops/measure.ts`, `src/components/ops/measured.tsx` |
| Todo vermelho tem o caso vermelho testado e o controle negativo | `tests/admin/ops-lib.test.ts`, `tests/admin/ops-describe.test.ts` |
| A ficha dá o MESMO veredito que a página (nota, trailer, imagem, Score) | `tests/governance/admin-visibility-mirror.test.ts` |
| A cobertura usa os mesmos portões da página | `tests/governance/admin-coverage-mirror.test.ts` |
| As ações só ENFILEIRAM (INSERT em três tabelas), com auditoria na mesma transação | `tests/admin/ops-actions-guard.test.ts` |
| Nenhuma escrita Prisma nas páginas e servidores de leitura | `tests/admin/readonly-guard.test.ts` |
| `"use server"` só em `editorial-actions.ts` e `ops-actions.ts` | `tests/admin/no-server-writes.test.ts`, `no-write-endpoints.test.ts` |
| Nenhum formulário ou botão em `app/` (a UI de ação mora em `src/components`) | `tests/admin/pages-no-write.test.ts` |
| `noindex` no HTML, no cabeçalho de toda resposta (inclusive o 401) e no `robots.txt` | `tests/admin/ops-noindex.test.ts` |
| Sem login/sessão próprios: o portão é o Basic Auth fail-closed | `tests/admin/no-fake-login.test.ts` |

Prova contra PostgreSQL e Next reais: `pnpm --filter @screena/admin validate:ops-panel`
(exige `pnpm build:admin` antes).

## Fronteira de segurança

- O painel lê o PostgreSQL server-side. Não chama TMDB, OMDb, GitHub nem Gemini:
  quem fala com fornecedor é o `screen-cron` e o `screen-catalog-worker`.
- Credencial nunca é exibida: a tela de serviços mostra só nome, se está
  preenchida e o formato.
- E-mail de usuário aparece na tela, não vai para URL (busca por POST), não vai
  para log e não tem exportação.
- O painel não apaga nada, não muda licença nem `display_allowed`, não altera
  cadência nem teto de fila, e não para, reinicia nem implanta serviço.
