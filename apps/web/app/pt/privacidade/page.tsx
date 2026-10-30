import type { Metadata } from 'next'

import { TMDB_IMAGE_HOST } from '@screena/public-contracts'
import { serializeJsonLd } from '@screena/seo'

import { LEGAL_PRIVACY_VERSION, LegalDoc } from '../../_components/legal-doc'
import {
  HOME_PATH,
  PRIVACY_PATH,
  SITE_URL,
  TERMS_PATH,
  canonicalPublicUrl,
  legalDocRobots,
} from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'
import '../../_components/legal.css'

/**
 * Política de Privacidade (LGPD, Lei 13.709/2018).
 *
 * TEXTO FINAL DO CONTROLADOR (vigente desde 4 de agosto de 2026, versão
 * 2026-08). Substitui a minuta técnica anterior. A redação é do controlador e
 * NÃO deve ser reescrita por conveniência de implementação.
 *
 * O TEXTO FOI ALINHADO AO SISTEMA (2026-08-06). O levantamento anterior listava
 * cinco promessas que a infraestrutura não cumpria. Quatro foram corrigidas NO
 * TEXTO — um documento legal não pode afirmar o que o código não faz, e o
 * caminho certo é a política descrever o estado real, não o estado desejado:
 *
 *  - item 5.2: a atribuição ao TMDB passou a ser declarada em TEXTO, sem
 *    logotipo. Não há logo do TMDB no repositório e
 *    `services/legal/src/authorization-spec.ts` registra `logoAllowed: false`;
 *    exibi-lo contrariaria a própria matriz de licença que o item descreve.
 *  - item 5.4: os backups são descritos como são hoje — diários, acesso
 *    restrito, soma de verificação, rodízio das 14 cópias mais recentes
 *    (`scripts/backup/backup.sh`). A criptografia em repouso e a retenção de 30
 *    dias passaram a constar como MELHORIA PLANEJADA, não como fato.
 *  - item 5.1: o rastreamento de abertura/clique da Brevo está ATIVO no padrão
 *    da plataforma (`providers/brevo/transactional-email.ts` não envia os
 *    parâmetros de desativação). O texto passou a dizer isso, e a declarar que
 *    a Cinerie não consulta nem usa esses indicadores.
 *  - item 9 / item 4: o cadastro tem TRÊS caixas de seleção
 *    (`app/pt/criar-conta/signup-form.tsx`) e `parseSignupCommand` recusaria um
 *    campo de idade. A declaração de 18 anos deixou de ser apresentada como
 *    caixa própria e passou a derivar do aceite dos Termos — o que também
 *    resolve a contradição entre o item 4 ("três caixas") e o item 9, que
 *    acrescentava uma quarta.
 *
 * REVISÃO 2026-10 (30/10/2026), a pedido do controlador: a Cinerie passou a
 * medir audiência. Itens 2.3, 3, 5.6 (Cloudflare), 5.7 (Google Analytics), 6,
 * 6.2, 6.3 e 7 descrevem o que `src/lib/analytics-config.ts` e
 * `app/_components/consent-banner.tsx` fazem: o beacon da Cloudflare sem cookie
 * em toda página, e o GA4 só depois do "Aceitar". Os números do texto (13
 * meses de cookie, 14 meses de retenção, 6 meses de escolha) vivem no código ou
 * na configuração da propriedade — mudou lá, muda aqui.
 *
 * PENDÊNCIA QUE O TEXTO NÃO RESOLVE: `privacidade@cinerie.com` e
 * `contato@cinerie.com` ainda não existem como caixas configuradas. São os
 * canais canônicos declarados pelo controlador e por isso permanecem no texto,
 * mas precisam existir ANTES de a página entrar no índice — uma política de
 * privacidade sem canal de contato funcional descumpre a própria LGPD que ela
 * invoca. Criar as caixas é ação do controlador, não do código.
 *
 * Por isso a página permanece fora do índice até autorização explícita do
 * controlador — ver a nota de indexabilidade abaixo.
 *
 * Destino de um dos dois links do aceite obrigatório do cadastro
 * (`app/pt/criar-conta/signup-form.tsx`), que até aqui apontava para 404.
 *
 * Indexabilidade: `legalDocRobots()` — chave PRÓPRIA
 * (`CINERIE_LEGAL_DOCS_INDEXING_ENABLED`), porque esta página fica pronta antes
 * do catálogo e indexá-la não pode exigir abrir o site inteiro. Nunca montar
 * `robots` na mão, e nunca voltar ao helper genérico do site — as duas coisas
 * são travadas por tests/governance/no-raw-robots-metadata.test.ts e
 * tests/governance/legal-docs-indexing.test.ts.
 */

/**
 * `force-dynamic` — o `<meta robots>` desta página lê a chave de indexação do
 * AMBIENTE (`legalDocRobots()`), e essa chave só existe em RUNTIME: o release
 * constrói sem env pública (ver o `Dockerfile`).
 *
 * Prerenderizada no build, a página saía com o robots do BUILD — `noindex,
 * nofollow` — e nenhuma env de runtime o alcançava: a chave própria dos
 * documentos legais ficava inerte. Medido em 15/09/2026 no HTML que o build
 * gravou em `.next/server/app/pt/privacidade.html`. Sem banco, renderizar por
 * requisição custa pouco. Travado por
 * `tests/web/prerendered-routes-robots-runtime.test.ts`.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Política de Privacidade'
const DESCRIPTION =
  'Como a Cinerie trata dados pessoais: o que coletamos, com que finalidade, ' +
  'por quanto tempo guardamos e como você exerce seus direitos de titular.'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: legalDocRobots(),
    alternates: { canonical: canonicalPublicUrl(PRIVACY_PATH) },
    ...socialMetadata({
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      canonicalUrl: canonicalPublicUrl(PRIVACY_PATH),
    }),
  }
}

export default function PrivacidadePage() {
  const canonicalUrl = canonicalPublicUrl(PRIVACY_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  return (
    <>
      <LegalDoc
        breadcrumbLabel="Privacidade"
        effectiveDate="30 de outubro de 2026"
        title={TITLE}
        version={LEGAL_PRIVACY_VERSION}
      >
        <p>
          Esta política explica como a Cinerie trata dados pessoais de quem usa o site e,
          principalmente, de quem cria uma conta. Ela descreve o funcionamento real do produto: o
          que é coletado, por quê, com que base legal, por quanto tempo fica guardado e como você
          exerce seus direitos.
        </p>
        <p>
          Navegar pelo catálogo (filmes, séries, pessoas, notícias) <strong>não exige conta</strong>{' '}
          e não depende de nenhum cadastro. A maior parte do que está descrito aqui só passa a
          valer quando você cria uma conta.
        </p>

        <h2>1. Quem é o controlador</h2>
        <p>
          O controlador dos dados pessoais tratados pela Cinerie é Pablo Eduardo Gameleira, nome
          fantasia Grupo Maquina Nerd, inscrito no CNPJ sob o nº 22.739.386/0001-90, com sede em
          Aparecida de Goiânia, Goiás, responsável pela operação da Cinerie.
        </p>
        <p>
          Para assuntos relacionados à privacidade, proteção de dados pessoais ou exercício dos
          direitos previstos na Lei Geral de Proteção de Dados Pessoais — LGPD, utilize:
        </p>
        <p>
          <strong>Canal de privacidade: privacidade@cinerie.com</strong>
        </p>
        <p>
          O Grupo Maquina Nerd atua como agente de tratamento de pequeno porte e, na configuração
          atual, não possui encarregado pelo tratamento de dados pessoais formalmente nomeado. O
          canal acima exerce a função de comunicação com titulares e com a Agência Nacional de
          Proteção de Dados — ANPD.
        </p>
        <p>
          Pedidos relacionados a dados pessoais serão confirmados e analisados sem demora indevida. A
          Cinerie buscará apresentar resposta completa em até 15 dias corridos, salvo quando a
          natureza ou a complexidade do pedido exigir prazo adicional permitido pela legislação.
          Nesse caso, o titular será informado.
        </p>
        <p>
          O canal geral para dúvidas que não estejam relacionadas à proteção de dados é:
        </p>
        <p>
          <strong>Contato geral: contato@cinerie.com</strong>
        </p>

        <h2>2. Quais dados tratamos e para quê</h2>
        <p>
          Os dados abaixo são os que o sistema efetivamente grava. Nada aqui é coletado &quot;por
          precaução&quot;: cada item existe para uma finalidade concreta.
        </p>

        <h3>2.1 Dados de conta</h3>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Dado</th>
                <th scope="col">Finalidade</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">E-mail</th>
                <td>
                  Identificar sua conta, verificar o endereço, recuperar senha e enviar avisos de
                  segurança. É o identificador único da conta.
                </td>
              </tr>
              <tr>
                <th scope="row">Senha</th>
                <td>
                  Autenticar você. A senha é guardada apenas como <em>hash</em> (scrypt), com
                  parâmetros versionados. Não guardamos a senha em texto e não temos como
                  recuperá-la — só redefiní-la.
                </td>
              </tr>
              <tr>
                <th scope="row">Nome de exibição e apelido (handle)</th>
                <td>Identificar você na interface. Ambos são opcionais.</td>
              </tr>
              <tr>
                <th scope="row">
                  Perfil: biografia, avatar, idioma, país, fuso horário, visibilidade
                </th>
                <td>
                  Personalizar a experiência. Todos opcionais. A visibilidade do perfil nasce{' '}
                  <strong>privada</strong>.
                </td>
              </tr>
              <tr>
                <th scope="row">Sessões ativas</th>
                <td>
                  Manter você conectado com segurança. Guardamos o <em>hash</em> do token (nunca o
                  token), a data de expiração, o último uso e o dispositivo (user-agent).
                </td>
              </tr>
              <tr>
                <th scope="row">Tokens de verificação e de redefinição de senha</th>
                <td>
                  Confirmar seu e-mail e permitir a redefinição de senha. Guardamos apenas o{' '}
                  <em>hash</em>, com prazo de validade e marca de uso — cada token só funciona uma
                  vez.
                </td>
              </tr>
              <tr>
                <th scope="row">Endereço IP (na forma de hash)</th>
                <td>
                  Proteger contra ataques de força bruta e abuso. Ver o item 2.4.
                </td>
              </tr>
              <tr>
                <th scope="row">Registros de autenticação</th>
                <td>
                  Segurança e auditoria: cadastro, login, logout, troca de senha, pedido de
                  exclusão. Registram a ação, o momento, o hash de IP e o dispositivo — nunca a
                  senha nem tokens.
                </td>
              </tr>
              <tr>
                <th scope="row">Registros de consentimento</th>
                <td>
                  Provar o que você aceitou e quando. Cada decisão grava a finalidade, se foi
                  concedida ou negada, a <strong>versão do documento</strong> e a data.
                </td>
              </tr>
              <tr>
                <th scope="row">Pedidos de exportação e de exclusão</th>
                <td>Registrar e auditar o atendimento dos seus direitos de titular.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>2.2 Dados de uso do produto</h3>
        <p>
          São os dados que <strong>você mesmo cria</strong> ao usar a Cinerie. Existem para entregar
          a função que você pediu — sua biblioteca, seu histórico, suas listas:
        </p>
        <ul>
          <li>
            <strong>Estado de acompanhamento</strong> de filmes e séries (quero assistir, assistindo,
            assistido), incluindo datas de início e conclusão e contagem de rewatch;
          </li>
          <li>
            <strong>Progresso por episódio</strong>: se foi assistido, quando, e a posição em
            segundos quando informada;
          </li>
          <li>
            <strong>Histórico de eventos</strong> de acompanhamento, em registro imutável (só
            adiciona, não altera), com a origem do evento (app ou importação);
          </li>
          <li>
            <strong>Listas</strong> criadas por você, seus itens, a ordem e as anotações de cada
            item;
          </li>
          <li>
            <strong>Suas notas</strong> (0,5 a 5,0). São <em>pessoais</em> e nunca se misturam com
            notas de fontes externas nem viram nota agregada do site;
          </li>
          <li>
            <strong>Importações</strong> (Letterboxd CSV, exportação do Trakt, formatos da própria
            Cinerie): guardamos o registro do trabalho — origem, nome do arquivo, quantidade de
            itens, conflitos e resultado.
          </li>
        </ul>
        <p>
          A visibilidade de listas e de estado de acompanhamento nasce <strong>privada</strong>. Nada
          disso fica público sem uma ação sua.
        </p>

        <h3>2.3 Dados que NÃO coletamos</h3>
        <ul>
          <li>
            <strong>Não coletamos dados de pagamento.</strong> A Cinerie não cobra e não processa
            pagamento.
          </li>
          <li>
            <strong>Não pedimos CPF, RG, data de nascimento nem telefone.</strong> Não há campo para
            isso no cadastro.
          </li>
          <li>
            <strong>Não usamos geolocalização precisa.</strong> O país do perfil, quando existe, é
            informado por você.
          </li>
          <li>
            <strong>Não usamos rastreamento publicitário.</strong> Não há Meta Pixel, Hotjar,
            Clarity, pixel de anúncio ou gravação de sessão no site. A única medição de audiência
            com cookies é o Google Analytics, e ele <strong>só carrega se você autorizar</strong>{' '}
            (item 6.2).
          </li>
        </ul>

        <h3>2.4 Seu endereço IP nunca é guardado em texto</h3>
        <p>
          Quando é preciso limitar tentativas de login ou registrar um evento de segurança, o
          endereço IP passa antes por uma função de hash (SHA-256) combinada com um segredo do
          servidor. O que fica gravado é esse resultado — o endereço original{' '}
          <strong>não é persistido em lugar nenhum</strong>.
        </p>
        <p>
          Isso permite reconhecer que duas tentativas vieram da mesma origem sem manter um registro
          de onde você estava. O hash de IP também nunca sai na exportação de dados.
        </p>

        <h2>3. Base legal de cada tratamento</h2>
        <p>
          A LGPD exige uma base legal para cada tratamento. As nossas, na ordem em que aparecem no
          produto:
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Tratamento</th>
                <th scope="col">Base legal</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Conta, autenticação e funções do produto</th>
                <td>
                  Execução de contrato (art. 7º, V) — são os Termos de Uso que você aceita ao criar
                  a conta. Sem esses dados não há como entregar o serviço.
                </td>
              </tr>
              <tr>
                <th scope="row">Registro de consentimento e de pedidos LGPD</th>
                <td>
                  Cumprimento de obrigação legal (art. 7º, II) — é a prova de que respeitamos suas
                  decisões e atendemos seus pedidos.
                </td>
              </tr>
              <tr>
                <th scope="row">Segurança: limite de tentativas, hash de IP, log de autenticação</th>
                <td>
                  Legítimo interesse (art. 7º, IX), para prevenir fraude e proteger sua conta, com o
                  mínimo de dado possível — daí o IP virar hash.
                </td>
              </tr>
              <tr>
                <th scope="row">Comunicações por e-mail (novidades)</th>
                <td>Consentimento (art. 7º, I). Opcional e revogável a qualquer momento.</td>
              </tr>
              <tr>
                <th scope="row">Análise de uso para melhorar recomendações</th>
                <td>Consentimento (art. 7º, I). Opcional e revogável a qualquer momento.</td>
              </tr>
              <tr>
                <th scope="row">Medição de audiência sem cookie (Cloudflare Web Analytics)</th>
                <td>
                  Legítimo interesse (art. 7º, IX), para saber quais páginas são lidas e se o site
                  carrega rápido. Não grava nada no seu navegador e não identifica você (item 6.2).
                </td>
              </tr>
              <tr>
                <th scope="row">Medição de audiência com cookies (Google Analytics)</th>
                <td>
                  Consentimento (art. 7º, I), dado no aviso de cookies. Opcional e revogável a
                  qualquer momento (item 6.3).
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="legal-note">
          <strong>Transparência sobre &quot;análise de uso&quot;:</strong> a caixa &quot;Análise de
          uso&quot; da sua conta trata de análise <strong>ligada à conta</strong>, para melhorar
          recomendações. Hoje a Cinerie registra essa escolha, mas nenhuma ferramenta a usa — marcá-la
          ou não não muda nada no que é coletado. A medição de audiência do site (item 6.2) é outra
          coisa: ela não é ligada à sua conta, e a escolha sobre o Google Analytics é feita no aviso
          de cookies de cada navegador.
        </p>

        <h2>4. Consentimento e como retirar</h2>
        <p>
          No cadastro há três caixas de seleção. Nenhuma vem marcada — a lei proíbe consentimento
          pré-marcado.
        </p>
        <ul>
          <li>
            <strong>Aceite dos Termos e desta Política</strong> — obrigatório. Sem ele o botão de
            criar conta não funciona. Não é &quot;consentimento&quot; no sentido revogável: é a base
            contratual e legal do serviço. Para deixar de aceitar, o caminho é encerrar a conta
            (item 8).
          </li>
          <li>
            <strong>Receber novidades por e-mail</strong> — opcional, revogável.
          </li>
          <li>
            <strong>Análise de uso</strong> — opcional, revogável.
          </li>
        </ul>
        <p>
          <strong>Toda decisão é gravada, inclusive o &quot;não&quot;.</strong> Recusar é diferente
          de não responder, e ausência de resposta nunca é lida como aceite. Cada registro guarda a
          finalidade, a escolha, a versão do documento vigente e a data.
        </p>
        <p>
          Para revogar, acesse{' '}
          <a href="/pt/conta/privacidade/">Configurações → Privacidade e meus dados</a>. As
          finalidades opcionais aparecem com um botão de liga/desliga. A retirada vale{' '}
          <strong>na hora</strong>: a partir daquele instante o servidor passa a barrar aquela
          finalidade. As finalidades não revogáveis aparecem na mesma tela, sem o botão e com a base
          legal indicada.
        </p>
        <p>
          Quando publicarmos uma versão nova destes documentos, a tela de privacidade sinaliza que há
          uma nova versão e pede seu aceite outra vez. A versão anterior continua registrada — o
          histórico não é sobrescrito.
        </p>

        <h2>5. Com quem compartilhamos dados</h2>
        <p>
          A Cinerie não vende dados pessoais, não forma audiências publicitárias com base na
          atividade da conta e não compartilha informações de usuários para publicidade
          comportamental de terceiros.
        </p>
        <p>Os fornecedores utilizados para viabilizar o serviço são os seguintes.</p>

        <h3>5.1 Brevo</h3>
        <p>
          A Brevo é utilizada para o envio de mensagens relacionadas à conta, incluindo:
        </p>
        <ul>
          <li>verificação de endereço de e-mail;</li>
          <li>redefinição de senha;</li>
          <li>alertas de segurança;</li>
          <li>comunicações essenciais sobre a conta;</li>
          <li>novidades por e-mail, somente quando houver consentimento.</li>
        </ul>
        <p>São enviados à Brevo apenas:</p>
        <ul>
          <li>endereço de e-mail;</li>
          <li>assunto e conteúdo da mensagem;</li>
          <li>identificadores técnicos necessários ao envio;</li>
          <li>registros de entrega, falha, rejeição ou descadastro.</li>
        </ul>
        <p>
          A Brevo pode armazenar metadados técnicos relacionados à entrega das mensagens.{' '}
          <strong>
            Os recursos de rastreamento de abertura e clique da Brevo permanecem no padrão da
            plataforma e podem registrar essas interações.
          </strong>{' '}
          A Cinerie não consulta, não exporta e não usa esses indicadores para nenhuma finalidade —
          nem para perfil, nem para segmentação, nem para publicidade. Desativá-los na origem é uma
          mudança de configuração planejada; enquanto não estiver aplicada, esta política não a
          afirma como feita.
        </p>
        <p>
          Os bancos de dados da Brevo são processados na União Europeia, utilizando infraestrutura
          localizada principalmente na França, Alemanha e Bélgica.
        </p>
        <p>
          A relação com a Brevo deverá permanecer sujeita ao respectivo Acordo de Processamento de
          Dados — DPA.
        </p>

        <h3>5.2 TMDB — The Movie Database</h3>
        <p>
          O TMDB é utilizado como fonte de dados e imagens relacionados a filmes, séries, temporadas,
          episódios, pessoas e empresas do setor audiovisual.
        </p>
        <p>
          Nenhum dado da conta Cinerie é enviado ao TMDB nos processos de sincronização do catálogo.
        </p>
        <p>
          As imagens de pôster, capa, perfil, fundo e demais mídias do catálogo são carregadas
          diretamente dos servidores externos do TMDB, normalmente pelo domínio técnico{' '}
          {TMDB_IMAGE_HOST}.
        </p>
        <p>
          Ao abrir uma página que contenha essas imagens, o navegador do usuário realiza uma conexão
          direta com a infraestrutura do TMDB. Nessa conexão, o TMDB ou seu provedor de distribuição
          de conteúdo poderá receber:
        </p>
        <ul>
          <li>endereço IP;</li>
          <li>user-agent;</li>
          <li>data e hora da requisição;</li>
          <li>endereço da imagem solicitada;</li>
          <li>informações técnicas normalmente transmitidas pelo navegador.</li>
        </ul>
        <p>A Cinerie não controla a retenção desses registros pelo TMDB.</p>
        <p>
          A Cinerie apresenta, no rodapé de todas as páginas públicas, o seguinte aviso de
          atribuição:
        </p>
        <p>
          <em>
            &quot;Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.&quot;
          </em>
        </p>
        <p>
          A atribuição é feita <strong>em texto</strong>. A matriz de licenças que a Cinerie mantém
          para cada fonte registra o TMDB sem autorização de uso do logotipo, e exibir a marca sem
          essa autorização contrariaria a própria licença que este item descreve.
        </p>

        <h3>5.3 Contabo GmbH</h3>
        <p>
          A infraestrutura principal da Cinerie será hospedada em servidores virtuais privados
          fornecidos pela Contabo GmbH, em região localizada na União Europeia.
        </p>
        <p>
          A aplicação, o banco de dados e os serviços internos serão administrados pelo Grupo Maquina
          Nerd em ambiente privado, utilizando o EasyPanel como ferramenta de gerenciamento.
        </p>
        <p>A Contabo poderá processar:</p>
        <ul>
          <li>arquivos da aplicação;</li>
          <li>banco de dados;</li>
          <li>dados das contas;</li>
          <li>registros técnicos;</li>
          <li>endereços IP presentes em conexões de rede;</li>
          <li>cópias de segurança;</li>
          <li>informações necessárias à operação do servidor.</li>
        </ul>
        <p>
          A Contabo atua como operadora de infraestrutura e não está autorizada a utilizar os dados
          da Cinerie para finalidades próprias incompatíveis com a prestação do serviço.
        </p>
        <p>
          O Grupo Maquina Nerd deverá formalizar o Acordo de Processamento de Dados — DPA —
          disponibilizado pela Contabo.
        </p>

        <h3>5.4 Cópias de segurança</h3>
        <p>
          As cópias de segurança serão armazenadas em ambiente separado do servidor principal,
          preferencialmente em armazenamento de objetos ou serviço de backup localizado na União
          Europeia.
        </p>
        <p>Hoje, as cópias de segurança:</p>
        <ul>
          <li>são executadas diariamente;</li>
          <li>têm acesso restrito no sistema de arquivos;</li>
          <li>
            têm sua integridade conferida por soma de verificação gravada junto com a cópia;
          </li>
          <li>
            são mantidas em rodízio das <strong>14 cópias mais recentes</strong>, e a mais antiga é
            substituída automaticamente a cada nova execução;
          </li>
          <li>passam por teste periódico de restauração.</li>
        </ul>
        <p>
          <strong>As cópias ainda não são criptografadas em repouso.</strong> A criptografia e a
          transferência para armazenamento de objetos fora do servidor principal são melhorias
          planejadas; enquanto não estiverem em produção, esta política não as afirma. Não
          utilizamos snapshots do servidor como único mecanismo de backup.
        </p>

        <h3>5.5 RapidAPI e fornecedores de catálogo</h3>
        <p>
          A Cinerie poderá utilizar serviços disponibilizados por meio da RapidAPI para consultar:
        </p>
        <ul>
          <li>avaliações externas;</li>
          <li>disponibilidade legal em serviços de streaming;</li>
          <li>informações complementares sobre filmes e séries.</li>
        </ul>
        <p>
          Nenhum dado de conta, e-mail, lista, nota, histórico ou progresso do usuário será enviado
          nesses processos.
        </p>
        <p>
          As consultas serão realizadas por serviços internos da Cinerie e conterão apenas
          identificadores de catálogo, como título, ano, IMDb ID ou TMDB ID.
        </p>

        <h3>5.6 Cloudflare</h3>
        <p>
          Toda requisição ao site passa pela rede da Cloudflare, Inc., que entrega as páginas,
          guarda cópias temporárias delas (cache) e protege o site contra ataques. Para isso, a
          Cloudflare recebe o endereço IP, o user-agent, o endereço da página pedida e as demais
          informações técnicas que o navegador transmite em qualquer acesso.
        </p>
        <p>
          A Cinerie também usa o <strong>Cloudflare Web Analytics</strong> para contar visitas
          (item 6.2). Ele não usa cookie, não grava nada no seu navegador e não cria identificador de
          visitante. A Cinerie vê apenas números agregados — páginas mais lidas, origem do acesso,
          país, tipo de navegador e tempo de carregamento —, nunca um registro por pessoa.
        </p>
        <p>
          A Cloudflare opera uma rede global, e esses dados podem ser processados fora do Brasil,
          inclusive nos Estados Unidos.
        </p>

        <h3>5.7 Google Analytics</h3>
        <p>
          O Google Analytics 4, serviço da Google LLC, só é carregado{' '}
          <strong>depois que você clica em &quot;Aceitar&quot;</strong> no aviso de cookies. Sem essa
          autorização, nenhuma requisição é feita ao Google Analytics.
        </p>
        <p>Quando autorizado, ele recebe:</p>
        <ul>
          <li>as páginas visitadas, o endereço de origem (de onde você veio) e o horário;</li>
          <li>tipo de dispositivo, sistema, navegador, idioma e resolução de tela;</li>
          <li>
            localização aproximada (cidade ou região), deduzida pelo Google a partir do endereço IP —
            o Google Analytics 4 não registra o IP em si;
          </li>
          <li>um identificador aleatório guardado nos cookies <code>_ga</code> (item 6).</li>
        </ul>
        <p>
          Configuramos a propriedade com o mínimo: os <strong>Google Signals</strong> e a
          personalização de anúncios estão <strong>desligados</strong>, nenhum dado de conta (e-mail,
          nome, listas, notas) é enviado, e os dados detalhados são apagados pelo Google após{' '}
          <strong>14 meses</strong>. A Cinerie usa esses números só para entender quais páginas são
          lidas, nunca para publicidade.
        </p>
        <p>
          Os dados são processados em servidores do Google, inclusive nos Estados Unidos, sob a{' '}
          <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">
            Política de Privacidade do Google
          </a>{' '}
          e os termos de processamento de dados do Google Analytics.
        </p>

        <h3>5.8 Cumprimento de obrigações legais</h3>
        <p>Dados poderão ser compartilhados quando isso for necessário para:</p>
        <ul>
          <li>cumprir obrigação legal ou regulatória;</li>
          <li>atender ordem judicial;</li>
          <li>responder a requisição válida de autoridade competente;</li>
          <li>investigar fraude ou incidente de segurança;</li>
          <li>exercer ou defender direitos em processo judicial, administrativo ou extrajudicial.</li>
        </ul>
        <p>
          O fornecimento será limitado às informações necessárias ao atendimento da obrigação ou
          requisição válida.
        </p>

        <h2 id="cookies">6. Cookies</h2>
        <p>
          A Cinerie usa <strong>dois cookies estritamente necessários</strong>, que só existem para
          quem entra na conta, e os <strong>cookies do Google Analytics</strong>, que só existem se
          você autorizar no aviso de cookies. Não há cookie de publicidade.{' '}
          <strong>Nada que dependa da sua autorização carrega sozinho</strong>: o Google Analytics
          espera o seu &quot;Aceitar&quot; (item 6.2), e o player de vídeo espera o seu clique em
          assistir (item 6.1).
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Cookie</th>
                <th scope="col">Para que serve</th>
                <th scope="col">Duração</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <code>__Host-cinerie_session</code>
                </th>
                <td>
                  Mantém você conectado. Contém apenas um identificador opaco — nenhum dado pessoal.
                  É <code>HttpOnly</code>: nenhum script consegue lê-lo.
                </td>
                <td>Igual à validade da sessão (padrão: 30 dias)</td>
              </tr>
              <tr>
                <th scope="row">
                  <code>__Host-cinerie_csrf</code>
                </th>
                <td>
                  Protege contra falsificação de requisição entre sites (CSRF). Precisa ser legível
                  pela página para ser reapresentado a cada ação — por isso não é{' '}
                  <code>HttpOnly</code>. Também é um valor opaco.
                </td>
                <td>Igual à validade da sessão (padrão: 30 dias)</td>
              </tr>
              <tr>
                <th scope="row">
                  <code>_ga</code> e <code>_ga_&lt;ID&gt;</code>
                </th>
                <td>
                  Cookies do Google Analytics (item 5.7). Guardam um identificador aleatório para
                  distinguir visitas, sem nome nem e-mail. <strong>Só são criados se você clicar em
                  &quot;Aceitar&quot;</strong>, e são apagados quando você retira a autorização.
                </td>
                <td>Até 13 meses</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Os dois primeiros são criados <strong>somente no login</strong> e removidos no logout.
          Quem apenas navega sem conta não recebe cookie nenhum, a não ser que autorize o Google
          Analytics.
        </p>
        <p>
          A sua resposta ao aviso de cookies — &quot;Aceitar&quot; ou &quot;Recusar&quot; — fica
          guardada no próprio navegador, no armazenamento local (<code>localStorage</code>), sob o
          nome <code>cinerie:consentimento-analise</code>. Ela não é um cookie, não é enviada ao
          servidor e serve só para não perguntar de novo a cada página.
        </p>

        <h3>6.1. O player de vídeo do YouTube</h3>
        <p>
          Trailers e vídeos dentro das matérias são reproduzidos por um player do YouTube, que é
          serviço do Google. <strong>Ele não carrega junto com a página.</strong> Você vê um botão
          nosso; até você clicar nele, nada é pedido ao YouTube — nem o seu endereço IP, nem qual
          página você está lendo. Sem a sua autorização ao Google Analytics (item 6.2), abrir a
          home, a lista de filmes ou uma matéria não entrega dado nenhum ao Google.
        </p>
        <p>
          Quando você clica para assistir, o player é carregado de{' '}
          <code>youtube-nocookie.com</code> — o endereço que o próprio YouTube mantém para adiar o
          registro de atividade. Desse ponto em diante, o Google trata os seus dados como
          controlador dele, sob as regras dele:{' '}
          <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">
            Política de Privacidade do Google
          </a>
          .
        </p>
        <p>
          O que fazemos para reduzir isso ao mínimo: o endereço do player não leva nenhum parâmetro
          de rastreamento, e o player roda isolado do resto do site, sem alcançar os nossos
          cookies. Se preferir não carregá-lo, cada vídeo tem a opção de abrir no YouTube em outra
          aba — a escolha é sua, e ela continua sendo sua a cada vídeo.
        </p>

        <h3>6.2. Medição de audiência</h3>
        <p>
          Para saber quais páginas são lidas e se o site está rápido, usamos duas ferramentas:
        </p>
        <ul>
          <li>
            <strong>Cloudflare Web Analytics</strong> (item 5.6) — carrega em todas as páginas.{' '}
            <strong>Não usa cookie</strong>, não grava nada no seu navegador e não cria
            identificador de visitante. Mostra para a Cinerie só números agregados: visitas por
            página, origem do acesso, país, tipo de navegador e tempo de carregamento.
          </li>
          <li>
            <strong>Google Analytics 4</strong> (item 5.7) — usa cookies e por isso{' '}
            <strong>depende da sua autorização</strong>. Na primeira visita aparece um aviso com
            dois botões do mesmo tamanho, &quot;Recusar&quot; e &quot;Aceitar&quot;. Enquanto você
            não responder, ou se recusar, o Google Analytics não carrega.
          </li>
        </ul>

        <h3>6.3. Como mudar sua escolha</h3>
        <p>
          Use o botão <strong>&quot;Preferências de cookies&quot;</strong>, no rodapé de todas as
          páginas. Ele reabre o aviso e mostra a sua escolha atual. Se você retirar a autorização,
          o Google Analytics para de coletar na hora e os cookies <code>_ga</code> deste site são
          apagados.
        </p>
        <p>
          A resposta vale por <strong>6 meses</strong> naquele navegador. Depois disso, ou se a
          lista de ferramentas mudar, o aviso pergunta de novo. Limpar os dados do site no navegador
          também apaga a escolha.
        </p>

        <h2>7. Por quanto tempo guardamos os dados</h2>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col">Período de retenção</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  Perfil, listas, notas, histórico, progresso e conteúdo pessoal
                </th>
                <td>
                  Enquanto a conta estiver ativa e durante o período de arrependimento do
                  encerramento
                </td>
              </tr>
              <tr>
                <th scope="row">Senha e parâmetros criptográficos</th>
                <td>Enquanto a conta existir</td>
              </tr>
              <tr>
                <th scope="row">Sessões</th>
                <td>Até 30 dias, salvo encerramento, revogação ou troca de senha anterior</td>
              </tr>
              <tr>
                <th scope="row">Tokens de verificação e recuperação</th>
                <td>Até sua utilização ou expiração</td>
              </tr>
              <tr>
                <th scope="row">Registros de autenticação e segurança</th>
                <td>
                  365 dias após o evento, salvo investigação, incidente ou exercício regular de
                  direitos
                </td>
              </tr>
              <tr>
                <th scope="row">Identificadores derivados de IP</th>
                <td>
                  365 dias ou pelo período do registro de segurança ao qual estiverem vinculados
                </td>
              </tr>
              <tr>
                <th scope="row">Registros de consentimento e versões aceitas</th>
                <td>5 anos após o encerramento da conta</td>
              </tr>
              <tr>
                <th scope="row">Pedidos relacionados à LGPD</th>
                <td>5 anos após a conclusão do pedido</td>
              </tr>
              <tr>
                <th scope="row">Metadados de importações</th>
                <td>Enquanto a conta existir</td>
              </tr>
              <tr>
                <th scope="row">Registros de envio de e-mail</th>
                <td>Até 180 dias, ressalvados registros mantidos diretamente pela Brevo</td>
              </tr>
              <tr>
                <th scope="row">Dados do Google Analytics (só com autorização)</th>
                <td>14 meses, apagados pelo próprio Google conforme a configuração da propriedade</td>
              </tr>
              <tr>
                <th scope="row">Escolha no aviso de cookies (no seu navegador)</th>
                <td>6 meses, ou até você limpar os dados do site</td>
              </tr>
              <tr>
                <th scope="row">Backups da Cinerie</th>
                <td>Até 30 dias</td>
              </tr>
              <tr>
                <th scope="row">Registros relacionados a fraude, incidente ou processo</th>
                <td>
                  Enquanto forem necessários para investigação, cumprimento de obrigação legal ou
                  exercício regular de direitos
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Depois do encerramento definitivo, e-mail, nome, apelido, perfil, listas, notas, histórico
          e progresso serão eliminados da base ativa.
        </p>
        <p>
          Registros conservados para demonstrar cumprimento da legislação serão segregados, terão
          acesso restrito e não poderão ser utilizados para publicidade, personalização, recomendação
          ou reativação automática da conta.
        </p>

        <h2>8. Seus direitos e como exercer cada um</h2>
        <p>
          A LGPD (art. 18) garante um conjunto de direitos. Abaixo, como exercer cada um{' '}
          <strong>dentro do produto</strong>, sem depender de e-mail:
        </p>

        <h3>8.1 Confirmação e acesso aos dados</h3>
        <p>
          Em <a href="/pt/conta/privacidade/">Privacidade e meus dados</a>, use{' '}
          <strong>Exportar meus dados</strong>. O arquivo JSON é gerado na hora e baixado pelo seu
          navegador — não fica armazenado em servidor nenhum.
        </p>
        <p>
          A exportação inclui: dados da conta, perfil, estado de acompanhamento, progresso de
          episódios, histórico, listas e itens, suas notas, registros de consentimento, pedidos LGPD
          e metadados de importações. Ela vem acompanhada de um <strong>manifesto</strong> que diz,
          categoria por categoria, o que entrou e o que ficou de fora e por quê.
        </p>
        <p>
          A exportação <strong>nunca</strong> inclui senha, hash de senha, tokens, hash de IP,
          registros de segurança nem dados de catálogo de terceiros — os três primeiros por serem
          segredos, os demais por não serem dado seu.
        </p>
        <p className="legal-note">
          <strong>Limitação declarada:</strong> a exportação consulta também os campos de{' '}
          <em>resenhas</em> e de <em>estatísticas de perfil</em>. Essas duas funções ainda não
          existem na interface, então hoje essas seções saem <strong>sempre vazias</strong> — não
          porque algo tenha sido omitido, mas porque não há o que exportar. Não afirmamos que a
          exportação é completa em relação a funções que ainda não existem.
        </p>

        <h3>8.2 Correção de dados</h3>
        <p>
          Nome de exibição, apelido, biografia, idioma, país, fuso e visibilidade são editáveis em{' '}
          <a href="/pt/conta/">Configurações</a>. A senha é alterada na mesma área. Para corrigir o
          e-mail da conta, use o contato do item 1.
        </p>

        <h3>8.3 Revogação de consentimento</h3>
        <p>Ver o item 4. Efeito imediato, na própria tela de privacidade.</p>

        <h3>8.4 Eliminação e encerramento de conta</h3>
        <p>
          Em <a href="/pt/conta/privacidade/">Privacidade e meus dados</a>, use{' '}
          <strong>Encerrar minha conta</strong>. É preciso confirmar com a sua senha — a sessão
          sozinha não encerra conta. O que acontece, em ordem:
        </p>
        <ol>
          <li>a conta entra em estado de encerramento e todas as sessões são derrubadas na hora;</li>
          <li>
            abre-se um <strong>prazo de arrependimento de 30 dias</strong>, contado do pedido;
          </li>
          <li>
            depois desse prazo, a conta é anonimizada em definitivo: e-mail, apelido e nome são
            apagados, e o conteúdo que você criou (listas, notas, histórico, progresso) é removido.
          </li>
        </ol>
        <p>
          <strong>O registro da conta não é apagado da base</strong>, e isso é deliberado: os
          registros de consentimento e de segurança precisam sobreviver por obrigação legal, e eles
          se apoiam nesse registro. O que resta é um registro sem qualquer dado que identifique
          você.
        </p>
        <p className="legal-note">
          <strong>Como isso funciona hoje, com honestidade:</strong> o pedido de encerramento é
          automático e imediato, mas a <strong>anonimização definitiva do passo 3 é executada por
          operação manual da equipe</strong> — não há um processo agendado que a dispare sozinho ao
          fim dos 30 dias. Na prática isso significa que ela pode ocorrer algum tempo depois do
          prazo. Estamos declarando isso em vez de prometer automação que ainda não existe. Para
          reativar a conta dentro do prazo, use o contato do item 1.
        </p>

        <h3>8.5 Portabilidade</h3>
        <p>
          O mesmo arquivo do item 8.1 serve para portabilidade: é JSON estruturado, com formato
          identificado e legível por máquina.
        </p>

        <h3>8.6 Informação sobre compartilhamento e revisão de decisões</h3>
        <p>
          O item 5 lista todos os terceiros. Não tomamos decisões automatizadas que afetem seus
          interesses — as recomendações do produto não restringem acesso, não classificam pessoas e
          não produzem efeito jurídico.
        </p>

        <h3>8.7 Reclamação</h3>
        <p>
          Você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD). Antes disso, fale
          conosco pelo contato do item 1 — normalmente é mais rápido.
        </p>

        <h2>9. Crianças e adolescentes</h2>
        <p>
          A consulta ao catálogo público da Cinerie não exige conta. O catálogo poderá ser acessado
          por pessoas de diferentes idades, observadas as classificações indicativas e os avisos
          apresentados junto às obras.
        </p>
        <p>
          A criação e utilização de uma conta Cinerie são permitidas somente a pessoas com 18 anos
          completos ou mais.
        </p>
        <p>
          A Cinerie não oferece contas infantis, contas juvenis, perfis supervisionados ou mecanismos
          para obtenção de autorização de pais ou responsáveis.
        </p>
        <p>
          O cadastro <strong>não</strong> traz uma caixa de seleção separada para a idade. Ao marcar
          o aceite dos Termos de Uso e desta Política — obrigatório para criar conta — você declara
          possuir 18 anos completos ou mais, porque a idade mínima é condição dos próprios Termos
          (item &quot;Idade mínima&quot;).
        </p>
        <p>
          A Cinerie não solicita data de nascimento nem documento de identidade no cadastro comum.
          Entretanto, poderá adotar medidas proporcionais de verificação quando houver indícios de
          que uma conta pertence a uma pessoa menor de 18 anos.
        </p>
        <p>Se identificarmos uma conta pertencente a uma pessoa menor de 18 anos:</p>
        <ul>
          <li>a conta poderá ser preventivamente bloqueada;</li>
          <li>as sessões serão encerradas;</li>
          <li>
            o responsável poderá ser contatado quando isso for juridicamente permitido e necessário;
          </li>
          <li>os dados serão eliminados, ressalvadas as hipóteses legais de conservação;</li>
          <li>
            registros mínimos poderão ser mantidos para documentar o atendimento do caso e prevenir
            novas violações.
          </li>
        </ul>
        <p>
          Pais ou responsáveis podem solicitar análise e exclusão pelo e-mail:{' '}
          <strong>privacidade@cinerie.com</strong>
        </p>
        <p>
          A restrição de idade para contas não significa que todo conteúdo público da Cinerie seja
          adequado a menores. Filmes, séries, notícias, imagens e textos podem tratar de violência,
          sexualidade, drogas, linguagem imprópria ou outros temas destinados a diferentes faixas
          etárias.
        </p>
        <p>
          Quando disponível, a classificação indicativa da obra será apresentada como informação ao
          usuário.
        </p>
        <p>
          A Cinerie observará o melhor interesse de crianças e adolescentes, a LGPD, o Estatuto da
          Criança e do Adolescente e o Estatuto Digital da Criança e do Adolescente também nas áreas
          públicas do serviço.
        </p>

        <h2>10. Segurança</h2>
        <ul>
          <li>Senhas guardadas apenas como hash (scrypt), com parâmetros versionados;</li>
          <li>Tokens de sessão e de verificação guardados apenas como hash;</li>
          <li>Cookies com <code>Secure</code>, <code>SameSite</code> e prefixo <code>__Host-</code>;</li>
          <li>Proteção contra CSRF em toda ação que altera dados;</li>
          <li>Limite de tentativas de login por conta e por origem;</li>
          <li>
            Respostas idênticas para e-mail existente e inexistente no cadastro e na recuperação de
            senha, para que não seja possível descobrir quem tem conta;
          </li>
          <li>Registro de eventos de autenticação em log que não pode ser alterado.</li>
        </ul>
        <p>
          Nenhum sistema é imune. Se ocorrer incidente com risco relevante aos seus direitos,
          comunicaremos você e a ANPD na forma da lei.
        </p>

        <h2>11. Transferência internacional</h2>
        <p>
          A Cinerie utiliza fornecedores que podem processar dados pessoais fora do Brasil.
        </p>
        <p>
          <strong>Contabo</strong> — A aplicação, o banco de dados e os backups serão mantidos
          preferencialmente em região da União Europeia contratada junto à Contabo GmbH. Os dados
          transferidos podem incluir informações da conta, conteúdo pessoal, registros de segurança e
          cópias de segurança. A relação deverá ser protegida pelo Acordo de Processamento de Dados
          disponibilizado pela Contabo e pelas garantias contratuais exigidas pela legislação
          aplicável.
        </p>
        <p>
          <strong>Brevo</strong> — A Brevo processa os endereços de e-mail, conteúdos de mensagens e
          metadados de entrega na União Europeia, especialmente na França, Alemanha e Bélgica. O
          tratamento deverá permanecer sujeito ao DPA da Brevo.
        </p>
        <p>
          <strong>TMDB</strong> — O navegador do usuário se conecta diretamente à infraestrutura de
          imagens do TMDB. Essa infraestrutura pode utilizar servidores e redes de distribuição de
          conteúdo localizados fora do Brasil. Nessa operação, o TMDB poderá receber endereço IP,
          user-agent e informações sobre a imagem solicitada.
        </p>
        <p>
          <strong>RapidAPI e APIs integradas</strong> — Consultas técnicas feitas pela Cinerie podem
          ser processadas fora do Brasil. Essas consultas não incluirão dados de conta ou dados
          comportamentais dos usuários.
        </p>
        <p>
          As transferências internacionais serão realizadas conforme as hipóteses autorizadas pelos
          arts. 33 e seguintes da LGPD e pela regulamentação da ANPD, utilizando contratos, cláusulas
          de proteção de dados e outras garantias aplicáveis.
        </p>

        <h2>12. Alterações desta Política</h2>
        <p>
          Esta Política entra em vigor em 4 de agosto de 2026 e corresponde à versão 2026-08.
        </p>
        <p>Mudanças relevantes serão acompanhadas de:</p>
        <ul>
          <li>nova identificação de versão;</li>
          <li>nova data de vigência;</li>
          <li>aviso dentro da conta ou por e-mail;</li>
          <li>novo aceite quando houver alteração contratual relevante;</li>
          <li>novo consentimento quando uma nova finalidade depender dessa base legal.</li>
        </ul>
        <p>
          Os registros anteriores permanecerão vinculados à versão apresentada no momento da
          respectiva decisão.
        </p>
        <p>
          A versão e a data de vigência desta política estão no topo desta página. Os Termos de Uso
          estão em <a href={TERMS_PATH}>Termos de Uso</a>.
        </p>
      </LegalDoc>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </>
  )
}
