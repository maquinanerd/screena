# Proposta de migration — 4 bloqueadores do espelho TMDB

> **NADA FOI APLICADO.** Este documento é a migration **apresentada para
> aprovação**, como pedido. O SQL abaixo não está em
> `packages/db/prisma/migrations/` justamente para que um `prisma migrate deploy`
> de outra pessoa não o aplique por engano. Depois da sua aprovação ele vira uma
> pasta de migration normal.
>
> Base: branch `claude/tmdb-mirror-disk-d64e67`. Idioma: pt-BR. Sem segredos.

---

## 0. Por que só estes quatro

O resto do que falta (`overview`, `tagline`, `budget`, `revenue`,
`production_countries`, …) **não é bloqueador** e fica para depois — porque
`tmdb_raw` arquiva o payload bruto e `reprocess_raw` normaliza retroativamente
**sem refazer o fetch**. É exatamente por isso que a fotocópia vale o disco: o
custo de esquecer uma coluna hoje é um reprocessamento local, não uma segunda
varredura do TMDB inteiro.

Estes quatro são diferentes: sem eles, o dado **não tem onde entrar** (1 e 2),
**não existe** (3), ou **o upsert não é idempotente** (4) — e o último corrompe o
espelho, não só o empobrece.

---

## 1. `entity_genres` não existe

**Estado atual (verificado).** `packages/db/prisma/schema.prisma:1169` define
`model Genre` com PK composta `(media_type, tmdb_id)`. A lista canônica de
gêneros é ingerida de `/genre/{movie,tv}/list`. **Não existe nenhuma tabela que
ligue um filme ou uma série a um gênero** — `grep -n "genre" schema.prisma`
devolve apenas o próprio model e um comentário.

Consequência: o espelho sabe que "Ficção científica" existe e que o filme
existe, e não sabe que um é do outro. Nenhuma página de gênero, nenhum filtro,
nenhum "obras parecidas" por gênero.

**Proposta.** Tabela de junção polimórfica, no mesmo padrão das outras tabelas
polimórficas do schema (`cast_members`, `tmdb_images`), com a FK composta para
`entities` aplicada em SQL bruto — o padrão D5 já usado no repositório.

```prisma
/// Liga uma obra (movie|tv) a um genero da lista canonica `genres`.
/// Worker-only: escrita so pelo pipeline de ingestao.
model EntityGenre {
  entityType  EntityType @map("entity_type")
  entityId    BigInt     @map("entity_id")
  /// Redundante com `entityType` por construcao, mas necessario: a PK de
  /// `genres` e (media_type, tmdb_id), e o TMDB usa o MESMO id numerico para
  /// generos diferentes em movie e tv (ex.: 10402 e "Musica" em movie e nao
  /// existe em tv). Sem `media_type` na FK, a ligacao seria ambigua.
  mediaType   String     @map("media_type")
  genreTmdbId Int        @map("genre_tmdb_id")
  createdAt   DateTime   @default(now()) @map("created_at")

  genre Genre @relation(fields: [mediaType, genreTmdbId], references: [mediaType, tmdbId], onDelete: Cascade)

  @@id([entityType, entityId, mediaType, genreTmdbId])
  @@index([mediaType, genreTmdbId])
  @@map("entity_genres")
}
```

E em `model Genre`, a relação inversa:

```prisma
  entityGenres EntityGenre[]
```

---

## 2. `release_dates` / `content_ratings` colapsados num escalar

**Estado atual (verificado).** `Movie.certification String?`
(`schema.prisma:517`) e `TvShow.certification String?` (`:559`) — **uma string,
sem país**.

Isso é um colapso com perda: o TMDB entrega
`/movie/{id}/release_dates` como uma lista **por país**, e cada país pode ter
**vários** registros (por tipo de lançamento: Premiere, Theatrical, Digital,
TV…). `/tv/{id}/content_ratings` entrega **um rating por país**. Uma coluna
escalar guarda no máximo um deles e não diz de qual país — então "16" pode ser
Brasil, Alemanha ou qualquer outro, e não há como saber.

**Proposta.** Duas tabelas, espelhando os **dois endpoints diferentes** do TMDB.
Deliberadamente não são uma tabela polimórfica única: os dois têm chaves naturais
diferentes (filme tem tipo de lançamento, série não), e unificá-las exigiria um
`release_type` sentinela para TV — um valor inventado dentro de dado factual,
que é exatamente o que a governança proíbe.

```prisma
/// Classificacao indicativa de FILME, por pais e por tipo de lancamento.
/// Advisory de conteudo — NAO e rating source e nao passa pelas regras de
/// `external_ratings` (invariantes 1/2).
model MovieReleaseDate {
  id            BigInt    @id @default(autoincrement())
  movieId       BigInt    @map("movie_id")
  /// ISO-3166-1 alpha-2, como o TMDB entrega em `iso_3166_1`.
  countryCode   String    @map("country_code") @db.VarChar(2)
  /// Tipo de lancamento do TMDB: 1=Premiere 2=Theatrical(limited)
  /// 3=Theatrical 4=Digital 5=Physical 6=TV.
  releaseType   Int       @map("release_type")
  /// Pode ser string vazia no upstream (pais listado sem classificacao).
  certification String?
  releaseDate   DateTime? @map("release_date")
  note          String?
  /// Idioma da nota, quando o TMDB informa (`iso_639_1`).
  languageCode  String?   @map("language_code")
  providerApi   String    @default("tmdb") @map("provider_api")
  payloadHash   String    @map("payload_hash")
  fetchedAt     DateTime  @default(now()) @map("fetched_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  movie Movie @relation(fields: [movieId], references: [id], onDelete: Cascade)

  /// Chave natural do upstream: um registro por (filme, pais, tipo).
  @@unique([movieId, countryCode, releaseType])
  @@index([countryCode])
  @@map("movie_release_dates")
}

/// Classificacao indicativa de SERIE, por pais (`/tv/{id}/content_ratings`).
model TvContentRating {
  id           BigInt   @id @default(autoincrement())
  tvShowId     BigInt   @map("tv_show_id")
  countryCode  String   @map("country_code") @db.VarChar(2)
  rating       String
  providerApi  String   @default("tmdb") @map("provider_api")
  payloadHash  String   @map("payload_hash")
  fetchedAt    DateTime @default(now()) @map("fetched_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  tvShow TvShow @relation(fields: [tvShowId], references: [id], onDelete: Cascade)

  @@unique([tvShowId, countryCode])
  @@index([countryCode])
  @@map("tv_content_ratings")
}
```

E as relações inversas em `Movie` (`releaseDates MovieReleaseDate[]`) e `TvShow`
(`contentRatings TvContentRating[]`).

> **A coluna `certification` escalar NÃO é removida nesta migration.** Remover
> uma coluna que o render pode estar lendo é uma mudança destrutiva que precisa
> de uma passada própria pelo `apps/web`. Ela fica como está, e a decisão de
> aposentá-la vem depois — com o dado novo já populado e o consumidor migrado.

---

## 3. `Person.biography` não existe

**Estado atual (verificado).** `model Person` (`:633`) tem
`biographySourceStatus LicenseStatus @default(unknown)` — o gate de licença que
governa a **exibição** de uma biografia — mas **não tem a coluna da biografia**.
O gate existe para um dado que não existe.

Confirmado nos três consumidores:

- `services/ingestion/src/normalizers/person.ts:4` — "Nao persiste biografia (o
  schema nao tem coluna de bio)";
- `services/ingestion/src/persistence/public-payload-reader.ts:622` — devolve
  `biography: null` fixo;
- `services/ingestion/src/__tests__/raw-promote-person.test.ts:43` — o teste
  afirma explicitamente que a bio **não** é promovida.

**Proposta.**

```prisma
  /// Biografia vinda do TMDB. A EXIBICAO continua governada por
  /// `biographySourceStatus` (invariante 6): a coluna guardar o texto nao
  /// autoriza mostra-lo.
  biography         String?  @db.Text
  /// Idioma do texto acima (o TMDB entrega a bio por idioma).
  biographyLanguage String?  @map("biography_language")
```

O `biographySourceStatus` continua nascendo `unknown`, então a bio entra no banco
e **não aparece em página indexável** até uma decisão humana de licença. A
migration não afrouxa nada.

---

## 4. `Season.tmdbId` / `Episode.tmdbId` nullable e não-unique

**Estado atual (verificado).** `Season.tmdbId Int? @map("tmdb_id")` (`:587`) e
`Episode.tmdbId Int? @map("tmdb_id")` (`:611`) — nullable, **sem** `@unique`.
Compare com `Movie.tmdbId Int @unique`, `TvShow.tmdbId Int @unique`,
`Person.tmdbId Int @unique`.

Consequência: temporada e episódio não têm chave estável vinda do upstream. As
uniques que existem são `Season(tvShowId, seasonNumber)` e
`Episode(seasonId, episodeNumber)` — **posicionais**. Quando o TMDB renumera uma
temporada, insere um episódio no meio ou corrige um número, o upsert por posição
grava o payload do episódio A na linha do episódio B. Isso não empobrece o
espelho: **corrompe**, e em silêncio.

**Proposta — em duas etapas, e só a primeira entra agora.**

**Etapa A (esta migration, não-destrutiva):** índice único **parcial**, só sobre
as linhas que já têm id.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_tmdb_id_key"
  ON "seasons" ("tmdb_id") WHERE "tmdb_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "episodes_tmdb_id_key"
  ON "episodes" ("tmdb_id") WHERE "tmdb_id" IS NOT NULL;
```

Isso já entrega o que falta — uma **chave estável para upsert idempotente** — e
não quebra nenhuma linha legada com `tmdb_id` nulo. Em Postgres um índice único
comum já permitiria vários NULL, mas o parcial declara a intenção e é mais
barato.

**Etapa B (NÃO nesta migration): `NOT NULL`.** Exige que **não haja nenhuma
linha com `tmdb_id` nulo em produção** — e eu **não pude verificar isso**: a
produção está inalcançável desta máquina (SSH sem chave, 5432 fechado). Rodar
`SET NOT NULL` às cegas aborta a migration no meio.

**Pré-condição que você roda antes de eu propor a etapa B:**

```sql
SELECT 'seasons'  AS tabela, COUNT(*) AS nulos FROM seasons  WHERE tmdb_id IS NULL
UNION ALL
SELECT 'episodes' AS tabela, COUNT(*) AS nulos FROM episodes WHERE tmdb_id IS NULL;
```

Zero nos dois → a etapa B é segura. Diferente de zero → o backfill vem primeiro,
a partir de `tmdb_raw` (que é justamente o motivo de a fotocópia existir).

---

## 5. SQL completo da migration proposta

Nome sugerido: `packages/db/prisma/migrations/20260811120000_tmdb_mirror_blockers/migration.sql`

```sql
-- 1. entity_genres — liga obra a genero (a ligacao que faltava)
CREATE TABLE "entity_genres" (
  "entity_type"   "EntityType" NOT NULL,
  "entity_id"     BIGINT       NOT NULL,
  "media_type"    TEXT         NOT NULL,
  "genre_tmdb_id" INTEGER      NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_genres_pkey"
    PRIMARY KEY ("entity_type", "entity_id", "media_type", "genre_tmdb_id")
);

CREATE INDEX "entity_genres_media_type_genre_tmdb_id_idx"
  ON "entity_genres" ("media_type", "genre_tmdb_id");

ALTER TABLE "entity_genres"
  ADD CONSTRAINT "entity_genres_genre_fkey"
  FOREIGN KEY ("media_type", "genre_tmdb_id")
  REFERENCES "genres" ("media_type", "tmdb_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK composta para o registro de entidades (padrao D5 do schema): impede id
-- orfao sem exigir mudanca no app.
ALTER TABLE "entity_genres"
  ADD CONSTRAINT "entity_genres_entity_fkey"
  FOREIGN KEY ("entity_type", "entity_id")
  REFERENCES "entities" ("entity_type", "entity_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Um genero de filme so pode ser ligado a um filme, e o de tv a uma serie.
-- Sem isto, `media_type` e `entity_type` poderiam divergir em silencio.
ALTER TABLE "entity_genres"
  ADD CONSTRAINT "entity_genres_media_type_matches_entity_type"
  CHECK (
    ("entity_type" = 'movie' AND "media_type" = 'movie') OR
    ("entity_type" = 'tv'    AND "media_type" = 'tv')
  );

-- 2a. movie_release_dates — classificacao de filme por pais e tipo
CREATE TABLE "movie_release_dates" (
  "id"            BIGSERIAL    NOT NULL,
  "movie_id"      BIGINT       NOT NULL,
  "country_code"  VARCHAR(2)   NOT NULL,
  "release_type"  INTEGER      NOT NULL,
  "certification" TEXT,
  "release_date"  TIMESTAMP(3),
  "note"          TEXT,
  "language_code" TEXT,
  "provider_api"  TEXT         NOT NULL DEFAULT 'tmdb',
  "payload_hash"  TEXT         NOT NULL,
  "fetched_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "movie_release_dates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "movie_release_dates_movie_id_country_code_release_type_key"
  ON "movie_release_dates" ("movie_id", "country_code", "release_type");
CREATE INDEX "movie_release_dates_country_code_idx"
  ON "movie_release_dates" ("country_code");

ALTER TABLE "movie_release_dates"
  ADD CONSTRAINT "movie_release_dates_movie_id_fkey"
  FOREIGN KEY ("movie_id") REFERENCES "movies" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2b. tv_content_ratings — classificacao de serie por pais
CREATE TABLE "tv_content_ratings" (
  "id"           BIGSERIAL    NOT NULL,
  "tv_show_id"   BIGINT       NOT NULL,
  "country_code" VARCHAR(2)   NOT NULL,
  "rating"       TEXT         NOT NULL,
  "provider_api" TEXT         NOT NULL DEFAULT 'tmdb',
  "payload_hash" TEXT         NOT NULL,
  "fetched_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tv_content_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tv_content_ratings_tv_show_id_country_code_key"
  ON "tv_content_ratings" ("tv_show_id", "country_code");
CREATE INDEX "tv_content_ratings_country_code_idx"
  ON "tv_content_ratings" ("country_code");

ALTER TABLE "tv_content_ratings"
  ADD CONSTRAINT "tv_content_ratings_tv_show_id_fkey"
  FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. people.biography — a coluna que o gate de licenca ja governava
ALTER TABLE "people" ADD COLUMN "biography"          TEXT;
ALTER TABLE "people" ADD COLUMN "biography_language" TEXT;

-- 4. Etapa A: chave estavel para upsert idempotente (nao-destrutiva).
--    A etapa B (SET NOT NULL) NAO entra aqui — ver secao 4.
CREATE UNIQUE INDEX "seasons_tmdb_id_key"
  ON "seasons" ("tmdb_id") WHERE "tmdb_id" IS NOT NULL;

CREATE UNIQUE INDEX "episodes_tmdb_id_key"
  ON "episodes" ("tmdb_id") WHERE "tmdb_id" IS NOT NULL;
```

---

## 6. Risco, ordem e rollback

| # | Mudança | Destrutiva? | Risco | Rollback |
| --- | --- | --- | --- | --- |
| 1 | `entity_genres` | não (tabela nova) | baixo | `DROP TABLE entity_genres` |
| 2a | `movie_release_dates` | não | baixo | `DROP TABLE movie_release_dates` |
| 2b | `tv_content_ratings` | não | baixo | `DROP TABLE tv_content_ratings` |
| 3 | `people.biography` | não (colunas nullable) | baixo | `DROP COLUMN` |
| 4A | uniques parciais | não | **médio** | `DROP INDEX` |

**O único risco real é o 4A**, e é preciso ser explícito: se a produção já tiver
**duas linhas com o mesmo `tmdb_id`** (o sintoma exato da corrupção que o índice
existe para impedir), o `CREATE UNIQUE INDEX` **falha** e a migration aborta.
Isso é o comportamento correto — mas é melhor descobrir antes do deploy:

```sql
SELECT 'seasons' AS tabela, tmdb_id, COUNT(*) AS repeticoes
  FROM seasons  WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1
UNION ALL
SELECT 'episodes', tmdb_id, COUNT(*)
  FROM episodes WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1;
```

Zero linhas → 4A é seguro. Alguma linha → **pare**: há duplicata a resolver
antes, e ela é evidência de que o upsert posicional já corrompeu dado.

**Backup antes de aplicar.** Todas as mudanças são aditivas, mas 4A pode abortar
no meio, e `prisma migrate deploy` não tem transação envolvendo a cadeia inteira.

---

## 7. O que esta migration NÃO faz

- não remove `movies.certification` nem `tv_shows.certification`;
- não aplica `NOT NULL` em `seasons.tmdb_id`/`episodes.tmdb_id` (etapa B);
- não popula nenhuma das tabelas novas — quem popula é o pipeline de ingestão,
  e os normalizadores para elas ainda **não** foram escritos (trabalho seguinte,
  depois da sua aprovação do schema);
- não afrouxa nenhum gate de licença: `biographySourceStatus` continua nascendo
  `unknown`, e a classificação indicativa continua sendo advisory de conteúdo,
  **não** rating source (invariantes 1 e 2).
