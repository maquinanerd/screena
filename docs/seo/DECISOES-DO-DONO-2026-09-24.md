# Decisões do dono — 24/09/2026 (portão de relevância de títulos)

> **O que este documento é.** O `CLAUDE.md` §6 exige **revisão humana** para
> **indexação em massa**. Esta é uma: tira do índice dezenas de milhares de
> páginas de filme e série.
>
> **A decisão foi tomada e assinada pelo dono em 24/09/2026, como ordem humana
> explícita**: "o portão de relevância NASCE LIGADO. Não é proposta. O dono não
> quer chave para editar. A ativação acontece no deploy, que a sessão local fará
> depois da simulação." Este arquivo é o registro dela. O código que a
> implementa o cita, para que quem encontrar um `noindex` de relevância chegue
> aqui e encontre a decisão, a data e o motivo.
>
> Formato e precedente: [`DECISOES-DO-DONO-2026-09-11.md`](DECISOES-DO-DONO-2026-09-11.md).

---

## R1 · Filme e série só ficam no índice se forem relevantes para o público brasileiro

**Decisão.** Um filme ou uma série **fica** no índice se valer **qualquer uma**
destas condições:

| Condição | Onde se lê |
| --- | --- |
| algum país de origem é **EUA** | filme: `movie_production_countries`, em qualquer posição; série: `tv_show_origin_countries` |
| algum país de origem é **Brasil** | idem |
| **`vote_count_tmdb >= 500`** | `movies.vote_count_tmdb` / `tv_shows.vote_count_tmdb` (nulo conta como 0) |
| tem **oferta de streaming no Brasil** | qualquer linha de `watch_availability` do título com `country_code = 'BR'` |

**Qualquer outro título sai**, inclusive o **sem país**:

- `noindex, follow`: a página continua de pé, acessível ao leitor, e os links dela
  continuam valendo;
- fora do sitemap;
- **temporadas e episódios da série que sai saem junto**, porque já exigiam a
  série dona no índice.

**Limiar e países ficam num lugar só:** `packages/config/src/relevance-gate.ts`
(`RELEVANCE_GATE_MIN_TMDB_VOTES = 500`, `RELEVANCE_GATE_ANCHOR_COUNTRIES = US, BR`,
`RELEVANCE_GATE_OFFER_COUNTRY = BR`). A regra pura é `evaluateRelevanceGate`
(`@screena/seo`), usada pela página. O SQL do sitemap é a segunda tradução, com
os mesmos números. Os dois nunca podem discordar: ver
`tests/web/sitemap-relevance-gate.test.ts` e `validate:relevance-gate`.

### Por quê (medido em produção em 24/09/2026)

- 108.974 títulos no catálogo, com **95.610 páginas de título no índice**.
- **82% do catálogo tem menos de 100 votos no TMDB.**
- A entrada diária (~2.090 títulos/dia) era 96% cauda, com menos de 100 votos,
  e 2/3 vinham de fora dos EUA. A origem era o `/changes`, fechado na PR
  `fix/ingestion-entrada-e-pais`.
- Estimativa: saem **~64,5 mil títulos** (50.012 com país fora de EUA/BR mais
  ~14,5 mil sem país) e **~52 mil páginas de título indexadas**. Nenhum com
  oferta no Brasil, por construção. Os números andam ~2 mil títulos por dia até
  a entrada ser fechada.
  A conta exata é a de `docs/operations/simulacao-portao-relevancia.sql`, rodado
  em produção antes do merge.

### Por que o sem país sai

O sem país é dado medido, não lacuna nossa. Dos **14.963** títulos sem país,
**14.939** têm a lista **vazia no próprio payload do TMDB**. Quase todos entraram
depois de 20/08, e 78% têm zero votos.

Os outros **24** são defeito de gravação: o payload tem país e o banco não. A
PR `fix/ingestion-entrada-e-pais` corrige com `catalog backfill-countries`. Esses
24 **voltam ao índice sozinhos** quando o país for gravado, porque o portão lê o
país gravado. A simulação mostra quantos sem país que saem têm país no payload
(`sem_pais_que_saem_e_tem_pais_no_payload_api_cache`).

### Por que "oferta" é qualquer linha BR, e não só a exibível

A pergunta do portão é **"o título é distribuído no Brasil?"**, e não "podemos
mostrar a oferta na tela?". A segunda é a invariante 6 (`display_allowed`,
licença), que continua valendo integralmente na tela. Toda oferta nasce
`display_allowed = false` e só é exibida depois de decisão de licença. Se o
portão exigisse a oferta exibível, a indexação de um título passaria a depender
de uma decisão de licença que nada tem a ver com relevância. Uma revogação de
licença tiraria do índice títulos com distribuição real no país, e um `supersede`
de licença já apagou ofertas da página uma vez
([`legal-supersede-carries-rows.md`](../operations/legal-supersede-carries-rows.md)).
O diagnóstico do dono também usou qualquer linha. O fato de haver oferta decide
só o índice e **não é exibido** por causa disso.

---

## R2 · Volta automática ao índice

O portão se abre sozinho, sem ninguém rodar comando. O título volta ao índice
**na página e no sitemap**, na revalidação seguinte, quando:

- chega a **500 votos** no TMDB (o sync do detalhe atualiza `vote_count_tmdb`);
- **ganha oferta no Brasil** (a ingestão de disponibilidade grava a linha BR);
- **ganha país EUA ou Brasil gravado**, inclusive pelo `backfill-countries` dos 24.

---

## R3 · Chave de emergência: `CINERIE_RELEVANCE_GATE=off`

- O portão **nasce ligado**. Não existe chave para *ligar*.
- Só a variável `CINERIE_RELEVANCE_GATE=off` desliga. Caixa e espaços das pontas
  são ignorados. **Ausente, vazia ou qualquer outro valor = ligado.** Um erro de
  digitação nunca reabre o índice.
- É lida em **runtime**, a cada consulta. **Nunca** é build-arg: nenhum
  Dockerfile nem o `next.config` a menciona (travado por teste). Basta mudar a
  variável no painel e reiniciar o serviço, sem rebuild. O sitemap muda na hora.
  A ficha que estiver no cache ISR muda na revalidação seguinte dela.
- Desligada, página e sitemap voltam **exatamente** ao que eram antes desta
  decisão. A página nem consulta país nem oferta. O SQL do sitemap recebe o
  primeiro termo do predicado como verdadeiro. Provado em
  `validate:relevance-gate`.

A chave é para **emergência**, como rollback sem deploy. Não é para ajustar a
regra: mudar a regra é nova decisão do dono, registrada aqui.

---

## R4 · O que esta decisão NÃO autoriza

- **Apagar.** Nenhum título, temporada, episódio, slug ou vínculo é apagado. A
  página continua acessível, com `follow`.
- Mexer em **home, listagens ou busca**. O portão vale para a indexação das
  páginas de filme, série, temporada e episódio e do sitemap. As listagens
  seguem com o critério que tinham.
- Mudar o **portão de pessoa** (D2). A filmografia da pessoa continua contando a
  obra pelo critério de 11/09/2026 (slug, D3 e decisão efetiva). Fazer a pessoa
  contar só obra relevante tiraria perfis do índice. A simulação mede quantos
  (`pessoas_se_a_filmografia_contasse_o_portao`, informativo), mas essa é **outra
  decisão, pendente do dono**.
- Mudar o limiar, os países ou a definição de oferta sem nova decisão registrada.

---

## Como a sessão local ativa (resumo; o roteiro completo está na PR)

1. Rodar `docs/operations/simulacao-portao-relevancia.sql` em produção.
2. Só seguir se `titulos_que_saem.com_oferta_br = 0` e
   `titulos_que_saem.pct_do_catalogo <= 70`.
3. Merge e deploy do app web. O portão entra ligado.
4. Contar as URLs de filme e série no sitemap publicado antes e depois.
5. Abrir uma página que deveria sair e conferir `noindex, follow`.
