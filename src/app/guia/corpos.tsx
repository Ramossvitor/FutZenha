import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import { Estrelas } from "@/components/ui/estrelas";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { StatGrid, StatTile } from "@/components/ui/stat";
import { formatMeias, formatPercent, formatSkill } from "@/lib/format";
import { MIN_GRUPO_AVALIACAO } from "@/lib/lineup";
import { MIN_VOTOS_PARA_MVP } from "@/lib/mvp";
import {
  JANELA_CORRECAO_HORAS,
  MIN_AVALIACOES_PARA_DENUNCIAR,
  MIN_JOGOS_APROVEITAMENTO,
  PRAZO_ADMIN_HORAS,
  PRAZO_AVALIACAO_HORAS,
  PRAZO_DENUNCIA_HORAS,
  TIMES_MAX,
  TIMES_MIN,
  VALIDADE_CONVITE_DIAS,
} from "@/lib/regras";
import {
  MEIAS_MAX,
  MEIAS_MIN,
  PESO_RODADA_DEN,
  PESO_RODADA_NUM,
  SKILL_INICIAL_CENT,
  SKILL_MAX_CENT,
  SKILL_MIN_CENT,
} from "@/lib/skill";
import { PRAZO_ABERTURA_EXCLUSAO_HORAS, PRAZO_VOTACAO_HORAS, QUORUM } from "@/lib/votacao";
import type { IdDeCapitulo } from "./capitulos";

// A nota é guardada em centésimos (500 = 5,0). Exibir sem dividir escreveria
// "começa em 500".
const NOTA_INICIAL = formatSkill(SKILL_INICIAL_CENT / 100);
const NOTA_MIN = formatSkill(SKILL_MIN_CENT / 100);
const NOTA_MAX = formatSkill(SKILL_MAX_CENT / 100);

// O peso do que a pessoa já era — o lado oposto ao da rodada na mesma fração.
// Com PESO_RODADA 1/3, é o "2" de "(2 × atual + recebida) ÷ 3". Derivado, e não
// escrito à mão: interpolar só o denominador seria pior que não interpolar
// nada, porque a linha continuaria parecendo autoridade depois de meia
// atualização.
const PESO_ATUAL = PESO_RODADA_DEN - PESO_RODADA_NUM;

// O exemplo do capítulo "a nota": quem está na nota inicial e recebe a nota
// cheia de todo mundo. É a média ponderada crua — o clamp e o destravarExtremo
// do skill.ts só entram nas pontas da escala, e este caso não chega lá.
const EXEMPLO_NOTA_CHEIA = formatSkill(
  (PESO_ATUAL * SKILL_INICIAL_CENT + PESO_RODADA_NUM * MEIAS_MAX * 100) / (PESO_RODADA_DEN * 100),
);

// "0,5 a 5" — as pontas da régua do voto, na unidade da tela.
const ESCALA_DO_VOTO = `${formatMeias(MEIAS_MIN)} a ${formatMeias(MEIAS_MAX)}`;

export const CORPOS: Record<IdDeCapitulo, ReactNode> = {
  "como-funciona": (
    <>
      <p>
        O FutZenha cuida do fut de ponta a ponta: quem vai, quem joga com quem, quem fez gol
        e o quanto cada um jogou. O ciclo é sempre o mesmo.
      </p>
      <HairlineList as="ol">
        <HairlineRow as="li">
          <strong className="text-fg">Alguém marca o fut.</strong> Dia, hora, local e, se
          quiser, um limite de vagas.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">O pessoal confirma.</strong> Vou ou Fora. Se lotar,
          quem chega depois entra na espera.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Os times saem e a bola rola.</strong> O sorteio
          equilibra pela nota, e os gols entram na súmula.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">O fut é encerrado.</strong> Abre a avaliação: você dá
          estrelas a quem jogou do seu lado e vota no melhor em campo.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Os números entram nos rankings.</strong> Nota,
          artilharia, aproveitamento, presença e MVP.
        </HairlineRow>
      </HairlineList>
      <p>Cada um desses passos tem regra própria — é o que vem a seguir.</p>
    </>
  ),

  "a-lista": (
    <>
      <p>
        Marcado o fut, é só dizer <strong className="text-fg">Vou</strong> ou{" "}
        <strong className="text-fg">Fora</strong>. A lista segue ordem de chegada: quem
        confirma primeiro fica na frente.
      </p>
      <p>
        <strong className="text-fg">Se o fut tem vaga limitada</strong>, quem confirma depois
        de lotar entra na lista de espera. E a espera anda sozinha: quando alguém que estava
        dentro cai fora, o primeiro da espera sobe na hora e recebe um aviso.
      </p>
      <Banner tom="aviso">
        Desistir custa o lugar na fila. Se você marcar Fora e voltar atrás depois, você entra
        no fim da lista — não na posição que tinha.
      </Banner>
      <p>
        <strong className="text-fg">A lista trava no sorteio.</strong> Depois que os times
        saem, ninguém entra nem sai sozinho: quem organiza é que ajusta, porque mexer na
        lista depois do sorteio é mexer nos times.
      </p>
    </>
  ),

  "os-times": (
    <>
      <p>
        O sorteio não é aleatório — ele tenta deixar os lados parelhos usando a nota de cada
        um. De <strong className="text-fg">{TIMES_MIN} a {TIMES_MAX} times</strong>, à
        escolha de quem organiza.
      </p>
      <p>
        <strong className="text-fg">Goleiro primeiro.</strong> Quem está marcado como goleiro
        é distribuído um por time. Sobrando goleiro, ele entra como jogador de linha.
      </p>
      <p>
        <strong className="text-fg">Depois a linha, do mais bem avaliado para o menos.</strong>{" "}
        Cada jogador vai para o time que estiver com a menor soma de notas naquele momento. É
        o que impede um time de juntar todas as notas altas.
      </p>
      <p>
        Os times saem do mesmo tamanho, com diferença de no máximo um jogador. Depois do
        sorteio, quem organiza ainda pode trocar dois jogadores de lado na mão.
      </p>
    </>
  ),

  "a-avaliacao": (
    <>
      <p>
        Encerrado o fut, abre a avaliação — e você avalia{" "}
        <strong className="text-fg">quem jogou do seu lado</strong>, não o fut inteiro. Se
        você dividiu o time com a mesma pessoa em três jogos, avalia ela uma vez só.
      </p>
      <StatGrid>
        <StatTile label="prazo" valor={`${PRAZO_AVALIACAO_HORAS}h`} nota="a partir do encerramento" />
        <StatTile label="escala" valor={ESCALA_DO_VOTO} nota="estrelas, de meia em meia" />
        <StatTile label="mínimo do lado" valor={MIN_GRUPO_AVALIACAO} nota="contas ativas" />
      </StatGrid>
      <p>
        <strong className="text-fg">É tudo ou nada.</strong> Faltou a estrela de um
        companheiro, nada é salvo. O voto de melhor em campo vai no mesmo pacote.
      </p>
      <p>
        <strong className="text-fg">Dá para mudar de ideia</strong> enquanto o prazo não
        vence: é só enviar de novo. Se todo mundo avaliar antes da hora, a rodada fecha na
        hora — ninguém fica esperando o relógio à toa.
      </p>
      <Banner tom="aviso">
        Ninguém nunca vê quem deu qual nota. Você enxerga as estrelas que recebeu, mas não de
        quem — e isso vale também para quem organiza e para quem administra a plataforma.
      </Banner>
      <p>
        Um lado só gera avaliação se tiver ao menos {MIN_GRUPO_AVALIACAO} pessoas com conta
        ativa. Com menos que isso, a nota seria o gosto de uma pessoa só. E a conta é por
        lado: um time pode avaliar mesmo que o outro não tenha gente suficiente.
      </p>
    </>
  ),

  "a-nota": (
    <>
      <p>
        Todo mundo começa em <strong className="text-fg">{NOTA_INICIAL}</strong>. A partir
        daí ela sobe e desce com o que os companheiros de time acharam do seu jogo — e só com
        isso. Gol não mexe na nota, vitória não mexe na nota.
      </p>
      <p>
        <strong className="text-fg">
          Um fut pesa {PESO_RODADA_NUM}/{PESO_RODADA_DEN} da sua nota.
        </strong>{" "}
        Quando a avaliação de um fut é apurada, a conta é a média das estrelas que você
        recebeu contra os outros {PESO_ATUAL}/{PESO_RODADA_DEN}, que são o que você já era:
      </p>
      <Card>
        <CardHeader>
          <Eyebrow>a conta</Eyebrow>
        </CardHeader>
        <CardBody>
          <p className="text-[13px] text-fg-3">
            nota nova = ({PESO_ATUAL} × nota atual + {PESO_RODADA_NUM} × média recebida) ÷{" "}
            {PESO_RODADA_DEN}
          </p>
        </CardBody>
      </Card>
      <p>
        Uma noite ruim não te derruba, e uma noite ótima não te promove sozinha — precisa
        repetir. Estando em {NOTA_INICIAL} e recebendo <Estrelas meias={MEIAS_MAX} /> de três
        companheiros, sua nota vai para {EXEMPLO_NOTA_CHEIA}, não para {NOTA_MAX}.
      </p>
      <p>
        <strong className="text-fg">A escala vai de {NOTA_MIN} a {NOTA_MAX}.</strong> Os dois
        extremos são alcançáveis, mas só com unanimidade repetida por vários futs. E eles não
        grudam: um único quatro estrelas no meio dos cinco já traz a nota para baixo do teto.
      </p>
      <p>
        <strong className="text-fg">A nota é sempre recalculada do zero.</strong> O app não
        guarda “quanto subiu” — ele refaz a conta desde {NOTA_INICIAL}, na ordem dos futs,
        toda vez. É por isso que uma avaliação descartada hoje conserta aquele fut e todos os
        seguintes de uma vez só.
      </p>
      <p>
        <strong className="text-fg">A nota é sua, não do grupo.</strong> O ranking de um
        grupo mostra quem jogou ali, mas a nota que aparece é a mesma em todo lugar. Não
        existe “nota no grupo do sábado”.
      </p>
      <Banner tom="aviso">
        Quem ainda não resgatou o convite joga normalmente, mas não recebe nota. Ao entrar,
        começa em {NOTA_INICIAL} como todo mundo — não há avaliação retroativa.
      </Banner>
    </>
  ),

  "o-mvp": (
    <>
      <p>
        Junto com as estrelas, cada pessoa que avalia dá{" "}
        <strong className="text-fg">um voto de melhor em campo</strong>. Aqui você não fica
        preso ao seu lado: dá para votar em quem jogou dos dois times — menos em você mesmo.
      </p>
      <p>
        <strong className="text-fg">
          O resultado só sai com {MIN_VOTOS_PARA_MVP} votos ou mais.
        </strong>{" "}
        Com um voto só, o título seria a opinião de uma pessoa identificável — e o sigilo da
        avaliação iria junto.
      </p>
      <p>
        <strong className="text-fg">Empatou?</strong> Ganha quem teve a melhor média de
        estrelas naquela mesma rodada. Se ainda assim persistir, o título é dividido e conta
        inteiro para cada um no ranking.
      </p>
      <p>A apuração sai no momento em que a avaliação fecha. Fut sem voto nenhum fica sem MVP.</p>
    </>
  ),

  "os-rankings": (
    <>
      <p>
        São cinco listas, e todas obedecem a duas regras: só entram{" "}
        <strong className="text-fg">futs já encerrados</strong> e só aparece{" "}
        <strong className="text-fg">quem tem conta ativa</strong>.
      </p>
      <HairlineList as="ul">
        <HairlineRow as="li">
          <strong className="text-fg">Notas</strong> — da maior para a menor. É a única sem
          filtro de ano: a nota é estado atual, não temporada.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Artilharia</strong> — total de gols.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Aproveitamento</strong> — vitória vale tudo, empate vale
          metade. Precisa de {MIN_JOGOS_APROVEITAMENTO} jogos para entrar.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Presença</strong> — em quantos futs encerrados você
          esteve na lista.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">MVP</strong> — títulos de melhor em campo. Só existe
          dentro de um grupo.
        </HairlineRow>
      </HairlineList>
      <Banner tom="aviso">
        Gol sem autor — o gol contra e o “ninguém viu quem foi” — conta no placar, mas não
        entra na artilharia de ninguém.
      </Banner>
      <p>
        Dentro de um grupo, os números são só dos futs daquele grupo. A nota é a exceção:
        ela é sempre a global.
      </p>
    </>
  ),

  "sua-conta": (
    <>
      <p>
        <strong className="text-fg">Não tem cadastro aberto.</strong> Quem entra no FutZenha
        foi convidado por quem organiza o fut, e o convite vale{" "}
        {VALIDADE_CONVITE_DIAS} dias.
      </p>
      <p>
        Dá para jogar sem conta: quem organiza te coloca na lista, você entra em campo, marca
        gol e conta presença normalmente.{" "}
        <strong className="text-fg">
          O que não acontece é avaliação — nem dar, nem receber
        </strong>{" "}
        — e sem avaliação você não aparece nos rankings.
      </p>
      <p>
        Ao resgatar o convite, o histórico que já estava lá passa a contar de uma vez: gols,
        vitórias, presenças. A nota é que começa do começo, em {NOTA_INICIAL} — não há como
        avaliar um fut que já passou.
      </p>
      <p>Perdeu o acesso? Quem administra gera um link novo.</p>
    </>
  ),

  "os-avisos": (
    <>
      <p>
        O sino no topo guarda o que aconteceu enquanto você não estava olhando. Chega aviso
        quando:
      </p>
      <HairlineList as="ul">
        <HairlineRow as="li">um fut novo é marcado;</HairlineRow>
        <HairlineRow as="li">os times são sorteados;</HairlineRow>
        <HairlineRow as="li">
          é véspera de fut e você ainda não disse se vai;
        </HairlineRow>
        <HairlineRow as="li">abre uma vaga e você sobe da lista de espera;</HairlineRow>
        <HairlineRow as="li">alguém te coloca na lista de um fut;</HairlineRow>
        <HairlineRow as="li">a avaliação de um fut que você jogou abre;</HairlineRow>
        <HairlineRow as="li">sua nota muda, seja por apuração ou por revisão;</HairlineRow>
        <HairlineRow as="li">você é eleito melhor em campo;</HairlineRow>
        <HairlineRow as="li">
          há convite de grupo, pedido de entrada ou votação para apagar um fut.
        </HairlineRow>
      </HairlineList>
      <p>
        Instalando o FutZenha na tela de início do celular, os mesmos avisos chegam como
        notificação — dá para não depender de abrir o app para saber que a avaliação abriu.
      </p>
    </>
  ),

  "marcar-um-fut": (
    <>
      <p>
        <strong className="text-fg">Quem marca o fut administra aquele fut.</strong> É quem
        cuida da lista, sorteia os times, lança placar e encerra. Dentro de um grupo, marcar
        fut é coisa de quem administra ou organiza o grupo.
      </p>
      <p>
        Além de dia, hora e local, dá para definir{" "}
        <strong className="text-fg">um limite de vagas</strong>. Com limite, quem passa do
        número entra na espera; aumentando o limite depois, a espera sobe em ordem
        automaticamente.
      </p>
      <p>
        <strong className="text-fg">Chegou gente de última hora?</strong> Quem administra o
        fut coloca a pessoa na lista, mesmo depois do sorteio. Quem é incluído por outra
        pessoa sempre recebe um aviso — ninguém é escalado sem saber.
      </p>
      <p>
        E se a pessoa nem conta tem, dá para cadastrar ali mesmo, direto do fut: ela já entra
        na lista e recebe um convite para criar a conta depois.
      </p>
      <p>O grupo de um fut é escolhido na criação e não muda mais.</p>
    </>
  ),

  "a-sumula": (
    <>
      <p>
        A súmula ao vivo é a tela de lançar gol com a bola rolando. Ela{" "}
        <strong className="text-fg">só existe depois do sorteio</strong> — antes disso não há
        lado para creditar o gol.
      </p>
      <p>
        <strong className="text-fg">Um jogo em andamento por vez.</strong> Abre o jogo, os
        times entram zerados, e cada toque no nome de alguém é um gol. Não sabe de quem foi,
        ou foi contra? Existe o botão de gol sem autor: o placar sobe, e a artilharia não.
      </p>
      <p>
        <strong className="text-fg">Errou?</strong> Dá para desfazer o último lançamento. Quem
        administra o fut desfaz qualquer lançamento do jogo aberto; quem só recebeu a súmula
        desfaz apenas o último do próprio lado.
      </p>
      <Banner tom="aviso">
        Quem administra pode passar a súmula para alguém que está jogando. Essa pessoa ganha
        só a súmula — abrir jogo, lançar e desfazer gol. Não ganha a lista, o sorteio, nem o
        encerramento. E perde a súmula na hora se sair da lista do fut.
      </Banner>
    </>
  ),

  encerrar: (
    <>
      <p>
        Encerrar é o que transforma o fut em números: é aí que os gols entram na artilharia,
        o V/E/D entra no aproveitamento e a avaliação abre.
      </p>
      <p>
        <strong className="text-fg">Duas coisas travam o encerramento:</strong> jogo ainda em
        andamento na súmula e jogo com um dos lados vazio. Resolva os dois e o botão libera.
      </p>
      <p>
        Quem estava na lista e não entrou em nenhum jogo é marcado como falta no mesmo ato.
        Fut sem jogo lançado não marca falta em ninguém.
      </p>
      <Banner tom="aviso">
        Não existe reabrir fut. A escalação — times, jogos e quem jogou de que lado — fica
        imutável para sempre, porque é ela que define quem avalia quem.
      </Banner>
      <p>
        <strong className="text-fg">
          Placar e gols ainda dão para corrigir por {JANELA_CORRECAO_HORAS} horas.
        </strong>{" "}
        Passada a janela, o jeito de consertar um fut errado é apagá-lo — e aí precisa de
        votação.
      </p>
    </>
  ),

  "os-grupos": (
    <>
      <p>
        Grupo é a turma que joga junto. Ele separa os rankings: dentro de um grupo, os
        números são só dos futs dele.
      </p>
      <HairlineList as="ul">
        <HairlineRow as="li">
          <strong className="text-fg">Quem administra</strong> — manda em tudo: nome,
          visibilidade, papéis, convites, quem entra e quem sai.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Quem organiza</strong> — marca futs e convida gente.
        </HairlineRow>
        <HairlineRow as="li">
          <strong className="text-fg">Quem é membro</strong> — joga e vê o ranking.
        </HairlineRow>
      </HairlineList>
      <p>
        <strong className="text-fg">Cada grupo tem uma pessoa administrando, só uma.</strong>{" "}
        Para sair do grupo, ela precisa antes passar o bastão para outra pessoa.
      </p>
      <p>
        Um grupo pode ser <strong className="text-fg">privado</strong> — só entra quem foi
        convidado — ou <strong className="text-fg">público</strong>, e aí ou a pessoa pede
        para entrar e alguém aprova, ou ela entra direto. O link de convite vale{" "}
        {VALIDADE_CONVITE_DIAS} dias, e gerar um link novo derruba o anterior.
      </p>
      <p>
        Apagar o grupo não apaga os futs dele: eles viram futs avulsos, e gols, vitórias e
        notas continuam valendo.
      </p>
    </>
  ),

  "nota-injusta": (
    <>
      <p>
        Recebeu uma estrela que não faz sentido? Dá para contestar a rodada — não a nota de
        uma pessoa, já que ninguém sabe quem deu o quê.
      </p>
      <StatGrid>
        <StatTile label="prazo" valor={`${PRAZO_DENUNCIA_HORAS}h`} nota="depois da apuração" />
        <StatTile label="mínimo recebido" valor={MIN_AVALIACOES_PARA_DENUNCIAR} nota="avaliações na rodada" />
        <StatTile label="resposta" valor={`${PRAZO_ADMIN_HORAS}h`} nota="para quem administra" />
      </StatGrid>
      <p>
        É <strong className="text-fg">uma contestação por rodada</strong>, e ela precisa de ao
        menos {MIN_AVALIACOES_PARA_DENUNCIAR} avaliações recebidas naquele fut — com uma só,
        contestar seria apontar o dedo para alguém óbvio.
      </p>
      <p>
        Quem julga é quem administra a plataforma, e{" "}
        <strong className="text-fg">nunca alguém que jogou aquele fut</strong>.
      </p>
      <Banner tom="aviso">
        O silêncio aceita. Passadas as {PRAZO_ADMIN_HORAS} horas sem resposta, a contestação é
        aceita automaticamente.
      </Banner>
      <p>
        Aceita a contestação, aquelas avaliações saem da conta e a nota é recalculada desde o
        começo — a sua e a de todo mundo que jogou com você dali em diante.
      </p>
    </>
  ),

  "apagar-um-fut": (
    <>
      <p>
        Fut encerrado não se apaga sozinho, porque os gols, o V/E/D e as avaliações dele já
        contam para todo mundo. Some só se{" "}
        <strong className="text-fg">quem jogou concordar</strong>.
      </p>
      <StatGrid>
        <StatTile label="para aprovar" valor={formatPercent(QUORUM)} nota="de quem jogou" />
        <StatTile label="prazo" valor={`${PRAZO_VOTACAO_HORAS}h`} nota="de votação" />
        <StatTile label="para pedir" valor={`${PRAZO_ABERTURA_EXCLUSAO_HORAS}h`} nota="após a contestação" />
      </StatGrid>
      <Banner tom="aviso">
        Não votar conta como contra, e o voto é definitivo. O quórum é sobre todo mundo que
        jogou — não sobre quem apareceu para votar.
      </Banner>
      <p>
        <strong className="text-fg">É uma votação por fut.</strong> Rejeitada, não se abre
        outra: o fut fica no histórico.
      </p>
      <p>
        Quem pediu a exclusão vê quantas pessoas ainda faltam votar, nunca o placar parcial —
        senão daria para descobrir o voto de alguém recarregando a tela.
      </p>
      <p>
        Aprovada, o fut sai inteiro e as notas de todo mundo são recalculadas no mesmo
        instante.
      </p>
    </>
  ),
};
