-- Casamento EXATO de titulo por texto DOBRADO, para a rota interna de resolucao
-- de entidade (`apps/web`, POST /api/internal/entity-resolve).
--
-- POR QUE ESTA MIGRATION EXISTE.
--
-- A rota casava titulo contra `search_documents` -- a projecao de busca, escrita
-- por um worker offline (`catalog search-reindex`). Medido em producao: o
-- casamento por `tmdbId` funcionava (le o catalogo direto) e o casamento por
-- titulo/nome devolvia `not_found` para 11 de 11 titulos que a PROPRIA rota
-- havia acabado de devolver em `canonicalTitle`. Uma rota nao pode depender, em
-- silencio, de um job que ninguem foi mandado rodar: o unico sintoma e o
-- casamento exato deixar de casar.
--
-- A rota passa a ler o CATALOGO (a mesma fonte do `tmdbId`). Para o casamento
-- por texto ser barato ali, os dois lados precisam ser dobrados pela MESMA
-- funcao -- e o lado do banco precisa de indice. E o que esta migration entrega.
--
-- Forward-only e ADITIVA: cria UMA funcao e cinco indices. Nenhuma tabela e
-- alterada, nenhuma linha e apagada, nada e removido. Reaplicar e seguro.
--
-- Governanca: os indices servem uma rota INTERNA (nao indexavel) que le somente
-- PostgreSQL -- invariantes 3 e 4 intactas.

-- ---------------------------------------------------------------------------
-- A dobra, em SQL. Ela dobra OS DOIS LADOS.
-- ---------------------------------------------------------------------------
--
-- Sem acento, minusculo, espacos colapsados, sem espaco nas pontas.
--
-- A PROPRIEDADE QUE IMPORTA nao e "esta funcao e identica a dobra do
-- JavaScript". E que a consulta aplica ESTA funcao aos DOIS lados: ao valor da
-- coluna e ao termo procurado. Duas funcoes "equivalentes" divergem no primeiro
-- caractere exotico e o sintoma e mudo -- o casamento exato deixa de casar, sem
-- erro, sem log, sem teste vermelho. Uma funcao so nao tem como divergir de si
-- mesma.
--
-- O termo chega ja pre-dobrado pelo modulo puro (NFD, sem acento, minusculo,
-- espacos colapsados) e e dobrado AQUI de novo. A redobra nao e desperdicio: e
-- ela que faz a comparacao acontecer no MESMO espaco dos dois lados. Exemplo
-- concreto do que so funciona por causa disso: o `unaccent` do PostgreSQL
-- transforma o AE ligado em "ae" e o eszett em "ss", e o NFD do JavaScript
-- deixa os dois intactos. Dobrando o termo aqui, os dois viram "ae"/"ss" e
-- casam; comparando a dobra do JS com a dobra do SQL, nunca casariam.
--
-- 100% ASCII, e sem `normalize()`/escapes `\uXXXX`, de proposito: o harness de
-- validacao cai para o encoding do SO quando `initdb --encoding=UTF8` falha (o
-- que acontece no Windows), e `normalize()` so roda com o servidor em UTF8.
-- Uma migration que so aplica em UTF8 quebraria TODOS os validadores locais.
-- `immutable_unaccent` e `chr(160)` funcionam em qualquer encoding.
--
-- `public.immutable_unaccent`, QUALIFICADO, e nao `immutable_unaccent`.
--
-- MEDIDO na CI: sem o schema, o job de backup+restore falha em
-- `pg_restore` com `function immutable_unaccent(text) does not exist` ao
-- recriar os indices. O `pg_restore` roda com `search_path = ''`, e a funcao
-- e INLINADA na expressao do indice -- a chamada interna e resolvida ali, sem
-- schema nenhum no caminho. A migration aplica limpa nos dois casos; so o
-- restore quebra, e um backup que nao restaura nao e backup.
--
-- E o mesmo motivo pelo qual `immutable_unaccent` ja qualifica
-- `public.unaccent(...)` no corpo dela.
--
-- `chr(160)` e o espaco inquebravel: ele nao esta em `[[:space:]]` sob ctype C,
-- e e o unico espaco nao-ASCII que aparece de fato em titulo copiado de site.
CREATE OR REPLACE FUNCTION immutable_fold(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
AS $$
    SELECT btrim(
        regexp_replace(
            replace(lower(public.immutable_unaccent($1)), chr(160), ' '),
            '[[:space:]]+',
            ' ',
            'g'
        )
    )
$$;

-- ---------------------------------------------------------------------------
-- Indices funcionais sobre a dobra.
-- ---------------------------------------------------------------------------
--
-- Sem eles o casamento por titulo faz varredura sequencial em `movies`,
-- `tv_shows`, `people`, `entity_translations` e `entity_alternative_titles` a
-- cada chamada. Com eles e busca por igualdade.
--
-- B-tree, e nao GIN/trgm: aqui o predicado e IGUALDADE exata. Prefixo e
-- similaridade sao da busca do site, que continua com seus proprios indices.
--
-- Os indices de `entity_translations` e `entity_alternative_titles` levam
-- `entity_type` na frente porque a consulta sempre filtra por tipo -- pedir um
-- filme nunca pode casar com uma pessoa homonima.
--
-- `CREATE INDEX` sem `CONCURRENTLY` porque o Prisma roda a migration dentro de
-- uma transacao. Em tabela grande isto bloqueia ESCRITA durante a criacao; a
-- escrita do catalogo e worker offline, entao a janela e operacional e nao de
-- usuario.
CREATE INDEX IF NOT EXISTS "movies_title_original_folded_idx"
    ON "movies" (immutable_fold("title_original"));

CREATE INDEX IF NOT EXISTS "tv_shows_name_original_folded_idx"
    ON "tv_shows" (immutable_fold("name_original"));

CREATE INDEX IF NOT EXISTS "people_name_folded_idx"
    ON "people" (immutable_fold("name"));

CREATE INDEX IF NOT EXISTS "entity_translations_title_folded_idx"
    ON "entity_translations" ("entity_type", immutable_fold("title"));

CREATE INDEX IF NOT EXISTS "entity_alternative_titles_title_folded_idx"
    ON "entity_alternative_titles" ("entity_type", immutable_fold("title"));
