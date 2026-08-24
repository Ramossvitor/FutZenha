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
  RECARGA_EXPIRA_MINUTOS,
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
import { ValoresDaZenha } from "./valores-da-zenha";

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
        Há uma exceção à conta acima, e ela é sua: quem arma o{" "}
        <strong className="text-fg">multiplicador</strong> num fut faz a nota daquele fut andar
        mais — nos dois sentidos. O histórico marca quais futs foram assim. Ver{" "}
        <a href="#o-multiplicador" className="text-accent-ink hover:underline">
          O multiplicador
        </a>
        .
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

  "as-zenhas": (
    <>
      <p>
        A <strong className="text-fg">zenha</strong> é a moeda do FutZenha. Ela se ganha
        jogando e participando, e se gasta na loja — em{" "}
        <strong className="text-fg">badges</strong> para a sua vitrine (cabem cinco no perfil, e
        um deles anda junto do seu nome no ranking e na escalação), na moldura do seu avatar, na
        cor do seu nome, num título e no multiplicador.
      </p>
      <p>
        Jogando, são quatro formas de ganhar, e só quatro (comprar por Pix existe também — é o
        capítulo &ldquo;A recarga&rdquo;):
      </p>
      <ValoresDaZenha />
      <p>
        A <strong className="text-fg">participação</strong> é o pacote: entrar em campo,
        avaliar os companheiros e votar no melhor em campo. As três coisas, uma zenha só. Se
        não houver em quem votar, o voto é dispensado — e quem caiu num lado pequeno demais
        para avaliar (menos de {MIN_GRUPO_AVALIACAO} com conta) recebe do mesmo jeito: o app
        não convocou, então não cobra.
      </p>
      <p>
        A <strong className="text-fg">nota</strong> paga quando sobe, e paga proporcional ao
        quanto subiu. <strong className="text-fg">Nota que cai não tira zenha nenhuma</strong>{" "}
        — ela só não rende essa parte. Nada aqui desconta do seu saldo: a única linha negativa
        do extrato é uma compra sua.
      </p>
      <Banner tom="aviso">
        Gol e vitória não pagam. Placar e gols continuam corrigíveis por{" "}
        {JANELA_CORRECAO_HORAS}h depois do encerramento, e pagar por número que ainda muda
        seria pagar por engano.
      </Banner>
      <p>
        <strong className="text-fg">A zenha cai quando a avaliação fecha</strong> — e a
        avaliação fecha no instante em que o último companheiro avalia, ou quando as{" "}
        {PRAZO_AVALIACAO_HORAS}h do prazo vencem, o que vier primeiro. É o primeiro momento
        em que as quatro fontes existem ao mesmo tempo: antes disso não há nota nem melhor em
        campo para pagar. Quando cair, chega um aviso com o total.
      </p>
      <p>
        Ou seja: avaliar rápido não adianta só para você.{" "}
        <strong className="text-fg">Quando todo mundo avalia, todo mundo recebe na hora</strong>{" "}
        — e quem enrola segura o pagamento do grupo inteiro até o prazo estourar.
      </p>
      <p>
        Faltou? A sequência quebra e a contagem recomeça. Ficar na lista de espera{" "}
        <strong className="text-fg">não</strong> quebra: você quis ir e não coube, e isso não
        é falta sua.
      </p>
    </>
  ),

  "o-multiplicador": (
    <>
      <p>
        O multiplicador é o único item da loja que mexe no jogo. Ele{" "}
        <strong className="text-fg">amplia o movimento da sua nota num fut</strong> — para cima
        e para baixo.
      </p>
      <Card>
        <CardHeader>
          <Eyebrow>o trato</Eyebrow>
        </CardHeader>
        <CardBody>
          <p className="text-[13px] text-fg-3">
            Jogou bem e a nota ia subir 0,3? Sobe mais. Jogou mal e ela ia cair? Cai mais
            também.
          </p>
        </CardBody>
      </Card>
      <p>
        Como a zenha da nota é proporcional ao quanto ela subiu, o ganho vem ampliado junto — e
        é por isso que o item se paga nas noites boas. Nas ruins, você fica com a queda maior e
        sem a zenha da nota. É uma aposta, e é para ser.
      </p>
      <Banner tom="aviso">
        <strong className="text-fg">Só vale se você armar antes de a bola rolar.</strong> Depois
        do horário de início o botão some — e desarmar também deixa de valer. Sem isso, daria
        para esperar o fut acabar, ver como foi, e só então decidir se aposta.
      </Banner>
      <p>
        Armar é escolher em qual fut o item vale, na página daquele fut. Um por fut, e ele não
        empilha. Se o fut for adiado, seu arme continua de pé; se for antecipado para antes de
        você ter armado, o item volta para o inventário.
      </p>
      <p>
        O item também volta se você não entrar em campo, se o fut encerrar sem avaliação, se
        ninguém te avaliar, ou se o fut for apagado. Você só gasta o multiplicador quando ele
        realmente tem uma nota para multiplicar.
      </p>
      <p>
        Enquanto a avaliação está aberta, <strong className="text-fg">ninguém vê</strong> que
        você armou — nem quantas pessoas armaram. Saber de quem a nota vai andar mais rápido é
        exatamente o tipo de pressão que a avaliação secreta existe para tirar da mesa. Depois
        que a rodada fecha, o histórico da sua nota mostra o selo naquele fut: a nota é o que os
        companheiros acharam de você, e acelerá-la com moeda não pode acontecer escondido.
      </p>
    </>
  ),

  "a-recarga": (
    <>
      <p>
        Além de ganhar zenha jogando, dá para{" "}
        <strong className="text-fg">comprar zenhas por Pix</strong>, em &ldquo;Minhas
        zenhas&rdquo;. Você escolhe um pacote, o app gera um código Pix que vale por{" "}
        {RECARGA_EXPIRA_MINUTOS} minutos, e o saldo sobe sozinho assim que o pagamento cai —
        normalmente em segundos, com um aviso junto.
      </p>
      <p>
        Zenha comprada é <strong className="text-fg">igualzinha à ganhada em campo</strong>:
        gasta na loja, aparece no mesmo extrato, e vale as mesmas regras. A escada de preço do
        multiplicador continua subindo a cada compra do mês — ter saldo não muda isso.
      </p>
      <Banner tom="aviso">
        <strong className="text-fg">Zenha não vira dinheiro de volta.</strong> Não existe
        saque, transferência entre jogadores nem estorno de saldo — o caminho é de mão única,
        como o extrato inteiro. Pagou por engano? Fale com o admin da plataforma em até 7
        dias, <strong className="text-fg">antes de gastar</strong>: com o saldo intacto, o
        reembolso do Pix é resolvido na mão.
      </Banner>
      <p>
        O código expirou sem pagar? Nada foi cobrado — é só gerar outro. E se o Pix cair no
        último instante, o crédito entra do mesmo jeito, alguns minutos depois: pagamento
        confirmado não se perde.
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
      <p>
        <strong className="text-fg">Trocou de time no meio?</strong> Acontece — alguém sai
        machucado, o time fica desfalcado, chega gente. Na escalação do painel, cada nome tem o
        botão de passar para o outro lado, e a partir dali a pessoa marca pelo time novo. Os
        gols que ela já tinha feito continuam do time em que saíram, e todos contam na
        artilharia dela. Já a vitória, a derrota e a lista de quem ela avalia (e de quem a
        avalia) contam o time em que ela <strong className="text-fg">terminou</strong> o jogo. A
        troca também vale para o colete nos jogos seguintes.
      </p>
      <Banner tom="aviso">
        Quem administra pode passar a súmula para alguém que está jogando. Essa pessoa ganha
        só a súmula — abrir jogo, lançar e desfazer gol, e trocar jogador de lado. Não ganha a
        lista, o sorteio, nem o encerramento. E perde a súmula na hora se sair da lista do fut.
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
      <Banner tom="aviso">
        A contestação corrige a <strong className="text-fg">nota</strong>, nunca a{" "}
        <strong className="text-fg">zenha</strong>. A zenha do fut já foi paga quando a
        avaliação fechou, e nada no extrato é desfeito: ninguém perde saldo por uma
        contestação, e ninguém ganha a diferença por causa dela.
      </Banner>
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
