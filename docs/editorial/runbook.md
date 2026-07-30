# Runbook editorial

> O que fazer quando algo da errado no pipeline editorial. Cada cenario tem
> sintoma, diagnostico e acao. Em pt-BR.
>
> Arquitetura: [`README.md`](./README.md).
> Operacao da redacao humana (papeis, abas, corpo, SEO, midia, workflow,
> auditoria): [`../operations/manual-editorial-workflow.md`](../operations/manual-editorial-workflow.md).

**Antes de diagnosticar, saiba em qual camada voce esta.** Sao tres, e elas
falham por motivos diferentes:

| Camada | Sintoma tipico de falha | Onde olhar |
| --- | --- | --- |
| **CMS manual** (Payload, banco editorial, storage de upload, usuario humano) | nao consigo salvar, publicar recusado, campo bloqueado | este runbook (cenarios 4, 7, 10, 11) + [`manual-editorial-workflow.md`](../operations/manual-editorial-workflow.md) |
| **Publicacao publica** (worker de projecao, screen-db, storage publico) | painel diz `published` e o site nao mostra | [`../operations/editorial-projection-worker.md`](../operations/editorial-projection-worker.md) |
| **Autopublicacao** (MNScr, conta tecnica, kill switch, quotas) | materia do pipeline nao entra, ou entra demais | [`../operations/editorial-auto-publication-quota.md`](../operations/editorial-auto-publication-quota.md) |

"Painel diz publicado mas o site nao mudou" quase sempre e a camada 2, nao a 1:
publicar no CMS grava um EVENTO; quem muda o site e o worker.

**Regra que atravessa todos os cenarios:** nenhum comando aqui roda contra
producao sem decisao humana explicita. Validador e desenvolvimento usam
PostgreSQL 16 efemero.

---

## Diagnostico rapido

```bash
pnpm validate:editorial-platform
```

Prova a cadeia inteira num PostgreSQL efemero. Se ela passa e producao esta
errada, o problema e de **dados/operacao**, nao de codigo.

---

## 1. Fonte parou de entregar

**Sintoma:** alerta `ingest_stalled` — fonte `active`, zero itens em 24h.

**Diagnostico:** confirmar se e a fonte ou o transporte. `last_ingested_at`
parado + `source_items` sem linha nova aponta para o upstream (o transporte
nao e desta plataforma).

**Acao:** se a fonte morreu de vez, `status = 'retired'`. Isso **para de
ingerir** e nao apaga nada — a evidencia historica continua ligada aos artigos
(FK `RESTRICT`).

**Nao faca:** apagar a fonte. E impossivel por FK e seria a operacao errada.

---

## 2. Item duplicado entrou

**Sintoma:** dois `source_items` para o mesmo fato.

**Diagnostico:** comparar `external_id`, `normalized_url` e
`content_fingerprint`. Um dos tres explica por que o dedup nao pegou:

| Causa | Sinal |
| --- | --- |
| fontes diferentes | `source_id` distinto — **e sindicacao, nao duplicata** |
| URL nao normalizavel | `normalized_url IS NULL` nos dois |
| upstream mudou o `external_id` | ids distintos para a mesma URL |

**Acao:** se for mesmo duplicata, marcar manualmente
(`dedup_verdict = 'duplicate'`, `duplicate_of_id = <primario>`). O CHECK exige
o primario e proibe autorreferencia.

**Nao faca:** relaxar o dedup para "manchete igual". Isso funde eventos
diferentes de anos diferentes — o falso positivo e o erro caro.

---

## 3. Agrupamento (`related`) errado

**Sintoma:** dois itens marcados `related` sem relacao real.

**Contexto:** `related` e um sinal **fraco** (mesma entidade + 48h) que **nao
funde e nao descarta**. Um `related` errado nao corrompe nada — so agrupa para
revisao.

**Acao:** voltar para `unique`. `related` nunca aponta `duplicate_of_id`
(CHECK garante).

---

## 4. Rascunho vazou para o publico

**Sintoma:** materia nao publicada aparece em listagem, artigo, relacionadas,
busca ou sitemap.

**Isto e um incidente**, nao um bug cosmetico.

**Diagnostico:** o gate e unico (`evaluateArticlePublication` em
`@screena/seo`). Um vazamento significa **uma superficie que nao o consulta**.

```bash
grep -rn "isPublishableArticle\|evaluateArticlePublication" apps/ services/
```

**Acao:** ligar a superficie ao gate canonico. **Nunca** reimplementar a regra
localmente — foi exatamente a duplicacao da regra que produziu o vazamento de
materia agendada corrigido no Prompt 10.

---

## 5. Materia agendada apareceu antes da hora

**Sintoma:** `published_at` no futuro e a materia ja esta visivel.

**Diagnostico:** alguma superficie compara `published_at IS NOT NULL` em vez
de `<= agora`. Os pontos historicamente afetados:

- `apps/web/src/lib/news-presenter.ts` (listagem, artigo, relacionadas)
- `apps/web/src/server/seo/sitemap-index.ts` (SQL do sitemap)
- `services/news-ingestion/src/projection.ts` (busca, indexabilidade)

**Acao:** garantir `nowIso` injetado e comparacao `<=`. Coberto por
`validate:editorial-platform` (check 16).

---

## 6. Agendada passou da hora e nao apareceu

**Sintoma:** alerta `scheduled_overdue`.

**Contexto esperado:** **nao existe scheduler**. A materia passa a aparecer
sozinha nas superficies que consultam o banco a cada request, mas as
**projecoes derivadas** (busca, indexabilidade) precisam ser reprocessadas.

**Acao:** reprocessar a projecao do artigo (`reprojectArticle`). Idempotente.

---

## 7. Artigo publicado sem proveniencia

**Sintoma:** alerta `article_without_provenance` (**critical**).

**Contexto:** `evaluatePublishGate` exige >= 1 fonte. Um artigo publicado sem
fonte foi publicado **fora do gate** (escrita direta no banco) ou perdeu o
vinculo.

**Acao:** restabelecer o vinculo (`linkArticleSource`). Se a fonte real nao for
conhecida, **despublicar** (`blocked`) ate ser. Nao inventar fonte.

---

## 8. Busca desatualizada (`search_projection_stale` / `_broken`)

**Sintoma:** artigo publicado nao aparece na busca, ou materia retratada ainda
aparece.

**Diagnostico:**

```sql
SELECT COUNT(*) FROM search_documents WHERE doc_kind = 'article';
```

**Acao:** reprojetar. A projecao e **reversivel nos dois sentidos** — cria
quando o artigo e publicavel e **remove** quando deixa de ser.

**Nao faca:** apagar linhas de `search_documents` a mao para "limpar". O
unique parcial `search_documents_article_unique` ja impede duplicata.

---

## 9. Indexabilidade desatualizada

**Sintoma:** alerta `indexability_stale`.

**Acao:** reprojetar. A escrita e **sem churn**: decisao identica a vigente nao
grava nada. Uma execucao que grava uma linha por artigo por rodada e bug — a
tabela viraria log de execucao em vez de registro de decisao.

**Se aparecer** `supersedes_id ... deve referenciar decisao do mesmo ...`: a
guarda `page_indexability_supersedes_same_group()` esta na versao ANTIGA
(NULL-blind). Confirmar pelo corpo real da funcao — `migrate deploy` compara
**nomes**, nao checksums:

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'page_indexability_supersedes_same_group';
```

Deve conter `IS NOT DISTINCT FROM` e `doc_kind`.

---

## 10. Artigo publicado por engano

**Acao:** `review_status = 'blocked'` (despublicar) e reprojetar. O artigo sai
de listagem, artigo, relacionadas, busca e sitemap; a proveniencia e o
historico **permanecem**.

Para retirada definitiva com registro: `archived` (retratacao).

**Nao faca:** deletar o artigo para "sumir com o problema". Deletar aciona
CASCADE nas projecoes e apaga a rastreabilidade editorial.

---

## 11. Correcao de fato

**Acao:** editar o corpo e preencher `corrected_at` **e** `correction_note`
(os dois juntos; CHECK exige). Slug e `published_at` **permanecem**.

**Nao faca:** editar silenciosamente um fato publicado sem nota, nem trocar o
slug "para atualizar a URL" — isso quebra links e zera o historico.

---

## 12. Job/ingestao presa

**Contexto:** a ingestao editorial **ainda nao usa** `catalog_jobs`; nao ha
dead-letter editorial. Itens com falha ficam em `status = 'failed'` e o alerta
`ingest_failures` os sinaliza.

**Acao:** reingerir o item (idempotente: zero duplicata).

---

## 13. Reprocessamento seguro

Todas as operacoes do pipeline sao idempotentes e podem ser repetidas:

| Operacao | Repetir e seguro? |
| --- | --- |
| `ingestEditorialItem` | sim — upsert por `(source, external_id)` |
| `linkArticleSource` | sim — `ON CONFLICT DO NOTHING` |
| `reprojectArticle` | sim — 1 documento, 1 decisao vigente |
| `writeArticleSlugRedirect` | sim — colapsa cadeia, nunca grava A -> A |

---

## 14. Rollback

A migration `20260727120000_editorial_news_platform` e **aditiva**: cria
tabelas/colunas/indices novos e **nao** remove nem altera dado existente.

Rollback logico (preferido): parar de usar as tabelas novas. As colunas
`doc_kind` nascem `'entity'`, entao busca e indexabilidade voltam ao
comportamento anterior sem nenhum DDL.

Rollback fisico (so com decisao humana e backup validado): dropar
`article_source_links`, `source_items`, `editorial_sources`, as colunas novas e
os enums, **e restaurar** a versao anterior de
`page_indexability_supersedes_same_group()`.

> Atencao: sem restaurar a funcao, a guarda permanece na versao kind-aware.
> Isso e **inofensivo** para entidades (a condicao e mais estrita, nunca mais
> frouxa), mas precisa estar no plano para nao virar surpresa.
