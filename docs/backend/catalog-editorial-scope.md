# Escopo editorial do catalogo — Cinerie

> Documento **normativo** e versionado. Define O QUE entra no catalogo, com que
> frequencia e sob quais criterios. Alterar este escopo e decisao editorial
> humana; nenhum agente amplia o escopo por inferencia.
>
> Complementa (nao substitui): [`catalog-platform.md`](catalog-platform.md),
> [`catalog-cli.md`](catalog-cli.md) e os runbooks de
> [bootstrap](../runbooks/catalog-bootstrap.md) e
> [sync incremental](../runbooks/catalog-incremental-sync.md).

---

## 1. Por que existe um escopo

O TMDB tem milhoes de entidades. Ingerir tudo produziria um catalogo caro de
manter, impossivel de revisar e — o mais grave — **desequilibrado**: como o
detalhe de um titulo vem com `append_to_response=credits`, cada filme
sincronizado arrasta dezenas de pessoas junto. Sem escopo e sem gate, a
proporcao observada foi de **~22.400 URLs de pessoa contra ~129 filmes e ~110
series**.

Isso nao e "indexacao total" (invariante 5). A invariante manda indexar a
**entidade sincronizada**; ela nao obriga a publicar um registro que so existe
como efeito colateral do elenco de outra entidade.

O escopo abaixo e a resposta: **um catalogo pequeno, denso e completo** vale mais
que um catalogo grande e oco.

---

## 2. Escopo inicial (bootstrap)

| Dimensao | Valor |
| --- | --- |
| Filmes | ~100, estrategia `popular` |
| Series | ~100, estrategia `popular` |
| Idioma | `pt-BR` (invariante 7 — pt-BR publica primeiro) |
| Temporadas | **todas** das series selecionadas |
| Episodios | **todos** das temporadas selecionadas |
| Pessoas | **nenhuma por descoberta** — so elenco/equipe dos titulos acima |
| Entidades de referencia | colecao/produtora/rede/keyword vinculadas aos titulos |

Comando canonico (ver [catalog-cli](catalog-cli.md)):

```bash
pnpm catalog bootstrap --strategy popular --entity movie,tv --limit 100 --locale pt-BR --request-id <id> --apply
```

O bootstrap **so enfileira**; quem preenche e o worker:

```bash
pnpm catalog worker --concurrency 4 --max-jobs 0
```

### Por que `--entity movie,tv` e nunca `person`

`person` esta deliberadamente fora da descoberta. Pessoa **nao e ponto de
entrada** do catalogo: ela existe porque participa de uma obra que decidimos
cobrir. Passar `--entity person` reintroduz exatamente o desequilibrio que este
documento existe para evitar.

---

## 3. Regra de pessoa (elegibilidade)

Fonte canonica executavel: [`packages/seo/src/person-eligibility.ts`](../../packages/seo/src/person-eligibility.ts).

Uma pessoa so e **exposta publicamente** (pagina, listagem, sitemap) quando,
cumulativamente:

1. tem **nome** nao vazio;
2. tem **slug canonico** no idioma;
3. tem **pelo menos 1 credito** (elenco ou equipe) em um **filme ou serie** que
   ela propria seja publicavel (slug canonico no idioma + sem decisao vigente
   `!= index`).

Credito em **episodio nao qualifica sozinho** — quem sustenta a relevancia
editorial e a serie.

A pessoa inelegivel **continua no banco** (ela e parte do elenco e alimenta a
ficha do titulo). Ela apenas nao vira URL publica. Ingestao != publicacao.

---

## 4. Frequencias de sincronizacao

Derivadas das periodicidades de [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md).
Cada valor tem justificativa; nenhuma frequencia e arbitraria.

| Conjunto | Frequencia | Por que |
| --- | --- | --- |
| Configuracao TMDB (`/configuration`) | semanal | base de imagens muda raramente; um erro aqui quebra toda a midia |
| Listas de descoberta (`popular`, `now_playing`, `on_the_air`) | diaria | e o sinal que define o que entra no catalogo |
| Detalhe de filme/serie | 7–14 dias | metadados sao estaveis apos o lancamento |
| Lancamentos (titulo com estreia < 30 dias) | diaria | ficha, elenco e sinopse ainda mudam |
| Episodios de serie em exibicao | diaria perto da data de exibicao | episodio ganha titulo/still poucos dias antes |
| Episodios de serie encerrada | 30 dias | dado historico, praticamente imutavel |
| Midia (imagens/videos) | 7 dias ou apos mudanca de detalhe | poster/backdrop trocam em campanha |
| Creditos | junto do detalhe | vem no mesmo `append_to_response`; refetch separado e cota jogada fora |
| Pessoas | **nunca por agenda propria** | so re-sincroniza via a obra que a trouxe |
| `/changes` incremental | diaria (janela max. 14 dias) | mantem a fila fresca sem baixar o export inteiro |

---

## 5. Criterios de exclusao

Nao entram no catalogo, em nenhuma hipotese:

- **Conteudo adulto** — dupla camada obrigatoria: arquivos `adult_*` dos Daily ID
  Exports nunca sao baixados, e o campo `adult` e classificado *fail-closed* por
  linha (ver [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md)).
- **Titulos sem `title`/`name`** — sem titulo nao ha slug, e slug quebrado e pior
  que ausencia de pagina.
- **Qualquer fonte de pirataria** (invariante 8).
- **Dado sem licenca clara** — persiste para auditoria, nunca vira pagina
  indexavel (invariante 6).

---

## 6. Criterios de rollback

Se um ciclo de ingestao degradar o catalogo, a ordem de reacao e:

1. **Parar o worker** (`SIGINT` — drena o que esta em voo, nao abandona job).
2. **Ler o censo** (`pnpm catalog audit-database --json`) e comparar com o censo
   anterior: queda de entidades publicaveis ou explosao de pessoas sao os dois
   sinais de alarme.
3. **Inspecionar a dead-letter** (`pnpm catalog dead-letter list`).
4. **Restaurar por backup** quando houver corrupcao de dado
   (ver [BACKUP_RESTORE](../runbooks/BACKUP_RESTORE.md)). Nao existe "desfazer
   ingestao": a ingestao e idempotente, entao o caminho e corrigir a origem e
   reprocessar, ou restaurar.

Reexecutar o bootstrap **nao** e um risco: mesmas chaves de idempotencia, mesmo
resultado. Enfileirar de novo e noop.

---

## 7. Ampliacao do escopo

Ampliar exige, nesta ordem:

1. justificativa editorial escrita (por que este recorte agora);
2. estimativa de custo de cota e de volume de pessoas arrastadas;
3. atualizacao **deste documento** na mesma PR que amplia;
4. censo antes/depois anexado a PR.

Estrategias disponiveis alem de `popular`: `now_playing`, `upcoming`,
`top_rated`, `airing_today`, `on_the_air`, `trending`, `discover`,
`daily-exports`, `explicit-ids`. Nenhuma delas e "melhor" em abstrato — cada uma
define um catalogo diferente.

---

## 8. O que este escopo NAO autoriza

- Nao autoriza **ligar indexacao** (`CINERIE_PUBLIC_INDEXING_ENABLED` continua
  `0`; a decisao e humana e separada).
- Nao autoriza **publicar** conteudo editorial (`content_blocks` seguem o fluxo
  de revisao do Entity Writer).
- Nao autoriza **en/es** (invariante 7 — `PUBLISHED_LOCALES` e decisao humana).
- Nao autoriza **ratings** nem **onde assistir** — features com licenca propria,
  fora deste escopo.
