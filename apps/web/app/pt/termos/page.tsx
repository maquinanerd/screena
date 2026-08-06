import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { LegalDoc } from '../../_components/legal-doc'
import {
  HOME_PATH,
  PRIVACY_PATH,
  SITE_URL,
  TERMS_PATH,
  canonicalPublicUrl,
  publicRobots,
} from '../../../src/lib/site'

/**
 * Termos de Uso.
 *
 * TEXTO FINAL DO CONTROLADOR (vigente desde 4 de agosto de 2026, versão
 * 2026-08). Substitui a minuta técnica anterior. A redação é do controlador e
 * NÃO deve ser reescrita por conveniência de implementação.
 *
 * O TEXTO FOI ALINHADO AO SISTEMA (2026-08-06). Os dois compromissos que o
 * código não cumpria deixaram de ser afirmados:
 *
 *  - item "Idade mínima": o cadastro NÃO tem caixa de seleção de idade — são
 *    três caixas, e `parseSignupCommand`, na plataforma de identidade, tem
 *    allowlist de seis chaves e RECUSARIA um campo de idade. O texto deixou de
 *    mandar marcar uma declaração inexistente: a idade mínima passou a ser
 *    condição destes Termos, declarada pelo aceite deles. (O caminho do arquivo
 *    não é citado aqui de propósito: a guarda
 *    `tests/governance/user-platform-privacy.test.ts` proíbe o literal em
 *    arquivo de página, e com razão — ela não distingue comentário de import.)
 *  - item 4.2: a atribuição ao TMDB é declarada em TEXTO, no rodapé. Não há
 *    logotipo do TMDB no repositório e `services/legal/src/authorization-spec.ts`
 *    registra `logoAllowed: false` — exibi-lo contrariaria a matriz de licença.
 *
 * Por isso a página permanece fora do índice até autorização explícita do
 * controlador.
 *
 * Destino de um dos dois links do aceite obrigatório do cadastro
 * (`app/pt/criar-conta/signup-form.tsx`), que até aqui apontava para 404.
 */

const TITLE = 'Termos de Uso'
const DESCRIPTION =
  'Regras de uso da Cinerie: o que o serviço é, requisitos de conta, conduta, ' +
  'propriedade intelectual, conteúdo do usuário e limites de responsabilidade.'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(true),
    alternates: { canonical: canonicalPublicUrl(TERMS_PATH) },
  }
}

export default function TermosPage() {
  const canonicalUrl = canonicalPublicUrl(TERMS_PATH)

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
      <LegalDoc breadcrumbLabel="Termos de Uso" effectiveDate="4 de agosto de 2026" title={TITLE}>
        <p>
          Estes Termos regulam o uso da Cinerie. Ao criar uma conta, você declara que leu e aceita
          estes Termos e a <a href={PRIVACY_PATH}>Política de Privacidade</a>. Se não concordar com
          alguma parte, não crie conta e não use o serviço.
        </p>

        <h2>1. O que é a Cinerie</h2>
        <p>
          A Cinerie é uma base de consulta sobre entretenimento: filmes, séries, temporadas,
          episódios e pessoas, com notícias e conteúdo editorial próprio. Cada página gira em torno
          de uma obra ou de uma pessoa, reunindo ficha técnica, elenco, mídia e, quando disponível,
          onde assistir de forma legal.
        </p>
        <p>
          O serviço é <strong>gratuito</strong> e não exige conta para consultar o catálogo. A conta
          existe para funções pessoais: marcar o que você assistiu, acompanhar o progresso de
          séries, montar listas e registrar suas notas.
        </p>
        <p>
          <strong>A Cinerie não exibe, hospeda nem transmite obras audiovisuais.</strong> Não somos
          um serviço de streaming. Quando indicamos onde assistir, apontamos apenas para serviços
          oficiais e licenciados. Nunca vamos linkar torrent, IPTV irregular, player pirata ou
          qualquer download não autorizado.
        </p>

        <h2>2. Sua conta</h2>
        <p>Para criar uma conta, você deverá:</p>
        <ul>
          <li>utilizar um endereço de e-mail válido;</li>
          <li>criar uma senha com pelo menos 10 caracteres;</li>
          <li>possuir 18 anos completos ou mais;</li>
          <li>aceitar estes Termos;</li>
          <li>declarar que teve acesso à Política de Privacidade;</li>
          <li>declarar que possui a idade mínima exigida.</li>
        </ul>
        <p>O nome de exibição é opcional.</p>
        <p>
          A Cinerie enviará uma mensagem de verificação ao endereço informado. Algumas funções
          poderão exigir que o e-mail esteja confirmado.
        </p>
        <p>Você é responsável por:</p>
        <ul>
          <li>manter sua senha em sigilo;</li>
          <li>não compartilhar suas credenciais;</li>
          <li>manter acesso ao endereço de e-mail associado à conta;</li>
          <li>informar dados corretos;</li>
          <li>revisar as sessões ativas;</li>
          <li>comunicar suspeitas de acesso não autorizado;</li>
          <li>respeitar estes Termos e a legislação.</li>
        </ul>
        <p>
          Uma conta deve ser utilizada por uma única pessoa. Não venda, alugue, transfira ou
          compartilhe o acesso.
        </p>
        <p>
          Se suspeitar de acesso indevido, altere imediatamente a senha e encerre as sessões
          desconhecidas.
        </p>
        <p>
          A Cinerie nunca solicitará sua senha completa por e-mail, mensagem ou atendimento.
        </p>

        <h3>Idade mínima</h3>
        <p>
          A criação e utilização de uma conta Cinerie são permitidas somente para pessoas com 18 anos
          completos ou mais.
        </p>
        <p>
          Não há uma caixa de seleção separada para a idade no cadastro. Ao marcar o aceite destes
          Termos e da Política de Privacidade — obrigatório para criar conta — você declara possuir
          18 anos completos ou mais.
        </p>
        <p>
          A Cinerie não oferece contas para menores de idade nem possui, na configuração atual, um
          sistema para obtenção ou verificação de autorização de pais ou responsáveis.
        </p>
        <p>
          Contas identificadas como pertencentes a menores de 18 anos poderão ser bloqueadas e
          encerradas conforme a <a href={PRIVACY_PATH}>Política de Privacidade</a>.
        </p>
        <p>
          A consulta ao catálogo público continuará disponível sem conta, mas cada usuário ou
          responsável deverá observar a classificação indicativa das obras e a adequação do conteúdo
          à respectiva idade.
        </p>

        <h2>3. Conduta</h2>
        <p>Ao usar a Cinerie, você concorda em não:</p>
        <ul>
          <li>
            publicar conteúdo ilegal, ofensivo, discriminatório, que incite violência ou que viole
            direito de terceiro;
          </li>
          <li>
            usar o serviço para divulgar pirataria — links de download não autorizado, streaming
            irregular, IPTV clandestino ou similares;
          </li>
          <li>
            tentar burlar mecanismos de segurança, autenticação, limites de uso ou controles de
            acesso;
          </li>
          <li>
            coletar dados de forma automatizada (raspagem, robôs, mineração) sem autorização prévia,
            nem sobrecarregar a infraestrutura;
          </li>
          <li>usar a conta de outra pessoa, ou se passar por outra pessoa ou organização;</li>
          <li>
            reproduzir, revender ou redistribuir o conteúdo do catálogo como se fosse uma base
            própria.
          </li>
        </ul>
        <p>
          Descumprir estas regras pode levar à suspensão ou ao encerramento da conta, conforme o item
          7.
        </p>

        <h2>4. Propriedade intelectual</h2>

        <h3>4.1 Conteúdo da Cinerie</h3>
        <p>
          O texto editorial, as análises, a curadoria, a marca, o design e o código da Cinerie são
          protegidos por direito autoral e demais leis aplicáveis. Você pode ler, citar com
          atribuição e compartilhar links. Não pode copiar em massa nem republicar o conteúdo
          editorial como se fosse seu.
        </p>

        <h3>4.2 Dados e atribuição ao TMDB</h3>
        <p>
          Parte das informações de catálogo, como títulos, sinopses, datas, fichas, créditos, elenco,
          pôsteres e imagens, é obtida por meio do TMDB — The Movie Database.
        </p>
        <p>
          As imagens são carregadas diretamente dos servidores de imagens do TMDB. A utilização
          dessas imagens está sujeita aos direitos dos respectivos titulares e às condições
          aplicáveis ao uso da API do TMDB.
        </p>
        <p>
          A Cinerie apresentará o logotipo oficial do TMDB em sua área de créditos e o seguinte
          aviso:
        </p>
        <p>
          <em>
            &quot;Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.&quot;
          </em>
        </p>
        <p>
          O logotipo do TMDB será apresentado de forma menos proeminente que a marca Cinerie e não
          será alterado de maneira incompatível com as regras de identidade do fornecedor.
        </p>
        <p>
          O uso da Cinerie não transfere ao usuário qualquer licença sobre a base do TMDB, imagens,
          marcas ou materiais de terceiros.
        </p>

        <h3>4.3 Obras, cartazes e marcas de terceiros</h3>
        <p>
          Títulos, cartazes, imagens promocionais, logotipos de estúdios e de plataformas pertencem
          a seus titulares. Aparecem aqui para identificar as obras e informar o público. A Cinerie
          não reivindica direito sobre esse material e não é endossada por esses titulares.
        </p>

        <h3>4.4 Notas de fontes externas</h3>
        <p>
          Quando exibimos nota de uma fonte externa, ela aparece sempre identificada, na escala
          original daquela fonte e com o crédito devido. Nunca convertemos a nota de uma fonte para
          o formato de outra e nunca apresentamos nota de terceiro como se fosse nota da Cinerie.
        </p>

        <h2>5. Conteúdo que você cria</h2>
        <p>
          Listas, anotações de item, notas atribuídas a obras e demais registros que você cria
          continuam <strong>seus</strong>. Não reivindicamos propriedade sobre eles.
        </p>
        <ul>
          <li>
            Você nos concede apenas a licença necessária para armazenar e exibir esse conteúdo dentro
            do serviço, na visibilidade que você escolher.
          </li>
          <li>
            <strong>Tudo nasce privado.</strong> Listas e estado de acompanhamento só se tornam
            visíveis para outras pessoas se você mudar a visibilidade.
          </li>
          <li>
            Ao tornar algo público, você declara ter o direito de fazê-lo e assume a
            responsabilidade pelo conteúdo.
          </li>
          <li>
            Podemos remover conteúdo público que viole estes Termos ou a lei, mediante denúncia ou
            constatação própria.
          </li>
          <li>
            Você pode apagar seu conteúdo a qualquer momento, e a exportação em{' '}
            <a href="/pt/conta/privacidade/">Privacidade e meus dados</a> devolve uma cópia dele.
          </li>
        </ul>

        <h2>6. Disponibilidade e ausência de garantia</h2>
        <p>
          O serviço é oferecido <strong>&quot;no estado em que se encontra&quot;</strong>. Fazemos um
          esforço honesto para manter tudo no ar e correto, mas não garantimos:
        </p>
        <ul>
          <li>funcionamento ininterrupto ou livre de erros;</li>
          <li>
            exatidão, atualidade ou completude das informações de catálogo — boa parte vem de fontes
            externas e pode conter erro, atraso ou lacuna;
          </li>
          <li>
            que a informação de &quot;onde assistir&quot; esteja atualizada: catálogos de
            plataformas mudam sem aviso, e a data da última verificação é exibida junto ao dado;
          </li>
          <li>
            que qualquer função continue existindo — o produto está em evolução e funções podem
            mudar ou ser descontinuadas.
          </li>
        </ul>
        <p>
          Podemos alterar, suspender ou encerrar o serviço, no todo ou em parte. Se o encerramento
          for definitivo, avisaremos com antecedência razoável para que você exporte seus dados.
        </p>

        <h2>7. Encerramento</h2>
        <p>
          <strong>Por você:</strong> a qualquer momento, em{' '}
          <a href="/pt/conta/privacidade/">Privacidade e meus dados</a> → Encerrar minha conta. É
          preciso confirmar com a senha. Há um prazo de arrependimento de 30 dias antes da
          anonimização definitiva — o procedimento completo está no item 8.4 da{' '}
          <a href={PRIVACY_PATH}>Política de Privacidade</a>.
        </p>
        <p>
          <strong>Por nós:</strong> podemos suspender ou encerrar uma conta que viole estes Termos ou
          a lei, ou que coloque em risco o serviço ou outras pessoas. Sempre que possível, avisamos
          antes e indicamos o motivo. Em caso de violação grave ou ilegalidade, o encerramento pode
          ser imediato.
        </p>
        <p>
          O encerramento não afeta obrigações já constituídas nem apaga registros que precisamos
          manter por obrigação legal (ver item 7 da Política de Privacidade).
        </p>

        <h2>8. Limitação de responsabilidade</h2>
        <p>
          Na máxima extensão permitida pela lei brasileira, a Cinerie não responde por danos
          indiretos, lucros cessantes, perda de dados ou prejuízos decorrentes de:
        </p>
        <ul>
          <li>indisponibilidade, interrupção ou falha técnica do serviço;</li>
          <li>
            imprecisão de informação de catálogo obtida de fontes externas, inclusive disponibilidade
            em plataformas de streaming;
          </li>
          <li>
            decisões que você tome com base nas informações do site — incluindo assinar ou cancelar
            um serviço de terceiro;
          </li>
          <li>conteúdo publicado por outros usuários;</li>
          <li>acesso não autorizado à sua conta por descuido com as suas credenciais.</li>
        </ul>
        <p>
          Nada nestes Termos afasta direitos que a lei brasileira garante de forma inafastável,
          especialmente os do Código de Defesa do Consumidor. Como o serviço é gratuito, não há
          contrapartida financeira a ser reembolsada.
        </p>

        <h2>9. Links para serviços de terceiros</h2>
        <p>
          A Cinerie pode indicar plataformas oficiais onde uma obra está disponível. Esses serviços
          são independentes, com termos e políticas próprios. Não controlamos preço, catálogo,
          disponibilidade nem qualidade deles, e não respondemos por eles.
        </p>

        <h2>10. Alterações destes Termos</h2>
        <p>
          Estes Termos entram em vigor em 4 de agosto de 2026 e correspondem à versão 2026-08.
        </p>
        <p>Alterações relevantes terão:</p>
        <ul>
          <li>nova identificação de versão;</li>
          <li>nova data de vigência;</li>
          <li>aviso na conta ou por e-mail;</li>
          <li>descrição das principais mudanças;</li>
          <li>solicitação de novo aceite quando necessário.</li>
        </ul>
        <p>
          Caso não concorde com a nova versão, você poderá exportar seus dados e encerrar a conta.
        </p>

        <h2>11. Lei aplicável e foro</h2>
        <p>
          Estes Termos são regidos pela legislação brasileira, incluindo, conforme aplicável:
        </p>
        <ul>
          <li>Lei nº 12.965/2014 — Marco Civil da Internet;</li>
          <li>Lei nº 13.709/2018 — Lei Geral de Proteção de Dados Pessoais;</li>
          <li>Lei nº 8.078/1990 — Código de Defesa do Consumidor;</li>
          <li>Lei nº 9.610/1998 — Lei de Direitos Autorais;</li>
          <li>Lei nº 8.069/1990 — Estatuto da Criança e do Adolescente;</li>
          <li>Lei nº 15.211/2025 — Estatuto Digital da Criança e do Adolescente.</li>
        </ul>
        <p>
          Para controvérsias que não possam ser resolvidas diretamente, fica eleito o foro da comarca
          de Aparecida de Goiânia, Goiás.
        </p>
        <p>
          Essa escolha não impede que o consumidor utilize o foro de seu próprio domicílio ou outra
          competência obrigatoriamente estabelecida pela legislação.
        </p>

        <h2>12. Contato</h2>
        <p>
          Dúvidas gerais sobre estes Termos poderão ser enviadas para:{' '}
          <strong>contato@cinerie.com</strong>
        </p>
        <p>
          Questões relacionadas a dados pessoais, privacidade ou exercício de direitos deverão ser
          enviadas para: <strong>privacidade@cinerie.com</strong>
        </p>
        <p>O responsável pela Cinerie é:</p>
        <p>
          Pablo Eduardo Gameleira
          <br />
          Nome fantasia: Grupo Maquina Nerd
          <br />
          CNPJ: 22.739.386/0001-90
          <br />
          Sede: Aparecida de Goiânia, Goiás
        </p>
        <p>
          Os dados do controlador e o canal específico de privacidade também constam do item 1 da{' '}
          <a href={PRIVACY_PATH}>Política de Privacidade</a>.
        </p>
      </LegalDoc>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </>
  )
}
