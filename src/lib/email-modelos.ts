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

import type { EmailPronto } from "./email-envio";
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
      `<p style="margin:12px 0;">Olá, <strong>${nome}</strong>! O FutZenha é o app da pelada: presença, times, gols e avaliações, tudo num lugar só.</p>`,
      `<p style="margin:20px 0;">${botao(url, "Aceitar convite")}</p>`,
      `<p style="margin:12px 0;">Para aceitar, entre com o Google usando <strong>este endereço</strong> (${email}) — o convite só vale para ele.</p>`,
      `<p style="margin:12px 0 0 0;font-size:12px;color:${FG_MUDO};">O convite expira em ${validade}. Depois disso, peça outro a quem convidou você.</p>`,
      urlDeApoio(url),
    ].join(""),
  );

  const texto = [
    `Olá, ${dados.nome}!`,
    ``,
    `Você foi convidado para o FutZenha — o app da pelada.`,
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
