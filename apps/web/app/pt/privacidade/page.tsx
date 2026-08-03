import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { Fill, LegalDoc } from '../../_components/legal-doc'
import {
  HOME_PATH,
  PRIVACY_PATH,
  SITE_URL,
  TERMS_PATH,
  canonicalPublicUrl,
  publicRobots,
} from '../../../src/lib/site'

/**
 * Política de Privacidade (LGPD, Lei 13.709/2018).
 *
 * RASCUNHO TÉCNICO: cada afirmação descreve o que o código FAZ hoje, não o que
 * seria desejável. Onde o produto ainda não entrega algo, o texto declara a
 * limitação em vez de prometer. Precisa de revisão jurídica antes de ir ao ar.
 *
 * Destino de um dos dois links do aceite obrigatório do cadastro
 * (`app/pt/criar-conta/signup-form.tsx`), que até aqui apontava para 404.
 *
 * Indexabilidade: `publicRobots(true)` — a página é pública e indexável por
 * natureza, e o gate global (`CINERIE_PUBLIC_INDEXING_ENABLED` + origem oficial)
 * decide sozinho se algum `index` sai. Nunca montar `robots` na mão
 * (tests/governance/no-raw-robots-metadata.test.ts).
 */

const TITLE = 'Política de Privacidade'
const DESCRIPTION =
  'Como a Cinerie trata dados pessoais: o que coletamos, com que finalidade, ' +
  'por quanto tempo guardamos e como você exerce seus direitos de titular.'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalPublicUrl(PRIVACY_PATH) },
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
      <LegalDoc breadcrumbLabel="Privacidade" effectiveDate={null} title={TITLE}>
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
          O controlador dos dados é <Fill>razão social completa</Fill>, inscrita no CNPJ sob o nº{' '}
          <Fill>CNPJ</Fill>, com sede em <Fill>endereço completo</Fill>.
        </p>
        <p>
          Para falar sobre privacidade, exercer direitos ou tirar dúvidas sobre esta política, o
          contato é <Fill>e-mail do encarregado/DPO</Fill>. Respondemos em até{' '}
          <Fill>prazo de resposta, ex.: 15 dias</Fill>.
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
            <strong>Não rastreamos você por terceiros.</strong> Não há Google Analytics, Meta Pixel,
            Hotjar, Clarity ou qualquer script de rastreamento no site.
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
            </tbody>
          </table>
        </div>
        <p className="legal-note">
          <strong>Transparência sobre &quot;análise de uso&quot;:</strong> hoje a Cinerie registra
          essa escolha, mas <strong>não há nenhuma ferramenta de análise em funcionamento</strong> —
          nem própria, nem de terceiros. O consentimento está lá para que, quando existir, ele já
          nasça condicionado à sua decisão. Enquanto isso, marcá-lo ou não não muda nada no que é
          coletado.
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

        <h2>5. Com quem compartilhamos</h2>
        <p>
          Não vendemos dados pessoais e não os compartilhamos para publicidade de terceiros. Os
          únicos terceiros envolvidos são fornecedores necessários para o serviço funcionar:
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Terceiro</th>
                <th scope="col">Papel</th>
                <th scope="col">Que dado seu chega até ele</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Brevo</th>
                <td>Envio de e-mail transacional (verificação de e-mail, redefinição de senha).</td>
                <td>
                  Apenas o <strong>endereço de e-mail</strong> de destino e o conteúdo da mensagem.
                  Nada além disso é enviado.
                </td>
              </tr>
              <tr>
                <th scope="row">TMDB (The Movie Database)</th>
                <td>
                  Fonte do catálogo (fichas, elenco, imagens). Os dados do catálogo são sincronizados
                  fora do fluxo de navegação e servidos do nosso banco.
                </td>
                <td>
                  Nenhum dado de conta. Porém: <strong>as imagens de pôster e capa são carregadas
                  direto dos servidores do TMDB</strong> pelo seu navegador. Nessa requisição, o
                  TMDB recebe seu IP e seu user-agent, como acontece com qualquer imagem hospedada
                  fora do site.
                </td>
              </tr>
              <tr>
                <th scope="row">Provedor de infraestrutura e backup</th>
                <td>
                  Hospedagem da aplicação e do banco de dados, e armazenamento das cópias de
                  segurança.
                </td>
                <td>
                  Os dados ficam armazenados na infraestrutura contratada, inclusive nas cópias de
                  segurança periódicas. O fornecedor atua como operador, sem usar os dados para
                  finalidade própria. Identificação: <Fill>fornecedor de hospedagem e de backup</Fill>.
                </td>
              </tr>
              <tr>
                <th scope="row">
                  Fornecedores técnicos de dados de catálogo (ex.: RapidAPI)
                </th>
                <td>
                  Entregam <em>para nós</em> informações sobre obras (notas de fontes externas,
                  disponibilidade em streaming).
                </td>
                <td>
                  <strong>Nenhum.</strong> O fluxo é de entrada: consultamos esses fornecedores em
                  processos que rodam fora do site, sem enviar qualquer dado de usuário.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Também podemos compartilhar dados quando houver obrigação legal, ordem judicial ou pedido
          de autoridade competente — apenas na medida exigida.
        </p>

        <h2>6. Cookies</h2>
        <p>
          A Cinerie usa <strong>dois cookies, ambos estritamente necessários</strong>. Não há cookie
          de publicidade, de análise ou de rastreamento — e é por isso que você não vê banner de
          cookies aqui: não existe nada opcional para consentir.
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
            </tbody>
          </table>
        </div>
        <p>
          Os dois são criados <strong>somente no login</strong> e removidos no logout. Quem apenas
          navega sem conta não recebe cookie nenhum.
        </p>

        <h2>7. Por quanto tempo guardamos</h2>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col">Retenção</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Conteúdo criado por você (listas, notas, histórico, perfil)</th>
                <td>Enquanto a conta existir. É apagado no encerramento.</td>
              </tr>
              <tr>
                <th scope="row">Senha, sessões e tokens</th>
                <td>
                  Enquanto necessários. Sessões e tokens expiram sozinhos; tudo é apagado no
                  encerramento.
                </td>
              </tr>
              <tr>
                <th scope="row">Registros de autenticação (segurança)</th>
                <td>
                  <strong>365 dias</strong>. Depois disso a referência ao titular é anonimizada.
                </td>
              </tr>
              <tr>
                <th scope="row">Registros de consentimento e pedidos LGPD</th>
                <td>
                  Mantidos por prazo indeterminado, por obrigação legal: são a prova de que
                  respeitamos suas escolhas. Após o encerramento, ficam sem vínculo com você.
                </td>
              </tr>
              <tr>
                <th scope="row">Identificação da conta (e-mail, apelido, nome)</th>
                <td>
                  <strong>Anonimizada</strong>, não apagada. Ver o item 8.
                </td>
              </tr>
              <tr>
                <th scope="row">Cópias de segurança</th>
                <td>
                  Backups periódicos podem conter dados já apagados da base ativa até que o ciclo de
                  retenção do backup se complete. Período de retenção:{' '}
                  <Fill>retenção dos backups, ex.: 30 dias</Fill>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

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
          A Cinerie não é destinada a menores de <Fill>idade mínima, ex.: 16 anos</Fill> e não
          coletamos intencionalmente dados de crianças.
        </p>
        <p>
          <strong>Não verificamos idade no cadastro</strong> — não há campo de data de nascimento.
          Se tomarmos conhecimento de conta criada por menor de idade sem o consentimento previsto
          no art. 14 da LGPD, encerramos a conta e eliminamos os dados. Responsáveis podem pedir
          isso pelo contato do item 1.
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
          Alguns fornecedores do item 5 podem processar dados fora do Brasil. Quando isso acontece, a
          transferência se apoia nas hipóteses do art. 33 da LGPD. Detalhamento por fornecedor:{' '}
          <Fill>países de processamento e garantias contratuais de cada fornecedor</Fill>.
        </p>

        <h2>12. Alterações desta política</h2>
        <p>
          Se esta política mudar de forma relevante, publicamos a nova versão aqui com nova data de
          vigência e nova identificação de versão, e a tela de privacidade passa a pedir seu aceite
          outra vez. Aceites anteriores continuam registrados com a versão a que se referiam.
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
