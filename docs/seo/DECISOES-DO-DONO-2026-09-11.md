# Decisões do dono — 11/09/2026 (remediação da auditoria de SEO)

> **O que este documento é.** O `CLAUDE.md` §6 exige **revisão humana** para
> decisões de **licença**, de **indexação em massa** e de **publicação**. A
> auditoria de 11/09/2026 ([`AUDITORIA-SEO-2026-09-11.md`](AUDITORIA-SEO-2026-09-11.md))
> terminou com seis perguntas dessa natureza em aberto, na seção 9C — de
> propósito, porque um agente não as responde sozinho.
>
> **O dono respondeu as seis, por escrito, em 11/09/2026.** Este arquivo é o
> registro dessas respostas. Ele é citado pelo código que as implementa: quem
> encontrar uma regra de indexação estranha deve chegar aqui e ver a decisão, a
> data e o motivo — em vez de encontrar um `noindex` sem dono.
>
> Precedente e formato: [`docs/legal/owner-authorization-2026-08-20.md`](../legal/owner-authorization-2026-08-20.md).

---

## D1 · Galerias saem do índice

**Decisão.** Galerias de mídia — `/imagens/` e `/videos/` de filme, série,
temporada e episódio — **não permanecem como URLs indexáveis independentes**.

- `noindex, follow` enquanto a página continuar acessível ao usuário.
- Fora do sitemap normal.
- **A funcionalidade não é removida.** A página segue existindo como navegação
  de mídia onde for útil.

**Compensação obrigatória.** A descoberta dos *assets* não pode ser perdida
junto com as URLs finas: onde for tecnicamente apropriado, imagens e vídeos
passam a ser descobertos **pela entidade principal** (`Movie`, `TVSeries`,
`NewsArticle`) e pelas extensões `image:`/`video:` de sitemap, quando isso
trouxer valor real e corresponder ao conteúdo.

**Por quê.** São 69.016 URLs — 42,7% do sitemap — com `0 palavras` de conteúdo
principal e sem `<main>`, competindo por rastreio com as fichas. Elas não usam
extensão de sitemap de imagem/vídeo, ou seja, hoje **só pedem rastreio sem
alimentar Google Imagens ou Vídeos**.

**Escala:** 69.016 URLs mudam de estado. É indexação em massa.

---

## D2 · Pessoa indexa por portão de qualidade, único

**Decisão.** Não se indexa ~73.574 perfis mínimos porque eles existem. Passa a
haver **um** portão de qualidade para pessoa, e **`<meta robots>` e sitemap usam
exatamente o mesmo portão** — a divergência atual acaba.

O portão usa a realidade dos dados do projeto; a forma declarada é:

```text
foto válida
+ identificação confiável
+ biografia/conteúdo licenciado suficiente
+ filmografia/relevância
+ dados mínimos de entidade
```

A listagem `/pt/pessoas/` passa a **priorizar perfis aptos**. Não se entrega ao
Google uma primeira página cheia de perfis praticamente vazios.

**Por quê.** Hoje a página diz `index` e o sitemap lista **0 URLs** de pessoa —
o sitemap exige biografia licenciada e foto, a página não exige nada. Os dois
lados discordam, e a exceção vive só num comentário de código.

**Escala:** até 73.574 URLs. É indexação em massa.

---

## D3 · Ficha sem localização não indexa até ser enriquecida

**Decisão.** As ~11.666 fichas com slug `tmdb-{id}`, título no alfabeto original
e sem description **não continuam indexáveis só por existirem**.

- Enquanto não houver qualidade suficiente para o público pt-BR:
  `noindex, follow` **e** fora do sitemap.
- Quando a entidade for enriquecida/localizada: volta a `index` e **entra
  automaticamente no sitemap**, sem intervenção manual.
- **Não** apagar a entidade. **Não** quebrar URL nem banco. **Não** usar
  redirect falso.

**Por quê.** 12,6% do catálogo publicado em pt-BR com título que o leitor
brasileiro não reconhece e sem description — em tensão direta com a própria
regra do projeto ("entidade sem tradução = `noindex` técnico").

**Escala:** ~11.666 URLs. É indexação em massa.

---

## D4 · A imagem do TMDB pode ir para o Open Graph

**Decisão.** Está **autorizado** usar no Open Graph a mesma imagem do TMDB que
já é exibida licenciadamente na própria ficha.

Ordem de prioridade, sem exceção:

```text
imagem específica da entidade
→ imagem editorial existente
→ fallback oficial da marca
```

**Nunca** inventar imagem de filme ou série.

**Por quê.** É a mesma licença que já governa a imagem na página; o OG não cria
uso novo. Sem isso, toda ficha compartilhada em WhatsApp, X ou Facebook sai sem
imagem.

**Natureza:** decisão de **licença**.

---

## D5 · As páginas institucionais são criadas

**Decisão.** Criar, de verdade e com conteúdo real:

```text
/pt/sobre/
/pt/politica-editorial/
/pt/contato/
/pt/autores/  e  /pt/autores/{slug}/
```

mais uma página ou seção explicando o **Cinerie Score**.

**Limite inegociável — só fato comprovável.** É proibido inventar tamanho de
equipe, anos de experiência, audiência, prêmios, parcerias ou credenciais. Onde
não houver material real (por exemplo, biografia específica de um autor), vale
uma descrição institucional neutra baseada apenas no que se sabe — nunca
formação ou experiência fabricadas.

**A política editorial descreve o que o site cumpre.** Onde o texto e a
implementação divergirem, muda-se a implementação, não o texto.

**Por quê.** É o conjunto de sinais de E-E-A-T mais penalizado num site que
publica opinião editorial e reexibe notas de terceiros — e é o único achado
**crítico** da auditoria.

**Natureza:** decisão de **publicação**.

---

## D6 · Favicon: reaproveitar antes de desenhar

**Decisão.** `/favicon.ico` responder **200**. A ordem é:

1. procurar símbolo quadrado oficial, ícone existente, *app icon* ou asset
   anterior válido já usado em outra aplicação Cinerie e **reutilizar**;
2. só se não existir nenhum, derivar um ícone técnico minimalista da identidade
   já existente — letra/símbolo já associado à marca, tipografia e paleta já
   existentes, quadrado, legível em tamanho pequeno.

**Não** redesenhar a marca.

**Por quê.** Hoje `/favicon.ico` responde **404 com ~23 KB de HTML**, e todo
navegador pede esse arquivo em toda visita.

---

## D7 · Crawlers de IA: a política atual **fica como está**

**Decisão.** **Manter.** Crawlers de **busca/resposta ao vivo** seguem
liberados; crawlers de **treino** seguem bloqueados. **Não** liberar crawler de
treino automaticamente, e **não** desativar o `Content-Signal`.

| Papel | Agentes | Estado |
|---|---|---|
| busca / resposta ao vivo | OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Googlebot, Googlebot-News, Bingbot, Applebot | liberados |
| treino de modelo | GPTBot, ClaudeBot, Google-Extended, CCBot, Amazonbot, Applebot-Extended, Bytespider, meta-externalagent | **bloqueados** |

**Por quê.** A visibilidade em busca com IA **não** está bloqueada — o que está
bloqueado é o uso para treino. Isso sempre foi decisão de negócio, e a auditoria
a registrou sem recomendar inversão. Bloquear `Google-Extended` não afeta Search
nem AI Overviews.

**A ambiguidade do robots.txt continua sendo defeito técnico** e será corrigida:
hoje saem **dois** grupos `User-agent: *` (o bloco gerenciado da Cloudflare mais
o do app). O Google une os dois; um parser ingênuo, não. Simplificar o lado do
app **não** pode remover as regras da borda.

---

## Decisões de rota que acompanham (sem ambiguidade)

| Item | Decisão |
|---|---|
| `www.cinerie.com` | **301** para o apex, preservando *path* e *query string*. Canonical sozinho não resolve. |
| Raiz `/` | **308** para `/pt/` enquanto só `pt` estiver publicado (hoje 307). |
| Degrau de gênero na trilha | Sai como link/entidade estrutural enquanto não existir página de gênero real. **Não** criar página vazia só para satisfazer o breadcrumb. |

---

## O que estas decisões **não** autorizam

Para não sobrar dúvida em nenhuma leitura futura:

- **Não** autorizam liberar crawler de treino (D7 é explicitamente o contrário).
- **Não** autorizam inventar conteúdo, autor, credencial ou nota (D5).
- **Não** autorizam `AggregateRating` a partir do Cinerie Score — a proibição
  segue travada por teste.
- **Não** autorizam apagar entidade, URL ou linha de banco (D3).
- **Não** autorizam usar `noindex` como tratamento de falha de infraestrutura:
  banco fora do ar é **5xx**, não decisão de SEO.
- **Não** autorizam cachear `/pt/noticias/**`: a despublicação de emergência
  depende de leitura por requisição, e cache ali seguraria matéria retratada no
  ar.
