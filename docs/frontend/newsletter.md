# Newsletter — por que a faixa não está no ar, e o que a liga

> Estado: **desligada**, atrás de flag. Decisão do proprietário (Pablo Eduardo),
> 13/08/2026. Este documento existe para que a próxima pessoa não precise ler o
> código para descobrir por quê.

## O estado atual, em uma frase

O `<form>` existe, funciona e está testado. A faixa **não renderiza** porque não
há onde guardar uma inscrição — e um formulário que nunca consegue ter sucesso é
pior que ausência: o leitor digita o e-mail, aperta, e recebe erro. O gesto foi
gasto à toa.

## A flag

| | |
|---|---|
| **Nome** | `CINERIE_NEWSLETTER_ENABLED` |
| **Onde é lida** | `isNewsletterEnabled()` em [`apps/web/src/lib/site.ts`](../../apps/web/src/lib/site.ts) |
| **Quem decide** | `SiteFooter` (server component) |
| **Parser** | `parseBooleanEnvFlag` — só `"true"`/`"1"` ligam; ausente, vazio ou inválido desliga |
| **Default** | **desligada** (fail-closed) |

É uma flag de **capacidade** ("existe onde guardar?"), não de indexação.
Deliberadamente independente de `CINERIE_PUBLIC_INDEXING_ENABLED` — amarrar as
duas faria a newsletter acender em produção só porque a indexação foi ligada.

## A ausência não é muda

Com a flag desligada, o `SectionBoundary` emite:

```json
{"event":"section_absent","section":"newsletter","reason":"newsletter_storage_unavailable","surface":"footer","actionable":true}
```

`actionable: true` porque é um passo pendente, nunca um fato sobre o site.

O log sai **uma vez por processo**, não por request (`once` no `SectionBoundary`).
O rodapé renderiza em toda página; uma linha por pageview afogaria o log inteiro,
e a causa aqui é uma propriedade do deploy — repetir não acrescenta informação.

Em desenvolvimento há, além do log, um aviso visível no DOM.

## O que exatamente destrava a flag

**Não basta criar a flag ligada.** Ligar sem armazenamento devolve o formulário
que sempre erra — o estado que esta decisão removeu.

### 1. Uma tabela de inscrição anônima — que **não existe** hoje

O engano fácil aqui: o schema **já tem** consentimento de marketing.

```prisma
model ConsentRecord {
  userId        BigInt      // ← FK para User
  kind          ConsentKind // ← inclui `marketing_email`
  policyVersion String
  occurredAt    DateTime
}
```

E `/pt/privacidade` já declara a finalidade "Comunicações por e-mail (novidades)"
como opcional e revogável, com o liga/desliga em `/pt/conta/privacidade`.

**Mas isso cobre quem tem conta.** A faixa do rodapé é **anônima**: um visitante
sem cadastro. `ConsentRecord.userId` é FK obrigatória para `User` — não há onde
pôr um e-mail sem conta. É exatamente essa a lacuna.

A tabela nova precisa carregar, no mínimo:

- **e-mail** (e a decisão de normalizá-lo ou não — isso muda o que é "duplicado");
- **consentimento**: momento + versão do documento vigente, como o `ConsentRecord`
  já faz. Sem versão, não se prova o que a pessoa aceitou;
- **origem**: qual superfície capturou (rodapé, artigo, campanha). Sem isso não há
  como responder "de onde veio esse e-mail?";
- **dupla confirmação** (opt-in por e-mail): estado + token + validade. Sem ela,
  qualquer pessoa inscreve o endereço de outra;
- **descadastro**: token estável e carimbo de quando saiu. O link de descadastro
  precisa funcionar **sem login** — quem se inscreveu anônimo não tem conta para
  entrar;
- **alcance pelas rotas de LGPD**: exportação e exclusão (`DataRequest`) precisam
  enxergar essa tabela, senão um pedido de exclusão deixa o e-mail para trás.

### 2. A política de privacidade precisa cobrir a lista anônima

Hoje ela descreve a finalidade para **titulares de conta**. Uma lista anônima é
outra base de tratamento e outro caminho de revogação — o texto tem de dizer isso
antes de o primeiro e-mail entrar.

### 3. Só então: `CINERIE_NEWSLETTER_ENABLED=1`

E trocar o corpo de `POST /api/newsletter`, que hoje responde `503` honesto.

## Por que a migration não foi criada junto

Decisão do proprietário: **lista de e-mail é dado pessoal e abre uma frente que o
site hoje não tem** — consentimento registrado, data, origem, caminho de
descadastro. É tarefa própria, com aprovação própria. Criar a tabela "de carona"
numa mudança de rodapé seria decidir sobre dado pessoal sem a revisão que isso
exige.

## Um caminho mais curto, se ele servir

A capacidade **já existe para quem tem conta**: `ConsentKind.marketing_email`,
o registro versionado e o liga/desliga em `/pt/conta/privacidade`. Se a intenção
for só "avisar quem já é usuário", nada disso precisa ser construído — a faixa
anônima do rodapé é que não se aplica. Isso é decisão de produto, não de
implementação; fica registrado porque o custo das duas opções é muito diferente.

## O que **não** mudar por engano

- **Não apague o `<form>`, os estados nem os testes.** É trabalho feito e testado,
  e vai ao ar ligando a flag.
- **Não faça a rota responder `200`** para "resolver" o erro. Ela responde `503`
  com a verdade de propósito, e continua respondendo mesmo com a faixa oculta —
  quem chegar nela por outro caminho recebe a mesma resposta honesta.
- **Não troque o `SectionBoundary` por um ternário.** A decisão e o log são a
  mesma linha justamente para não divergirem.
