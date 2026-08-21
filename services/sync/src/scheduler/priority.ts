/**
 * priority.ts — A ORDEM DENTRO DE UMA FILA E MEDIDA, NAO ALFABETICA. PURO.
 *
 * ============================================================================
 * O QUE ESTAVA ERRADO
 * ============================================================================
 * A selecao de candidatos de ratings ordenava por `e."id" ASC`
 * (`services/ratings/src/persistence/stale-entity-candidates.ts`), e o
 * comentario dizia o motivo: ordem ESTAVEL, para o relatorio nao "pular"
 * candidatos entre execucoes. O motivo e legitimo — determinismo importa — mas a
 * escolha do CAMPO nao era. `id` e ordem de INSERCAO: quem entrou primeiro no
 * catalogo passa na frente para sempre, independentemente de alguem estar
 * olhando aquela pagina.
 *
 * Com 239 titulos isso e invisivel. Com 10 mil e uma volta de dez dias, `id ASC`
 * significa que o titulo mais pedido do site pode esperar nove dias atras de
 * novecentos titulos que ninguem abriu — e a fila continua deterministica e
 * continua errada.
 *
 * ============================================================================
 * QUAL SINAL FOI USADO, E POR QUE ESTE
 * ============================================================================
 * **`popularity` do TMDB** (`movies.popularity` / `tv_shows.popularity`).
 *
 *  - E MEDIDO, nao inferido: o TMDB o calcula a partir de visualizacoes de
 *    pagina, votos, favoritos e watchlist do dia anterior.
 *  - Ja EXISTE preenchido para todo o catalogo e ja tem INDICE
 *    (`@@index([popularity])` nas duas tabelas). Nao inventa coluna, nao pede
 *    migration, nao muda o custo da consulta.
 *  - E ATUALIZADO por nos: chega em todo sync de detalhe. Um titulo que
 *    explodiu de audiencia sobe na fila no ciclo seguinte, sozinho.
 *
 * ============================================================================
 * E O "TITULO QUE O LEITOR ABRIU RECENTEMENTE"? NAO EXISTE MEDICAO.
 * ============================================================================
 * Isto precisa ser dito com todas as letras em vez de virar uma coluna
 * inventada: **a Cinerie nao registra visualizacao de pagina.** Nao ha tabela de
 * pageview, nao ha contador em `slugs`, nao ha analytics no banco. As unicas
 * acoes de leitor persistidas sao de usuario LOGADO (`viewing_events`,
 * `user_watch_states`) — dado esparso, de outra populacao, que nao responde
 * "que pagina foi aberta".
 *
 * Ordenar por um sinal que nao se mede seria fabricar prioridade. Entao:
 *
 *  1. a ORDEM da fila de fundo usa `popularity`, que e o melhor proxy MEDIDO de
 *     demanda de leitor disponivel hoje;
 *  2. a demanda REAL de leitor — alguem esperando na tela agora — nao e tratada
 *     por ordenacao e sim por RESERVA DE COTA (`checkOmdbBudget`, consumidor
 *     `on_demand`). E uma garantia mais forte que ordenacao: ordem so ajuda se a
 *     fila chegar no item; reserva garante que o leitor passa mesmo com a fila
 *     de fundo cheia.
 *
 * Quando existir medicao de pageview, ela entra aqui como segundo termo — e este
 * comentario e o registro de que a ausencia foi vista, nao esquecida.
 *
 * ============================================================================
 * DETERMINISMO PRESERVADO
 * ============================================================================
 * `popularity DESC NULLS LAST, id ASC` continua sendo uma ordem TOTAL: o
 * desempate por `id` mantem a propriedade que o comentario original protegia —
 * dois ciclos com o mesmo `limit` veem o mesmo prefixo enquanto a popularidade
 * nao mudar.
 */

/** O criterio de ordenacao da fila de fundo, como SQL. */
export const CATALOG_PRIORITY_ORDER_SQL = 'e."popularity" DESC NULLS LAST, e."id" ASC'

/**
 * ONDE A PRIORIDADE E APLICADA — e nao e aqui.
 *
 * Este modulo declara o SINAL e a ORDEM de selecao. A conversao de rank em
 * `catalog_jobs.priority` vive em `entity-coverage/entry.ts`
 * (`popularityPriorityOffset`), a porta UNICA de cobertura, porque prioridade de
 * job e propriedade do job — e duas tabelas de faixas, uma aqui e outra la,
 * divergiriam no primeiro ajuste.
 *
 * O contrato que a porta impoe: o maior deslocamento por popularidade (+20) e
 * MENOR que o menor intervalo entre motivos (50 -> 80). Popularidade ordena
 * dentro do motivo; ela nunca promove um pedido para a faixa de outro.
 */
