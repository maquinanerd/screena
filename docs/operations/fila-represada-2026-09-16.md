# Fila represada de 02/09 a 16/09/2026 — causa, conserto e o que conferir

> Medido em produção em 2026-09-16, no console do `screen-db`, somente leitura.
> Nenhum valor de chave, token ou senha aparece neste documento.

---

## 1. O que aconteceu, em uma frase

**A mídia POR EPISÓDIO da cascata automática ocupava o worker, e a fila global por
prioridade nunca chegava no resto.** Detalhe agendado, descoberta e `/changes`
ficaram 14 dias parados, sem nenhum erro.

`catalog_jobs` é reivindicado por `ORDER BY priority ASC, available_at ASC`, sem
raia por tipo. Um job só roda quando não há nada com número menor na frente.

| Medido (24 h até 16/09) | Valor |
| --- | --- |
| Jobs de mídia de episódio criados | **115.980**, para **108** séries (15,4 temporadas cada) |
| … da temporada de maior número de cada série | 8.471 (7,3%) |
| … das duas temporadas de maior número | 13.582 (11,7%) |
| Prioridade desses jobs | 80 |
| Capacidade do worker | 4 slots = 96 h/dia; ~92 h ocupadas |
| `sync_changes` / `discover_ids` pendentes | 58 / 42, **prioridade 100**, desde 02/09 e 03/09 |
| `sync_details` pendentes em 84/88/100 | 92 + 103 (retry) / 700 / 116 |
| `sync_details` falhados com P2003 em `original_language` | 648 (464 filmes, 184 séries) |
| Linhas em `languages` | **3** (`en`, `es`, `pt-BR`) |

A cascata religou em 28/08 (#256, escopo na chave do filho), e o balde de 7 dias
da folha (#257) não bastou: `airing_series` visita séries **diferentes** todo
dia, e as séries em exibição são as mais longas do catálogo.

---

## 2. Os três consertos (uma PR)

### A2 — mídia por episódio só das temporadas recentes, na cascata automática

`episodeMediaSeasons` no payload de `sync_details` e `sync_seasons`:

- `latest` (default, e o que agendador, `/changes` e descoberta usam): só a
  temporada do último episódio exibido e a do próximo anunciado
  (`last_episode_to_air` / `next_episode_to_air`, do mesmo `GET /tv/{id}`, sem
  requisição a mais);
- `all`: pedido de pessoa (`on_demand`, botões do painel), como antes.

Todo `sync_episodes` continua saindo, de todas as temporadas. O `sync_seasons`
escreve `enqueueEpisodeMedia` **explícito** em cada filho: o default do
`sync_episodes` é `true`, e omitir o campo religaria tudo.

Efeito esperado: de ~116 mil para algo entre ~8,5 mil e ~13,6 mil jobs/dia
(medido acima: a maior temporada e as duas maiores). **[DERIVADO]**

Detalhe: [`tmdb-temporada-episodio-cobertura.md` §3](./tmdb-temporada-episodio-cobertura.md).
Travado por `services/ingestion/src/catalog-jobs/handlers/__tests__/episode-media-seasons.test.ts`,
que roda a cascata inteira com os handlers reais e conta os jobs criados.

### B — os produtores na prioridade 20

`discover_ids` e `sync_changes` nasciam sem `priority` — 100, o default do
schema, o fim da fila. Agora saem de um builder único
(`services/ingestion/src/catalog-jobs/producer-jobs.ts`), usado pelos DOIS
produtores (agendador e serviço de catálogo), na prioridade **20**: atrás do
`on_demand` (10), junto do trending (20), na frente de todo trabalho por título.
São ~7 jobs por dia (3 descobertas diárias e 4 ciclos de `/changes`); o trabalho
que eles geram nasce nas faixas de sempre.

A chave de idempotência **não mudou** (conferida contra as chaves que estavam em
produção). Travado por `services/ingestion/src/catalog-jobs/__tests__/producer-jobs.test.ts`.

### D — o dicionário de idiomas chega à produção

O relatório anterior propunha estender a trava de idioma à atualização. **A medição
mudou o conserto:** a causa não era o portão. O vocabulário de 186 códigos só entrava
pelo seed, e produção roda `migrate deploy`, nunca o seed. `pt`, `ja` e `ko` — três
dos cinco idiomas que o recorte mantém — não tinham linha. A migration
`20260916120000_language_vocabulary` entrega a lista com `ON CONFLICT DO NOTHING`.
Detalhe: [`language-cutdown.md` §1](./language-cutdown.md).

---

## 3. O que NÃO volta

- **As mudanças do TMDB de 02/09 a 15/09.** `sync_changes` sem `from`/`to` pede as
  últimas 24 h **a partir de quando roda** (`resolveWindow`). Os 58 represados vão
  pedir todos a janela do dia em que rodarem. Recuperar o período exige rodar o
  `/changes` com janela explícita (teto de 14 dias do TMDB) — decisão do dono.
- **Os produtores já enfileirados continuam em 100.** A prioridade vale para o que
  nasce depois do deploy; a chave do dia (descoberta) e da hora (`/changes`) já
  enfileirados é a mesma, então o reenfileiramento é noop. Os antigos rodam quando
  a fila chegar neles — redundantes (a descoberta baixa o export de ONTEM a partir
  de quando roda, e os detalhes que ela gera têm chave sem escopo).

---

## 4. O que conferir depois do deploy

```sql
-- Mídia de episódio criada nas últimas 24 h (esperado: ~8,5 mil a ~13,6 mil)
SELECT count(*) FROM catalog_jobs
WHERE job_type = 'sync_media' AND entity_type = 'episode'
  AND created_at > (now() AT TIME ZONE 'UTC') - interval '24 hours';

-- Produtores novos nascendo em 20
SELECT job_type, priority, status, count(*) FROM catalog_jobs
WHERE job_type IN ('discover_ids', 'sync_changes')
  AND created_at > (now() AT TIME ZONE 'UTC') - interval '24 hours'
GROUP BY 1, 2, 3;

-- Vocabulário: 187 linhas
SELECT count(*) FROM languages;
```

E no painel, em 24 h e 72 h: os tipos represados saem do vermelho; P2003 de
`original_language` para de crescer.

**C, em seguida:** pôr a mídia da cascata atrás do trabalho de título (defesa
estrutural). Sozinha seria perigosa; depois de A2, é seguro.
