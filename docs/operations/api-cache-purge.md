# Expurgo do `api_cache` — o lixo que nunca era recolhido

> Runbook operacional. A execucao em **producao e do dono**: este documento
> prepara o comando e diz o que medir. Nenhum agente roda isto sozinho.

---

## O que foi medido (2026-09-01)

| Metrica | Valor |
| --- | ---: |
| `api_cache` — linhas | **543.936** |
| `api_cache` — tamanho | **5.075 MB** (~50% do banco de 10 GB) |
| Linhas **vencidas** (`expires_at < now()`) | **500.140 — 89%** |
| Espaco ocupado pelas vencidas | **~3,6 GB** |
| Comandos de expurgo existentes | **nenhum** |

A coluna `expires_at` sempre existiu e sempre foi respeitada na **leitura**. O
que nunca existiu foi alguem **recolhendo** o que venceu. O cache funcionava; o
lixo dele so crescia.

---

## A regra que nao pode ser relaxada

**`expires_at IS NULL` nunca e apagado.**

NULL nao significa "venceu ha muito tempo" — significa **sem prazo**. Um
`expires_at < now()` sozinho ja exclui NULL (a comparacao da NULL, nunca
`true`), mas todo predicado deste runbook declara `IS NOT NULL` **explicitamente**,
para que a regra fique legivel para quem for editar a consulta em vez de depender
de o leitor lembrar da semantica de tres valores do SQL.

---

## Antes: medir

```sql
SELECT count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now()) AS vencidas,
       count(*)                                                             AS total,
       pg_size_pretty(pg_total_relation_size('api_cache'))                  AS tamanho
  FROM api_cache;
```

Guarde as tres colunas. Sem o "antes" nao ha como afirmar o ganho depois.

---

## Opcao A — pela CLI (preferida)

Ela apaga em lotes, registra em `api_sync_logs` e diz se sobrou trabalho.

**1. Dry-run — conta e nao apaga (nao precisa da variavel de ambiente):**

```bash
corepack pnpm --filter @screena/sync exec tsx bin/purge-api-cache.ts
```

**2. Executar** — exige `CINERIE_CACHE_PURGE_ENABLED=true` no ambiente **e**
`--apply`. As duas coisas: a variavel autoriza a *instalacao* a expurgar, a flag
autoriza a *invocacao*. Um `--apply` colado de um runbook de staging nao apaga
producao sozinho.

```bash
corepack pnpm --filter @screena/sync exec tsx bin/purge-api-cache.ts --apply
```

Cada execucao recolhe ate `40 lotes x 5.000 = 200.000` linhas. Para os ~500 mil
do passivo historico, **rode 3 vezes** — ou aumente o teto de uma vez:

```bash
corepack pnpm --filter @screena/sync exec tsx bin/purge-api-cache.ts --apply --max-batches=120
```

A saida diz `TETO DE LOTES atingido` quando ainda sobrou trabalho. "Acabou" e
"cansei" nao saem iguais.

---

## Opcao B — SQL direto, se preferir nao rodar Node no servidor

Idempotente e interrompivel: cada volta apaga no maximo 5.000 linhas e pode ser
parada a qualquer momento sem deixar estado pela metade.

```sql
-- Repita ate `DELETE 0`. Cada volta e uma transacao curta.
DELETE FROM api_cache
 WHERE id IN (
   SELECT id
     FROM api_cache
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
    ORDER BY id
    LIMIT 5000
 );
```

**Nao** troque por um `DELETE` unico sobre as 500 mil linhas: ele segura a
transacao, incha o WAL e disputa lock com o `screen-catalog-worker`, que escreve
em `api_cache` continuamente.

---

## Depois: recuperar o espaco

`DELETE` marca as linhas como mortas; ele **nao devolve disco ao sistema de
arquivos**. Sem este passo a tabela continua com 5 GB no `df`.

```sql
VACUUM (VERBOSE, ANALYZE) api_cache;
```

`VACUUM` simples devolve o espaco para reuso **da propria tabela** — suficiente
aqui, porque `api_cache` volta a crescer e vai reocupar o espaco liberado.

> `VACUUM FULL` devolveria o espaco ao sistema operacional, mas **trava a tabela
> inteira** (`ACCESS EXCLUSIVE`) pelo tempo da reescrita, derrubando leitura e
> escrita. Com o worker de catalogo ativo, nao vale: escolha `VACUUM FULL` so
> numa janela de manutencao declarada, com o worker parado.

---

## Medir o ganho

```sql
SELECT count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now()) AS vencidas,
       count(*)                                                             AS total,
       pg_size_pretty(pg_total_relation_size('api_cache'))                  AS tamanho
  FROM api_cache;
```

**Aceite:** `vencidas` proximo de zero e `tamanho` bem abaixo dos 5.075 MB
iniciais.

E o registro do trabalho, uma linha por fornecedor:

```sql
SELECT provider_api, sum(items_processed) AS linhas_apagadas, max(created_at) AS ultima
  FROM api_sync_logs
 WHERE endpoint = 'scheduler/cache_purge'
 GROUP BY provider_api
 ORDER BY 2 DESC;
```

---

## Runbook em cinco linhas

1. Medir (consulta de "antes").
2. `... purge-api-cache.ts` **sem** `--apply` e conferir a contagem.
3. Definir `CINERIE_CACHE_PURGE_ENABLED=true` e rodar com `--apply --max-batches=120`.
4. `VACUUM (VERBOSE, ANALYZE) api_cache;`
5. Medir de novo e comparar com o passo 1.

---

## Pendente: a cadencia automatica

A CLI existe e e segura; **o que ainda nao existe e quem a chama todo dia.**

Wire-la como fila do agendador (`services/sync/src/scheduler`) esbarra numa
decisao que e do dono, e ela nao e cosmetica:

- `readLastRuns` deriva "quando esta fila rodou" de `api_sync_logs`, e uma fila
  sem registro vira alerta `never_ran` depois de 6 h de carencia
  (`stalled.ts`).
- Um ciclo que **nao encontra nada vencido** nao tem o que registrar:
  `api_sync_logs.provider_api` tem **FK para `api_providers.key`**, e o expurgo
  nao e um fornecedor. As chaves que ele usa hoje vem do proprio
  `RETURNING provider_api` — validas por construcao, mas so existem quando algo
  foi apagado.
- Criar uma chave de manutencao em `api_providers` resolveria, e exige
  **migration** — que `CLAUDE.md` §10 proibe fora de tarefa aprovada para banco.

As tres saidas possiveis, para o dono escolher:

| Saida | Custo | Efeito |
| --- | --- | --- |
| **Cron do sistema** chamando a CLI (`screen-cron` ou systemd timer) | nenhum codigo novo | Nao entra no painel de filas; observa-se pelas linhas de `api_sync_logs`. |
| **Fila do agendador** + chave `maintenance` em `api_providers` | uma migration + semente + allowlist do validador | Entra no painel como as outras, com alerta de fila parada. |
| **Fila do agendador** sem chave nova | nenhum | Ciclo sem trabalho nao registra, e a fila acusa `never_ran` de tempos em tempos — ruido no painel. |

Enquanto a decisao nao vem, o passivo se resolve com este runbook, e o
crescimento diario e pequeno perto dos 3,6 GB acumulados em 13 meses.
