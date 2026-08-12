# Despublicação de emergência — tirar UMA matéria do ar

> Runbook operacional. Vale para erro de fato, nome errado, pedido de remoção,
> decisão judicial — qualquer situação em que uma matéria publicada precisa
> SAIR DO AR agora. **Despublicar, nunca apagar**: o rebaixamento preserva o
> texto para auditoria e permite reverter; exclusão física não existe neste
> fluxo.

## Como o ar funciona (o modelo em 4 linhas)

1. A página de notícia (`/pt/noticias/{slug}/`) é `force-dynamic`: lê o banco a
   cada requisição, sem cache ISR. Rebaixou no banco → 404 na requisição
   seguinte.
2. O gate de render só aceita `review_status` em `human_reviewed|published`
   (`packages/seo/src/article-publication.ts`). `blocked`/`archived` viram
   motivo `retracted` → `notFound()`.
3. A listagem `/pt/noticias/` e o sitemap (`news-sitemap.ts`) filtram pelos
   mesmos status; o sitemap ainda exige `index_status = 'index'`.
4. `blocked` é o vocabulário da **retratação**; `archived`, o da
   **despublicação comum**. Os dois tiram do ar; a diferença é o registro.

## Caminho normal (documento ainda existe no CMS)

No admin do Payload, mude o `workflowStatus` para `retracted`, `blocked` ou
`archived` (só `administrator`/`editor_in_chief` alcançam esses estados). A
transição emite `article.retracted`/`article.unpublished` na outbox e o worker
de projeção rebaixa o lado público. **Não use o delete** — excluir não
despublica (o `beforeDelete` recusa exclusão de matéria no ar exatamente por
isso).

> Mudar só o `_status` nativo do Payload para rascunho NÃO despublica: o hook
> deriva `_status` de `workflowStatus` e reverte.

## Caminho de emergência (documento apagado no CMS, worker parado, urgência)

### Opção A — CLI versionada (preferida)

No container com o repo e `DATABASE_URL` apontando para o banco público
(screen-db):

```bash
pnpm --filter @screena/news-ingestion unpublish-article -- --article 41
```

Sem `--apply` é **dry-run**: mostra o estado atual e o plano. Para executar:

```bash
pnpm --filter @screena/news-ingestion unpublish-article -- --article 41 --reason "motivo aqui" --apply --confirm-production
```

- `--confirm-production` é obrigatória quando `DATABASE_URL`/`NODE_ENV`
  parecem produção (dupla confirmação deliberada).
- `--mode blocked` para retratação; o default `archived` é despublicação.
- O comando é idempotente (segunda execução é no-op explícito), rebaixa TODAS
  as traduções do artigo, reprojeta busca + indexabilidade e **verifica com o
  próprio gate de render** que a página responderia 404. `updated` divergente
  do plano é ERRO, nunca silêncio.

**Saída esperada (sucesso):** estado atual por idioma, `rebaixadas: N`,
`reprojecao: busca + indexabilidade atualizadas`, estado final com
`render: 404` por idioma e `OK: artigo N fora do ar`.

**Saídas de falha:** `artigo N nao existe no banco publico` (exit 2);
`DATABASE_URL/NODE_ENV parecem PRODUCAO ... --confirm-production` (exit 3);
`esperava rebaixar N ... banco reportou M` (exit 1 — investigue antes de
repetir).

### Opção B — SQL direto (quando nem o repo está à mão)

No console do serviço **screen-db** no EasyPanel:

```bash
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE article_translations SET review_status = 'archived', index_status = 'noindex' WHERE article_id = 41 RETURNING id, language_code, slug, review_status, index_status;"
```

- **Saída esperada:** `UPDATE n` com `n >= 1` e as linhas retornadas mostrando
  `archived`/`noindex` — o `slug` retornado é a URL a conferir
  (`https://cinerie.com/pt/noticias/{slug}/` deve responder 404 na hora).
- **`UPDATE 0` significa que NADA mudou** — id errado ou artigo inexistente.
  Não presuma sucesso; confira o id com
  `SELECT article_id, slug, review_status FROM article_translations ORDER BY article_id;`
- Depois, se possível, rode a Opção A (mesmo já rebaixado, ela reprojeta busca
  e indexabilidade e confirma o estado — é idempotente).

## Depois da emergência

- Se o documento AINDA existir no CMS, retrate/arquive também lá — um novo
  evento de publicação recolocaria a matéria no ar.
- A reversão (voltar ao ar) é decisão editorial humana: republicar pelo CMS
  (`blocked/archived → needs_review → ... → published`).

## Por que o article 41 ficou órfão (e o que mudou)

Apagar um artigo no Payload não emitia evento nenhum (não havia
`afterDelete`), e a projeção pública ficava no ar para sempre. Desde esta
correção:

1. `beforeDelete` **recusa** excluir matéria no ar (`published`,
   `needs_update`) com instrução de retratar antes.
2. `afterDelete` emite `article.unpublished` para qualquer artigo que já foi
   publicado um dia (rede de segurança para os demais estados).
3. Bloquear/arquivar um artigo já publicado emite remoção **de qualquer
   estado de origem** — antes, só `published → blocked/archived` emitia, e o
   caminho `needs_update → blocked` deixava a matéria órfã no ar.

Prova com banco real:
`services/news-ingestion/src/__tests__/unpublish-emergency.integration.test.ts`
(publica → despublica → gate de render nega + sitemap não lista) e
`retraction-sequence.integration.test.ts` (remoção via evento).
