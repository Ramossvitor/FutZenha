// Conteúdo dos emails: recebem dados, devolvem {assunto, html, texto}.
//
// Família `email-*`: `email-envio.ts` é o transporte, este monta o conteúdo e
// `email-convite.ts` orquestra os dois com o banco.
//
// Módulo puro — sem `server-only`, sem drizzle, imports só relativos — porque é
// a parte que mais merece teste (escape de HTML, presença do link) e o vitest
// roda sem config e sem alias (mesmo racional de email.ts e google-oauth.ts).
//
// O HTML é o de email, não o do app: tabela única e estilo inline porque Gmail e
// afins ignoram <style> e não conhecem flexbox. As cores saem em hex direto pelo
// mesmo motivo, mas são as do tema claro de src/app/globals.css — o convite é a
// primeira coisa que a pessoa vê do produto e precisa parecer o produto. A
// versão `texto` sempre repete a URL crua — é o que sobrevive a qualquer cliente.

import { urlDeAgendaGoogle, type FutParaAgenda } from "./agenda";
import type { EmailPronto } from "./email-envio";
import { formatDate, formatHorarioPorExtenso } from "./format";
// ./resumo é puro como este arquivo — a derivação do placar mora lá, e trazê-la
// para cá seria a terceira cópia da regra do colete de cada gol.
import { linhaDePlacar, type ResumoDoFut } from "./resumo";
import { siteUrl } from "./site-url";

/**
 * O nome do jogador e o nome do grupo vêm de formulário de admin — texto livre.
 * Sem escapar, um nome como `<script>` viraria markup dentro do email.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const FONTE = "Arial, Helvetica, sans-serif";

// Espelho do tema claro de src/app/globals.css. O lime se parte em dois papéis lá
// e aqui também: ACCENT é preenchimento (com ON_ACCENT quase preto em cima) e
// ACCENT_INK é texto/link — lime puro como texto no branco dá 1,4:1.
const CANVAS = "#F4F6F2";
const SURFACE = "#FFFFFF";
const LINE = "#DCE2D6";
const FG = "#0E1310";
const FG_MUDO = "#636D66";
const ACCENT = "#B8EF2A";
const ACCENT_INK = "#457200";
const ON_ACCENT = "#0B0E0D";

/**
 * Por que este e-mail chegou. Fica no rodapé da moldura, e o padrão é o do
 * convite — que era o único fluxo quando ela nasceu.
 *
 * Parametrizado quando o resumo do fut chegou: ele vai para quem JOGOU, e dizer
 * "alguém convidou você" a quem acabou de sair da quadra é mentira. O default
 * mantém os quatro templates antigos intactos.
 */
const RODAPE_CONVITE =
  "Você recebeu este email porque alguém do FutZenha convidou você. Se não esperava por ele, pode ignorá-lo.";

/** A moldura comum: fundo, cartão central de ~520px e rodapé explicando o porquê do email. */
function moldura(conteudo: string, rodape: string = RODAPE_CONVITE): string {
  return [
    `<div style="margin:0;padding:24px 12px;background-color:${CANVAS};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background-color:${SURFACE};border:1px solid ${LINE};border-radius:12px;">`,
    `<tr><td style="padding:28px 28px 8px 28px;font-family:${FONTE};font-size:15px;font-weight:bold;color:${ACCENT_INK};">FutZenha</td></tr>`,
    `<tr><td style="padding:8px 28px 28px 28px;font-family:${FONTE};font-size:14px;line-height:1.6;color:${FG};">${conteudo}</td></tr>`,
    `</table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">`,
    `<tr><td style="padding:16px 28px;font-family:${FONTE};font-size:11px;line-height:1.5;color:${FG_MUDO};">${escaparHtml(rodape)}</td></tr>`,
    `</table>`,
    `</div>`,
  ].join("");
}

function botao(url: string, rotulo: string): string {
  return `<a href="${url}" style="display:inline-block;padding:10px 20px;background-color:${ACCENT};color:${ON_ACCENT};font-family:${FONTE};font-size:14px;font-weight:bold;text-decoration:none;border-radius:8px;">${rotulo}</a>`;
}

/** "O botão não abriu?" — a URL crua, clicável, para cliente que estraga o botão. */
function urlDeApoio(url: string): string {
  return `<p style="margin:16px 0 0 0;font-size:12px;color:${FG_MUDO};">Se o botão não abrir, copie e cole este endereço no navegador:<br /><a href="${url}" style="color:${ACCENT_INK};word-break:break-all;">${url}</a></p>`;
}

function dataCurta(quando: Date): string {
  return quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Convite de plataforma: o link de `/convite/[token]` que hoje vai no WhatsApp.
 * O corpo repete a regra do resgate — entrar com o Google usando exatamente o
 * endereço convidado — porque é o erro mais provável de quem recebe (abrir com
 * outra conta Google e ver o convite recusado).
 */
export function emailDeConvitePlataforma(dados: {
  nome: string;
  token: string;
  emailDeDestino: string;
  expiraEm: Date;
}): EmailPronto {
  const url = `${siteUrl()}/convite/${dados.token}`;
  const nome = escaparHtml(dados.nome);
  const email = escaparHtml(dados.emailDeDestino);
  const validade = dataCurta(dados.expiraEm);

  const html = moldura(
    [
      `<p style="margin:0 0 4px 0;font-size:18px;font-weight:bold;color:${FG};">Você foi convidado para o FutZenha</p>`,
      `<p style="margin:12px 0;">Olá, <strong>${nome}</strong>! O FutZenha é o app do fut: presença, times, gols e avaliações, tudo num lugar só.</p>`,
      `<p style="margin:20px 0;">${botao(url, "Aceitar convite")}</p>`,
      `<p style="margin:12px 0;">Para aceitar, entre com o Google usando <strong>este endereço</strong> (${email}) — o convite só vale para ele.</p>`,
      `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">O convite expira em ${validade}. Depois disso, peça outro a quem convidou você.</p>`,
      urlDeApoio(url),
    ].join(""),
  );

  const texto = [
    `Olá, ${dados.nome}!`,
    ``,
    `Você foi convidado para o FutZenha — o app do fut.`,
    ``,
    `Aceite o convite neste endereço:`,
    url,
    ``,
    `Para aceitar, entre com o Google usando este endereço (${dados.emailDeDestino}) — o convite só vale para ele.`,
    `O convite expira em ${validade}.`,
    ``,
    `Se você não esperava este convite, ignore este email.`,
  ].join("\n");

  return { assunto: "Seu convite para o FutZenha", html, texto };
}

/**
 * Mesmo link, outra história: quem já tem conta e recebe um convite novo está
 * redefinindo o acesso, não estreando no app (é o botão "Resetar acesso" do
 * /admin/jogadores — ver createInvite). Dar as boas-vindas a um membro de anos
 * seria estranho, e a mensagem que importa aqui é outra: as sessões antigas
 * caem, e quem não pediu nada precisa saber que pode ignorar.
 */
export function emailDeResetDeAcesso(dados: {
  nome: string;
  token: string;
  emailDeDestino: string;
  expiraEm: Date;
}): EmailPronto {
  const url = `${siteUrl()}/convite/${dados.token}`;
  const nome = escaparHtml(dados.nome);
  const email = escaparHtml(dados.emailDeDestino);
  const validade = dataCurta(dados.expiraEm);

  const html = moldura(
    [
      `<p style="margin:0 0 4px 0;font-size:18px;font-weight:bold;color:${FG};">Redefinir seu acesso ao FutZenha</p>`,
      `<p style="margin:12px 0;">Olá, <strong>${nome}</strong>! Quem administra o FutZenha gerou um link para você voltar a entrar na sua conta.</p>`,
      `<p style="margin:20px 0;">${botao(url, "Redefinir acesso")}</p>`,
      `<p style="margin:12px 0;">Use o Google com <strong>este endereço</strong> (${email}) — o link só vale para ele. Ao concluir, as sessões abertas em outros aparelhos são encerradas.</p>`,
      `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">O link expira em ${validade}. Se não foi você que pediu, ignore este email: sua conta segue como está.</p>`,
      urlDeApoio(url),
    ].join(""),
  );

  const texto = [
    `Olá, ${dados.nome}!`,
    ``,
    `Quem administra o FutZenha gerou um link para você voltar a entrar na sua conta.`,
    ``,
    `Redefina seu acesso neste endereço:`,
    url,
    ``,
    `Use o Google com este endereço (${dados.emailDeDestino}) — o link só vale para ele.`,
    `Ao concluir, as sessões abertas em outros aparelhos são encerradas.`,
    `O link expira em ${validade}.`,
    ``,
    `Se não foi você que pediu, ignore este email: sua conta segue como está.`,
  ].join("\n");

  return { assunto: "Redefinir seu acesso ao FutZenha", html, texto };
}

/**
 * Aviso do convite nominal de grupo. Quem recebe já tem conta; o aceite é dentro
 * do app, na página /grupos — o email só encurta o caminho até lá. Por isso o
 * link é a página, não um token: não existe aceite por link nesse fluxo.
 */
export function emailDeAvisoDeGrupo(dados: {
  nomeDoGrupo: string;
  quemConvidou: string;
}): EmailPronto {
  const url = `${siteUrl()}/grupos`;
  const grupo = escaparHtml(dados.nomeDoGrupo);
  const quem = escaparHtml(dados.quemConvidou);

  const html = moldura(
    [
      `<p style="margin:0 0 4px 0;font-size:18px;font-weight:bold;color:${FG};">Convite para o grupo ${grupo}</p>`,
      `<p style="margin:12px 0;"><strong>${quem}</strong> convidou você para o grupo <strong>${grupo}</strong> no FutZenha.</p>`,
      `<p style="margin:20px 0;">${botao(url, "Responder no app")}</p>`,
      `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">O convite é aceito (ou recusado) dentro do app, na página de grupos.</p>`,
      urlDeApoio(url),
    ].join(""),
  );

  const texto = [
    `${dados.quemConvidou} convidou você para o grupo ${dados.nomeDoGrupo} no FutZenha.`,
    ``,
    `Responda dentro do app, na página de grupos:`,
    url,
    ``,
    `Se você não esperava este convite, ignore este email.`,
  ].join("\n");

  return { assunto: `Convite para o grupo ${dados.nomeDoGrupo} no FutZenha`, html, texto };
}

export type TipoDeEventoDeAgenda = "convite" | "atualizacao" | "saida" | "fut-cancelado";

/**
 * O e-mail que carrega o .ics do fut. O texto muda por tipo, mas a estrutura é
 * uma: o que aconteceu, o botão do Google (para cliente que ignora o anexo) e
 * o link do fut. Em cancelamento não há botão nem link — o evento está saindo
 * da agenda, e no fut apagado a página nem existe mais.
 */
export function emailDeEventoDeAgenda(dados: {
  tipo: TipoDeEventoDeAgenda;
  nome: string;
  fut: FutParaAgenda;
  /**
   * Quem pôs a pessoa na lista, quando não foi ela mesma. Muda o convite de
   * "presença confirmada" para "Fulano confirmou você" — e é o que justifica o
   * link de retirar o nome: sem saber quem foi, o e-mail estaria oferecendo uma
   * saída de algo que a pessoa acha que ela mesma escolheu.
   */
  confirmadoPor?: string | null;
}): EmailPronto {
  const urlDoFut = `${siteUrl()}/fut/${dados.fut.id}`;
  const hora = formatHorarioPorExtenso(dados.fut.startTime, dados.fut.endTime);
  const quando = `${formatDate(dados.fut.date)}${hora ? ` ${hora}` : ""}`;
  const nome = escaparHtml(dados.nome);
  const local = escaparHtml(dados.fut.location);
  const quandoHtml = escaparHtml(quando);
  // Só vale no convite: os outros três tipos falam de um evento que a pessoa já
  // tem, e a inclusão já foi avisada quando aconteceu.
  const porOutro = dados.tipo === "convite" ? (dados.confirmadoPor ?? null) : null;

  // `corpo` e `corpoTexto` dizem a mesma coisa em duas linguagens. O texto sai
  // dos valores CRUS, como em todos os templates daqui: derivá-lo do HTML
  // deixaria `&#39;` e `&amp;` visíveis em cliente de texto puro — e local de
  // fut ("Arena D'Oeste", "Zé & Cia") tem apóstrofo e "e comercial" à vontade.
  const cabecalhos: Record<
    TipoDeEventoDeAgenda,
    { assunto: string; titulo: string; corpo: string; corpoTexto: string }
  > = {
    convite: porOutro
      ? {
          assunto: `${porOutro} confirmou você no fut de ${quando}`,
          titulo: "Confirmaram sua presença",
          corpo: `Olá, <strong>${nome}</strong>! <strong>${escaparHtml(porOutro)}</strong> confirmou sua presença no fut de <strong>${quandoHtml}</strong>, em <strong>${local}</strong>. <strong>Se estiver tudo certo, não precisa fazer nada</strong> — o convite de calendário vai anexo e entra na sua agenda sozinho.`,
          corpoTexto: `Olá, ${dados.nome}! ${porOutro} confirmou sua presença no fut de ${quando}, em ${dados.fut.location}. Se estiver tudo certo, não precisa fazer nada — o convite de calendário vai anexo e entra na sua agenda sozinho.`,
        }
      : {
          assunto: `Na agenda: fut de ${quando}`,
          titulo: "Fut na agenda",
          corpo: `Olá, <strong>${nome}</strong>! Presença confirmada no fut de <strong>${quandoHtml}</strong>, em <strong>${local}</strong>. O convite de calendário vai anexo — na maioria dos clientes ele entra na agenda sozinho, ou com um toque em &quot;Sim&quot;.`,
          corpoTexto: `Olá, ${dados.nome}! Presença confirmada no fut de ${quando}, em ${dados.fut.location}. O convite de calendário vai anexo — na maioria dos clientes ele entra na agenda sozinho, ou com um toque em "Sim".`,
        },
    atualizacao: {
      assunto: `Fut atualizado: ${quando}`,
      titulo: "O fut mudou",
      corpo: `O fut mudou: agora é <strong>${quandoHtml}</strong>, em <strong>${local}</strong>. Se o evento já está na sua agenda, este e-mail o atualiza sozinho.`,
      corpoTexto: `O fut mudou: agora é ${quando}, em ${dados.fut.location}. Se o evento já está na sua agenda, este e-mail o atualiza sozinho.`,
    },
    saida: {
      assunto: `Fora da lista: fut de ${quando}`,
      titulo: "Você saiu da lista",
      corpo: `Você saiu da lista do fut de <strong>${quandoHtml}</strong>, em <strong>${local}</strong>. O cancelamento anexo tira o evento da sua agenda.`,
      corpoTexto: `Você saiu da lista do fut de ${quando}, em ${dados.fut.location}. O cancelamento anexo tira o evento da sua agenda.`,
    },
    "fut-cancelado": {
      assunto: `Cancelado: fut de ${quando}`,
      titulo: "Fut cancelado",
      corpo: `O fut de <strong>${quandoHtml}</strong>, em <strong>${local}</strong>, foi cancelado. O cancelamento anexo tira o evento da sua agenda.`,
      corpoTexto: `O fut de ${quando}, em ${dados.fut.location}, foi cancelado. O cancelamento anexo tira o evento da sua agenda.`,
    },
  };
  const { assunto, titulo, corpo, corpoTexto } = cabecalhos[dados.tipo];
  const comBotao = dados.tipo === "convite" || dados.tipo === "atualizacao";

  const html = moldura(
    [
      `<p style="margin:0 0 4px 0;font-size:18px;font-weight:bold;color:${FG};">${titulo}</p>`,
      `<p style="margin:12px 0;">${corpo}</p>`,
      // Pela nossa rota, não direto para o calendar.google.com: link de domínio
      // diferente do remetente pesa em filtro de spam (ver o route.ts em
      // src/app/fut/[id]/agenda/google). A tela do Google chega igual — o 302
      // leva os mesmos parâmetros.
      comBotao
        ? `<p style="margin:20px 0;">${botao(urlDeAgendaGoogle(dados.fut.id, siteUrl()), "Adicionar ao Google Agenda")}</p>`
        : "",
      // A saída de quem foi confirmado por outro. É link e não botão de propósito:
      // o botão é a ação que o e-mail está propondo (pôr na agenda), e esta é a
      // porta de quem NÃO quer — dar a ela o mesmo peso visual empurraria para
      // fora quem só abriu para confirmar que está tudo certo.
      //
      // Leva à página do fut, e não a uma rota que já retira o nome: nenhuma rota
      // deste projeto executa ação no GET, porque prefetcher de cliente de e-mail
      // e antivírus corporativo abrem link sozinhos — um "cancelar presença" por
      // GET tiraria da lista quem nunca clicou.
      porOutro
        ? `<p style="margin:16px 0 0 0;">Não vai? <a href="${urlDoFut}" style="color:${ACCENT_INK};font-weight:bold;">Retire seu nome da lista</a>.</p>`
        : "",
      comBotao ? urlDeApoio(urlDoFut) : "",
    ].join(""),
  );

  const texto = [
    corpoTexto,
    ...(porOutro ? ["", `Não vai? Retire seu nome da lista: ${urlDoFut}`] : []),
    ...(comBotao ? ["", `Página do fut: ${urlDoFut}`] : []),
  ].join("\n");

  return { assunto, html, texto };
}

/**
 * O resumo do fut encerrado: placar de cada jogo, quem marcou, artilharia e os
 * elencos. Vai só para quem JOGOU — quem não esteve lá recebe apenas o aviso
 * curto no app (ver notificarEncerramento).
 *
 * `podeAvaliar` decide o destino e a chamada. Quem é avaliador elegível vai para
 * o formulário, que mostra este mesmo resumo antes das estrelas; quem jogou e
 * não avalia — lado sem três contas ativas — vai para a página do fut. Um href
 * só levaria metade do elenco a um 404.
 *
 * Duas coisas que o resumo NÃO traz, e é melhor dizer do que deixar procurar:
 * o melhor em campo (só existe quando a rodada de avaliação fecha) e um placar
 * definitivo (ele é corrigível por 24h — ver ./janela-correcao). As duas viram
 * uma linha de rodapé em vez de uma ausência inexplicada.
 */
export function emailDeResumoDoFut(dados: {
  nome: string;
  fut: { id: number; date: string; location: string };
  resumo: ResumoDoFut;
  href: string;
  podeAvaliar: boolean;
  prazoHoras: number;
}): EmailPronto {
  const url = `${siteUrl()}${dados.href}`;
  const quando = formatDate(dados.fut.date);
  const placar = linhaDePlacar(dados.resumo);

  const jogosHtml = dados.resumo.jogos
    .map((jogo) => {
      const golsHtml = jogo.gols
        .map(
          (gol) =>
            `<tr><td style="padding:2px 0;font-size:13px;color:${gol.autor === null ? FG_MUDO : FG};">${
              gol.autor === null
                ? "<em>Gol contra / sem autor</em>"
                : escaparHtml(gol.autor)
            }${gol.time ? ` <span style="color:${FG_MUDO};">(${escaparHtml(gol.time)})</span>` : ""}</td>` +
            `<td align="right" style="padding:2px 0;font-size:13px;font-weight:bold;color:${FG};">${gol.quantidade}</td></tr>`,
        )
        .join("");

      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;border:1px solid ${LINE};border-radius:8px;">`,
        `<tr><td style="padding:12px 14px;font-family:${FONTE};">`,
        `<p style="margin:0;font-size:15px;font-weight:bold;color:${FG};">${escaparHtml(jogo.timeA)} <span style="color:${ACCENT_INK};">${jogo.placarA} × ${jogo.placarB}</span> ${escaparHtml(jogo.timeB)}</p>`,
        golsHtml
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid ${LINE};font-family:${FONTE};">${golsHtml}</table>`
          : `<p style="margin:6px 0 0 0;font-size:12px;color:${FG_MUDO};">Sem gols lançados.</p>`,
        `</td></tr></table>`,
      ].join("");
    })
    .join("");

  const artilhariaHtml =
    dados.resumo.artilheiros.length === 0
      ? ""
      : [
          `<p style="margin:20px 0 6px 0;font-size:13px;font-weight:bold;color:${FG};">Artilharia do dia</p>`,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONTE};">`,
          dados.resumo.artilheiros
            .map(
              (a) =>
                `<tr><td style="padding:2px 0;font-size:13px;color:${FG};">${escaparHtml(a.rotulo)}</td>` +
                `<td align="right" style="padding:2px 0;font-size:13px;font-weight:bold;color:${FG};">${a.gols}</td></tr>`,
            )
            .join(""),
          `</table>`,
        ].join("");

  const timesHtml =
    dados.resumo.times.length === 0
      ? ""
      : [
          `<p style="margin:20px 0 6px 0;font-size:13px;font-weight:bold;color:${FG};">Os times</p>`,
          dados.resumo.times
            .map(
              (time) =>
                `<p style="margin:0 0 8px 0;font-size:13px;color:${FG};"><strong>${escaparHtml(time.nome)}</strong><br />` +
                `<span style="color:${FG_MUDO};">${time.jogadores
                  .map((j) => escaparHtml(j.rotulo) + (j.isGoalkeeper ? " (goleiro)" : ""))
                  .join(", ")}</span></p>`,
            )
            .join(""),
        ].join("");

  const html = moldura(
    [
      `<p style="margin:0 0 4px 0;font-size:18px;font-weight:bold;color:${FG};">Como foi o fut de ${escaparHtml(quando)}</p>`,
      `<p style="margin:0 0 16px 0;font-size:13px;color:${FG_MUDO};">${escaparHtml(dados.fut.location)} · ${escaparHtml(placar)}</p>`,
      jogosHtml,
      artilhariaHtml,
      timesHtml,
      `<p style="margin:20px 0;">${botao(url, dados.podeAvaliar ? "Avaliar a rapaziada" : "Ver o fut")}</p>`,
      dados.podeAvaliar
        ? `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">Você tem ${dados.prazoHoras} horas para avaliar quem dividiu o lado com você. Ninguém vê quem deu cada estrela.</p>`
        : "",
      `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">O melhor em campo sai quando a avaliação fechar. O placar e os gols ainda podem ser corrigidos nas primeiras 24 horas — o que está aqui é como estava no encerramento.</p>`,
      urlDeApoio(url),
    ].join(""),
    "Você recebeu este e-mail porque jogou este fut no FutZenha.",
  );

  // Dos valores CRUS, como todos os templates daqui: derivar do HTML deixaria
  // `&#39;` visível em cliente de texto puro, e nome de time e apelido são texto
  // livre de admin.
  const texto = [
    `Como foi o fut de ${quando}`,
    `${dados.fut.location} · ${placar}`,
    ``,
    ...dados.resumo.jogos.flatMap((jogo) => [
      `${jogo.timeA} ${jogo.placarA} x ${jogo.placarB} ${jogo.timeB}`,
      ...jogo.gols.map(
        (gol) =>
          `  - ${gol.autor ?? "Gol contra / sem autor"}${gol.time ? ` (${gol.time})` : ""}: ${gol.quantidade}`,
      ),
      ``,
    ]),
    ...(dados.resumo.artilheiros.length > 0
      ? [
          `Artilharia do dia:`,
          ...dados.resumo.artilheiros.map((a) => `  - ${a.rotulo}: ${a.gols}`),
          ``,
        ]
      : []),
    ...(dados.resumo.times.length > 0
      ? [
          `Os times:`,
          ...dados.resumo.times.map(
            (time) =>
              `  ${time.nome}: ${time.jogadores
                .map((j) => j.rotulo + (j.isGoalkeeper ? " (goleiro)" : ""))
                .join(", ")}`,
          ),
          ``,
        ]
      : []),
    dados.podeAvaliar
      ? `Avalie quem dividiu o lado com você — você tem ${dados.prazoHoras} horas:`
      : `Veja o fut:`,
    url,
    ``,
    `O melhor em campo sai quando a avaliação fechar. O placar e os gols ainda podem ser corrigidos nas primeiras 24 horas.`,
  ].join("\n");

  return { assunto: `Como foi o fut de ${quando}`, html, texto };
}
