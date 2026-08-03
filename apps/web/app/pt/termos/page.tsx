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
 * Termos de Uso.
 *
 * RASCUNHO TÉCNICO: descreve o serviço como ele existe hoje. Onde uma função
 * ainda não está disponível, o texto diz isso em vez de prometer. Precisa de
 * revisão jurídica antes de ir ao ar.
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
      <LegalDoc breadcrumbLabel="Termos de Uso" effectiveDate={null} title={TITLE}>
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
        <ul>
          <li>
            Para criar conta você precisa de um endereço de e-mail válido e de uma senha com{' '}
            <strong>no mínimo 10 caracteres</strong>. O nome de exibição é opcional.
          </li>
          <li>
            Enviamos um link de verificação para o e-mail informado. Algumas funções podem depender
            dessa confirmação — publicar uma lista, por exemplo, exige conta verificada.
          </li>
          <li>
            Você é responsável por manter sua senha em sigilo e por tudo que acontecer na sua conta.
            Se suspeitar de acesso indevido, troque a senha: isso encerra as demais sessões.
          </li>
          <li>Uma conta pertence a uma pessoa. Não compartilhe credenciais.</li>
          <li>
            Idade mínima: <Fill>idade mínima, ex.: 16 anos</Fill>. Não verificamos idade no cadastro
            — ver o item 9 da <a href={PRIVACY_PATH}>Política de Privacidade</a>.
          </li>
        </ul>

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

        <h3>4.2 Dados de catálogo e atribuição ao TMDB</h3>
        <p>
          Parte das informações de catálogo — fichas, elenco, datas, pôsteres e imagens — vem do
          TMDB (The Movie Database), usado sob os termos da API deles. A atribuição exigida aparece
          no rodapé de todas as páginas:
        </p>
        <p>
          <em>
            &quot;Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.&quot;
          </em>
        </p>
        <p>
          Esses dados pertencem ao TMDB e a seus respectivos titulares, não à Cinerie. Nenhuma
          licença sobre eles é transferida a você pelo uso do serviço.
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
          Podemos alterar estes Termos. Mudança relevante é publicada aqui com nova data de vigência
          e nova identificação de versão, e a tela de privacidade passa a pedir seu aceite outra vez.
          Continuar usando o serviço depois disso significa concordar com a versão nova. Se não
          concordar, encerre a conta (item 7).
        </p>
        <p>A versão e a data de vigência destes Termos estão no topo desta página.</p>

        <h2>11. Lei aplicável e foro</h2>
        <p>
          Estes Termos são regidos pela lei brasileira, em especial o Marco Civil da Internet (Lei
          12.965/2014), a Lei Geral de Proteção de Dados (Lei 13.709/2018) e, quando aplicável, o
          Código de Defesa do Consumidor.
        </p>
        <p>
          Fica eleito o foro da comarca de <Fill>comarca do foro eleito</Fill> para dirimir
          controvérsias, ressalvado o direito do consumidor de acionar o foro do seu domicílio.
        </p>

        <h2>12. Contato</h2>
        <p>
          Dúvidas sobre estes Termos: <Fill>e-mail de contato</Fill>. Dados do controlador e canal
          específico de privacidade estão no item 1 da{' '}
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
