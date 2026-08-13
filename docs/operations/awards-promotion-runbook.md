# Runbook — promoção de premiação (`api_cache` → `entity_awards`)

> Como o fato "Venceu 4 Oscars" sai do payload guardado e chega (ou não chega) à
> tela. Idioma: pt-BR. Nenhum valor de chave, token ou senha aparece aqui.

---

## 0. Estado, em uma linha

A licença está **decidida** (2026-08-13): o crédito é da **OMDb**, com o texto
`Dados de premiação fornecidos por OMDb` —
[dossiê](../legal/omdb-awards-source-provenance.md). Aplicada a licença e
reexecutada a promoção, a faixa acende.

**O crédito é gravado na ESCRITA da linha.** Aplicar a licença sozinho não acende
nada: linhas já promovidas continuam com `source_key = NULL` até o próximo ciclo
do worker. A ordem da seção 4 não é sugestão.

---

## 1. Zero rede, zero cota

A promoção **não chama a OMDb**. O literal `Awards` chegou junto com as notas, no
primeiro sync de ratings, e está em `api_cache` desde então:

```sql
SELECT count(*) AS linhas_omdb,
       count(*) FILTER (WHERE payload ? 'Awards') AS tem_campo,
       count(*) FILTER (WHERE payload->>'Awards' NOT IN ('N/A','')) AS tem_valor_real
FROM api_cache WHERE provider_api='omdb';
```

O ciclo grava `api_sync_logs` com `quota_cost = 0` — esse zero é a prova de que
nenhuma requisição externa foi feita.

---

## 2. Os comandos

**Não use `--`**: medido no pnpm 9.15.4 deste repositório, o separador chega
**literal** como argumento e o parser o recusa.

Ver o que **seria** promovido, sem escrever nada (default):

```bash
corepack pnpm --filter @screena/ratings awards:promote
```

Gravar de verdade:

```bash
corepack pnpm --filter @screena/ratings awards:promote --apply
```

Só filmes, com teto e relatório em `services/ratings/.data/` (gitignored):

```bash
corepack pnpm --filter @screena/ratings awards:promote --type=movie --limit=50 --apply --report
```

Provar o caminho inteiro contra PostgreSQL real (efêmero, sem rede):

```bash
corepack pnpm --filter @screena/ratings validate:awards
```

### Flags

| Flag | Efeito |
| --- | --- |
| *(nenhuma)* | dry-run: lê, reconhece, relata; **não escreve** |
| `--apply` | escrita real em `entity_awards` |
| `--type=movie` / `--type=tv` | restringe a resolução de entidade a um tipo (default: os dois) |
| `--limit=N` | teto de payloads lidos (default 200), em ordem estável por `api_cache.id` |
| `--report` | escreve o relatório markdown em `services/ratings/.data/` |

### Em produção

`--apply` exige `CINERIE_AWARDS_PROMOTION_AUTHORIZED=true`. O dry-run roda
sempre.

**Por que não reusa `CINERIE_RATINGS_PROVIDER_AUTHORIZED`:** aquela variável
autoriza **consultar** a OMDb, e esta execução não consulta ninguém. Emprestar o
interruptor de coleta para autorizar escrita local faria os dois estados
divergirem no primeiro dia em que a coleta fosse desligada.

---

## 3. O que sai no relatório, e como ler

```
promocao de premiacao · --apply (escrita real) · rede: nenhuma (cota gasta: 0)
licenca: SEM LICENCA de premiacao vigente: ...
payloads=51 · reconhecidos=41 · criados=41 · ... · exibiveis=0 · recusas=11
```

| Motivo | Significa | Ação |
| --- | --- | --- |
| `no-license` | não há licença `awards_display` vigente no banco | rodar `legal sources apply` (seção 4). Aparece **uma vez** por ciclo, não uma por título |
| `ambiguous` (dentro de `no-license`) | há **duas** licenças de premiação vigentes | escolher uma seria sortear de quem é o crédito; o worker recusa e nomeia as candidatas. Aposente a que sobra em `services/legal` |
| `awards-not-available` | a OMDb respondeu `"N/A"` | **nenhuma.** Título sem prêmio é fato, não falha — e não vira registro |
| `awards-absent` | campo ausente ou vazio | nenhuma; idem acima |
| `awards-unrecognized` | frase fora dos formatos conhecidos | o **literal bruto** está no detalhe: estender `packages/schemas/src/omdb-awards.ts` com evidência |
| `entity-not-found` | o IMDb id não casa com nenhuma entidade local | sincronizar o catálogo daquele título |
| `payload-unusable` / `no-imdb-id` | payload inutilizável (inclusive `Response: "False"`, que a OMDb responde com HTTP 200) | reconsultar aquele id pelo worker de ratings |
| `write-refused` | o **trigger** recusou a escrita | governança incompleta; a mensagem do banco vem junto e o comando **sai com erro** |

Na medição de produção de 2026-08-13: **51 payloads, 41 com valor real, 10
`N/A`/ausentes**. Os 10 aparecem nomeados no relatório — nunca somem.

---

## 4. Como a faixa acende (a ordem importa)

A licença já está no spec (`STATIC_AUTHORIZATION`). O que falta é **materializá-la
no banco** e **reexecutar o worker**.

**1. Ver o plano** (read-only, não escreve nada):

```bash
corepack pnpm legal sources review
```

**2. Aplicar a autorização.** As três flags são obrigatórias juntas — sem elas o
comando mostra o plano e não muta:

```bash
corepack pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-07-v1" --confirm
```

`--policy-version` é a **leva** (`AUTHORIZATION_BATCH`), e a CLI **recusa
qualquer outro valor**. A versão por fonte (`cinerie-source-auth/omdb/2026-08-v1`)
vive dentro da entrada do spec, nunca na linha de comando.

**3. Reexecutar a promoção** — é ela que hidrata crédito e `display_allowed`:

```bash
corepack pnpm --filter @screena/ratings awards:promote --apply
```

O passo 3 **é obrigatório**, e é o erro mais fácil de cometer aqui: o crédito é
fato da licença, gravado no momento da escrita da linha. Sem ele, `legal apply`
termina com sucesso e a faixa continua apagada.

**4.** A página é `revalidate = 3600`; a faixa aparece no próximo ciclo de ISR.

O que se espera ver no passo 3: `exibiveis=` maior que zero, e o texto
`Dados de premiacao fornecidos por OMDb` gravado em `attribution_text`.

### Como saber que não acendeu, e por quê

O bloco nunca some calado. Em produção, o log do container traz:

```json
{"event":"section_absent","section":"premios","reason":"no_awards_source","entityType":"movie","entityId":"43","actionable":true}
```

`no_awards_source` (`actionable: true`) = **ninguém está autorizado ainda**;
adianta agir, não adianta olhar aquele título.
`no_awards_for_entity` (`actionable: false`) = existe faixa em outros títulos,
este não ganhou nada. É fato sobre a obra.

---

## 5. Idempotência e "mudança revoga"

- O upsert é por `(entity_type, entity_id, provider_api)`. Linha idêntica **não
  é reescrita** e `updated_at` não é bumpado.
- Se a frase mudar, a linha é atualizada, a exibição **cai** e o hash aprovado é
  limpo — a frase nova nunca herda a aprovação da velha. O mesmo ciclo reaprova
  sobre o texto novo, se a licença permitir.
- Uma licença cadastrada **depois** de a linha existir só acende no ciclo
  seguinte do worker. É por isso que o passo 3 acima existe.

---

## 6. O que este comando NÃO faz

- não chama a OMDb (nem qualquer rede);
- não cria entidade nem toca `movies` / `tv_shows`;
- não encosta em `external_ratings`, no gate de ratings ou no Cinerie Score;
- não decide licença: ele **lê** a que estiver vigente. Sem licença no banco,
  grava o fato e diz que não acendeu; com duas, recusa como `ambiguous` em vez de
  sortear de quem é o crédito;
- não traduz nome de prêmio. `"Oscars"` chega ao banco e à tela como `"Oscars"`.
