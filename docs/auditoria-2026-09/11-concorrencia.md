<!-- FASE 5 — produzido pelo Codex (gpt-5.6-terra, reasoning=high), em paralelo a FASE 0/1.
Comando: codex exec --sandbox read-only --skip-git-repo-check - < fase5-concorrencia.txt
O Codex teve acesso a web e navegou nos sites. Os marcadores [VERIFICADO] / [CONHECIMENTO] / [INFERIDO] sao dele.
Nenhuma edicao de conteudo foi feita por mim (Claude); so o cabecalho abaixo e a extracao do envelope da CLI. -->

# Análise de concorrência — Cinerie

Data da pesquisa: 31 de agosto de 2026.

## Método e limites

[VERIFICADO] As páginas públicas dos principais concorrentes foram consultadas diretamente ou por seus resultados indexados durante esta pesquisa. Exemplos: [IMDb](https://www.imdb.com/search/?lang=en), [Rotten Tomatoes](https://www.rottentomatoes.com/about), [Metacritic](https://www.metacritic.com/about-us/), [Letterboxd](https://letterboxd.com/), [JustWatch Brasil](https://www.justwatch.com/br/JustWatch-Streaming-API), [AdoroCinema](https://www.adorocinema.com/), [Filmow](https://filmow.com/), [Omelete](https://www.omelete.com.br/filmes/ficha/emilia-perez), [Papo de Cinema](https://www.papodecinema.com.br/filmes/pearl/) e [Plex Discover](https://www.plex.tv/discover/).

[VERIFICADO] Não foram estimados tráfego, receita, usuários, market share ou posições médias de SEO: esses números não foram determinados por fontes públicas auditadas nesta análise.

[CONHECIMENTO] A comparação com Cinerie usa exclusivamente o briefing: uma base global entity-first, em pt-BR no MVP, com filmes, séries, temporadas, episódios, pessoas, notas externas, disponibilidade, notícias e camada editorial própria gerada offline por IA e revisada. Portanto, “Cinerie faz melhor” deve ser lido como “o Cinerie pode fazer melhor se esse requisito for efetivamente entregue”; não é auditoria do produto em produção.

[VERIFICADO] “Acima da dobra” só é afirmado quando a estrutura textual acessível permite observá-lo. Em sites cuja página visual não foi carregada integralmente, o campo aparece como “não determinado”, em vez de uma suposição.

[VERIFICADO] Schema.org e sitemaps exigem inspeção de HTML e/ou arquivos de sitemap. Quando isso não foi possível, o documento diz “não determinado”; não presume que um site emite `Movie`, `TVSeries` ou `Review`.

## Tabela comparativa

Convenção: o marcador no começo de cada célula se aplica a toda a célula.

| Nome | País | Tipo | Receita | Nota própria? | Onde assistir? | Editorial? | Comunidade? | Força principal | Fraqueza principal |
|---|---|---|---|---|---|---|---|---|---|
| IMDb | [CONHECIMENTO] EUA/global | [VERIFICADO] base de títulos e pessoas | [CONHECIMENTO] anúncios, Amazon, IMDbPro e licenciamento | [VERIFICADO] sim, voto ponderado de usuários | [CONHECIMENTO] sim, links e disponibilidade por país | [CONHECIMENTO] sim, IMDb Originals/editorial | [CONHECIMENTO] listas, watchlist, avaliações e reviews | [CONHECIMENTO] profundidade de créditos | [INFERIDO] experiência editorial pouco localizada em pt-BR |
| Rotten Tomatoes | [CONHECIMENTO] EUA/global | [VERIFICADO] agregador de críticas | [CONHECIMENTO] publicidade, parcerias e comércio de ingressos/ecossistema Fandango | [VERIFICADO] Tomatometer e Popcornmeter | [CONHECIMENTO] sim, sobretudo EUA | [VERIFICADO] sim | [VERIFICADO] avaliações/reviews de usuários | [VERIFICADO] marca de crítica agregada | [INFERIDO] fraca utilidade local brasileira |
| Metacritic | [CONHECIMENTO] EUA/global | [VERIFICADO] agregador de crítica e entretenimento | [CONHECIMENTO] publicidade e patrocínio | [VERIFICADO] Metascore ponderado; User Score | [VERIFICADO] sim, há descoberta por serviço | [VERIFICADO] sim | [VERIFICADO] ratings e reviews | [VERIFICADO] metodologia de média ponderada | [INFERIDO] pouca cobertura operacional do Brasil |
| Letterboxd | [VERIFICADO] Nova Zelândia/global | [VERIFICADO] rede social de filmes | [VERIFICADO] assinaturas Pro/Patron e anúncios | [VERIFICADO] nota de membros | [VERIFICADO] sim, via JustWatch | [VERIFICADO] sim, Journal/HQs/listas oficiais | [VERIFICADO] muito forte: diário, reviews, listas, follows | [VERIFICADO] produto social cinéfilo | [VERIFICADO] catálogo de séries não é o foco |
| JustWatch | [VERIFICADO] Alemanha/global | [VERIFICADO] buscador de streaming/dados B2B | [VERIFICADO] comissões, widgets/API e inteligência de dados | [CONHECIMENTO] não possui nota editorial central | [VERIFICADO] sim, seu produto principal | [CONHECIMENTO] editorial limitado | [CONHECIMENTO] watchlist e preferências; comunidade limitada | [VERIFICADO] disponibilidade por país | [INFERIDO] pouco contexto editorial por obra |
| Reelgood | [CONHECIMENTO] EUA | [CONHECIMENTO] guia de streaming | [CONHECIMENTO] afiliados, anúncios e parcerias | [CONHECIMENTO] terceiros | [CONHECIMENTO] sim | [CONHECIMENTO] limitado | [CONHECIMENTO] watchlist | [CONHECIMENTO] agregação de serviços dos EUA | [INFERIDO] relevância baixa no Brasil |
| TV Guide | [CONHECIMENTO] EUA | [CONHECIMENTO] guia de TV, streaming e entretenimento | [CONHECIMENTO] anúncios, afiliados e patrocínios | [CONHECIMENTO] terceiros/editorial | [CONHECIMENTO] sim | [CONHECIMENTO] sim | [CONHECIMENTO] limitado | [CONHECIMENTO] grade e televisão norte-americana | [INFERIDO] não resolve catálogo brasileiro |
| Collider | [CONHECIMENTO] EUA | [VERIFICADO] publicação editorial | [CONHECIMENTO] anúncios, patrocínio e afiliados | [CONHECIMENTO] crítica assinada, não score de base | [CONHECIMENTO] ocasional | [VERIFICADO] sim, reviews, recaps e listas | [CONHECIMENTO] comentários, quando habilitados | [VERIFICADO] volume editorial de fandom | [INFERIDO] não é uma base confiável entity-first |
| Screen Rant | [CONHECIMENTO] EUA/global | [CONHECIMENTO] publicação pop e SEO editorial | [CONHECIMENTO] publicidade, afiliados e conteúdo comercial | [CONHECIMENTO] crítica editorial | [CONHECIMENTO] ocasional | [CONHECIMENTO] muito forte | [CONHECIMENTO] comentários limitados | [CONHECIMENTO] velocidade e cobertura de franquias | [INFERIDO] pouco rigor de ficha como produto principal |
| Vulture | [CONHECIMENTO] EUA | [CONHECIMENTO] vertical cultural da New York Magazine | [CONHECIMENTO] anúncios, assinaturas e patrocínio | [CONHECIMENTO] crítica assinada | [CONHECIMENTO] ocasional | [CONHECIMENTO] muito forte | [CONHECIMENTO] baixo | [CONHECIMENTO] crítica cultural autoral | [INFERIDO] pouca cobertura de catálogo/serviços |
| TheWrap | [VERIFICADO] EUA | [VERIFICADO] trade publication de entretenimento | [VERIFICADO] anúncios e assinatura TheWrap Pro | [CONHECIMENTO] crítica assinada, sem score de catálogo | [CONHECIMENTO] ocasional | [VERIFICADO] muito forte em negócio, awards e reviews | [CONHECIMENTO] baixa | [VERIFICADO] jornalismo de indústria | [INFERIDO] não atende intenção “onde assistir” |
| AdoroCinema | [VERIFICADO] Brasil | [VERIFICADO] guia de filmes/séries, sessões e editorial | [INFERIDO] anúncios, campanhas de estúdios e links comerciais | [VERIFICADO] AdoroCinema, Imprensa e Usuários | [VERIFICADO] sim | [VERIFICADO] muito forte | [VERIFICADO] notas, críticas e perfis | [VERIFICADO] amplitude de ficha em pt-BR | [INFERIDO] dependência de formato portal e publicidade |
| Omelete | [VERIFICADO] Brasil | [VERIFICADO] mídia de cultura pop com fichas | [INFERIDO] anúncios, branded content, eventos e comércio | [VERIFICADO] exibe notas atribuídas a IMDb/RT em fichas | [VERIFICADO] sim, quando há oferta | [VERIFICADO] muito forte | [CONHECIMENTO] comunidade não é o centro da ficha | [VERIFICADO] marca, notícias e franquias | [INFERIDO] cobertura de longa cauda é irregular |
| Filmow | [VERIFICADO] Brasil | [VERIFICADO] rede social e catálogo | [INFERIDO] anúncios e remoção de anúncios; demais receitas não determinadas | [VERIFICADO] Média Filmow | [VERIFICADO] sim, com JustWatch | [VERIFICADO] notícias próprias | [VERIFICADO] listas, avaliações, comentários e marcações | [VERIFICADO] comunidade brasileira cinéfila | [INFERIDO] SEO editorial menos dominante que AdoroCinema |
| Cinema10 | [CONHECIMENTO] Brasil | [CONHECIMENTO] catálogo/guia de filmes | [INFERIDO] publicidade e afiliados; não determinado | [CONHECIMENTO] não determinado | [CONHECIMENTO] sim, em parte das páginas | [CONHECIMENTO] limitado | [CONHECIMENTO] limitado | [CONHECIMENTO] fichas simples e intenção transacional | [INFERIDO] baixa diferenciação editorial |
| Papo de Cinema | [VERIFICADO] Brasil | [VERIFICADO] crítica, catálogo e cobertura de cinema | [INFERIDO] anúncios, patrocínios e projetos editoriais; não determinado | [VERIFICADO] nota da crítica e média da grade; voto de leitores em algumas obras | [VERIFICADO] sim, atribuído a JustWatch | [VERIFICADO] muito forte | [VERIFICADO] voto de leitores; comunidade limitada | [VERIFICADO] crítica brasileira identificada | [INFERIDO] não é buscador de catálogo em escala |
| CinePOP | [VERIFICADO] Brasil | [VERIFICADO] portal de notícias, críticas e estreias | [INFERIDO] publicidade, campanhas e conteúdo patrocinado | [CONHECIMENTO] críticas próprias; score de catálogo não determinado | [CONHECIMENTO] não é núcleo do produto | [VERIFICADO] muito forte | [CONHECIMENTO] baixa | [VERIFICADO] notícias velozes e gênero/fandom | [INFERIDO] ficha factual não é proposta central |
| Observatório do Cinema | [CONHECIMENTO] Brasil | [CONHECIMENTO] portal de notícias e recomendações | [INFERIDO] publicidade e conteúdo comercial; não determinado | [CONHECIMENTO] não determinado | [CONHECIMENTO] frequente em matérias, não necessariamente em fichas | [CONHECIMENTO] forte | [CONHECIMENTO] baixa | [CONHECIMENTO] pautas de streaming e celebridades | [INFERIDO] menor autoridade como base de dados |
| Legião dos Heróis | [CONHECIMENTO] Brasil | [CONHECIMENTO] mídia de fandom e cultura pop | [INFERIDO] anúncios, campanhas e conteúdo comercial; não determinado | [CONHECIMENTO] não possui score de catálogo central | [CONHECIMENTO] em matérias | [CONHECIMENTO] forte | [CONHECIMENTO] social externo, não base de usuários | [CONHECIMENTO] comunidades de franquias | [INFERIDO] cobertura pouco entity-first |
| TMDB | [CONHECIMENTO] global | [CONHECIMENTO] base colaborativa e API | [CONHECIMENTO] API, patrocínio/doações e publicidade; não determinado em detalhe | [CONHECIMENTO] média comunitária | [CONHECIMENTO] disponibilidade em mercados suportados | [CONHECIMENTO] baixo | [CONHECIMENTO] listas, avaliações e discussões | [CONHECIMENTO] infraestrutura e dados globais | [INFERIDO] não possui camada editorial brasileira madura |
| Trakt | [CONHECIMENTO] global | [VERIFICADO] tracking de filmes, séries e episódios | [CONHECIMENTO] assinaturas VIP e API/ecossistema | [VERIFICADO] ratings de usuários | [VERIFICADO] filtros por onde assistir | [CONHECIMENTO] baixo | [VERIFICADO] histórico, listas, comentários e progresso | [VERIFICADO] tracking episódico e histórico | [INFERIDO] descoberta editorial localizada fraca |
| Simkl | [VERIFICADO] global | [VERIFICADO] tracking de TV, anime e filmes | [VERIFICADO] planos Pro/VIP | [CONHECIMENTO] ratings comunitários | [CONHECIMENTO] limitado | [CONHECIMENTO] baixo | [VERIFICADO] listas, histórico e recomendações | [VERIFICADO] automação e TV/anime | [INFERIDO] baixa marca no Brasil |
| Plex Discover | [VERIFICADO] EUA/global | [VERIFICADO] agregador de descoberta dentro de plataforma de streaming | [VERIFICADO] publicidade em AVOD e assinatura Plex Pass | [VERIFICADO] usuário pode avaliar e comentar | [VERIFICADO] sim | [CONHECIMENTO] editorial reduzido | [VERIFICADO] amigos, watchlist e comentários | [VERIFICADO] convergência de catálogo, AVOD e biblioteca pessoal | [INFERIDO] pouca indexação SEO por obra |
| MUBI | [CONHECIMENTO] global | [CONHECIMENTO] streaming curado e publicação | [CONHECIMENTO] assinatura, aluguel e distribuição | [CONHECIMENTO] editorial, não agregador de notas | [CONHECIMENTO] apenas catálogo MUBI/serviços próprios | [CONHECIMENTO] muito forte | [CONHECIMENTO] watchlist e comunidade limitada | [CONHECIMENTO] curadoria e marca cinéfila | [INFERIDO] não é base universal |

---

# Capítulos por concorrente

## 1. IMDb

1. [CONHECIMENTO] O IMDb é a base global mais abrangente de títulos, profissionais, créditos, empresas, prêmios e títulos audiovisuais. Monetiza com publicidade, integração ao ecossistema Amazon, IMDbPro pago, licenciamento e produtos B2B. [VERIFICADO] O próprio `robots.txt` identifica IMDb.com como empresa da Amazon e aponta para licenciamento.  
2. [CONHECIMENTO] A ficha de filme costuma priorizar: hero com pôster/título/ano/classificação/duração; nota IMDb e popularidade; trailer; sinopse; créditos principais; opções de assistir; elenco; fotos/vídeos; detalhes técnicos; reviews, recomendações e listas. [INFERIDO] Acima da dobra, a prioridade é identidade, nota, ação de watchlist e trailer.  
3. [CONHECIMENTO] IMDb oferece ao Cinerie uma referência de profundidade: créditos extensos, empresas, versões, certificados, box office, technical specs, trivia, goofs, keywords, parental guide e títulos alternativos. [CONHECIMENTO] Pelo briefing, o Cinerie pretende mostrar uma camada editorial verificável em pt-BR e um painel explícito de fontes de notas, potencialmente mais claro que o IMDb em atribuição entre fontes.  
4. [VERIFICADO] A nota IMDb é uma nota própria de usuários calculada por média ponderada, não média aritmética simples; a fórmula exata não é divulgada para prevenir manipulação. [VERIFICADO] IMDb também informa votos, média bruta e mediana no detalhamento de votos. [CONHECIMENTO] Não é agregador de crítica no modelo RT/Metacritic.  
5. [CONHECIMENTO] Possui “Where to Watch” por país, com links para provedores, locação, compra e, em mercados selecionados, canais Amazon. [INFERIDO] Há potencial de monetização por encaminhamento e pela integração comercial do ecossistema Amazon, mas contratos e comissões por título não são públicos.  
6. [VERIFICADO] Rota observada: `https://www.imdb.com/title/tt15398776/`; créditos: `/title/{id}/fullcredits/`; pessoas: `/name/nm.../`. [VERIFICADO] O `robots.txt` libera bots selecionados e bloqueia o restante, mas sitemap não foi localizado nesta auditoria. [INFERIDO] IMDb normalmente implementa dados estruturados para entidades, porém o schema efetivamente emitido não foi auditado aqui.  
7. [CONHECIMENTO] Há conteúdo próprio: IMDb Originals, vídeos, entrevistas, listas, notícias e editorial de awards.  
8. [CONHECIMENTO] Permite nota de usuário, review, watchlist, listas e contribuição de dados; a camada social é funcional, mas menos central que a do Letterboxd.  
9. [CONHECIMENTO] Monetiza com anúncios, IMDbPro, licenciamento, publicidade de estúdios e integrações comerciais.  
10. [INFERIDO] Faz melhor que o Cinerie: (a) cobertura global e histórico de créditos; (b) reconhecimento de marca e confiança; (c) riqueza de metadados técnicos. [INFERIDO] O Cinerie pode fazer melhor: (a) explicitar claramente a origem de cada nota; (b) construir editorial pt-BR por entidade, não apenas uma camada de notícias; (c) normalizar disponibilidade e contexto local brasileiro.

## 2. Rotten Tomatoes

1. [VERIFICADO] Rotten Tomatoes é agregador de críticas profissionais e de reações de público, com camada editorial de recomendações. [CONHECIMENTO] A receita provavelmente combina publicidade, parcerias de distribuição, campanhas de estúdios e ativos do ecossistema Fandango; a divisão não é pública.  
2. [CONHECIMENTO] A ficha tende a ordenar: título/arte/dados básicos; Tomatometer e Popcornmeter; consenso crítico; trailer; sinopse; onde assistir; elenco; críticas de críticos; reviews de público; fotos, notícias e títulos similares. [INFERIDO] Acima da dobra, os dois scores e o CTA de assistir dominam.  
3. [VERIFICADO] Mostra ao Cinerie o consenso crítico, percentual Fresh/Rotten, média, contagem e críticas atribuídas por veículo/crítico; também diferencia audiência verificada da não verificada. [CONHECIMENTO] Pelo briefing, o Cinerie pode superar na visualização lado a lado de múltiplas fontes, em pt-BR, com fonte e data de coleta por nota.  
4. [VERIFICADO] O Tomatometer é percentual de críticas profissionais positivas de críticos aprovados; 60% ou mais é Fresh. [VERIFICADO] O Popcornmeter é percentual de avaliações de audiência positivas; onde há compra confirmada, o site destaca avaliações verificadas. [VERIFICADO] O site mantém atribuição por crítico, veículo e link/trecho de crítica.  
5. [CONHECIMENTO] Tem links de “where to watch”, especialmente úteis no mercado norte-americano. [INFERIDO] A ligação com Fandango sugere monetização transacional, mas a origem dos feeds e contratos por serviço não foram determinados.  
6. [VERIFICADO] Rota observada: `/m/{slug}` para filmes e `/tv/{slug}` para séries. [VERIFICADO] O `robots.txt` declara sitemap em `https://www.rottentomatoes.com/sitemaps/sitemap.xml`. [INFERIDO] Emite dados estruturados de obras e reviews em muitas páginas, mas não foi feita auditoria de JSON-LD nesta análise.  
7. [VERIFICADO] Possui editorial próprio: guias “what to watch”, listas, trailers, vídeos, cobertura de awards e matérias.  
8. [VERIFICADO] Usuários podem avaliar e resenhar; a plataforma separa crítica profissional do público.  
9. [CONHECIMENTO] Publicidade, patrocínios, campanhas de estúdios e comércio/ingressos são as hipóteses de receita mais plausíveis; valores não determinados.  
10. [INFERIDO] Faz melhor: (a) linguagem de consenso crítico imediatamente compreensível; (b) marca de score altamente reconhecida; (c) governança formal de críticos. [INFERIDO] Cinerie pode fazer melhor: (a) não reduzir crítica a binário “positiva/negativa”; (b) cobrir fontes brasileiras e lusófonas com rastreabilidade; (c) integrar disponibilidade real no Brasil.

## 3. Metacritic

1. [VERIFICADO] Metacritic agrega crítica de filmes, TV, música e games em uma pontuação única chamada Metascore. [CONHECIMENTO] Sua receita é principalmente publicidade e patrocínio; não determinada em detalhe.  
2. [CONHECIMENTO] Uma ficha de filme tende a apresentar: título/arte e lançamento; Metascore e classificação qualitativa; User Score; sinopse; críticas de veículos; trailer; elenco; onde assistir; notícias e mais títulos. [INFERIDO] Acima da dobra, Metascore e a leitura “universal acclaim/mixed/unfavorable” são o principal bloco.  
3. [VERIFICADO] Oferece média ponderada de críticos selecionados, texto/score de cada crítica e User Score. [CONHECIMENTO] O Cinerie poderia oferecer transparência mais forte: não converter silenciosamente escalas diferentes e explicar quando uma fonte não possui score.  
4. [VERIFICADO] Metascore é uma média ponderada de críticos curados e respeitados. [VERIFICADO] O produto também permite ratings e reviews da comunidade.  
5. [VERIFICADO] A página institucional informa descoberta por serviços de streaming. [CONHECIMENTO] A origem de disponibilidade e eventual receita afiliada não foram determinadas.  
6. [VERIFICADO] Rota observada em listagem: `/browse/movie/.../metascore/`; formato detalhado de filme e schema não foram determinados por inspeção. [CONHECIMENTO] Sitemap não determinado.  
7. [VERIFICADO] Possui listas, calendários de lançamento e notícias/rankings editoriais.  
8. [VERIFICADO] Possui comunidade de ratings e reviews.  
9. [CONHECIMENTO] Publicidade e patrocínio são prováveis; assinatura ou comissão de parceiro não determinada.  
10. [INFERIDO] Faz melhor: (a) normalização editorial de escalas; (b) posição clara de crítica profissional; (c) cobertura transversal de games/música. [INFERIDO] Cinerie pode fazer melhor: (a) explicar a proveniência de todos os dados; (b) ter melhor UX de pessoas, temporadas e episódios; (c) entregar páginas em pt-BR nativas.

## 4. Letterboxd

1. [VERIFICADO] Letterboxd é uma rede social de filmes centrada no diário de consumo, rating, review, listas e descoberta. [VERIFICADO] A própria página informa que depende de membros e oferece Pro, recursos premium e remoção de anúncios.  
2. [CONHECIMENTO] Em uma ficha, a ordem típica é: pôster/título/ano; ações “watched”, “like”, lista e rating; nota média e popularidade; tagline/sinopse; amigos que viram; reviews; listas que incluem o filme; elenco/equipe; estatísticas e disponibilidade. [INFERIDO] Acima da dobra, a interação social e as ações pessoais superam a ficha técnica.  
3. [VERIFICADO] O Letterboxd recebe de TMDB boa parte dos metadados de filmes: nomes, sinopses, datas, trailers, arte e elenco/equipe. [VERIFICADO] Exibe listas, diário, log, popularidade social e texto de reviews como dados que o Cinerie não tem no briefing. [CONHECIMENTO] Cinerie pretende diferenciar-se com séries, temporadas, episódios, fontes de rating e editorial verificado em pt-BR.  
4. [VERIFICADO] A nota é média de membros, em escala de estrelas, e não crítica agregada. [VERIFICADO] A plataforma publica listas oficiais baseadas na média de membros, com regras de elegibilidade.  
5. [VERIFICADO] A disponibilidade é “Powered by JustWatch”; membros Pro podem definir serviços favoritos e filtrar por eles. [INFERIDO] O vínculo pode envolver parceria de dados, mas a receita por clique não foi determinada.  
6. [VERIFICADO] Rota observada: `/film/{slug}/`; listas: `/list/{slug}/`; páginas de pessoas, membros e reviews têm rotas próprias. [CONHECIMENTO] Schema e sitemap não foram auditados.  
7. [VERIFICADO] Há camada editorial própria por meio de Journal, HQs, listas oficiais, destaques de equipe e histórias de parceiros.  
8. [VERIFICADO] É seu maior ativo: notas, reviews, likes, follows, diário, watchlist, listas e atividade.  
9. [VERIFICADO] Assinaturas Pro/Patron e anúncios são explicitamente parte do modelo.  
10. [INFERIDO] Faz melhor: (a) hábito recorrente e identidade de usuário; (b) rede social nativa; (c) descoberta por listas humanas. [INFERIDO] Cinerie pode fazer melhor: (a) tratar séries/episódios como entidades de primeira classe; (b) fornecer disponibilidade brasileira confiável; (c) separar fato, crítica própria e score de fonte externa.

## 5. JustWatch

1. [VERIFICADO] JustWatch é motor de busca de streaming e fornecedor B2B de API, widgets e inteligência de disponibilidade. [VERIFICADO] A página comercial declara oportunidades de e-commerce/comissão, API unificada, widgets e dados de disponibilidade em mais de 120 países.  
2. [CONHECIMENTO] A ficha prioriza: título/poster, disponibilidade atual por serviço e modalidade; CTA para assistir; preço; sinopse; trailer; elenco; títulos similares; ranking diário. [INFERIDO] Acima da dobra, “onde assistir” e preço são o produto.  
3. [VERIFICADO] Possui cobertura de serviços, preço, modelo de acesso, país e ranking de streaming, dados ausentes do briefing detalhado do Cinerie. [CONHECIMENTO] Cinerie pode oferecer mais explicação editorial, fontes de notas e relações entre pessoas/franquias.  
4. [CONHECIMENTO] Exibe notas de fontes terceiras em vários mercados, mas não é principalmente uma autoridade de rating própria. [INFERIDO] Não deve chamar uma nota exibida de “JustWatch Score” sem definição pública específica.  
5. [VERIFICADO] Sim; dados vêm de dezenas de fontes, líderes de OTT e streaming, segundo a página da própria JustWatch. [VERIFICADO] O site declara oportunidades de comissão e e-commerce.  
6. [VERIFICADO] Rota brasileira observada: `/br/filme/{slug}`. [VERIFICADO] O `robots.txt` não bloqueia rastreamento geral. [CONHECIMENTO] Schema e sitemap não foram auditados.  
7. [CONHECIMENTO] Há páginas de guia e descoberta, mas a camada editorial não é o seu principal diferencial.  
8. [CONHECIMENTO] Watchlist, preferências de provedores e alertas existem; comunidade aberta de crítica não é central.  
9. [VERIFICADO] Dados B2B, API, widgets e comissões são produtos declarados.  
10. [INFERIDO] Faz melhor: (a) atualização operacional de disponibilidade; (b) cobertura por país; (c) monetização afiliada madura. [INFERIDO] Cinerie pode fazer melhor: (a) página entity-first que responda também “o que é/por que importa”; (b) crítica/editorial revisado; (c) melhores relações semânticas entre obras e pessoas.

## 6. AdoroCinema

1. [VERIFICADO] AdoroCinema é um portal brasileiro que combina catálogo de filmes e séries, sessões, streaming, notícias, trailers, críticas e comunidade. [INFERIDO] A receita parece vir de anúncios, campanhas promocionais de estúdios, exibição de sessões e possíveis links comerciais; termos financeiros não determinados.  
2. [VERIFICADO] Em uma ficha observada, a sequência é: título, pôster, data/local de lançamento, duração, gêneros, direção/roteiro/elenco, título original; notas de Imprensa, Usuários, AdoroCinema e Amigos; sinopse; “Assista ao filme”; crítica própria; trailers; elenco; ficha completa; críticas de usuários. [VERIFICADO] Esses elementos iniciais estão acima da dobra textual da ficha de [Adoráveis Mulheres](https://www.adorocinema.com/filmes/filme-224808/).  
3. [VERIFICADO] Mostra classificação indicativa, distribuidora, sessões de cinema, críticas de imprensa, notas de usuários, trailers, fotos e editoriais associados. [CONHECIMENTO] Pelo briefing, o Cinerie pode superar ao apresentar, em vez de notas genéricas, o nome exato da fonte, método, timestamp e vínculo da evidência editorial à entidade.  
4. [VERIFICADO] Há quatro categorias claramente rotuladas: “Imprensa”, “Usuários”, “AdoroCinema” e “Meus amigos”. [VERIFICADO] A página de rankings também separa “melhores segundo o AdoroCinema” de “mais votados por membros”.  
5. [VERIFICADO] Há bloco “Assista ao filme”, com SVOD, VOD, serviço, preço e CTA para assistir. [INFERIDO] Os CTAs podem ser comerciais/afiliados, mas a remuneração não foi determinada.  
6. [VERIFICADO] Rotas observadas: `/filmes/filme-{id}/`, `/filmes-todos/`, `/filmes/melhores/`. [VERIFICADO] O `robots.txt` bloqueia `/pesquisar/` e diversas rotas técnicas; não foi encontrado sitemap no arquivo acessado. [CONHECIMENTO] Schema não foi auditado.  
7. [VERIFICADO] A camada própria é substancial: críticas da redação, notícias, especiais, rankings, trailers e vídeo.  
8. [VERIFICADO] Possui notas, críticas de usuários, seguidores e sinal de “meus amigos”.  
9. [INFERIDO] Publicidade, campanhas de lançamento, vídeo e links de oferta são as hipóteses mais sólidas; receita exata não determinada.  
10. [INFERIDO] Faz melhor: (a) amplitude de conteúdo pt-BR e força de marca; (b) cobertura de sessões; (c) comunidade e crítica em uma mesma ficha. [INFERIDO] Cinerie pode fazer melhor: (a) arquitetura consistente por entidade e idioma; (b) atribuição de dados/ratings sem ambiguidade; (c) camada editorial factual e auditável em vez de apenas conteúdo associado.

## 7. Omelete

1. [VERIFICADO] Omelete é uma marca brasileira de cultura pop com notícias, reviews, cobertura de entretenimento e fichas de filmes. [INFERIDO] Monetiza com publicidade, conteúdo patrocinado, projetos comerciais, eventos e ecossistema de mídia; a composição não foi determinada.  
2. [VERIFICADO] Em fichas observadas, a ordem é: pôster/título; classificação e gêneros; direção e data; notas externas quando disponíveis; sinopse; “onde assistir”; elenco principal; informações adicionais como título original, idioma, orçamento, receita e estúdios; trailer. [INFERIDO] Acima da dobra, identidade, dados básicos, nota externa e sinopse são dominantes.  
3. [VERIFICADO] Em uma ficha, expõe orçamento, receita, estúdio, classificação etária e fontes como IMDb e Rotten Tomatoes. [CONHECIMENTO] Pelo briefing, Cinerie pode mostrar melhor a diferença entre “dado informado”, “não informado”, “zero” e “não aplicável”; por exemplo, orçamento `0` não deveria ser tratado como valor factual sem fonte.  
4. [VERIFICADO] A página de *McWalter* exibe IMDb 4.9/10; a de *A Colheita* exibe Rotten Tomatoes 74% e IMDb 6.0/10. [VERIFICADO] A atribuição pelo nome e logotipo da fonte é visível.  
5. [VERIFICADO] Há seção “Onde assistir”, embora a origem do feed e se há comissão não tenham sido determinados.  
6. [VERIFICADO] Rota observada: `/filmes/ficha/{slug}`. [CONHECIMENTO] Schema e sitemap não foram auditados.  
7. [VERIFICADO] Editorial é muito forte: notícias, trailers, entrevistas, críticas e cobertura de franquias.  
8. [CONHECIMENTO] A comunidade não é o centro do produto de ficha; não foi verificada uma camada equivalente a Filmow/Letterboxd.  
9. [INFERIDO] Anúncios, branded content, eventos e parcerias de indústria são fontes prováveis; receita não determinada.  
10. [INFERIDO] Faz melhor: (a) alcance cultural e de franquias; (b) velocidade editorial; (c) cobertura comercial de entretenimento. [INFERIDO] Cinerie pode fazer melhor: (a) disponibilidade brasileira estruturada; (b) histórico e versões de entidades; (c) editorial menos dependente de pauta de hype.

## 8. Filmow

1. [VERIFICADO] Filmow se define como plataforma de filmes e é uma rede social brasileira de títulos, listas, marcações, avaliações, comentários e streaming. [INFERIDO] Exibe publicidade e opção de remoção de anúncios; outras fontes de receita não foram determinadas.  
2. [VERIFICADO] Em página de título observada, a ordem é: pôster/título; “Média Filmow” e número de avaliações; ações “já vi”, “quero ver” e lista; bloco “onde assistir”; sinopse; elenco; crédito de cadastro. [INFERIDO] Acima da dobra, rating comunitário e ações sociais são prioritários.  
3. [VERIFICADO] Tem contagem de avaliações, comentários, marcações pessoais, listas e compatibilidade cinéfila. [CONHECIMENTO] Pelo briefing, Cinerie pretende ter mais fortemente pessoas, temporadas, episódios, fontes externas atribuídas e uma camada de revisão editorial verificável.  
4. [VERIFICADO] É nota própria comunitária, denominada “Média Filmow”, acompanhada por volume de avaliações.  
5. [VERIFICADO] A ficha de *A Avaliação* diz explicitamente “Onde assistir” e identifica “JustWatch” como fonte. [INFERIDO] Como o clique pode levar a parceiro, a monetização afiliada é possível, mas não determinada.  
6. [VERIFICADO] Rotas observadas: `/[slug]-t{id}/`; disponibilidade: `/[slug]-t{id}/assista-agora/`; listas: `/listas/{slug}-l{id}/`. [CONHECIMENTO] Schema e sitemap não foram auditados.  
7. [VERIFICADO] Possui notícias próprias na home, embora o editorial seja menor que o dos grandes portais.  
8. [VERIFICADO] É uma força central: listas, notas, comentários, “já vi”, “quero ver”, favoritos e perfis.  
9. [VERIFICADO] A home exibe publicidade e a navegação cita “Remover Anúncios”. [CONHECIMENTO] O preço e a natureza desse produto não foram determinados.  
10. [INFERIDO] Faz melhor: (a) comunidade brasileira de catálogo; (b) retenção por watchlist; (c) sinais sociais de intenção. [INFERIDO] Cinerie pode fazer melhor: (a) dados normalizados de indústria e fontes; (b) SEO editorial de entidades; (c) disponibilidade mais transparente, com data/fonte.

## 9. Papo de Cinema

1. [VERIFICADO] Papo de Cinema é publicação brasileira de crítica, cobertura de cinema, catálogo e festivais. [INFERIDO] Sua receita parece depender de publicidade, projetos editoriais e patrocínio; não determinada.  
2. [VERIFICADO] Em uma ficha observada: título; classificação etária, duração, direção, título original, gênero, ano e país; “onde assistir”; sinopse; crítica; autor; grade crítica; detalhes, fotos, vídeos e curiosidades. [INFERIDO] Acima da dobra, identificação e a nota crítica são o núcleo.  
3. [VERIFICADO] Mostra crítica assinada, biografia/credenciais do crítico e uma grade de várias notas individuais, algo ausente do briefing do Cinerie. [CONHECIMENTO] Cinerie pode diferenciar-se com escala global de fontes externas, status de revisão e páginas de pessoas/obras em grande escala.  
4. [VERIFICADO] Há nota de crítico e média de grade. [VERIFICADO] Em alguns títulos também existe “Leitores”, com contagem de votos e média separada.  
5. [VERIFICADO] Exibe “Onde Assistir — Fonte: JustWatch”. [INFERIDO] Não foi determinada comissão por clique.  
6. [VERIFICADO] Rota observada: `/filmes/{slug}/`. [CONHECIMENTO] Schema e sitemap não foram auditados.  
7. [VERIFICADO] O editorial é o produto: críticas, podcasts, colunas, cobertura de festivais e grade de críticos.  
8. [VERIFICADO] Há voto de leitores em parte do catálogo; listas/comentários sociais em escala não foram confirmados.  
9. [INFERIDO] Publicidade, projetos especiais e patrocínio são prováveis; não determinado.  
10. [INFERIDO] Faz melhor: (a) crítica brasileira identificável; (b) grade de múltiplos críticos; (c) repertório de cinema de festival/nacional. [INFERIDO] Cinerie pode fazer melhor: (a) escala e atualização de dados; (b) navegação entity-first; (c) operação SEO de páginas de pessoas, temporadas, episódios e disponibilidade.

## 10. TMDB

1. [CONHECIMENTO] The Movie Database é uma base comunitária global de filmes, TV e pessoas, largamente usada como fonte/API por terceiros.  
2. [CONHECIMENTO] A ficha normalmente prioriza hero, rating comunitário, sinopse, participantes, mídia, recomendações, reviews e detalhes; a ordem visual pode variar por idioma.  
3. [VERIFICADO] Letterboxd declara que usa TMDB para nomes de elenco/equipe, sinopses, datas, trailers e pôsteres. [CONHECIMENTO] O TMDB é concorrente indireto e fornecedor potencial, não substituto da camada editorial proposta pelo Cinerie.  
4. [CONHECIMENTO] Possui rating comunitário próprio, separado de agregadores críticos.  
5. [CONHECIMENTO] Pode conter ofertas de streaming em mercados suportados; origem e monetização não determinadas nesta auditoria.  
6. [CONHECIMENTO] Rotas comuns são `/movie/{id}-{slug}`, `/tv/{id}-{slug}` e `/person/{id}-{slug}`. [CONHECIMENTO] Schema e sitemap não auditados.  
7. [CONHECIMENTO] Editorial próprio é limitado; seu valor é a base e a contribuição comunitária.  
8. [CONHECIMENTO] Tem listas, ratings, reviews, comentários/discussões e contribuições.  
9. [CONHECIMENTO] Modelo exato de receita não determinado; API e parceria são partes centrais de sua posição de mercado.  
10. [INFERIDO] Faz melhor: (a) ecossistema de dados e contribuição; (b) cobertura internacional; (c) relações de entidades. [INFERIDO] Cinerie pode fazer melhor: (a) editorial brasileiro verificável; (b) SEO local; (c) atribuição de fontes de rating e disponibilidade como produto editorial.

## 11. Trakt

1. [VERIFICADO] Trakt é plataforma de tracking de filmes, séries, temporadas e episódios, com APIs e plano VIP.  
2. [CONHECIMENTO] A ficha enfatiza ação de assistir, progressão, histórico, nota, listas, comentários, temporadas/episódios e disponibilidade.  
3. [VERIFICADO] Oferece histórico individual, progresso episódico, calendário, filtros de disponibilidade e estatísticas, dados não presentes explicitamente no briefing do Cinerie.  
4. [VERIFICADO] A API documenta retorno de ratings por usuário e valor individual da nota. [CONHECIMENTO] É nota comunitária, não agregador de críticos.  
5. [VERIFICADO] Os filtros avançados incluem “where you can watch online”. [CONHECIMENTO] Fonte e modelo afiliado não determinados.  
6. [CONHECIMENTO] Rotas públicas normalmente seguem `/movies/{slug}` e `/shows/{slug}`; schema e sitemap não auditados.  
7. [CONHECIMENTO] Editorial não é uma proposta central.  
8. [VERIFICADO] Histórico, ratings, listas, comentários, calendário e social são recursos relevantes.  
9. [CONHECIMENTO] Assinaturas VIP e API são receitas prováveis; valores não determinados.  
10. [INFERIDO] Faz melhor: (a) tracking de episódios; (b) calendário pessoal; (c) integração com apps. [INFERIDO] Cinerie pode fazer melhor: (a) páginas públicas SEO em pt-BR; (b) camada editorial; (c) conteúdo explicativo por entidade.

## 12. Plex Discover

1. [VERIFICADO] Plex Discover agrega a descoberta de conteúdo de serviços externos, biblioteca pessoal e o próprio catálogo gratuito do Plex. [VERIFICADO] O Plex declara fornecer filmes e shows gratuitos com publicidade e vender Plex Pass.  
2. [CONHECIMENTO] A página de entidade tende a priorizar onde tocar o conteúdo, fontes disponíveis, watchlist, classificação e opções de reprodução.  
3. [VERIFICADO] Pode incluir biblioteca pessoal do usuário, servidores Plex, serviços externos e seu AVOD próprio; esse é um conjunto de dados que uma base editorial pública normalmente não tem.  
4. [VERIFICADO] O Plex permite rating e comentários; não foi verificado um score crítico agregado como peça central.  
5. [VERIFICADO] A central de suporte informa que mostra disponibilidade por localização em servidores pessoais, streaming Plex, aluguel/compra e serviços externos.  
6. [CONHECIMENTO] Schema, rotas estáveis por entidade e sitemap não foram auditados.  
7. [CONHECIMENTO] Editorial não é o diferencial principal.  
8. [VERIFICADO] Tem watchlist, amigos, perfil, ratings e comentários.  
9. [VERIFICADO] AVOD com anúncios e Plex Pass são receitas públicas.  
10. [INFERIDO] Faz melhor: (a) ligação com playback e biblioteca pessoal; (b) unificação de fontes; (c) distribuição multiplataforma. [INFERIDO] Cinerie pode fazer melhor: (a) busca pública indexável; (b) contexto editorial; (c) experiência brasileira de catálogo e crítica.

## Concorrentes secundários

### Reelgood

[CONHECIMENTO] Reelgood é um guia de streaming norte-americano que concorre com JustWatch em busca, watchlist e links para provedores. [CONHECIMENTO] Monetiza provavelmente com afiliados, anúncios e parcerias de distribuição; não determinado. [CONHECIMENTO] A ficha tende a priorizar título, provedores, preço, CTA, sinopse, trailer e elenco; acima da dobra, a disponibilidade. [CONHECIMENTO] Mostra disponibilidade por serviço, útil ao Cinerie, mas não possui vantagem conhecida em editorial pt-BR. [CONHECIMENTO] Notas são majoritariamente de terceiros. [CONHECIMENTO] A origem do dado de streaming, schema e sitemap não foram auditados. [CONHECIMENTO] Editorial e comunidade existem de forma limitada, com watchlist mais importante que comentários. [INFERIDO] Faz melhor que o Cinerie em UX de encaminhamento para streaming nos EUA; Cinerie pode fazer melhor em dados locais, páginas de pessoas e editorial verificável.

### TV Guide

[CONHECIMENTO] TV Guide é guia americano de programação, canais, séries, filmes e streaming. [CONHECIMENTO] Receita provável: anúncios, afiliados, patrocínio e licenciamento; não determinada. [CONHECIMENTO] Em fichas, programação e disponibilidade costumam competir com sinopse, elenco e notícias; a estrutura visual não foi auditada. [CONHECIMENTO] Usa informações/ratings editoriais ou terceiras, não uma nota comunitária de referência global. [CONHECIMENTO] Oferece onde assistir e possivelmente links comerciais, sem feed ou comissão verificados. [CONHECIMENTO] Rotas, schema e sitemaps não determinados. [CONHECIMENTO] Possui forte editorial de TV e comunidade limitada. [INFERIDO] Faz melhor em grade televisiva EUA; Cinerie pode fazer melhor em catálogo global em pt-BR, fontes de nota e disponibilidades brasileiras.

### Collider

[VERIFICADO] Collider publica reviews, recaps, notícias, entrevistas e listas; seu arquivo de reviews confirma cobertura contínua. [CONHECIMENTO] Receita provável: publicidade, afiliados e patrocínio; não determinada. [CONHECIMENTO] Não mantém ficha entity-first consistente como produto principal; páginas de artigo priorizam manchete, imagem, texto, autor e links relacionados. [CONHECIMENTO] A “nota” é crítica assinada, não agregador próprio. [CONHECIMENTO] Onde assistir aparece em conteúdo editorial, não como infraestrutura central. [CONHECIMENTO] Rotas de artigos, schema e sitemap não auditados. [VERIFICADO] Editorial é o núcleo; comunidade é periférica. [INFERIDO] Faz melhor que Cinerie em velocidade, profundidade de fandom e formatos de artigo; Cinerie pode fazer melhor ao responder intenções utilitárias por entidade.

### Screen Rant

[CONHECIMENTO] Screen Rant é grande publisher de cultura pop, entretenimento, guias e franquias. [CONHECIMENTO] Publicidade, afiliados e conteúdos comerciais são receitas prováveis; não determinadas. [CONHECIMENTO] Trabalha majoritariamente com artigos, não fichas canônicas de obra; acima da dobra prevalecem headline, imagem, autor e introdução. [CONHECIMENTO] Não possui score de catálogo central; avaliações são editoriais. [CONHECIMENTO] “Onde assistir” aparece em guias. [CONHECIMENTO] Estrutura técnica não auditada. [CONHECIMENTO] Editorial muito forte e comunidade interna limitada. [INFERIDO] Faz melhor em captura de demanda de cauda longa por artigos; Cinerie pode fazer melhor ao transformar essas perguntas em páginas factuais estáveis e atualizadas.

### Vulture

[CONHECIMENTO] Vulture é uma publicação cultural da New York Magazine, voltada a crítica, TV, cinema, música e cultura. [CONHECIMENTO] Monetiza por publicidade, assinaturas e patrocínio no ecossistema editorial; não determinado em detalhe. [CONHECIMENTO] Artigos priorizam crítica e voz autoral, não uma ficha de título. [CONHECIMENTO] Não mantém score agregador de catálogo como diferencial. [CONHECIMENTO] Disponibilidade aparece apenas quando editorialmente relevante. [CONHECIMENTO] URLs de artigos, schema e sitemap não auditados. [CONHECIMENTO] Editorial é muito forte; comunidade é secundária. [INFERIDO] Faz melhor em crítica cultural; Cinerie pode fazer melhor em utilidade, cobertura brasileira e links entre entidades.

### TheWrap

[VERIFICADO] TheWrap é publicação de entretenimento com seções de filmes, TV, awards, negócio, streaming e reviews, além de produto TheWrap Pro. [VERIFICADO] A home promove conteúdo Pro e a cobertura inclui negócios e crítica. [CONHECIMENTO] A receita inclui publicidade e assinatura profissional; demais detalhes não determinados. [CONHECIMENTO] Seus artigos priorizam manchete, autor, data, imagem e texto; não há ficha de filme como produto central. [CONHECIMENTO] A nota é crítica assinada, não score próprio de catálogo. [CONHECIMENTO] Onde assistir não é infraestrutura principal. [CONHECIMENTO] Schema e sitemap não auditados. [VERIFICADO] Editorial é muito forte; comunidade é pequena. [INFERIDO] Faz melhor em inteligência de indústria e awards; Cinerie pode fazer melhor em catálogo público e local.

### Cinema10

[CONHECIMENTO] Cinema10 é concorrente brasileiro de catálogo e guias de filme. [INFERIDO] Receita provável: anúncios, afiliados e mídia comercial; não determinada. [CONHECIMENTO] Fichas tipicamente buscam atender título, sinopse, elenco, trailer, lançamento e disponibilidade, mas a ordem e a dobra não foram verificadas nesta auditoria. [CONHECIMENTO] Nota, origem de streaming, schema e sitemap não determinados. [CONHECIMENTO] Editorial e comunidade parecem menos centrais que em AdoroCinema, Omelete e Filmow. [INFERIDO] Faz melhor que Cinerie se já possuir páginas indexadas antigas; Cinerie pode fazer melhor com proveniência de dados, padrão de rota por idioma e atualização editorial.

### CinePOP

[VERIFICADO] CinePOP é portal de cinema, séries e música, com críticas e páginas de lançamentos que exibem elenco, direção, gênero, duração, distribuidora e estreia. [INFERIDO] Receita provável: anúncios, campanhas de estúdios e conteúdo comercial; não determinada. [CONHECIMENTO] A página editorial prioriza título, imagem, resumo e texto, enquanto as páginas de estreia priorizam data e dados técnicos. [CONHECIMENTO] Nota agregada e comunidade estruturada não determinadas. [CONHECIMENTO] Onde assistir não é o produto principal. [CONHECIMENTO] Schema e sitemap não auditados. [VERIFICADO] Editorial é forte, especialmente para novidades e gêneros. [INFERIDO] Faz melhor em velocidade e fandom; Cinerie pode fazer melhor em uma ficha canônica pesquisável.

### Observatório do Cinema

[CONHECIMENTO] Observatório do Cinema é portal brasileiro de notícias, streaming e cultura pop. [INFERIDO] Receita provável: anúncios e conteúdo comercial; não determinada. [CONHECIMENTO] O produto é artigo editorial, não ficha de entidade; acima da dobra predominam manchete, imagem e texto. [CONHECIMENTO] Nota própria, disponibilidade estruturada, fonte de feed, comunidade, schema e sitemap não determinados. [CONHECIMENTO] Editorial é a camada relevante. [INFERIDO] Faz melhor em manchetes oportunistas de streaming; Cinerie pode fazer melhor ao responder de forma estável “onde assistir”, “elenco” e “qual a nota”.

### Legião dos Heróis

[CONHECIMENTO] Legião dos Heróis é mídia brasileira de fandom, heróis, HQs, filmes, séries, listas e cultura pop. [INFERIDO] Receita provável: anúncios, publicidade de entretenimento e conteúdo comercial; não determinada. [CONHECIMENTO] Não é uma base de filme; as páginas são artigos e listas. [CONHECIMENTO] Não há nota canônica, disponibilidade estruturada, comunidade de catálogo, schema ou sitemap confirmados. [CONHECIMENTO] O editorial de franquias é sua força. [INFERIDO] Faz melhor em linguagem de fã e temas de franquia; Cinerie pode fazer melhor em precisão factual, neutralidade e entidades de longa cauda.

### Simkl

[VERIFICADO] Simkl oferece tracking de filmes, séries e anime, importação de histórico de mais de 20 serviços, calendário, listas e planos Pro/VIP. [CONHECIMENTO] A ficha enfatiza progresso, status, listas, rating e recomendação; ordem visual não auditada. [CONHECIMENTO] A nota é comunitária, não crítica agregada. [CONHECIMENTO] Onde assistir e a origem do feed não foram determinados. [CONHECIMENTO] Rotas, schema e sitemap não auditados. [VERIFICADO] Tem comunidade e tracking fortes, especialmente TV/anime. [INFERIDO] Faz melhor que Cinerie em automação de histórico; Cinerie pode fazer melhor em SEO público brasileiro e editorial.

### MUBI

[CONHECIMENTO] MUBI é streaming e distribuidora com seleção curada, publicação editorial e comunidade cinéfila. [CONHECIMENTO] Receita central é assinatura, aluguel e distribuição; valores não determinados. [CONHECIMENTO] A ficha tende a priorizar acesso ao título, contexto curatorial, trailer e créditos; o catálogo é propositalmente limitado ao seu serviço. [CONHECIMENTO] Não é agregador universal de críticas nem guia de todos os provedores. [CONHECIMENTO] Onde assistir significa, em geral, disponibilidade no próprio MUBI. [CONHECIMENTO] Rotas, schema e sitemap não auditados. [CONHECIMENTO] Editorial é muito forte; comunidade é menor que Letterboxd. [INFERIDO] Faz melhor em curadoria de gosto; Cinerie pode fazer melhor em abrangência de catálogo e comparação entre fontes.

# O mercado brasileiro

## Quem realmente aparece para as intenções principais

[VERIFICADO] Esta não é uma medição de share de busca. É um teste direcional de resultados públicos e das capacidades observáveis dos domínios. Não há dados suficientes para afirmar “domínio X domina o Google Brasil” em termos numéricos.

| Intenção | Concorrentes com encaixe mais forte | Leitura operacional |
|---|---|---|
| “onde assistir X” | [VERIFICADO] JustWatch BR, AdoroCinema, Filmow, Papo de Cinema | [VERIFICADO] JustWatch é especializado em disponibilidade; Filmow e Papo de Cinema citam JustWatch; AdoroCinema exibe streaming/VOD e preços em fichas. |
| “elenco de X” | [VERIFICADO] AdoroCinema, Omelete, IMDb; [CONHECIMENTO] TMDB/Cinema10 | [VERIFICADO] AdoroCinema e Omelete exibem elencos em fichas; IMDb tem profundidade de créditos. |
| “X filme 2026” | [VERIFICADO] AdoroCinema, Omelete, CinePOP, Filmow, Papo de Cinema | [VERIFICADO] Todos publicam estreias, fichas ou conteúdo noticioso; [INFERIDO] AdoroCinema e Omelete têm maior capacidade de converter essa busca em ficha + notícia + trailer. |
| “nota de X” | [VERIFICADO] AdoroCinema, Filmow, Papo de Cinema; [CONHECIMENTO] IMDb/RT/Metacritic | [VERIFICADO] AdoroCinema separa redação, imprensa e usuários; Filmow possui Média Filmow; Papo possui crítica e grade. |
| “X final explicado”, “X tem cena pós-créditos?” | [CONHECIMENTO] Omelete, CinePOP, AdoroCinema, Observatório, Legião | [INFERIDO] Portais de pauta e franquias tendem a ocupar essa intenção melhor que bancos de dados. |
| “filmes parecidos com X” | [CONHECIMENTO] Letterboxd, Filmow, JustWatch, IMDb | [INFERIDO] No Brasil, ainda há espaço para recomendação explicável, em português e baseada em metadados. |

## Dinâmica competitiva real

[VERIFICADO] A maior ameaça de SEO para Cinerie não é um único site: é a composição de três classes de resultado.

1. [VERIFICADO] **Ficha local de grande portal:** AdoroCinema combina sinopse, elenco, notas, oferta, trailer, sessões, crítica e conteúdo relacionado na mesma URL. Isso cria forte cobertura para buscas de entidade.

2. [VERIFICADO] **Resolução transacional:** JustWatch tem infraestrutura de disponibilidade por país, múltiplos serviços e oportunidades explícitas de comissão/API. Para “onde assistir X”, essa especialização é difícil de vencer apenas com conteúdo.

3. [VERIFICADO] **Atualidade editorial:** Omelete, CinePOP, Papo de Cinema, AdoroCinema e outros publicam páginas sobre lançamento, crítica, elenco, trailer, explicação e streaming. A notícia ocupa consultas que ainda não têm demanda por ficha estável.

4. [VERIFICADO] **Comunidade:** Filmow preenche o espaço brasileiro de marcação pessoal e média comunitária; Letterboxd captura usuários mais cinéfilos, embora seu foco principal seja filme, não TV/episódio.

5. [INFERIDO] **Lacuna estrutural:** poucos concorrentes unem, em uma experiência pt-BR, dados de entidade profundamente ligados, notas de múltiplas fontes com atribuição inequívoca, disponibilidade localizada com timestamp e editorial factual revisado.

## Onde Cinerie não deve competir primeiro

[INFERIDO] Não é estratégico tentar superar IMDb em completude global de créditos no MVP.

[INFERIDO] Não é estratégico tentar superar JustWatch em cobertura mundial de disponibilidade sem usar parceria, feed licenciado ou integração equivalente.

[INFERIDO] Não é estratégico tentar criar uma rede social ampla antes de ter páginas de entidade úteis e confiáveis; Filmow e Letterboxd já possuem hábito, histórico e capital social.

[INFERIDO] Não é estratégico replicar o modelo de manchete diária de Omelete/CinePOP como base do SEO. Notícias têm ciclo curto, custo editorial alto e dependem de marca/distribuição.

# Espaço que ninguém ocupa plenamente no Brasil

## Tese

[INFERIDO] O espaço é uma **camada de referência audiovisual em pt-BR, orientada por entidade e por evidência**, que responda numa única URL canônica a quatro perguntas diferentes:

1. [INFERIDO] “O que é esta obra, exatamente?”
2. [INFERIDO] “Quem fez e em que outras obras aparece?”
3. [INFERIDO] “Como diferentes fontes a avaliam — sem fingir que são a mesma métrica?”
4. [INFERIDO] “Onde ela está disponível no Brasil agora, em qual modalidade e com que data de verificação?”

[INFERIDO] AdoroCinema chega perto, mas mistura diversos scores e ofertas numa experiência de portal. JustWatch resolve a quarta pergunta, mas não as três primeiras com profundidade editorial. Filmow resolve hábito e nota comunitária, mas não proveniência factual. Papo de Cinema resolve crítica autoral, mas não escala entity-first. IMDb resolve dados globais, mas não a versão localizada e editorialmente explicada para o Brasil.

## Produto acionável

### 1. Cartão de evidência de notas

[INFERIDO] Cada nota deve ser um objeto, não uma string:

- fonte: IMDb, Rotten Tomatoes, Metacritic, AdoroCinema, Filmow, crítica Cinerie;
- tipo: comunidade, críticos agregados, crítica editorial, audiência verificada;
- valor e escala: `7,9/10`, `91%`, `83/100`;
- contagem de votos/críticas, se licenciada/disponível;
- URL de origem;
- data/hora de coleta;
- escopo: filme, série, temporada ou episódio;
- status: ativo, indisponível, sem nota, histórico.

[INFERIDO] Essa interface evita o erro recorrente de apresentar “nota 8,1” sem dizer se é média de usuários, percentual de críticas positivas ou média ponderada de veículos.

### 2. “Onde assistir” com proveniência e mudança temporal

[INFERIDO] O bloco deve dizer: serviço, modalidade, preço quando permitido, qualidade/idioma quando houver fonte, território `BR`, data de atualização e origem do dado.

[INFERIDO] O Cinerie não deve prometer precisão de JustWatch sem feed confiável. A hipótese correta é: integrar parceiro licenciado ou tratar disponibilidade como sinal editorial verificável com prazo de validade explícito.

### 3. Páginas de pessoas que resolvem buscas reais

[INFERIDO] A maioria dos sites brasileiros mostra elenco, mas poucos transformam uma pessoa em um hub de alta utilidade: filmografia cronológica, personagem, função, obras disponíveis no Brasil, notas por fonte, relações de franquia e notícias verificadas.

[INFERIDO] Exemplo de página mais útil que uma lista simples: “Wagner Moura — filmes e séries, personagens, onde assistir no Brasil, próximas estreias, notas por fonte e entrevistas verificadas”.

### 4. Editorial factual, não “conteúdo de enchimento”

[INFERIDO] A camada de IA offline revisada deve produzir módulos com escopo limitado e citável, por exemplo:

- “O que sabemos sobre a produção”;
- “Adaptação de qual obra?”;
- “Cronologia da franquia”;
- “Diferenças entre temporadas”;
- “Por que a classificação indicativa é X?”;
- “O que foi confirmado pela distribuidora?”;
- “Onde a obra está disponível no Brasil hoje?”.

[INFERIDO] O requisito de revisão humana precisa ser visível: autor/revisor, data, fontes e versão. Isso transforma IA em diferencial de confiabilidade, não em risco de thin content.

## Hipóteses testáveis

| Hipótese | Teste | Métrica de sucesso | Critério de invalidação |
|---|---|---|---|
| [INFERIDO] Usuários valorizam atribuição de notas | [INFERIDO] Teste A/B: score único versus painel de fontes | [INFERIDO] maior CTR para fonte, maior tempo na página e menor retorno à busca | [INFERIDO] painel não aumenta interação nem satisfação |
| [INFERIDO] “Onde assistir” atualizável gera retorno | [INFERIDO] Criar alertas de entrada/saída por serviço em 500 títulos | [INFERIDO] opt-in de alerta e retorno semanal | [INFERIDO] alertas têm baixa abertura/retorno |
| [INFERIDO] Pessoas são melhor porta de entrada que filmes isolados | [INFERIDO] Lançar hubs de 100 pessoas com demanda brasileira | [INFERIDO] crescimento de impressões em consultas “elenco”, “filmes de”, “séries com” | [INFERIDO] páginas atraem apenas tráfego de marca sem navegação interna |
| [INFERIDO] Editorial factual revisado vence texto genérico | [INFERIDO] Comparar 100 entidades com módulos citados versus 100 fichas básicas | [INFERIDO] CTR orgânico, links internos acionados, retorno e indexação | [INFERIDO] páginas revisadas não superam fichas simples após período suficiente |
| [INFERIDO] Sazonalidade de lançamento pode ser capturada sem newsroom | [INFERIDO] Criar páginas de “filme X 2026” com status, elenco, trailer, fontes e alterações | [INFERIDO] impressões/CTR antes e depois da estreia | [INFERIDO] notícias de portais absorvem toda a demanda e a ficha não cresce |
| [INFERIDO] Episódios são uma lacuna rentável | [INFERIDO] Publicar para séries selecionadas páginas de temporada/episódio com disponibilidade e contexto | [INFERIDO] impressões para consultas “episódio N”, “temporada N”, elenco e recapitulação factual | [INFERIDO] baixo volume ou canibalização sem conversão |

## Prioridade recomendada

1. [INFERIDO] Lançar primeiro um corpus pequeno, mas confiável: lançamentos atuais, catálogo popular e cinema brasileiro recente.

2. [INFERIDO] Para cada entidade, garantir o mínimo: identidade canônica, créditos, fontes de notas claramente separadas, disponibilidade BR com origem/data, notícias relacionadas e links para pessoas/franquias.

3. [INFERIDO] Tratar cada página como uma página de decisão, não como um espelho de API: a API fornece fatos; Cinerie fornece contexto, atribuição, versão brasileira e navegação.

4. [INFERIDO] Construir rotas estáveis e previsíveis, coerentes com o briefing: `/pt/filmes/{slug}/`, `/pt/series/{slug}/`, `/pt/pessoas/{slug}/`, `/pt/noticias/{slug}/`; adicionar, quando houver produto, rotas explícitas para temporadas e episódios.

5. [INFERIDO] Só depois de estabelecer confiança factual, abrir recursos comunitários leves: “quero ver”, “já vi”, listas e avaliações. Uma comunidade sem massa crítica não deve atrasar a vantagem estrutural de dados + editorial + disponibilidade.

