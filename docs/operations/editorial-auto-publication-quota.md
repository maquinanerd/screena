# Quota de autopublicacao editorial

> Operacao dos tetos diarios que governam a publicacao automatica do MNScr.
> Leia antes de mexer em limite, fuso ou nas tabelas de contador.

Escopo: o que o CMS conta, onde conta, como o teto sobrevive a concorrencia e o
que fazer quando um numero parece errado. A decisao editorial de cada pedido
(autoria, QA, SEO, contrato) esta em `apps/cms/src/auto-publication.ts` e nao e
assunto deste documento.

---

## 1. Por que existe uma tabela de contadores

A forma obvia de aplicar um teto — contar o que ja foi publicado hoje e comparar
antes de publicar — tem uma janela entre a contagem e a escrita. Duas
requisicoes simultaneas leem 9, ambas concluem que cabe mais uma, e o dia fecha
com 11 num teto de 10.

Isso **nao** e uma corrida rara: e o caso normal quando o pipeline dispara um
lote. E um `SELECT COUNT` tambem nao protege contra multiplas instancias do CMS,
porque cada uma contaria por si.

O contador resolve porque o incremento e a checagem sao a **mesma** operacao no
banco, e porque a linha e compartilhada por todas as instancias.

---

## 2. As cinco dimensoes

| Dimensao | Chave | Env de teto | O que protege |
| --- | --- | --- | --- |
| `global` | constante `all` | `EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT` | volume total do dia |
| `content_type` | `news`, `review`, ... | `..._PER_CONTENT_TYPE_LIMIT` | um formato dominar o dia |
| `section` | secao sugerida | `..._PER_SECTION_LIMIT` | uma editoria dominar o dia |
| `author` | id do autor publico | `..._PER_AUTHOR_LIMIT` | uso excessivo de uma assinatura |
| `article_update` | id do artigo | `..._PER_ARTICLE_UPDATE_LIMIT` | reescrita em loop da mesma materia |

Regras que valem para todas:

- **Teto ausente em `production` vira teto conservador**, nunca "sem teto".
  Variavel esquecida no deploy nao pode significar publicacao ilimitada.
- **Dimensao sem teto nao vira linha.** Contar sem limite so gastaria escrita e
  criaria contencao numa linha que nunca recusa nada.
- **Teto `0` e diferente de ausente.** `0` recusa tudo naquele eixo; ausente
  significa "sem restricao" (ou o conservador, em production).
- **`article_update` nao e diario.** O teto de reescritas de uma materia nao se
  renova a meia-noite — por isso a recusa dessa dimensao **nao** promete
  `nextEligibleAt`. Prometer um horario mandaria o produtor reenviar para sempre.

### Teto do autor vence o da plataforma quando e menor

O documento `Author` tem `automationDailyLimit` proprio. O teto efetivo por autor
e o **mais restritivo** entre ele e `EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT`. Um
autor que aceita 3 publicacoes por dia nao passa a aceitar 50 porque a
plataforma permite 50 — a decisao sobre o proprio nome e dele.

### Ordem de aquisicao

As dimensoes sao consumidas sempre na ordem da tabela acima, do mais generico ao
mais especifico. **A ordem e deterministica de proposito**: duas transacoes que
travem as mesmas linhas em ordens diferentes formam um ciclo e o PostgreSQL mata
uma por deadlock. Falhar cedo tambem economiza trabalho — quando o teto global
estourou, nem tocamos nas outras quatro linhas.

Se voce adicionar uma dimensao, adicione-a a `QUOTA_DIMENSIONS`
(`apps/cms/src/quota.ts`) na posicao certa. Nao ordene em outro lugar.

---

## 3. O dia civil da redacao

O teto e do **dia da redacao**, nao do dia UTC. A chave do contador inclui o
fuso e a data local:

```
(time_zone, local_date, dimension_type, dimension_key)
```

- Fuso configurado em `EDITORIAL_AUTO_PUBLISH_TIME_ZONE`. Identificador **IANA**
  (`America/Sao_Paulo`). Offset fixo (`-03:00`) e abreviacao (`BRT`) sao
  **recusados**: os dois ignoram horario de verao e mudancas historicas, e a
  conta erraria em silencio justamente nos dias em que a virada importa.
- Em `production` o fuso e **obrigatorio**. Ausente ou invalido: readiness
  bloqueada, preflight `BLOCKED`, endpoint responde `503`
  (`AUTO_PUBLISH_TIME_ZONE_INVALID`). Nao e defeito editorial da materia — e
  configuracao de plataforma, e o produtor deve retentar depois da correcao.
- A janela e **half-open** `[inicio, proximo_inicio)`. Com os dois extremos
  inclusivos, uma publicacao a meia-noite exata contaria em dois dias.
- **Trocar o fuso da operacao nao reaproveita os baldes do fuso antigo.** Eles
  cobrem intervalos diferentes de tempo real, e por isso o fuso faz parte da
  chave. Depois de uma troca, os tetos do dia recomecam do zero — isso e
  correto, nao um bug.

---

## 4. Como o incremento sobrevive a concorrencia

O consumo de cada dimensao e **um unico statement**:

```sql
INSERT INTO autopublish_quota_counters (...) VALUES (..., 1, <limite>, ...)
ON CONFLICT (time_zone, local_date, dimension_type, dimension_key)
DO UPDATE SET current_count = autopublish_quota_counters.current_count + 1, ...
WHERE autopublish_quota_counters.current_count < <limite>
RETURNING current_count
```

Tres propriedades importam:

1. **Cria ou incrementa numa operacao so.** Nao ha "ler, decidir, escrever", logo
   nao ha janela entre a decisao e a escrita.
2. **O `WHERE` do `DO UPDATE` e reavaliado depois de travar a linha**, entao ele
   enxerga o valor commitado mais recente — nao o do snapshot em que a transacao
   comecou. Concorrentes nao competem: o segundo espera o primeiro commitar.
3. **Zero linhas devolvidas = teto atingido.** A recusa nao e um erro.

Isso e deliberadamente diferente de `INSERT` com `catch` da violacao de unique.
No PostgreSQL, um erro dentro de transacao interativa deixa a transacao em estado
abortado (`25P02`) e **todo comando seguinte falha**. Conflito esperado nao pode
virar excecao aqui — o `catch` nao recuperaria nada, so esconderia a origem do
estrago.

---

## 5. A garantia central: contador e publicacao vivem e morrem juntos

A reserva, a criacao/atualizacao do artigo, a publicacao e a gravacao da outbox
acontecem **na mesma transacao**. Consequencias praticas:

- Publicacao confirmada => contador confirmado.
- Qualquer falha depois da reserva => rollback leva os contadores junto.
- **Nao existe o estado "contou e nao publicou"** nem o inverso.
- Recusa por teto tambem desfaz as dimensoes ja consumidas naquele pedido. Sem
  isso, uma publicacao recusada pela secao teria consumido o teto global do dia.

Nao ha compensacao manual em nenhum ponto: decrementar um contador "de volta"
abriria exatamente a janela que a transacao existe para fechar.

O endpoint recusa publicar se o adapter de banco nao expuser transacao. Falhar e
melhor do que reservar e publicar fora de transacao.

---

## 6. Idempotencia

Um retry cujo HTTP se perdeu no caminho **ja consumiu** o teto na primeira
tentativa. Consumir de novo faria o produtor gastar o dia reenviando o mesmo
pedido — e o teto protegeria contra a coisa errada.

Duas defesas, nessa ordem:

1. Antes de abrir a transacao, o endpoint procura um consumo previo com o mesmo
   `requestId`. Se achar, responde com `idempotent: true` e **nao reaplica nada**.
2. `autopublish_quota_usage.request_id` e **unique**. Se dois envios do mesmo
   pedido passarem juntos pela consulta previa, a colisao aborta a transacao
   inteira e nenhum contador daquele envio sobrevive.

`autopublish_quota_usage` e a trilha de auditoria: os contadores dizem **quanto**
foi usado; ela diz **por que**. Sem ela, um numero divergente seria impossivel de
reconstruir.

---

## 7. Desfechos quando o teto esgota

| Situacao | Desfecho | HTTP |
| --- | --- | --- |
| Teto diario esgotado, conteudo valido | `ROUTED_TO_REVIEW` + codigo da dimensao + `nextEligibleAt` | 202 |
| Teto de reescrita esgotado | `ROUTED_TO_REVIEW` + codigo, **sem** `nextEligibleAt` | 202 |
| Fuso invalido em production | `OPERATIONAL_ERROR` / `AUTO_PUBLISH_TIME_ZONE_INVALID`, `retryable` | 503 |
| Falha de persistencia | `OPERATIONAL_ERROR` / `AUTO_PUBLISH_PERSISTENCE_FAILED`, `retryable` | 503 |

Teto esgotado com conteudo valido **nao e erro do produtor**: o pedido passou por
todas as validacoes e o que falta e decisao humana. Por isso 202 e nao 4xx, e por
isso o conteudo nao e jogado fora.

Os codigos por dimensao (`AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED`,
`..._AUTHOR_...`, `..._SECTION_...`, `..._CONTENT_TYPE_...`,
`..._ARTICLE_UPDATE_...`) sao distintos de proposito: "limite atingido" generico
nao diria ao produtor se ele deve esperar a meia-noite ou parar de reescrever a
mesma materia.

---

## 8. Diagnostico

**"O contador esta maior que o numero de materias publicadas hoje."**
Compare com `autopublish_quota_usage` do mesmo `local_date`. Cada linha de uso e
uma publicacao efetivada. Divergencia real so seria possivel com escrita manual
nas tabelas — o caminho normal e transacional.

**"Uma publicacao foi recusada e o dia parece ter sido consumido."**
Nao foi. As dimensoes anteriores a recusa entram no rollback. Confirme lendo
`current_count` da dimensao `global` daquele dia.

**"O teto zerou no meio da noite."**
Confira `EDITORIAL_AUTO_PUBLISH_TIME_ZONE`. Sem fuso correto a janela e calculada
em UTC e a virada acontece as 21h no horario de Brasilia.

**"O limite mudou mas o contador continua com o antigo."**
`limit_snapshot` guarda o teto **vigente no momento do consumo**, para auditoria.
Ele nao governa nada: o teto aplicado e sempre o da configuracao atual.

---

## 9. Onde esta o codigo

| Arquivo | Papel |
| --- | --- |
| `apps/cms/src/quota.ts` | politica PURA: quais dimensoes, em que ordem, codigos, dia civil |
| `apps/cms/src/quota-store.ts` | consumo transacional (SQL atomico) e trilha de uso |
| `apps/cms/src/env-auto-publish.ts` | kill switch, tetos, fuso, janela do dia |
| `apps/cms/src/endpoints/editorial-publications.ts` | orquestracao: idempotencia, transacao, desfechos |
| `apps/cms/src/__tests__/quota.test.ts` | politica (puro) |
| `apps/cms/src/__tests__/quota.integration.test.ts` | concorrencia e rollback contra PostgreSQL real |
| `apps/cms/src/__tests__/auto-publication.integration.test.ts` | caminho HTTP ponta a ponta |
