// Eventos de agenda do fut: .ics gerado à mão + links "adicionar à agenda".
//
// À mão porque é texto com CRLF e meia dúzia de campos (RFC 5545) — uma lib de
// ICS traria parser, recorrência e fusos genéricos que o fut não usa, ao custo
// de uma dependência (mesmo racional do fetch cru em email-envio.ts). Puro e
// sem `server-only`, como whatsapp.ts: o e-mail monta o convite no servidor e
// a página monta o botão de download com o mesmo gerador.
//
// O horário do fut é hora de parede de Brasília (`date` + `time` sem fuso no
// schema; ver src/lib/pendencias.ts). O .ics sai com TZID=America/Sao_Paulo e
// um VTIMEZONE de bloco único — o Brasil não tem horário de verão desde 2019,
// e se voltar o evento continua certo: 20h é 20h na parede, qualquer offset.

export type FutParaAgenda = {
  id: number;
  /** "YYYY-MM-DD", como a coluna `date` chega do driver. */
  date: string;
  /** "HH:MM:SS" (coluna `time`) ou nulo — sem horário o evento é de dia inteiro. */
  startTime: string | null;
  /** "HH:MM:SS" ou nulo — sem fim declarado o evento usa DURACAO_PADRAO_MIN. */
  endTime: string | null;
  location: string;
  notes: string | null;
};

/** Fut sem horário de término declarado: o tamanho típico de um fut. */
export const DURACAO_PADRAO_MIN = 60;

// Os limites do que alguém pode declarar como fut. Existem porque o evento vai
// para a agenda de terceiros: quem administra reescreve o bloco de todo mundo
// que confirmou, e sem teto daria para tomar o dia inteiro de gente que só
// disse "vou jogar bola". O piso corta o fim digitado errado (fim = início).
export const DURACAO_MIN_MIN = 30;
export const DURACAO_MAX_MIN = 360;

/**
 * Minutos de parede entre início e fim. Fim <= início é virada de meia-noite
 * (22:00 às 00:30 = 150min), não erro — é o mesmo ramo do
 * match_days_duracao_check em src/db/schema.ts, e os dois têm que concordar.
 */
export function duracaoDoFut(startTime: string, endTime: string): number {
  const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (minutos(endTime) - minutos(startTime) + 24 * 60) % (24 * 60);
}

const TZID = "America/Sao_Paulo";

// Quantos minutos somar à parede de Brasília para chegar em UTC. É o mesmo -03:00
// que o VTIMEZONE lá embaixo declara — se o horário de verão voltar, os dois
// mudam juntos. Serve ao link do Outlook, que não aceita TZID nem `ctz` e só
// deixa de ser ambíguo em UTC.
const OFFSET_UTC_MIN = 180;

// ---------------------------------------------------------------------------
// Datas: aritmética de parede, sem o fuso do processo. `Date.UTC` entra só
// como calculadora de calendário (virada de dia/mês) — nunca como instante.
// ---------------------------------------------------------------------------

function dataCompacta(date: string): string {
  return date.replaceAll("-", "");
}

function horaCompacta(time: string): string {
  return `${time.slice(0, 2)}${time.slice(3, 5)}00`;
}

/** date+time de parede após somar `minutos`, ainda como strings de parede. */
function somarMinutos(
  date: string,
  time: string,
  minutos: number,
): { date: string; time: string } {
  const [ano, mes, dia] = date.split("-").map(Number);
  const carimbo = new Date(
    Date.UTC(ano, mes - 1, dia, Number(time.slice(0, 2)), Number(time.slice(3, 5))),
  );
  carimbo.setUTCMinutes(carimbo.getUTCMinutes() + minutos);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${carimbo.getUTCFullYear()}-${pad(carimbo.getUTCMonth() + 1)}-${pad(carimbo.getUTCDate())}`,
    time: `${pad(carimbo.getUTCHours())}:${pad(carimbo.getUTCMinutes())}:00`,
  };
}

function diaSeguinte(date: string): string {
  return somarMinutos(date, "00:00:00", 24 * 60).date;
}

/** Parede de Brasília → UTC, ainda como strings (ver OFFSET_UTC_MIN). */
function paraUtc(date: string, time: string): { date: string; time: string } {
  return somarMinutos(date, time, OFFSET_UTC_MIN);
}

/** Instante real em UTC no formato do DTSTAMP: "20260819T120000Z". */
function utcCompacto(quando: Date): string {
  return quando.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

// ---------------------------------------------------------------------------
// Mecânica do .ics
// ---------------------------------------------------------------------------

/** Escape de VALOR de texto (RFC 5545 §3.3.11): \ ; , e quebras de linha. */
function escaparIcs(texto: string): string {
  return texto
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

// Valor de PARÂMETRO (CN) usa aspas, não backslash — o escaparIcs não serve
// aqui: dentro de aspas, `\;` sairia literal para o cliente. Aspas de dentro
// caem fora, e a quebra de linha vira espaço — não há `\n` que valha em
// parâmetro, e um nome com quebra encerraria a linha e injetaria propriedade
// nova no VEVENT (nickname/name são texto livre de formulário).
function valorDeParametro(texto: string): string {
  return texto.replaceAll('"', "").replaceAll(/[\r\n]+/g, " ");
}

/**
 * Dobra uma linha nos 75 octetos do RFC 5545 §3.1 — octetos UTF-8, não
 * caracteres: um "é" são 2 bytes e um emoji 3+, e cortar no meio corrompe o
 * caractere. A linha de continuação começa com espaço.
 */
function dobrarLinha(linha: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(linha).length <= 75) return [linha];
  const saida: string[] = [];
  let atual = "";
  let octetos = 0;
  for (const caractere of linha) {
    const tamanho = encoder.encode(caractere).length;
    if (octetos + tamanho > 75) {
      saida.push(atual);
      atual = " ";
      octetos = 1;
    }
    atual += caractere;
    octetos += tamanho;
  }
  saida.push(atual);
  return saida;
}

/**
 * Onde o evento termina, como parede. Ponto único de decisão dos três canais
 * (.ics, Google, Outlook) — antes cada um somava DURACAO_PADRAO_MIN por conta
 * própria, e um fim declarado teria que ser lembrado em três lugares.
 *
 * Só faz sentido com `startTime`; sem ele o evento é de dia inteiro e nem passa
 * por aqui.
 */
function fimDoEvento(fut: FutParaAgenda & { startTime: string }): {
  date: string;
  time: string;
} {
  const minutos =
    fut.endTime === null
      ? DURACAO_PADRAO_MIN
      : duracaoDoFut(fut.startTime, fut.endTime);
  return somarMinutos(fut.date, fut.startTime, minutos);
}

function tituloDoEvento(fut: FutParaAgenda): string {
  return `⚽ Fut · ${fut.location}`;
}

function descricaoDoEvento(fut: FutParaAgenda, urlBase: string): string {
  const linhas: string[] = [];
  if (fut.notes) linhas.push(fut.notes, "");
  linhas.push(`Presenças e times: ${urlBase}/fut/${fut.id}`);
  return linhas.join("\n");
}

function linhasDeQuando(fut: FutParaAgenda): string[] {
  if (fut.startTime === null) {
    return [
      `DTSTART;VALUE=DATE:${dataCompacta(fut.date)}`,
      `DTEND;VALUE=DATE:${dataCompacta(diaSeguinte(fut.date))}`,
    ];
  }
  const fim = fimDoEvento({ ...fut, startTime: fut.startTime });
  return [
    `DTSTART;TZID=${TZID}:${dataCompacta(fut.date)}T${horaCompacta(fut.startTime)}`,
    `DTEND;TZID=${TZID}:${dataCompacta(fim.date)}T${horaCompacta(fim.time)}`,
  ];
}

type Pessoa = { nome: string; email: string };

function montarIcs(opts: {
  fut: FutParaAgenda;
  urlBase: string;
  metodo: "REQUEST" | "CANCEL" | "PUBLISH";
  uid: string;
  sequence: number;
  agora: Date;
  organizador?: Pessoa;
  convidado?: Pessoa;
}): string {
  const { fut, urlBase, metodo } = opts;
  const linhas = [
    "BEGIN:VCALENDAR",
    "PRODID:-//FutZenha//Agenda//PT",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${metodo}`,
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    // -03:00 fixo, o mesmo offset que OFFSET_UTC_MIN aplica no link do Outlook.
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `SEQUENCE:${opts.sequence}`,
    `DTSTAMP:${utcCompacto(opts.agora)}`,
    ...linhasDeQuando(fut),
    `SUMMARY:${escaparIcs(tituloDoEvento(fut))}`,
    `LOCATION:${escaparIcs(fut.location)}`,
    `DESCRIPTION:${escaparIcs(descricaoDoEvento(fut, urlBase))}`,
    `URL:${urlBase}/fut/${fut.id}`,
    `STATUS:${metodo === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (opts.organizador) {
    linhas.push(
      `ORGANIZER;CN="${valorDeParametro(opts.organizador.nome)}":mailto:${opts.organizador.email}`,
    );
  }
  if (opts.convidado) {
    // PARTSTAT=ACCEPTED porque a pessoa já disse "Vou" no app — o convite não
    // pede resposta, registra a que já foi dada.
    linhas.push(
      `ATTENDEE;CN="${valorDeParametro(opts.convidado.nome)}";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${opts.convidado.email}`,
    );
  }
  linhas.push("END:VEVENT", "END:VCALENDAR");
  return linhas.flatMap(dobrarLinha).join("\r\n") + "\r\n";
}

/** Um UID por par (fut, jogador): é ele que faz update/cancel acharem o evento. */
export function uidDoConvite(matchDayId: number, playerId: number): string {
  return `fut-${matchDayId}-${playerId}@futzenha.com.br`;
}

/** O .ics que vai anexo no e-mail — convite (REQUEST) ou cancelamento (CANCEL). */
export function icsDeConvite(dados: {
  fut: FutParaAgenda;
  urlBase: string;
  metodo: "REQUEST" | "CANCEL";
  sequence: number;
  agora: Date;
  organizador: Pessoa;
  convidado: Pessoa & { playerId: number };
}): string {
  return montarIcs({ ...dados, uid: uidDoConvite(dados.fut.id, dados.convidado.playerId) });
}

/** O .ics do botão de download — PUBLISH: importa sem pedir resposta a ninguém. */
export function icsParaBaixar(dados: {
  fut: FutParaAgenda;
  urlBase: string;
  agora: Date;
}): string {
  return montarIcs({
    ...dados,
    metodo: "PUBLISH",
    uid: `fut-${dados.fut.id}@futzenha.com.br`,
    sequence: 0,
  });
}

// ---------------------------------------------------------------------------
// Links "adicionar à agenda" — os dois grandes que aceitam URL pronta.
// ---------------------------------------------------------------------------

export function urlGoogleAgenda(fut: FutParaAgenda, urlBase: string): string {
  let dates: string;
  if (fut.startTime === null) {
    dates = `${dataCompacta(fut.date)}/${dataCompacta(diaSeguinte(fut.date))}`;
  } else {
    const fim = fimDoEvento({ ...fut, startTime: fut.startTime });
    dates = `${dataCompacta(fut.date)}T${horaCompacta(fut.startTime)}/${dataCompacta(fim.date)}T${horaCompacta(fim.time)}`;
  }
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: tituloDoEvento(fut),
    dates,
    // Sem ctz o Google leria a hora de parede no fuso do usuário logado — um
    // brasileiro em viagem ganharia o fut na hora errada.
    ctz: TZID,
    location: fut.location,
    details: descricaoDoEvento(fut, urlBase),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * O link do Google que vai no E-MAIL: a nossa rota, que devolve 302 para a URL
 * acima. Link de outro domínio que o do remetente pesa em filtro de spam — o
 * porquê inteiro está em src/app/(esqueleto)/fut/[id]/agenda/google/route.ts.
 *
 * A página do fut não usa este: lá o `urlGoogleAgenda` direto continua certo.
 */
export function urlDeAgendaGoogle(futId: number, urlBase: string): string {
  return `${urlBase}/fut/${futId}/agenda/google`;
}

export function urlOutlookAgenda(fut: FutParaAgenda, urlBase: string): string {
  const params = new URLSearchParams({
    rru: "addevent",
    subject: tituloDoEvento(fut),
    location: fut.location,
    body: descricaoDoEvento(fut, urlBase),
  });
  if (fut.startTime === null) {
    // Dia inteiro não tem hora para ficar ambígua: data crua, sem fuso.
    params.set("startdt", fut.date);
    params.set("enddt", diaSeguinte(fut.date));
    params.set("allday", "true");
  } else {
    // Em UTC, com o "Z" explícito. O compose do Outlook não tem TZID (como o
    // .ics) nem `ctz` (como o Google): parede nua ali fica à mercê do fuso da
    // caixa de quem clica — quem estivesse com o calendário em outro fuso
    // ganharia o fut na hora errada, que é o mesmo risco que o `ctz` cobre lá.
    const inicio = paraUtc(fut.date, fut.startTime);
    const fimParede = fimDoEvento({ ...fut, startTime: fut.startTime });
    const fim = paraUtc(fimParede.date, fimParede.time);
    params.set("startdt", `${inicio.date}T${inicio.time}Z`);
    params.set("enddt", `${fim.date}T${fim.time}Z`);
  }
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}
