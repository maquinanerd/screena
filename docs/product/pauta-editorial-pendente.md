# Pauta editorial pendente — o que precisa ser **escrito**

> **Isto não é uma pendência de engenharia.** Os dois blocos estão prontos para
> receber; o que falta é texto. Prontidão verificada por
> [`tests/web/pauta-editorial-prontidao.test.ts`](../../tests/web/pauta-editorial-prontidao.test.ts).
>
> Nada aqui autoriza gerar conteúdo automaticamente. Publicação passa por humano
> (invariante 12), e `en`/`es` seguem `PUBLISHED_LOCALES` (invariante 7).

## Por que este documento existe

Bloco vazio por falta de **fiação** e bloco vazio por falta de **texto** são
idênticos na tela. Sem separá-los, a pendência fica no lugar errado — alguém
procura um comando que não existe, ou espera um artigo que nunca foi pautado.

A fiação está provada. O que resta está abaixo.

---

## 1. Guia por temporada

**Estado:** o bloco renderiza, o gate funciona, **zero blocos escritos**.

| | |
|---|---|
| **Onde entra** | `/pt/series/{slug}/` — seção "Episódios" |
| **Tipo de bloco** | `season_guide` (e `episode_context`, para o contexto de um episódio) |
| **Tabela** | `content_blocks` |
| **Gate de exibição** | `review_status` ∈ `human_reviewed`, `published` |
| **Motivo da ausência hoje** | `no_editorial_review` (`actionable: false` — nenhum comando destrava) |
| **Prompt versionado** | **não existe ainda** — precisa ser criado em `prompts/` |

### O que precisa ser escrito

Um bloco por **série**, cobrindo as temporadas: o que cada uma é, por onde
começar, o que muda de tom entre elas. É o bloco de valor 12 da lista canônica
("guia de temporadas") e o 11 quando trata de ordem cronológica.

### O que ele NÃO pode ser

- **Sinopse importada reescrita.** Copiar sinopse externa desqualifica o bloco
  como valor próprio (regra do Entity Writer, seção 4).
- **Contagem de episódios.** Isso já está na ficha técnica; repetir não é guia.
- **Gerado sem payload controlado.** Se o Entity Writer for usado, o fato tem de
  vir do PostgreSQL — ele não inventa número de temporada nem data.

### Antes de gerar pelo Entity Writer

1. Criar `prompts/season_guide_pt.md`, versionado.
2. Registrar `prompt_version` e `input_hash` em cada bloco gerado.
3. O bloco nasce `ai_generated`/`needs_review` — **não aparece na tela** até
   revisão humana.

---

## 2. Notícias vinculadas

**Estado:** o bloco renderiza nas duas verticais, o gate funciona, **zero
artigos publicados com vínculo**.

| | |
|---|---|
| **Onde entra** | `/pt/filmes/{slug}/` e `/pt/series/{slug}/` — seção "Notícias" |
| **Tabelas** | `articles` + `article_translations` + `entity_news_links` |
| **Gate de exibição** | `review_status` ∈ `human_reviewed`, `published` |
| **Motivo da ausência hoje** | `no_linked_article` (`actionable: false`) — o que falta é o **vínculo**, não a notícia |
| **Limite na tela** | 3 por título |

### O que precisa ser escrito

Matérias reais, publicadas pelo CMS, **com vínculo de entidade**. O vínculo é o
ponto: um artigo publicado sem `entity_news_links` não aparece em título nenhum
— ele existe em `/pt/noticias/` e some do detalhe.

### O caminho, ponta a ponta

1. Redigir e publicar a matéria no CMS (Payload).
2. Vincular à entidade — o `entity-resolve` interno resolve o título; ele
   **recusa ambiguidade** e devolve `null` em vez de palpite (ADR 0019).
3. O worker de projeção leva ao banco público.
4. O bloco aparece no detalhe, no ciclo seguinte.

### O que NÃO destrava isto

Nenhum comando, nenhuma flag, nenhuma migration. É pauta.

---

## O que eu deliberadamente não fiz

- **Não gerei conteúdo.** Nem por IA, nem por template.
- **Não criei placeholder.** "Em breve" num bloco editorial é promessa sem data;
  a seção sai do DOM e a ausência vai para o log, que é o desenho da casa.
- **Não afrouxei o gate de revisão** para mostrar rascunho. Bloco
  `ai_generated` visível seria texto que nenhum humano leu, publicado como
  editorial. Há teste que reprova se alguém tentar.

## Como saber que acabou

Quando houver conteúdo, o bloco aparece **sem deploy**: os dois leem do banco e
o gate é `review_status`. Enquanto não houver, cada página emite uma linha de
`section_absent` com `actionable: false` — que é o registro de que a pendência
é editorial, e não de operação.
