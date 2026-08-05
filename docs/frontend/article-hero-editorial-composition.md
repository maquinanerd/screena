# Tela de matéria (`/pt/noticias/[slug]`) — composição editorial do hero

> Documento de rastreabilidade da correção da tela 05. Registra **a causa raiz**
> da composição anterior, o que mudou, o que **não** mudou e as limitações que
> continuam de pé — com o motivo de cada uma.
>
> Escopo confirmado em [`page-map.md`](./page-map.md) § *News Pages*: a rota é
> `/pt/noticias/[slug]`. A Home, as páginas de filme/série/pessoa e o índice de
> notícias **não** foram tocados.

---

## 1. Diagnóstico — o que estava errado

A revisão listou vinte sintomas. Eles não eram vinte defeitos: eram **cinco
causas**, e a maior parte da lista descende das duas primeiras.

### Causa 1 — o hero e o header estavam em GRADES DIFERENTES

```css
/* antes */
.art-hero__inner {
  max-width: 880px;
  margin: 0 auto;
  padding: 150px 40px 60px;
}
```

O header usa `--container-nav` (1380px) com `--pad-page` (80px). Numa tela de
1920px isso põe a wordmark em **350px**. O hero, com 880px centrados e 40px de
recuo, punha a manchete em **552px**.

**200px fora de eixo.** Não era margem errada nem espaçamento mal calibrado: era
uma segunda grade, inventada só para este bloco. É daí que vêm os sintomas de
composição estreita, conteúdo longe da margem, largura de desktop mal
aproveitada e "navegação e hero não parecem a mesma composição".

Correção: o hero passa a citar **os mesmos dois tokens do header**, e a troca
para o recuo estreito acontece no **mesmo ponto de quebra** (`max-width: 1023px`,
onde `.site-header__inner` também troca `--pad-page` por `--pad-page-mobile`).

### Causa 2 — o scrim apagava a fotografia

O scrim anterior somava duas bandas fortes e a opacidade combinada **nunca caía
abaixo de ~0.66 em ponto nenhum do hero** — inclusive no meio, onde não há texto
para proteger. Medido sobre uma capa inteiramente branca, o quadrante superior
direito ficava em **73/255**: quase preto.

Correção: três bandas com destino declarado (topo, rodapé e **esquerda**) mais
uma base plana fraca de `0.2`. A banda lateral é o que permite as outras serem
fracas — ela protege a manchete sem escurecer a metade direita da foto, onde
costuma estar o assunto. O mesmo ponto agora mede **~168/255**.

### Causa 3 — o hero era baixo demais para o volume de texto

`clamp(520px, 68vh, 720px)`. O bloco editorial (data + manchete + resumo +
assinatura) ocupa ~300px; num hero de 612px ele tomava metade da altura e o
título caía no meio da imagem. **Estava tecnicamente ancorado no rodapé**
(`margin-top: auto`) e ainda assim *parecia* flutuar, porque sobrava pouca
imagem limpa acima dele.

Correção: `clamp(560px, 88svh, 1000px)`. A métrica que passou a valer é a fração
do hero que fica **só com imagem acima do texto** — era 42%, passou a ~56%.

### Causa 4 — a manchete não tinha escala editorial

`clamp(30px, 5vw, 52px)` travava em 52px dentro de uma caixa de 800px.

Correção, **apenas no estado com capa**: `clamp(34px, 4.6vw, 76px)` com
`max-width: min(920px, 100%)` e `text-wrap: balance`. Sem capa o título continua
em 52px, porque ali ele vive na coluna de leitura de 720px.

### Causa 5 — o avatar era um buraco

`background: linear-gradient(135deg, #8a8a8a, #2a2a2a)` num círculo de 30px. O
contrato público **não projeta retrato**, então aquilo nunca foi um avatar
carregando: era um círculo cinza permanente, que na tela lê como imagem quebrada.

Correção: iniciais reais derivadas do nome; sem letra aproveitável, **não há
círculo**.

---

## 2. Correções fora da lista de sintomas

Três defeitos apareceram durante a investigação e foram corrigidos junto porque
vivem exatamente nos elementos reestruturados.

| Defeito | Correção |
| --- | --- |
| Trilha exibia `Início › Notícias › news` | `sectionCrumbLabel` suprime o rótulo que apenas repete o degrau anterior. `articles.category` é **texto livre** da fonte, e feed RSS carimba a categoria técnica do próprio feed. |
| A data não tinha `<time datetime>` | Elemento semântico adicionado. O JSON-LD já declarava `datePublished`, mas ele descreve a página inteira — não liga aquela data **a esta linha**. |
| Corpo com `text-align: justify` | Removido. Em coluna de 720px com palavra longa de pt-BR ele abre rios de espaço e cada linha ganha um espaçamento diferente. `hyphens: auto` fica, porque ajuda a coluna estreita do celular. |

O corpo também subiu de 17px/1.8 para **18px/1.75** e ganhou 64px de respiro
após o hero — com os 40px anteriores o primeiro parágrafo encostava na borda da
capa e a passagem lia como corte de template.

---

## 3. Limitação conhecida: focal point NÃO é projetado

**Esta é a limitação mais importante do documento.**

O CMS **tem** o campo (`focalPoint`, grupo `{x, y}` em
[`apps/cms/src/collections.ts`](../../apps/cms/src/collections.ts)). Ele **não
chega ao lado público**: `NewsHeroMediaInput` carrega somente `alt`, `credit`,
`width` e `height`.

Ligá-lo de ponta a ponta exigiria projeção nova no worker editorial **e migration
no banco público** — tarefa aprovada de banco, não efeito colateral de uma tarefa
de layout (CLAUDE.md § 10).

O que foi feito no lugar:

1. O recorte é ancorado por `--art-hero-focus`, uma custom property. Quando a
   coordenada real for projetada, **basta alimentar essa variável** — nenhuma
   outra regra do hero muda.
2. Até lá a âncora sai do único dado real disponível: a **proporção declarada**
   (`heroCropOf`), sempre deslocada para cima, porque num hero largo e baixo o
   `cover` come topo e base, e é no terço superior que ficam os rostos.

Por que a proporção é um fallback honesto e não um chute: quando o asset
governado não está vinculado, `heroImageAsset` cai no `HERO_IMAGE_SPEC` fixo de
1280x720 — 16:9, classificado como `landscape`, que é **exatamente o
comportamento neutro**. A regra só desloca alguma coisa quando existe dimensão
real de arquivo alto ou quadrado. Ela nunca recorta com base num número inventado.

**Consequência prática:** capa cujo assunto esteja deslocado para a **esquerda ou
para a direita** não tem como ser respeitada — só o eixo vertical é tratado. Não
há dado que permita fazer melhor hoje.

### Outras limitações menores

- **`<nav aria-label>` em pt-BR.** A revisão pedia `aria-label="Breadcrumb"`; a
  trilha usa `"Trilha de navegação"`. Numa página `lang="pt-BR"` o rótulo em
  português é o correto para leitor de tela — foi mantido de propósito.
- **Autor sem marcação semântica de pessoa.** Não há URL de perfil no contrato;
  `rel="author"` sem `href` não significa nada. O autor legível por máquina
  continua no JSON-LD.

---

## 4. O que NÃO mudou

- Metadata, `canonical`, `robots`, Open Graph, Twitter Card, JSON-LD de
  `NewsArticle` e `BreadcrumbList` — intactos. Nenhum H1 ou JSON-LD duplicado.
- O gate de indexabilidade e o `gatePublicRobots` — intactos.
- Os **dois estados** do hero. Matéria **sem capa** continua no tema claro, com
  título escuro na coluna de leitura e header sólido — e continua decidida por
  `data-hero-media` no HTML do **servidor**, nunca por JS.
- A página continua Server Component. Nenhuma hidratação nova foi adicionada.
- Home, filmes, séries, pessoas, índice de notícias e explorar — não tocados
  (verificado no QA, bloco 7).

---

## 5. Como isto é verificado

| Camada | Arquivo | O que tranca |
| --- | --- | --- |
| Fonte | [`tests/web/article-hero-fullscreen.test.ts`](../../tests/web/article-hero-fullscreen.test.ts) | grade compartilhada com o header, alturas, scrim de 3 bandas sem vinheta, escala da manchete, especificidade do celular, coluna de leitura sem `justify` |
| Puro | [`tests/web/article-hero-helpers.test.ts`](../../tests/web/article-hero-helpers.test.ts) | `heroCropOf`, `authorInitials`, `sectionCrumbLabel` |
| Navegador | [`apps/web/scripts/qa-article-hero-real-postgres.ts`](../../apps/web/scripts/qa-article-hero-real-postgres.ts) | Next real + PostgreSQL efêmero, 10 viewports, contraste medido em pixel de captura |

O QA visual roda com:

```bash
corepack pnpm --filter @screena/web qa:article-hero
```

Duas checagens do QA merecem destaque porque medem coisas **opostas**:

- `contraste AA sobre capa BRANCA` garante que o texto é legível;
- `capa branca: … continua visivel` garante que a foto **não** foi apagada.

Um scrim pesado passa na primeira e destrói a página na segunda. Foi exatamente
esse o defeito anterior, e é por isso que as duas precisam existir juntas.
