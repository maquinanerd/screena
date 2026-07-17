---
name: add-entity
description: Use quando precisar adicionar uma nova entidade (filme, serie, temporada, episodio, pessoa) à Cinerie. Cobre ingestao offline via TMDB, normalizacao no PostgreSQL, criacao de slug por idioma, gate anti-thin e exigencia de revisao humana. O admin atual e read-only; cadastro manual via admin e fluxo futuro. NAO use para gerar texto editorial (isso e o Entity Writer).
---

# Skill: add-entity

Esta skill descreve o procedimento canonico para **adicionar uma entidade** na base da Cinerie.
A entidade e o nucleo da arquitetura entity-first: ela nasce de dados normalizados, nunca de
texto gerado por IA.

> **Origem da entidade (inegociavel):** toda entidade nasce via **TMDB offline em
> TypeScript/Node + Prisma** ou, futuramente, por fluxo de escrita com admin
> humano. O admin atual (`@screena/admin`) e **read-only**. Uma entidade
> **NUNCA** e criada pelo Entity Writer e **NUNCA** pelo MN26. O Entity
> Writer apenas escreve `content_blocks` a partir de payload controlado de uma entidade que ja
> existe; ele nao cria entidades, nao inventa fatos e nao chama APIs externas.

## Quando usar

- Importar um filme/serie/pessoa novo do TMDB por processo offline, quando o escopo da tarefa permitir.
- Planejar/validar cadastro manual futuro via admin; nao executar escrita no `@screena/admin` atual, que e read-only.
- Reprocessar/normalizar uma entidade ja existente apos atualizacao de fonte.

## Quando NAO usar

- Para escrever introducao editorial, FAQ, resumo etc. -> isso e o **Entity Writer**
  (`content_blocks`).
- Para criar um novo conector de API -> use a skill **new-api-client**.
- Para publicar/indexar -> publicacao e decisao separada, registrada em
  `page_indexability_decisions`.

## Pre-requisitos

- A entidade deve ter uma **fonte de origem identificada** (TMDB id em `entity_external_ids`;
  cadastro manual com autor humano depende de fluxo de escrita futuro).
- Chaves de API (TMDB etc.) **somente em env vars** — nunca no frontend, nunca em paginas de
  render.
- Ja existem schema Prisma e client TMDB real em TypeScript/Node. Reuse o fluxo existente; nao
  reimplemente TMDB em Python nem leia API externa no render.
- Para TMDB, prefira `TMDB_READ_ACCESS_TOKEN` (v4); `TMDB_API_KEY` (v3) e fallback quando suportado.

## Passos

1. **Identificar a fonte e o tipo da entidade.**
   - Defina `entity_type` (movie, tv_show, season, episode, person).
   - Garanta o id externo (ex.: TMDB) registrado em `entity_external_ids`. Nunca duplique
     entidade que ja exista — verifique por id externo antes de criar.

2. **Buscar no TMDB offline (estado atual, quando o escopo permitir).**
   - A busca ocorre **somente em worker offline**, via api-client dedicado (ver skill
     new-api-client). Nunca no render, nunca em pagina indexavel.
   - Todo fetch externo gera log em `api_sync_logs`.
   - Respeite licenca/atribuicao da fonte: campos de licenca vivem em `source_licenses` e, para
     ratings, em `external_ratings` (`license_status`, `display_allowed`).

3. **Normalizar e gravar no PostgreSQL.**
   - Persista nas tabelas canonicas (`movies`, `tv_shows`, `seasons`, `episodes`, `people`,
     `cast_members`, `crew_members`, etc.). NAO grave payload cru de API como conteudo
     publicavel.
   - **provider_api != rating_source**: o fornecedor tecnico (ex.: RapidAPI/TMDB) nunca e a fonte
     editorial. Guarde os dois separados.
   - **IMDb != Rotten Tomatoes**: nunca misture fontes, escalas, icones ou linguagem. Nota IMDb
     (escala 10) nunca vira Tomatometer (escala 100).

4. **Criar slug por idioma.**
   - Gere slug em `slugs` para cada idioma ativo. **pt-BR publica primeiro**; **en/es nascem em
     draft/noindex** ate revisao humana.
   - Slug deve refletir o tipo na URL: `/pt/filmes/{slug}/` (filme) vs `/pt/series/{slug}/`
     (serie). A diferenciacao filme/serie **nunca depende so da cor**: label + badge + breadcrumb
     + schema + URL.
   - Mudancas de slug geram entrada em `redirects` (nunca quebre URL ja publicada).

5. **NAO publicar automaticamente.**
   - Adicionar entidade **nao** publica nada. Publicacao e um passo humano/editorial separado.
   - Entidades prioritarias (lancamentos, alto trafego) **exigem revisao humana** antes de
     qualquer publicacao.

6. **Decidir index/noindex via gate anti-thin.**
   - Registre a decisao em `page_indexability_decisions` (index, noindex, draft, stale, blocked).
   - **Pagina fina recebe noindex**: sem pelo menos **2 blocos de valor proprios** alem de dado
     cru de API, a pagina nao indexa.
   - Dados sem licenca clara (`license_status` unknown/blocked ou `display_allowed=false`) **nao
     aparecem** em pagina indexavel.
   - Idioma fora do pt-BR nasce draft/noindex ate revisao.

7. **Encaminhar para conteudo editorial (separado).**
   - Apenas depois de a entidade existir e estar normalizada, o Entity Writer pode ser acionado
     para gerar `content_blocks` a partir de payload controlado do PostgreSQL. Esse e outro fluxo
     — esta skill termina aqui.

## Checklist de saida

- [ ] Entidade normalizada nas tabelas canonicas, sem payload cru como conteudo.
- [ ] `entity_external_ids` preenchido; sem duplicata.
- [ ] Slug por idioma criado; pt-BR primeiro, en/es em draft/noindex.
- [ ] provider_api e rating_source mantidos separados; IMDb e Rotten Tomatoes nunca misturados.
- [ ] Licenca verificada; dado sem licenca clara nao entra em pagina indexavel.
- [ ] Decisao de index/noindex registrada em `page_indexability_decisions` via gate anti-thin.
- [ ] NADA publicado automaticamente; prioritarias marcadas para revisao humana.
- [ ] Fetch externo logado em `api_sync_logs`.

## Nota de governanca

Skill sem teste vira lembrete; skill com hook/teste vira governanca. Enquanto este fluxo nao
tiver validacao automatizada (hook que bloqueie publicacao sem revisao, teste do gate anti-thin,
verificacao de licenca em CI), trate este documento como **lembrete obrigatorio** de processo —
nao como garantia tecnica. O objetivo de longo prazo e transformar cada passo critico (origem
TMDB/admin futuro, separacao provider_api/rating_source, gate anti-thin, exigencia de revisao
humana) em **governanca executavel**.
