# Runbook — promoção de mídia (`tmdb_videos` e fotos de pessoa)

> Como o trailer e a foto de pessoa saem de "existe no banco" para "aparece na
> tela". Idioma: pt-BR. Nenhum valor de chave, token ou senha aparece aqui.

---

## 0. Estado, em uma linha

**Desde 28/08/2026 a linha NASCE no estado que a licença autoriza.** A pergunta
que era feita depois ("quem promove?") passou a ser feita na escrita, em
`services/ingestion/src/media-promotion/birth.ts`.

Até lá as duas tabelas nasciam `display_allowed = false` **e**
`license_status = 'unknown'` por DEFAULT do DDL, sem ninguém consultar licença
nenhuma — e só uma operação em massa posterior as acendia, ciclo após ciclo,
para sempre.

**Este comando virou ferramenta de ACERVO**: ele existe para o que já estava no
banco antes de 28/08 — e para reverter. Deixou de ser rotina.

### O comando único

```bash
corepack pnpm --filter @screena/ingestion media:liberar-tudo --reviewer="Pablo Eduardo"
```

Uma execução, os dois alvos, o acervo inteiro. Não há teto por execução a ser
contornado com repetição: o lote de 200 do `updateMany` é **interno** e o comando
itera sozinho até acabar. Para reverter:

```bash
corepack pnpm --filter @screena/ingestion media:reverter-tudo --reviewer="Pablo Eduardo"
```

---

## 1. Por que imagem de TÍTULO acendeu e vídeo não

É a pergunta que mais confunde, e a resposta é que **são dois gates diferentes**.

| Superfície | Gate | Quem lê | Estado |
| --- | --- | --- | --- |
| Imagem de **título** (pôster, galeria) | pela **FONTE** (`source_licenses` tmdb/image) | `authorizeImageDisplay` → presenter | **acesa** desde 21-22/08 |
| **Vídeo** (trailer, galeria, "Em breve") | pela **LINHA** (`tmdb_videos.display_allowed`) | 3 consultas de render | apagada |
| Foto de **pessoa** (`/pt/pessoas/{slug}/`) | pela **LINHA** (`tmdb_images.display_allowed`) | `person-page.ts` | apagada |

`getImagesForEntity` (`apps/web/src/server/entity-gallery.ts:52`) **deliberadamente
não filtra** por `tmdb_images.display_allowed` — a justificativa está escrita lá:
o pôster da ficha vem de `movies.poster_path` e não tem linha nenhuma, então
filtrar deixaria a galeria vazia enquanto a ficha exibe a mesma arte.

Ou seja: **não existe um "comando irmão" da promoção de imagem, porque aquela
promoção nunca existiu.** O que acendeu as fotos de título foi `legal sources apply`
gravando `source_licenses` — cujo equivalente para vídeo já está feito.

---

## 2. São DUAS colunas, não uma

Todo consumidor de render filtra o **par**:

```sql
display_allowed = true AND license_status NOT IN ('unknown','blocked')
```

`license_status` nasce `'unknown'` (DEFAULT do DDL, migration
`20260716120000_tmdb_media_genres_checkpoint`). **Ligar só `display_allowed` não
acende nada** — a linha para na segunda condição. A promoção escreve as duas, e
o valor de `license_status` é **derivado da licença vigente**, nunca um literal.

Os três consumidores de vídeo:

| Arquivo | Superfície |
| --- | --- |
| `apps/web/src/server/entity-trailer.ts:54` | trailer da ficha de filme/série |
| `apps/web/src/server/entity-gallery.ts:82` | galeria `/videos/` + contagem da banda |
| `apps/web/src/server/home-upcoming.ts:58` | trilho "Em breve" da home |

---

## 3. Zero rede

A promoção **não chama o TMDB**. Ela só vira duas colunas de linhas já
gravadas. O ciclo grava `api_sync_logs` com `quota_cost = 0` — esse zero é a
prova de que nenhuma requisição externa foi feita.

---

## 4. As três barreiras

```
1. LICENÇA    lê source_licenses. NENHUMA flag a pula.
2. GUARDRAIL  por linha, espelhando o que o render aceitaria.
3. FREIO      teto de volume (500 / 5%), como o freio da #221. Exit 5.
```

**Não há trigger em `tmdb_videos`.** Onde `watch_availability` tem o banco como
última palavra (`data_usage_decisions_guard`), aqui a última palavra é o próprio
comando. Por isso as três barreiras são código, e por isso o gate de licença não
é configurável.

### O que o freio faz na PRIMEIRA execução

Promover o acervo INTEIRO é 100% dele — estoura os dois tetos e **exige
`--confirm-mass-change`**. Isso não é o freio atrapalhando; é o freio
funcionando. A seção 6 do `CLAUDE.md` exige revisão humana para publicação, e
acender o acervo inteiro de uma vez é exatamente o ato que precisa de
assinatura. Depois dela, o punhado de vídeos que a ingestão traz por dia passa
livre.

O denominador é a **tabela inteira**, não a seleção. Se fosse a seleção, a razão
seria sempre 100% e o teto proporcional viraria ruído constante.

---

## 5. Os comandos

**Não use `--`**: medido no pnpm 9.15.4 deste repositório, o separador chega
**literal** como argumento e o parser o recusa.

Ver o que **seria** promovido, sem escrever nada (default):

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video
```

Ensaiar numa entidade só:

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video --tmdb-id=82856
```

Aplicar (a primeira execução exige o opt-in do freio):

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video \
  --confirm --reviewer="Pablo Eduardo" --confirm-mass-change
```

Fotos de pessoa:

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=person-photo
```

Reverter (volta as duas colunas ao estado de nascimento):

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video \
  --revoke --confirm --reviewer="Pablo Eduardo" --confirm-mass-change
```

### Flags

| Flag | Efeito |
| --- | --- |
| `--target=video\|person-photo` | **obrigatória**. Não há default nem `all`: um alvo por execução, senão o freio mistura dois denominadores. |
| `--confirm` | muta. Sem ela, dry-run. |
| `--reviewer="Nome"` | obrigatória com `--confirm`, inclusive em `--revoke`. |
| `--revoke` | volta `display_allowed=false` + `license_status='unknown'`. Não consulta licença. |
| `--confirm-mass-change` | opt-in do freio. Não apaga o fato: o relatório continua dizendo que houve mudança em massa. |
| `--max-changes=N` | teto absoluto (default 500). `0` congela o comando. |
| `--max-change-percent=N` | teto proporcional (default 5). |
| `--only-official` | **opt-in**. Por decisão do dono (2026-08-25) `official` NÃO filtra por padrão. |
| `--target=all` | os DOIS alvos na mesma execução. NÃO funde os censos: cada alvo roda com denominador e freio próprios. |
| `--entity-type=movie\|tv` | estreita (só no alvo `video`; não se combina com `--target=all`). |
| `--tmdb-id=N` / `--limit=N` | estreitam o escopo. |
| `--json` | saída estruturada. |

### Exit codes

| Code | Significado |
| --- | --- |
| `0` | ok (inclusive dry-run) |
| `2` | uso inválido |
| `3` | bloqueado (sem `DATABASE_URL`, ou **licença negada**) |
| `4` | aplicou com recusa do banco |
| `5` | **freio acionado** — calculou tudo, gravou zero |

O `5` é próprio, e não `failed`, porque quem chama precisa distinguir "o comando
quebrou" de "o comando se recusou de propósito e espera um humano".

---

## 6. O que ficou de fora do filtro, e por quê

**`video_type` NÃO filtra** (decisão do dono, 2026-08-25). A promoção cobre
TODOS os vídeos do alvo, não só os de tipo `Trailer`/`Teaser`. A licença vigente
(`tmdb-video/2026-08-v3`) cobre metadado de vídeo do YouTube sem distinção de
tipo, e o arquivo não é rehospedado em caso nenhum.

> NÃO há contagem fixa neste documento de propósito. A versão anterior dizia
> "os 1.119", e o número envelheceu com a ingestação — um runbook que afirma um
> total desatualizado ensina a desconfiar do resto dele. Quem quer o número roda
> o dry-run, que o mede.

Consequência que vale dizer em voz alta: **`pickTrailer` continua escolhendo só
`Trailer`/`Teaser`** para o botão da ficha, e isso está certo — um botão que
promete trailer e abre bastidor mente. O tipo deixou de ser gate de **promoção**;
segue sendo critério de **escolha** no presenter. Camadas diferentes.

**`official` não filtra por padrão.** O censo sempre separa oficiais de
não-oficiais para que a escolha seja vista a cada execução, nunca herdada por
omissão.

---

## 7. O censo, em SQL (para o console do painel)

O dry-run do comando imprime tudo isto. Este SQL existe para quem quer o número
antes de rodar qualquer coisa — é **read-only**.

### 7.1 A licença, primeiro

```sql
SELECT id, content_type, license_status, display_allowed, is_current, policy_version
FROM source_licenses
WHERE source_key = 'tmdb' AND content_type IN ('video','image')
ORDER BY content_type, is_current DESC, id DESC;
```

Esperado: uma linha `is_current = true` por `content_type`, com
`display_allowed = true`. Para **foto de pessoa** o `license_status` precisa ser
`official` ou `licensed` — `third_party` passa na invariante 6 mas
`person-page.ts:375` consulta com `IN ('official','licensed')`, e promover nesse
estado acenderia linhas que a tela descarta. O comando recusa esse caso.

### 7.2 Vídeo — denominador e elegíveis

```sql
WITH base AS (
  SELECT *,
         (license_status = 'blocked')                                        AS row_blocked,
         (display_allowed AND license_status NOT IN ('unknown','blocked'))   AS ja_acesa,
         (site = 'YouTube')                                                  AS site_ok,
         (video_key ~ '^[A-Za-z0-9_-]{11}$')                                 AS key_ok
  FROM tmdb_videos
  WHERE provider_api = 'tmdb'
)
SELECT
  count(*)                                                          AS total_no_alvo,
  count(*) FILTER (WHERE row_blocked)                               AS rec_row_blocked,
  count(*) FILTER (WHERE NOT row_blocked AND ja_acesa)              AS rec_already_promoted,
  count(*) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND NOT site_ok)              AS rec_wrong_site,
  count(*) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND site_ok AND NOT key_ok)   AS rec_invalid_key,
  count(*) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND site_ok AND key_ok)       AS ELEGIVEIS
FROM base;
```

### 7.3 Vídeo — elegíveis por tipo, entidade e oficialidade

```sql
WITH elegivel AS (
  SELECT * FROM tmdb_videos
  WHERE provider_api = 'tmdb'
    AND license_status <> 'blocked'
    AND NOT (display_allowed AND license_status NOT IN ('unknown','blocked'))
    AND site = 'YouTube'
    AND video_key ~ '^[A-Za-z0-9_-]{11}$'
)
SELECT
  coalesce(video_type, '(sem tipo)') AS tipo,
  entity_type,
  count(*)                                          AS n,
  count(*) FILTER (WHERE official IS TRUE)          AS oficial,
  count(*) FILTER (WHERE official IS FALSE)         AS nao_oficial,
  count(*) FILTER (WHERE official IS NULL)          AS official_nulo
FROM elegivel
GROUP BY ROLLUP (tipo, entity_type)
ORDER BY tipo NULLS LAST, entity_type NULLS LAST;
```

A linha de `ROLLUP` com `tipo IS NULL` é o total — compare com `ELEGIVEIS` de
7.2 e com o `changing` que o dry-run imprime. Os três têm de bater.

### 7.4 Foto de pessoa — denominador e elegíveis

O `file_path` é validado pela **mesma** regra de `buildTmdbImageUrl`.

```sql
WITH base AS (
  SELECT *,
         (license_status = 'blocked')                                      AS row_blocked,
         (display_allowed AND license_status NOT IN ('unknown','blocked')) AS ja_acesa,
         (      file_path LIKE '/%'
            AND file_path NOT LIKE '//%'
            AND file_path NOT LIKE '/media/%'
            AND file_path NOT LIKE '/uploads/%'
            AND file_path NOT LIKE '/brand/%'
            AND file_path NOT LIKE '%..%'
            AND file_path !~ '[?#[:space:]]'
            AND strpos(file_path, chr(92)) = 0
         ) AS path_ok
  FROM tmdb_images
  WHERE provider_api = 'tmdb' AND entity_type = 'person' AND image_type = 'profile'
)
SELECT
  count(*)                                                             AS total_no_alvo,
  count(*) FILTER (WHERE row_blocked)                                  AS rec_row_blocked,
  count(*) FILTER (WHERE NOT row_blocked AND ja_acesa)                 AS rec_already_promoted,
  count(*) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND NOT path_ok) AS rec_invalid_file_path,
  count(*) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND path_ok)     AS ELEGIVEIS,
  count(DISTINCT tmdb_id) FILTER (WHERE NOT row_blocked AND NOT ja_acesa AND path_ok) AS pessoas_afetadas
FROM base;
```

### 7.5 Conferir o efeito DEPOIS de aplicar

```sql
-- vídeo: quantos títulos passam a ter trailer exibível
SELECT entity_type, count(DISTINCT tmdb_id) AS titulos_com_trailer
FROM tmdb_videos
WHERE display_allowed AND license_status NOT IN ('unknown','blocked')
  AND site = 'YouTube' AND video_type IN ('Trailer','Teaser')
GROUP BY entity_type;

-- o log da promoção (quota_cost = 0 prova que não houve rede)
SELECT created_at, endpoint, status, items_processed, items_updated, duration_ms, quota_cost
FROM api_sync_logs
WHERE endpoint IN ('promote:tmdb_media','revoke:tmdb_media')
ORDER BY created_at DESC LIMIT 10;
```

---

## 8. Onde o código vive

| Caminho | Papel |
| --- | --- |
| `services/ingestion/bin/promote-media.ts` | o bin |
| `services/ingestion/src/media-promotion/license.ts` | gate de licença (marca opaca, fail-closed) |
| `services/ingestion/src/media-promotion/guardrails.ts` | guardrails por linha |
| `services/ingestion/src/media-promotion/brake.ts` | freio de massa (irmão do #221) |
| `services/ingestion/src/media-promotion/run.ts` | orquestração + portas |
| `services/ingestion/src/persistence/media-promotion-store.ts` | adapter Prisma |
| `services/ingestion/src/media-promotion/__tests__/` | 102 testes, com controle negativo |

O bin está listado em `tsconfig.runtime.json` — `bin/**` do ingestion está fora
do typecheck da raiz, e este é o único caminho do repositório que torna pública
uma linha destas tabelas.

### Por que não vive em `services/legal`

Porque não pode. `services/legal/src/__tests__/tmdb-video-license.test.ts`
**reprova** qualquer `apply`/`plan` que toque em `tmdb_videos`:

> `NEGATIVO — apply e plan não tocam em tmdb_videos` … *"Este bloco existe para
> que 'melhorar' o apply para ligar a coluna reprove aqui, e não em produção."*

A licença diz o que a fonte permite; a promoção é operação governada separada.
São dois passos, e o guard existe para que continuem sendo.
