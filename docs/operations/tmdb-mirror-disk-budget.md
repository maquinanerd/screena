# Orçamento de disco do espelho TMDB — o bloqueio da Parte 0

> **NÃO CONSEGUI MEDIR O DISCO DE PRODUÇÃO.** O `ssh vps-mn` falhou com
> `Permission denied (publickey,password)`: o `~/.ssh` desta máquina tem
> `config`, `known_hosts` e `known_hosts.old` — **nenhuma chave privada**. Não é
> bloqueio do classificador de permissão; é credencial ausente. A seção 1 traz os
> comandos exatos para você colar.
>
> Idioma: pt-BR. Sem segredos. Data: 2026-08-11.

---

## 1. Os comandos — cole no console do EasyPanel

### 1.1. Espaço em disco do host — serviço **`screen-app`** (ou qualquer serviço do projeto; o disco é do host)

```bash
df -h
```

```bash
docker system df
```

> Se `docker` não existir dentro do container (é o normal: containers não têm o
> daemon), o `df -h` sozinho já responde a pergunta que bloqueia tudo — ele
> mostra o filesystem do host montado. O `docker system df` só interessa se você
> tiver acesso ao shell do **host**, não ao do container.

Para descobrir o nome do serviço de banco, se preciso:

```bash
docker ps --format '{{.Names}}' | grep -i db
```

### 1.2. Tamanho do banco e das tabelas — serviço **`screen-db`**, console `psql`

```sql
-- Tamanho total do banco
SELECT pg_size_pretty(pg_database_size(current_database())) AS banco_total;
```

```sql
-- tmdb_raw especificamente: dados, TOAST (o payload comprimido) e índices
SELECT
  pg_size_pretty(pg_total_relation_size('tmdb_raw'))                            AS total,
  pg_size_pretty(pg_relation_size('tmdb_raw'))                                  AS so_tabela,
  pg_size_pretty(pg_total_relation_size('tmdb_raw') - pg_relation_size('tmdb_raw')) AS toast_mais_indices,
  (SELECT COUNT(*) FROM tmdb_raw)                                               AS linhas;
```

```sql
-- Censo das entidades
SELECT 'movies'   AS tabela, COUNT(*) FROM movies
UNION ALL SELECT 'tv_shows', COUNT(*) FROM tv_shows
UNION ALL SELECT 'seasons',  COUNT(*) FROM seasons
UNION ALL SELECT 'episodes', COUNT(*) FROM episodes
UNION ALL SELECT 'people',   COUNT(*) FROM people;
```

```sql
-- As 15 maiores relações do banco (onde o disco realmente está)
SELECT relname,
       pg_size_pretty(pg_total_relation_size(C.oid)) AS total
  FROM pg_class C
  LEFT JOIN pg_namespace N ON N.oid = C.relnamespace
 WHERE nspname = 'public' AND C.relkind = 'r'
 ORDER BY pg_total_relation_size(C.oid) DESC
 LIMIT 15;
```

### 1.3. A consulta que vale 200 GB — leia a seção 4 antes de ignorá-la

```sql
-- Bytes MÉDIOS por linha de tmdb_raw, por tipo, JÁ COMPRIMIDOS pelo TOAST,
-- comparados com o tamanho do JSON cru. A razão entre os dois é o fator de
-- compressão real do nosso payload.
SELECT entity_type,
       COUNT(*)                                              AS linhas,
       pg_size_pretty(AVG(pg_column_size(payload))::bigint)  AS media_comprimida,
       pg_size_pretty(AVG(length(payload::text))::bigint)    AS media_json_cru,
       ROUND(AVG(length(payload::text)) / NULLIF(AVG(pg_column_size(payload)),0), 1) AS fator_compressao
  FROM tmdb_raw
 GROUP BY entity_type
 ORDER BY linhas DESC;
```

---

## 2. O universo real do TMDB — **isto eu medi**

Os Daily ID Exports são **públicos** (sem token, sem cota), então consegui medir
o universo mesmo sem acesso à produção. Export de **2026-08-10**, baixado e
contado linha a linha:

| Export | Entidades | `.json.gz` | JSONL cru |
| --- | ---: | ---: | ---: |
| `movie_ids` | **1.230.788** | 26,3 MB | 121 MB |
| `tv_series_ids` | **228.804** | 4,8 MB | 15,8 MB |
| `person_ids` | **4.860.938** | 73,0 MB | 338 MB |
| `collection_ids` | 9.670 | 0,15 MB | 0,5 MB |
| `production_company_ids` | 256.219 | 3,0 MB | 10,2 MB |
| `keyword_ids` | 92.889 | 1,0 MB | 3,2 MB |
| `tv_network_ids` | 5.532 | 0,05 MB | 0,17 MB |

**Total de entidades com detalhe buscável (movie + tv + person): 6.320.530.**

Dois fatos que mudam o planejamento:

1. **Pessoas são 77% do universo.** 4,86 milhões contra 1,46 milhão de títulos.
   Qualquer conversa sobre disco que só fale de "títulos" está ignorando três
   quartos do problema.
2. **`popularity` vem em cada linha do export.** Foi o que permitiu a correção da
   ordem de ingestão (Parte 1) sem gastar um byte de cota. Distribuição medida:

   | | popularidade ≥ 10 | ≥ 5 | ≥ 1 | total |
   | --- | ---: | ---: | ---: | ---: |
   | filmes | 1.967 | 7.404 | 382.407 | 1.230.788 |
   | séries | 6.136 | 17.887 | 129.856 | 228.804 |
   | pessoas | 63 | 614 | 65.445 | 4.860.938 |

   **A cauda é quase tudo.** 99,8% dos filmes têm popularidade < 5. Os ~25 mil
   títulos com popularidade ≥ 5 são o que o público efetivamente procura — e
   cabem numa fração ínfima do disco.

Verificação de brinde: nos exports padrão, `adult === true` apareceu **0 vezes** e
o campo `adult` **nunca faltou** em movie/person. As duas camadas do filtro
fail-closed estão consistentes com o que o upstream entrega hoje.

---

## 3. A projeção — e o que nela é medido vs. presumido

Sua extrapolação (~275 GB de raw contra ~40 GB de normalizado) parte de **~200
títulos = 24 MB**, ou seja **~120 KB por título**. Aplicando aos números reais:

| Camada | Contagem (medida) | Bytes/linha (**presumido**) | Projeção |
| --- | ---: | ---: | ---: |
| `tmdb_raw` filmes | 1.230.788 | 120 KB | **~141 GB** |
| `tmdb_raw` séries | 228.804 | 150 KB | **~33 GB** |
| `tmdb_raw` pessoas | 4.860.938 | 5 KB *(mediana; ver ressalva)* | **~23 GB** |
| `tmdb_raw` temporadas + episódios | **não medido** | — | **não sei** |
| Normalizado (todas as tabelas) | — | — | ~40 GB (sua estimativa) |

**Ordem de grandeza confirmada: a fotocópia é ~80% do custo.** Sua conta se
sustenta contra os números reais de contagem.

**Onde ela pode errar feio, nos dois sentidos:**

- **Pessoas.** `PERSON_APPEND`
  (`api-clients/tmdb/src/append-to-response.ts:87`) inclui `combined_credits`,
  `movie_credits`, `tv_credits`, `images`, `tagged_images` e `translations`. Para
  um ator prolífico isso são centenas de créditos — dezenas ou centenas de KB.
  Se a **mediana** for 20 KB em vez de 5 KB, pessoas sozinhas passam de 23 GB
  para **~97 GB**. Com 4,86 milhões de linhas, cada KB de erro na média custa
  **4,9 GB**.
- **Temporadas e episódios.** Não tenho a contagem, e a evidência do repositório
  mostra o quanto ela é assimétrica: **3 séries populares produziram 639
  temporadas e 33.178 episódios**; um `--limit 20` gerou 85.878 episódios. Não
  vou extrapolar disso para 228 mil séries — seria inventar. **Não descobri.**

### Desperdício concreto que encontrei no caminho

`PERSON_APPEND` pede **`combined_credits` E `movie_credits` E `tv_credits`**.
`combined_credits` **já é** a união dos outros dois: estamos arquivando os
créditos de cada pessoa **duas vezes**. Em 4,86 milhões de pessoas, isso não é
detalhe — é possivelmente dezenas de GB de duplicata pura.

Não mexi nisso: está fora do escopo desta tarefa e merece medição antes
(a consulta 1.3 mostra o tamanho médio por tipo). Mas é a primeira economia a
avaliar se o disco apertar.

---

## 4. A pergunta que pode valer 200 GB: os 24 MB eram comprimidos?

`tmdb_raw.payload` é `Json` no Prisma, o que em PostgreSQL é **`jsonb`**. Valores
grandes vão para **TOAST** e são **comprimidos** (pglz ou LZ4). JSON comprime
tipicamente **5× a 10×**.

Então:

- se os **24 MB** vieram de `pg_total_relation_size('tmdb_raw')`, eles **já
  estão comprimidos** → a projeção de ~275 GB é de **disco real**;
- se vieram de somar o JSON cru, o disco real pode ser **5× a 10× menor** —
  algo entre **30 e 60 GB**.

**A diferença entre esses dois cenários é a diferença entre "não cabe" e "cabe
folgado".** A consulta 1.3 responde isso em um segundo, e é por isso que ela é
a mais importante desta página.

---

## 5. Sobre mandar `tmdb_raw` para o R2

A decisão é sua, depois do número — como você definiu. Três observações
técnicas para quando ela chegar:

1. **`reprocess_raw` lê `tmdb_raw` do PostgreSQL.** Mover para o R2 exige um
   adapter novo de leitura; não é só mudar onde os bytes moram. É trabalho real,
   não configuração.
2. **O R2 já está configurado para mídia editorial**, então a credencial e o
   padrão de acesso existem — mas o bucket de mídia é **outro papel**. Misturar
   arquivo bruto de catálogo com mídia editorial num mesmo prefixo confunde
   backup e ciclo de vida.
3. **Alternativa mais barata que mover:** *não arquivar tudo*. O valor de
   `tmdb_raw` é normalizar retroativamente sem refetch. Isso vale muito para os
   ~25 mil títulos com popularidade ≥ 5 e pouco para o filme com popularidade
   0,6 que ninguém abriu. Uma política de retenção por popularidade cortaria a
   maior parte do custo **sem** infraestrutura nova.

---

## 6. O que fazer com os números quando você os tiver

| `df -h` mostra livre | Leitura |
| --- | --- |
| **< 100 GB** | não inicie o espelho completo. Rode por faixa de popularidade (seção 2) e meça o crescimento real por título antes de ampliar. |
| **100–300 GB** | viável **com** política de retenção de `tmdb_raw` ou com a compressão confirmada na seção 4. Monitore o disco a cada ciclo. |
| **> 300 GB** | o espelho completo cabe. Ainda assim comece por popularidade — não por segurança, mas porque é o que faz os links das matérias resolverem amanhã em vez de na semana que vem. |

**Sinal de parada, em qualquer cenário:** se o disco livre cair abaixo de 20%, o
PostgreSQL degrada (autovacuum não consegue trabalhar) e o site cai junto — é o
mesmo banco. Ver a seção "worker competindo com o site" no roteiro de produção.
