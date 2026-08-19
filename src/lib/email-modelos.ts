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

import { urlGoogleAgenda, type FutParaAgenda } from "./agenda";
import type { EmailPronto } from "./email-envio";
import { formatDate, formatHorarioPorExtenso } from "./format";
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

/** A moldura comum: fundo, cartão central de ~520px e rodapé explicando o porquê do email. */
function moldura(conteudo: string): string {
  return [
    `<div style="margin:0;padding:24px 12px;background-color:${CANVAS};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background-color:${SURFACE};border:1px solid ${LINE};border-radius:12px;">`,
    `<tr><td style="padding:28px 28px 8px 28px;font-family:${FONTE};font-size:15px;font-weight:bold;color:${ACCENT_INK};">FutZenha</td></tr>`,
    `<tr><td style="padding:8px 28px 28px 28px;font-family:${FONTE};font-size:14px;line-height:1.6;color:${FG};">${conteudo}</td></tr>`,
    `</table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">`,
    `<tr><td style="padding:16px 28px;font-family:${FONTE};font-size:11px;line-height:1.5;color:${FG_MUDO};">Você recebeu este email porque alguém do FutZenha convidou você. Se não esperava por ele, pode ignorá-lo.</td></tr>`,
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
}): EmailPronto {
  const urlDoFut = `${siteUrl()}/fut/${dados.fut.id}`;
  const hora = formatHorarioPorExtenso(dados.fut.startTime, dados.fut.endTime);
  const quando = `${formatDate(dados.fut.date)}${hora ? ` ${hora}` : ""}`;
  const nome = escaparHtml(dados.nome);
  const local = escaparHtml(dados.fut.location);
  const quandoHtml = escaparHtml(quando);

  // `corpo` e `corpoTexto` dizem a mesma coisa em duas linguagens. O texto sai
  // dos valores CRUS, como em todos os templates daqui: derivá-lo do HTML
  // deixaria `&#39;` e `&amp;` visíveis em cliente de texto puro — e local de
  // fut ("Arena D'Oeste", "Zé & Cia") tem apóstrofo e "e comercial" à vontade.
  const cabecalhos: Record<
    TipoDeEventoDeAgenda,
    { assunto: string; titulo: string; corpo: string; corpoTexto: string }
  > = {
    convite: {
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
      comBotao
        ? `<p style="margin:20px 0;">${botao(urlGoogleAgenda(dados.fut, siteUrl()), "Adicionar ao Google Agenda")}</p>`
        : "",
      comBotao ? urlDeApoio(urlDoFut) : "",
    ].join(""),
  );

  const texto = [
    corpoTexto,
    ...(comBotao ? ["", `Página do fut: ${urlDoFut}`] : []),
  ].join("\n");

  return { assunto, html, texto };
}
