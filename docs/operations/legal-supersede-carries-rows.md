# Supersede de licenca: por que ele apagava a tela, e o que impede de novo

> Incidente de producao: **2026-08-20**. Documento operacional — leia antes de
> rodar `legal sources apply` com dado publicado no banco.

## 1. O que aconteceu

```
legal sources apply  ->  licencas: create=0 supersede=72 keep=4
                         decisoes: create=76 supersede=0 keep=4
```

Antes: pagina de serie com `AVALIACOES · IMDb 8,4` e `ONDE ASSISTIR · HBO Max`
— **453 notas** e **874 ofertas** exibiveis. Depois: coluna direita vazia, nas
duas verticais.

O bloco de premios continuou na tela. A licenca dele (`omdb`/`other`) foi uma
das **4 que ficaram `KEEP`**; as de nota e de oferta foram das **72 que sofreram
`SUPERSEDE`**. Tudo que foi superseded apagou; tudo que ficou keep sobreviveu.

## 2. A causa — o ponteiro, nunca a coluna

Medido em producao **depois** do apply:

```
external_ratings     display_allowed:  t = 453   f = 15
watch_availability   display_allowed:  t = 874   f = 48
```

Os mesmos numeros de antes. A coluna nao mudou uma linha. O portao que fechou e
a **resolucao da licenca em tempo de leitura**.

`external_ratings.data_usage_decision_id` e
`watch_availability.data_usage_decision_id` sao FKs para uma **LINHA** de
`data_usage_decisions` — nao para "a decisao vigente daquele uso". O `supersede`
fazia tres coisas, nesta ordem, e nenhuma quarta:

1. `UPDATE data_usage_decisions SET is_current = false` (as decisoes da licenca);
2. `UPDATE source_licenses SET is_current = false` (a licenca);
3. `INSERT` da licenca nova + `INSERT` das decisoes novas, **com ids novos**.

As notas e as ofertas continuaram apontando para os ids do passo 1. E os dois
gates de leitura exigem `is_current` na decisao **e** na licenca-mae:

| Onde | Linha |
| --- | --- |
| notas | [`apps/web/src/server/entity-ratings.ts:103`](../../apps/web/src/server/entity-ratings.ts) — `if (!decision.isCurrent) return false;` |
| notas | [`apps/web/src/server/entity-ratings.ts:116`](../../apps/web/src/server/entity-ratings.ts) — `if (!license.isCurrent) return false;` |
| ofertas | [`apps/web/src/server/entity-watch.ts:76`](../../apps/web/src/server/entity-watch.ts) — `isCurrent: true` na decisao |
| ofertas | [`apps/web/src/server/entity-watch.ts:86`](../../apps/web/src/server/entity-watch.ts) — `isCurrent: true` na licenca-mae |

O comentario que governava o passo 1, em `plan.ts`, dizia:

> "suas decisoes referenciam uma licenca que deixara de ser vigente, entao sao
> desativadas (o read path ja ignora decisao cuja licenca nao e is_current —
> isto so limpa o estado)."

Verdadeiro sobre a decisao. **Cego quanto ao que apontava para ela.**

### Detalhe operacional que vale saber

O estado orfao **nao e alcancavel por `UPDATE` direto**: o guard de escrita
recusa apontar uma linha exibivel para uma decisao morta
(`external_ratings fail-closed: decisao N nao e a vigente`). Ele so surge **por
baixo** — quando a decisao que a linha ja apontava sai de cena. O unico caminho
que produzia esse estado era o proprio `apply`.

Consequencia pratica: enquanto orfa, a linha fica **congelada** — qualquer
escrita nela e recusada pelo guard ate o ponteiro ser consertado.

## 3. O conserto de estado: `sources rebind`

Re-resolve o ponteiro das linhas existentes contra a licenca **vigente**. Nao
toca `display_allowed`, nao mexe em `reviewed_by`/`approved_payload_hash`, nao
recoleta nada de API, e so toca o que quebrou (idempotente).

Dry-run primeiro:

```bash
pnpm legal sources rebind
```

Depois, o conserto:

```bash
pnpm legal sources rebind --reviewer="Pablo Eduardo — proprietario da Cinerie" --confirm
```

O `--confirm` ja imprime a verificacao na mesma execucao. Para conferir de fora,
a consulta somente leitura equivalente ao gate da pagina esta na secao 6.

Linhas contadas como **irrecuperaveis** nao tem decisao vigente que as assuma —
isso e licenca faltando, nao ponteiro quebrado. `pnpm legal sources review`
mostra se a fonte/provedor daquelas linhas tem licenca vigente.

## 4. O que impede o proximo apply de repetir

**O supersede passa a carregar as linhas junto.** Em
[`services/legal/src/apply.ts`](../../services/legal/src/apply.ts), depois de
inserir a decisao nova e na **mesma transacao**, as linhas que apontavam para a
decisao antiga passam a apontar para a nova.

Quem decide **se** pode carregar e o planejador puro
([`services/legal/src/plan.ts`](../../services/legal/src/plan.ts),
`DecisionCarry`), olhando exatamente os campos que o guard de escrita exige:

- `license_status` em `official`/`licensed`/`third_party`;
- `display_allowed` na licenca nova;
- `score_allowed` quando `content_type = 'rating'` (exibir a nota e exibir o numero);
- decisao nova em `approved_for_display` com `display_allowed`;
- territorio que cobre `BR` (territorial vence global, como no resolvedor de escrita).

Isso **tem** de ser decidido no plano, nao descoberto pelo trigger: repontuar
para um destino que o guard recusa abortaria a transacao inteira, e uma mudanca
legitima de licenca derrubaria a ferramenta.

**Licenca mais restritiva continua ocultando** — e certo que oculte. O que mudou
e que ela **avisa antes**.

## 5. O `review` agora diz quantas linhas vai ocultar

O `review` de 2026-08-20 imprimiu `supersede=72` e mais nada. O numero que
importava — 453 notas e 874 ofertas prestes a sumir — nao estava escrito em
lugar nenhum. Um plano que nao diz quantas linhas vai ocultar nao e um plano.

`pnpm legal sources review` (e o dry-run do `apply`) agora imprime:

```
## Impacto nas linhas ja exibiveis
  CARREGADAS para a licenca nova (continuam na tela): 453 nota(s) · 874 oferta(s)
  OCULTADAS por esta mudanca (saem da tela):          0 nota(s) · 0 oferta(s)
```

e, quando alguma coisa sai:

```
  ATENCAO — esta leva vai OCULTAR dado que hoje esta publicado:
    - 1 nota(s) — imdb · rating_display/BR · decisao #11 — MOTIVO: licenca nova com display_allowed=false
```

Ha ainda um aviso de **risco de aborto**: linhas exibiveis cujo
`approved_payload_hash` divergiu do payload atual. O guard reconfere o
fingerprint a cada `UPDATE`, e repontuar e um `UPDATE` — sem esse aviso, o
operador descobriria com o apply caindo.

## 6. Conferencia somente leitura (cole no psql de producao)

A pergunta que a **pagina** faz. Nao escreve nada.

```sql
SELECT
  (SELECT count(*) FROM external_ratings r
     JOIN data_usage_decisions d ON d.id = r.data_usage_decision_id
     JOIN source_licenses l ON l.id = d.source_license_id
    WHERE r.display_allowed AND d.is_current AND d.use_case = 'rating_display'
      AND d.stage = 'approved_for_display' AND d.display_allowed
      AND d.valid_from <= now() AND (d.valid_until IS NULL OR d.valid_until > now())
      AND (d.territory IS NULL OR d.territory = 'BR')
      AND l.is_current AND l.content_type = 'rating' AND l.rating_source_key = r.rating_source
      AND l.display_allowed AND l.score_allowed
      AND l.license_status IN ('official','licensed','third_party')) AS notas_na_tela,
  (SELECT count(*) FROM external_ratings WHERE display_allowed) AS notas_display_allowed,
  (SELECT count(*) FROM watch_availability w
     JOIN data_usage_decisions d ON d.id = w.data_usage_decision_id
     JOIN source_licenses l ON l.id = d.source_license_id
    WHERE w.display_allowed AND d.is_current AND d.use_case = 'watch_offer_display'
      AND d.stage = 'approved_for_display' AND d.display_allowed
      AND d.valid_from <= now() AND (d.valid_until IS NULL OR d.valid_until > now())
      AND (d.territory IS NULL OR d.territory = w.country_code)
      AND l.is_current AND l.content_type = 'watch_availability' AND l.display_allowed
      AND l.license_status IN ('official','licensed','third_party')) AS ofertas_na_tela,
  (SELECT count(*) FROM watch_availability WHERE display_allowed) AS ofertas_display_allowed;
```

Quando `*_na_tela` e menor que `*_display_allowed`, a diferenca sao linhas
orfas. `pnpm legal sources rebind` (dry-run) diz quantas delas tem destino.

## 7. Por que nenhum teste pegou isto

`validate-source-authorization-supersede.ts` exercita um supersede real, com
licencas que **ja carregavam decisoes vigentes**, em PostgreSQL de verdade — e
ficou verde. O ponto cego era a **ordem da fixture**: os checks 13-14 promovem
as notas **depois** de aplicar a leva nova. Nesse estado a orfandade e
literalmente impossivel, porque o dado ja nasce ligado a decisao vigente.
Producao estava no estado oposto: notas e ofertas na tela **antes** de a leva
chegar.

O check 16 daquele validador chega a contar "orfas" — mas a palavra ali quer
dizer *decisao apontando para licenca morta*, nao *nota apontando para decisao
morta*. Duas orfandades diferentes, o mesmo nome.

E `applyAuthorizationWithin` — o laco de escrita inteiro — **nao tinha nenhum
teste unitario**.

O que passou a pegar:

| Teste | O que trava |
| --- | --- |
| [`services/legal/src/__tests__/supersede-carry.test.ts`](../../services/legal/src/__tests__/supersede-carry.test.ts) | o plano decide certo quem assume as linhas; o laco de escrita **emite** o `UPDATE`, nas duas tabelas, **depois** do `INSERT` da decisao; licenca restritiva nao repontua nada |
| [`services/legal/scripts/validate-supersede-carries-rows.ts`](../../services/legal/scripts/validate-supersede-carries-rows.ts) | PostgreSQL real, dado promovido **ANTES** da leva: nota e oferta continuam na tela; ponteiro migrou; `display_allowed` intocado; leva restritiva oculta avisando antes; `rebind` recupera o orfao e e idempotente |

Rode com:

```bash
pnpm validate:supersede-carries-rows
```

**Controle negativo (verificado, nao presumido).** Com o carregamento desligado
a mao no codigo de producao, o validador reproduz o incidente:

```
[FAIL] 4. DEPOIS do supersede: a nota E a oferta CONTINUAM na tela — notas 1->0, ofertas 1->0
[PASS] 6. display_allowed NAO foi tocado pelo carregamento
```

Exatamente o que producao mediu: tela vazia, coluna intacta.

## 8. Defeito latente que o carregamento revelou

`valid_from` era gravado com `now()` numa coluna `TIMESTAMP(3)`. O PostgreSQL
**arredonda** para o milissegundo, e o arredondamento pode subir: com
`now() = 00:03:00.635678` o valor gravado vira `.636` — **maior** que o
`CURRENT_TIMESTAMP` da mesma transacao. O guard testa exatamente
`decision.valid_from > CURRENT_TIMESTAMP` e derruba tudo:

```
P0001: external_ratings fail-closed: decisao N fora da vigencia
```

Ficou latente enquanto ninguem escrevia numa linha governada logo depois de
criar a decisao. O carregamento passou a fazer isso — e a falha seria
**intermitente** (so quando os microssegundos arredondam para cima). Corrigido
com `date_trunc('milliseconds', now())`, que sempre desce.
