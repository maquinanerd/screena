# Runbook — Auditoria do banco em producao

> Operacional (pt-BR). SOMENTE LEITURA por construcao: o reader
> (`persistence/audit-reader.ts`) so usa count/findMany/groupBy/aggregate —
> nenhum UPDATE/create/delete/raw, nenhuma migration, nenhuma API externa.

## Comando

```
# dev/staging
pnpm catalog audit-database --json
pnpm catalog audit-database --human

# producao: ler e ato consciente, mesmo read-only
NODE_ENV=production pnpm catalog audit-database --json --confirm-production-read
```

Sem `--confirm-production-read` em producao, o comando sai com exit 3
(bloqueado) sem tocar o banco. Sem `DATABASE_URL`, idem. A saida NUNCA contem a
`DATABASE_URL` nem credencial (redaction em toda a CLI + check no validador).

## O que o relatorio traz

- contagens por entidade (movies, tv_shows, seasons, episodes, people,
  collections, companies, networks, keywords, aliases, cast/crew, tmdb_images,
  tmdb_videos, search_documents, discovery_snapshots, catalog_jobs,
  api_sync_logs, tmdb_raw) + `last_synced_at` mais recente;
- cobertura de midia/trailer por tipo (entidades DISTINTAS com imagem/trailer —
  40 posteres de 1 filme nao sao "40 filmes cobertos");
- fila por status + total de dead-letters;
- checkpoints (`tmdb_sync_checkpoint`) e frescor dos snapshots de descoberta;
- total/por-locale de documentos de busca.

## Regras

- O comando NAO muta nada (travado por check no validador: contagem de jobs
  antes == depois).
- Modelo ausente no client (schema divergente) nao derruba a auditoria: a linha
  simplesmente nao aparece (reportar 0 seria mentira).
- Nunca afirmar "catalogo cheio" sem este relatorio no ambiente correto.
