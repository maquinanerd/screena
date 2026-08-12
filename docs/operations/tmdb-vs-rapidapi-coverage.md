# TMDB vs. RapidAPI — a RapidAPI é custo duplicado?

> Pergunta: *"quantos títulos teriam nota via TMDB (`vote_average`) vs via
> RapidAPI; quantos teriam streaming via TMDB watch providers vs via RapidAPI.
> Se a cobertura for equivalente, a RapidAPI é custo duplicado."*
>
> Idioma: pt-BR. Sem segredos. Data: 2026-08-11.

---

## 0. Resumo, e o que eu não descobri

**Os números de cobertura do catálogo real: NÃO DESCOBRI.** Eles exigem
consultar o banco de produção, que está **inalcançável desta máquina** (SSH sem
chave privada, 5432 fechado) — e exigem uma chave TMDB, que não pude ler (regra
de permissão bloqueia `.env*`). As consultas exatas estão na seção 4, prontas
para você colar.

**Mas três fatos estruturais, verificados no código, já mudam a pergunta** — e
dois deles contradizem premissas do enunciado. Eles importam mais que a
contagem, porque valem independentemente de quantos títulos existam hoje.

---

## 1. Ratings: o TMDB já está no banco. Hoje. Em 100% dos títulos sincronizados.

**Verificado.** `vote_average` do TMDB é normalizado e persistido em **todo**
sync de detalhe, para filme e para série:

- `services/ingestion/src/normalizers/movie.ts:46` → `voteAverageTmdb`
- `services/ingestion/src/normalizers/tv.ts:52` → `voteAverageTmdb`
- `services/ingestion/src/persistence/store.ts:161` e `:204` → grava nas colunas
  `movies.vote_average_tmdb` / `tv_shows.vote_average_tmdb`
- o schema também tem `vote_count_tmdb`

**Consequência:** a cobertura de nota via TMDB é, por construção, **igual à
cobertura do próprio espelho**. Todo título que o espelho sincroniza já chega
com nota e volume de votos, **sem nenhuma chamada adicional** e **sem nenhuma
assinatura** — vem no mesmo payload de detalhe que já pagamos.

A RapidAPI (Film & Show Ratings) traz outra coisa: **IMDb, Rotten Tomatoes,
Metacritic, Letterboxd, FilmAffinity** — fontes que o TMDB **não** fornece.

> **Isto não é uma comparação de cobertura. É uma comparação de FONTES.**
>
> A nota do TMDB é a nota **do TMDB**: uma média da comunidade do próprio TMDB.
> Ela não é, e nunca pode virar, "IMDb" — o schema deixa isso explícito no
> comentário da coluna: *"dado tecnico TMDB; NUNCA nota editorial (inv. 1/2)"*.
>
> Trocar RapidAPI por TMDB não é economizar numa fonte equivalente: é **deixar
> de exibir IMDb e Rotten Tomatoes**. Se o produto quer mostrar "7,9 IMDb", o
> TMDB não substitui a RapidAPI em nenhuma quantidade de títulos.

A decisão real, então, não é "qual cobre mais", e sim: **o produto precisa exibir
IMDb/RT, ou a nota da comunidade TMDB (devidamente creditada como TMDB) basta?**
Essa é sua decisão, não minha — mas ela é editorial, não de cobertura.

---

## 2. Streaming: o payload do TMDB **já está sendo baixado e arquivado**. Só não é normalizado.

Este é o achado que mais muda o cálculo.

**Verificado.** `watch/providers` **já está** na lista de `append_to_response`
que o client TMDB usa para movie, tv e season:

- `api-clients/tmdb/src/append-to-response.ts:42, 60, 74`
- travado por teste: `api-clients/tmdb/src/__tests__/append-to-response.test.ts:55-60`

Ou seja: **cada sync de detalhe já traz a disponibilidade do TMDB junto**, sem
chamada extra e sem custo de cota adicional — e o payload inteiro é arquivado em
`tmdb_raw`.

**E o que falta:** `grep -rn "watch_availability" services/ingestion/src` não
retorna **nada**. O payload chega, é arquivado, e **nunca é normalizado** para a
tabela `watch_availability`.

**Isso significa que os dados de streaming do TMDB de todo título já
sincronizado estão em nossa posse agora**, dentro de `tmdb_raw` — e podem ser
normalizados retroativamente com `reprocess_raw`, **sem refazer um único fetch**.
É exatamente o retorno que a fotocópia foi feita para dar.

O trabalho que falta é **um normalizador**, não uma assinatura.

### Correção de premissa: `TMDB_SYNC_WATCH_PROVIDERS` não existe

O enunciado diz *"`TMDB_SYNC_WATCH_PROVIDERS` já existe na configuração"*.

**Verificado: essa variável não aparece em nenhum arquivo de código do
repositório** (busca repo-wide, todos os tipos de arquivo rastreados). Não pude
ler `.env.example` (regra de permissão bloqueia `.env*`), então **não sei** se
ela está *documentada* lá — mas isso não muda a conclusão: **nenhum código a
lê**, portanto defini-la não liga nada.

A boa notícia é que ela é desnecessária: o `append_to_response` já traz os
providers incondicionalmente.

### O que o TMDB entrega vs. o que a RapidAPI entrega

| Dimensão | TMDB `watch/providers` | Streaming Availability (RapidAPI) |
| --- | --- | --- |
| Origem | **JustWatch** (o TMDB é revendedor do dado) | agregador próprio (Movie of the Night) |
| Custo | **já incluso** no detalhe que já buscamos | assinatura à parte |
| Deep link | link do **JustWatch**, não do provedor | link direto do provedor |
| Preço / qualidade | não entrega | entrega |
| Atribuição | **exigida pelo TMDB** ("fonte: JustWatch") | exigida pela licença própria |

A diferença material é o **deep link**: o TMDB manda para uma página do
JustWatch; a RapidAPI manda para a Netflix. Para "onde assistir", isso é
diferença de qualidade de produto — e é a pergunta que decide, não a contagem.

> **Atenção legal, e ela é dura:** os Termos do TMDB exigem atribuição ao
> JustWatch para o dado de `watch/providers`, e o JustWatch tem restrições
> próprias de uso comercial. **Não verifiquei os termos vigentes nesta sessão.**
> Antes de trocar a RapidAPI pelo TMDB, isso precisa de checagem humana — e é
> uma decisão de licença, que por regra do projeto nunca é minha.

---

## 3. O que fica decidido e o que fica em aberto

**Fica decidido pelos fatos (não depende de contagem):**

1. Nota do TMDB **não substitui** IMDb/Rotten Tomatoes. São fontes diferentes, e
   confundi-las é violação da invariante 1.
2. O dado de streaming do TMDB **já está pago e arquivado**. Normalizá-lo custa
   um normalizador, não uma assinatura.
3. `TMDB_SYNC_WATCH_PROVIDERS` é config morta: não existe em código.

**Fica em aberto (precisa de você):**

1. O produto exige exibir IMDb/RT? Se sim, a RapidAPI de ratings **não é**
   duplicada. Se a nota da comunidade TMDB creditada bastar, ela é.
2. O deep link direto ao provedor vale a assinatura de streaming? Se sim, a
   RapidAPI de streaming não é duplicada.
3. Os termos TMDB/JustWatch permitem nosso uso? **Checagem humana, obrigatória.**

---

## 4. As consultas — para você rodar no console do `screen-db`

### 4.1. Cobertura de nota via TMDB (custo zero, já no banco)

```sql
SELECT 'movies' AS tipo,
       COUNT(*)                                              AS total,
       COUNT(vote_average_tmdb)                              AS com_nota_tmdb,
       ROUND(100.0 * COUNT(vote_average_tmdb) / NULLIF(COUNT(*),0), 1) AS pct
  FROM movies
UNION ALL
SELECT 'tv_shows',
       COUNT(*), COUNT(vote_average_tmdb),
       ROUND(100.0 * COUNT(vote_average_tmdb) / NULLIF(COUNT(*),0), 1)
  FROM tv_shows;
```

Um filtro mais honesto — nota com pouquíssimos votos é ruído, não sinal:

```sql
SELECT 'movies' AS tipo,
       COUNT(*) FILTER (WHERE vote_count_tmdb >= 10)  AS nota_util_10_votos,
       COUNT(*) FILTER (WHERE vote_count_tmdb >= 100) AS nota_util_100_votos,
       COUNT(*)                                       AS total
  FROM movies
UNION ALL
SELECT 'tv_shows',
       COUNT(*) FILTER (WHERE vote_count_tmdb >= 10),
       COUNT(*) FILTER (WHERE vote_count_tmdb >= 100),
       COUNT(*)
  FROM tv_shows;
```

### 4.2. Cobertura de nota via RapidAPI (o que já foi coletado)

```sql
SELECT rating_source,
       COUNT(*)                        AS notas,
       COUNT(DISTINCT entity_id)       AS titulos_distintos,
       COUNT(*) FILTER (WHERE display_allowed) AS exibiveis
  FROM external_ratings
 GROUP BY rating_source
 ORDER BY notas DESC;
```

Se vier vazio, a resposta é simples: **a RapidAPI de ratings nunca rodou**, e o
custo até aqui foi 100% ocioso.

### 4.3. Streaming — o que já está arquivado no `tmdb_raw`

Esta é a consulta que responde "quanto do streaming do TMDB já temos". Ela lê o
payload arquivado; não faz nenhuma chamada de rede:

```sql
SELECT entity_type,
       COUNT(*) AS titulos_no_raw,
       COUNT(*) FILTER (
         WHERE payload -> 'watch/providers' -> 'results' -> 'BR' IS NOT NULL
       ) AS com_provider_no_brasil,
       ROUND(100.0 * COUNT(*) FILTER (
         WHERE payload -> 'watch/providers' -> 'results' -> 'BR' IS NOT NULL
       ) / NULLIF(COUNT(*),0), 1) AS pct
  FROM tmdb_raw
 WHERE entity_type IN ('movie','tv')
 GROUP BY entity_type;
```

### 4.4. Cobertura de streaming via RapidAPI (o que já foi coletado)

```sql
SELECT country_code,
       COUNT(*)                                AS ofertas,
       COUNT(DISTINCT entity_id)               AS titulos_distintos,
       COUNT(*) FILTER (WHERE display_allowed) AS exibiveis
  FROM watch_availability
 GROUP BY country_code
 ORDER BY ofertas DESC;
```

### 4.5. A comparação direta (títulos com TMDB **e sem** RapidAPI)

```sql
SELECT COUNT(*) AS filmes_com_nota_tmdb_e_sem_nota_externa
  FROM movies m
 WHERE m.vote_average_tmdb IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM external_ratings er
      WHERE er.entity_type = 'movie' AND er.entity_id = m.id
   );
```

---

## 5. O que fazer com o resultado

| Resultado de 4.2 e 4.4 | Leitura |
| --- | --- |
| **vazios** | as duas assinaturas nunca produziram um byte de dado exibido. Cancele-as até haver decisão de produto, e normalize o `watch/providers` que já está no `tmdb_raw`. |
| **populados, cobertura baixa** | o custo por título é alto. Compare com o que 4.3 mostra estar disponível de graça. |
| **populados, cobertura alta** | a pergunta volta a ser editorial (seção 3), não de custo. |

Em qualquer cenário, a recomendação técnica é a mesma e não depende dos números:
**escrever o normalizador de `watch/providers`**. Ele transforma dado que já
está pago e arquivado em disponibilidade exibível, e o custo marginal é zero em
cota e em assinatura.
