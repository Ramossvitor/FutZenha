// O ciclo do evento de agenda, do clique ao anexo: quem recebe convite, quem
// recebe cancelamento e com que SEQUENCE. O .ics é lido de volta do payload do
// Resend — é o que o cliente de e-mail veria, e é onde a regressão apareceria.

import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays, type MatchDay, type Player } from "@/db/schema";
import { setMyAttendance } from "@/app/fut/[id]/actions";
import {
  deleteMatchDay,
  promoverDaEspera,
  updateMatchDay,
} from "@/app/fut/[id]/gerenciar/actions";
import {
  agendarCancelamentosDeAgenda,
  agendarConvitesDeAgenda,
} from "@/lib/agenda-convite";
import {
  confirmarPresenca,
  criarFut,
  criarJogador,
  criarJogadorComConta,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";
import { flushAfter } from "@/test/after-flush";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";
import { TETO_AGENDA_DIA, TETO_AGENDA_POR_JOGADOR_DIA } from "@/lib/freios-de-envio";

const EMAIL = "jogador@example.com";
const FUT_COM_HORA = { date: "2026-08-22", startTime: "20:00:00" };

/** O .ics de dentro do anexo do envio `indice`. */
function icsDoEnvio(fetchMock: ReturnType<typeof vi.fn>, indice = 0): string {
  const anexos = payloadDoEnvio(fetchMock, indice).attachments;
  if (!anexos || anexos.length === 0) throw new Error("envio sem anexo .ics");
  return Buffer.from(anexos[0].content, "base64").toString("utf-8");
}

/**
 * Envelhece o carimbo de envio do par, para sair da janela por (fut, jogador).
 *
 * Testes que são sobre OUTRA coisa (SEQUENCE, destinatário, conteúdo do .ics)
 * chamam isto entre os passos: sem ele, o freio de ./freios-de-envio suprime o
 * segundo convite e o teste passa a medir o freio em vez do que ele diz medir.
 * Quem testa o freio é o bloco no fim deste arquivo.
 */
async function envelhecerCarimbo(fut: MatchDay, minutos = 11): Promise<void> {
  await db
    .update(attendances)
    .set({ agendaEmailSentAt: sql`now() - interval '${sql.raw(String(minutos))} minutes'` })
    .where(eq(attendances.matchDayId, fut.id));
}

/** Jogador com conta e e-mail — o caso que recebe convite. */
async function jogadorComEmail(email = EMAIL): Promise<Player> {
  const { jogador } = await criarJogadorComConta({}, { email });
  return jogador;
}

/**
 * Um fut em que o jogador logado consegue se auto-confirmar.
 *
 * É fut DE GRUPO com ele dentro, e não avulso, porque em fut avulso quem nunca
 * esteve na lista entra por pedido/convite/link (ver src/lib/fut-entrada.ts) —
 * e estes testes são sobre o e-mail de agenda, não sobre a regra de entrada.
 */
async function futQueAceitaEntrada(jogador: Player, extra: Record<string, unknown> = {}) {
  const groupId = (await criarGrupo()).id;
  await entrarNoGrupo(groupId, jogador);
  return criarFut({ ...FUT_COM_HORA, groupId, ...extra });
}

/** Jogador com conta, e-mail e sessão aberta — quem clica em "Vou". */
async function jogadorLogado(email = EMAIL): Promise<Player> {
  const { jogador, conta } = await criarJogadorComConta({}, { email });
  await logarComo(conta);
  return jogador;
}

function formDoFut(campos: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData();
  form.set("date", campos.date ?? FUT_COM_HORA.date);
  form.set("startTime", campos.startTime ?? "20:00");
  form.set("endTime", campos.endTime ?? "");
  form.set("location", campos.location ?? "Quadra de Teste");
  form.set("notes", campos.notes ?? "");
  form.set("maxPlayers", campos.maxPlayers ?? "");
  return form;
}

async function statusDe(fut: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha?.status ?? null;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agendarConvitesDeAgenda", () => {
  it("manda o convite com o .ics anexo, identificado pelo par (fut, jogador)", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = payloadDoEnvio(fetchMock);
    expect(payload.to).toEqual([EMAIL]);
    expect(payload.subject).toContain("Na agenda:");
    expect(payload.attachments?.[0].filename).toBe(`fut-${fut.id}.ics`);
    expect(payload.attachments?.[0].content_type).toContain("method=REQUEST");
    const ics = icsDoEnvio(fetchMock);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain(`UID:fut-${fut.id}-${jogador.id}@futzenha.com.br`);
    expect(ics).toContain("SEQUENCE:0");
  });

  // O mesmo e-mail, outra história. Não é um segundo envio: um extra para o
  // mesmo evento gastaria duas vezes a cota diária do Resend e chegaria como
  // spam — quem confirmou já recebe este aqui, com o .ics.
  it("quando foi outra pessoa que confirmou, o e-mail diz quem foi e por onde sair", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    const organizador = await criarJogador({ name: "Ana Organizadora" });
    await confirmarPresenca(fut, jogador);
    await db
      .update(attendances)
      .set({ confirmedByPlayerId: organizador.id })
      .where(eq(attendances.matchDayId, fut.id));
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    const payload = payloadDoEnvio(fetchMock);
    expect(payload.subject).toContain("Ana Organizadora confirmou você");
    expect(payload.html).toContain("não precisa fazer nada");
    expect(payload.html).toContain("Retire seu nome da lista");
    // O .ics continua indo: a pessoa está na lista, e o evento é real até ela
    // dizer o contrário.
    expect(icsDoEnvio(fetchMock)).toContain("METHOD:REQUEST");
  });

  // Quem entrou sozinha nunca tem autor gravado — é o valor de todo o histórico,
  // e é o que mantém o convite de sempre para a esmagadora maioria.
  it("quem entrou sozinha recebe o convite de sempre", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    const payload = payloadDoEnvio(fetchMock);
    expect(payload.subject).toContain("Na agenda:");
    expect(payload.html).not.toContain("Retire seu nome da lista");
  });

  // O despachante relê o estado na hora de enviar (só manda para quem está `in`
  // AGORA), e é isso que faz a saída ganhar da corrida: quem retirou o nome
  // entre o clique do organizador e o `after()` não recebe um e-mail dizendo
  // "Fulano confirmou você" depois de já ter saído.
  it("quem retirou o nome antes do despacho não recebe o convite", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    const organizador = await criarJogador({ name: "Ana Organizadora" });
    await confirmarPresenca(fut, jogador);
    await db
      .update(attendances)
      .set({ confirmedByPlayerId: organizador.id })
      .where(eq(attendances.matchDayId, fut.id));
    const fetchMock = stubResend();

    // O estado que o despachante vai encontrar: ela saiu.
    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await db
      .update(attendances)
      .set({ status: "out", optedOutAt: new Date() })
      .where(eq(attendances.matchDayId, fut.id));
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // `email` é credencial e só nasce do Google; quem entrou por usuário e senha
  // só tem o endereço de contato — e é nele que o convite tem de cair.
  it("cai no contactEmail quando a conta não tem email do Google", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const { jogador } = await criarJogadorComConta(
      {},
      { email: null, contactEmail: "contato@example.com" },
    );
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    expect(payloadDoEnvio(fetchMock).to).toEqual(["contato@example.com"]);
  });

  it("sem endereço nenhum, ou sem conta, ninguém é incomodado", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const { jogador: semEndereco } = await criarJogadorComConta({}, { email: null });
    const semConta = await criarJogador();
    await confirmarPresenca(fut, semEndereco);
    await confirmarPresenca(fut, semConta);
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [semEndereco.id, semConta.id]);
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem RESEND_API_KEY não toca a rede", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    await confirmarPresenca(fut, jogador);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A validação é no envio, não na chamada: um e-mail atrasado não pode falar
  // de um estado que já mudou.
  it("quem está na espera não recebe convite", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    await confirmarPresenca(fut, jogador, { status: "waitlist" });
    const fetchMock = stubResend();

    agendarConvitesDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quem está na lista não recebe cancelamento", async () => {
    const fut = await criarFut(FUT_COM_HORA);
    const jogador = await jogadorComEmail();
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    agendarCancelamentosDeAgenda(fut.id, [jogador.id]);
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ciclo pela action de presença", () => {
  // O caso que a SEQUENCE existe para resolver: sem número novo a cada
  // transição, o REQUEST de volta seria ignorado por quem já viu o CANCEL.
  it("confirmar, sair e voltar versiona o mesmo evento", async () => {
    const jogador = await jogadorLogado();
    const fut = await futQueAceitaEntrada(jogador);
    const fetchMock = stubResend();

    const uid = `UID:fut-${fut.id}-${jogador.id}@futzenha.com.br`;

    await setMyAttendance(fut.id, "in");
    await flushAfter();
    expect(icsDoEnvio(fetchMock, 0)).toContain("METHOD:REQUEST");
    expect(icsDoEnvio(fetchMock, 0)).toContain("SEQUENCE:0");

    // Sem envelhecer: o cancelamento é isento da janela por par, de propósito —
    // suprimi-lo deixaria na agenda um fut em que a pessoa não está.
    await setMyAttendance(fut.id, "out");
    await flushAfter();
    expect(payloadDoEnvio(fetchMock, 1).subject).toContain("Fora da lista:");
    expect(icsDoEnvio(fetchMock, 1)).toContain("METHOD:CANCEL");
    expect(icsDoEnvio(fetchMock, 1)).toContain("SEQUENCE:1");

    // Este passo é sobre SEQUENCE, não sobre o freio: sem envelhecer o carimbo,
    // a volta cairia na janela de 10 min e o teste mediria outra coisa.
    await envelhecerCarimbo(fut);
    await setMyAttendance(fut.id, "in");
    await flushAfter();
    expect(icsDoEnvio(fetchMock, 2)).toContain("METHOD:REQUEST");
    expect(icsDoEnvio(fetchMock, 2)).toContain("SEQUENCE:2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Os três falam do MESMO evento — é o UID que faz o cancelamento e a volta
    // atingirem o que já está na agenda, em vez de criar eventos soltos.
    for (const indice of [0, 1, 2]) expect(icsDoEnvio(fetchMock, indice)).toContain(uid);
  });

  it("quem cai na espera não ganha evento nenhum", async () => {
    const cheios = await Promise.all([jogadorComEmail("a@example.com"), jogadorComEmail("b@example.com")]);
    const atrasado = await jogadorLogado("c@example.com");
    const fut = await futQueAceitaEntrada(atrasado, { maxPlayers: 2 });
    for (const jogador of cheios) await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    await setMyAttendance(fut.id, "in");
    await flushAfter();

    expect(await statusDe(fut, atrasado)).toBe("waitlist");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A promoção é a única entrada na lista que ninguém pediu — e é justamente a
  // que mais precisa do aviso na agenda.
  it("ao sair, o promovido da espera ganha o convite junto do cancelamento", async () => {
    const saindo = await jogadorLogado("sai@example.com");
    const fut = await criarFut({ ...FUT_COM_HORA, maxPlayers: 1 });
    await confirmarPresenca(fut, saindo);
    const esperando = await jogadorComEmail("espera@example.com");
    await confirmarPresenca(fut, esperando, { status: "waitlist", minutosAtras: 5 });
    const fetchMock = stubResend();

    await setMyAttendance(fut.id, "out");
    await flushAfter();

    expect(await statusDe(fut, esperando)).toBe("in");
    const enviados = [payloadDoEnvio(fetchMock, 0), payloadDoEnvio(fetchMock, 1)];
    const paraQuemSaiu = enviados.find((e) => e.to[0] === "sai@example.com");
    const paraPromovido = enviados.find((e) => e.to[0] === "espera@example.com");
    expect(paraQuemSaiu?.subject).toContain("Fora da lista:");
    expect(paraPromovido?.subject).toContain("Na agenda:");
  });
});

describe("mudanças no fut", () => {
  it("mudar o horário atualiza o evento de quem está na lista", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({ ...FUT_COM_HORA, createdByPlayerId: admin.id });
    await confirmarPresenca(fut, admin);
    const fetchMock = stubResend();

    await updateMatchDay(fut.id, formDoFut({ startTime: "21:00" }));
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).subject).toContain("Fut atualizado:");
    const ics = icsDoEnvio(fetchMock);
    expect(ics).toContain("DTSTART;TZID=America/Sao_Paulo:20260822T210000");
    expect(ics).toContain("SEQUENCE:1");
  });

  // O caminho da correção retroativa: todo fut marcado antes deste campo está na
  // agenda das pessoas com o bloco da duração padrão. Quem administra abre,
  // declara o fim de verdade e salva — e é este e-mail que reescreve o evento
  // que já está lá. Sem o término dentro do `eventoMudou`, o banco guardaria a
  // correção e a agenda de todo mundo ficaria como estava, sem aviso nenhum.
  it("declarar o término corrige o evento de quem já estava na lista", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({ ...FUT_COM_HORA, createdByPlayerId: admin.id });
    await confirmarPresenca(fut, admin);
    const fetchMock = stubResend();

    await updateMatchDay(fut.id, formDoFut({ endTime: "22:00" }));
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).subject).toContain("Fut atualizado:");
    const ics = icsDoEnvio(fetchMock);
    expect(ics).toContain("DTSTART;TZID=America/Sao_Paulo:20260822T200000");
    expect(ics).toContain("DTEND;TZID=America/Sao_Paulo:20260822T220000");
    // SEQUENCE maior é o que faz o cliente aceitar a correção por cima do
    // evento que já está na agenda, em vez de criar um segundo.
    expect(ics).toContain("SEQUENCE:1");
  });

  // Subir o limite promove a espera no mesmo salvamento que mudou o horário. Aí
  // as duas mensagens são diferentes: quem já estava na lista teve o evento
  // alterado; quem subiu da espera nunca teve evento nenhum para alterar.
  it("promovido junto com a mudança recebe convite, não 'o fut mudou'", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({
      ...FUT_COM_HORA,
      createdByPlayerId: admin.id,
      maxPlayers: 1,
    });
    await confirmarPresenca(fut, admin);
    const daEspera = await jogadorComEmail("espera@example.com");
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 5 });
    const fetchMock = stubResend();

    await updateMatchDay(fut.id, formDoFut({ startTime: "21:00", maxPlayers: "2" }));
    await flushAfter();

    expect(await statusDe(fut, daEspera)).toBe("in");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const enviados = [payloadDoEnvio(fetchMock, 0), payloadDoEnvio(fetchMock, 1)];
    expect(enviados.find((e) => e.to[0] === EMAIL)?.subject).toContain("Fut atualizado:");
    expect(enviados.find((e) => e.to[0] === "espera@example.com")?.subject).toContain(
      "Na agenda:",
    );
  });

  // Vagas e observações não mexem no evento — e-mail à toa é o jeito mais rápido
  // de a pessoa marcar o remetente como spam.
  it("mudar só as observações não manda e-mail", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({ ...FUT_COM_HORA, createdByPlayerId: admin.id });
    await confirmarPresenca(fut, admin);
    const fetchMock = stubResend();

    await updateMatchDay(fut.id, formDoFut({ notes: "levar colete" }));
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Promover quem já está `in` não muda nada no banco e não versiona o evento —
  // mandar convite ali seria repetir o mesmo e-mail com a SEQUENCE velha.
  it("promover duas vezes manda um convite só", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({
      ...FUT_COM_HORA,
      createdByPlayerId: admin.id,
      status: "teams_drawn",
    });
    const daEspera = await jogadorComEmail("espera@example.com");
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });
    const fetchMock = stubResend();

    await promoverDaEspera(fut.id, daEspera.id);
    await promoverDaEspera(fut.id, daEspera.id);
    await flushAfter();

    expect(await statusDe(fut, daEspera)).toBe("in");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).to).toEqual(["espera@example.com"]);
  });

  it("apagar o fut cancela o evento de quem tinha vaga", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({ ...FUT_COM_HORA, createdByPlayerId: admin.id });
    await confirmarPresenca(fut, admin);
    const fetchMock = stubResend();

    expect(await esperaRedirect(() => deleteMatchDay(fut.id))).toBe("/futs");
    await flushAfter();

    expect(payloadDoEnvio(fetchMock).subject).toContain("Cancelado:");
    const ics = icsDoEnvio(fetchMock);
    expect(ics).toContain("METHOD:CANCEL");
    // O +1 da pré-leitura: o cancelamento tem de superar o último REQUEST.
    expect(ics).toContain("SEQUENCE:1");
    const sobrou = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(sobrou).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Os freios de ./freios-de-envio, no caminho que eles existem para fechar.
//
// O e-mail de agenda passava por fora de TODOS os freios de ./email-convite, e
// o gatilho mais barato dele é o mais desprotegido: `setMyAttendance`, que
// qualquer jogador elegível dispara sozinho. Alternar "Vou"/"Fora" mandava dois
// e-mails por ciclo, ilimitado, contra a mesma cota de 100/dia do Resend que
// serve ao link de redefinição de acesso.
// ---------------------------------------------------------------------------
describe("freio do e-mail de agenda", () => {
  it("alternar presença não vira enxurrada de convite", async () => {
    const jogador = await jogadorLogado();
    const fut = await futQueAceitaEntrada(jogador);
    const fetchMock = stubResend();

    for (let volta = 0; volta < 5; volta++) {
      await setMyAttendance(fut.id, "in");
      await setMyAttendance(fut.id, "out");
    }
    await flushAfter();

    // Um convite (o primeiro) e, no máximo, um cancelamento por volta. O convite
    // é suprimido pela janela por par; o cancelamento é isento dela, porque
    // calendário que mente é pior que calendário atrasado — e quem limita ELE é
    // o teto diário por caixa de entrada, exercitado no teste seguinte.
    const assuntos = fetchMock.mock.calls.map((_, i) => payloadDoEnvio(fetchMock, i).subject);
    expect(assuntos.filter((a) => a.includes("Na agenda:"))).toHaveLength(1);
    expect(assuntos.length).toBeLessThanOrEqual(6);
  });

  // A regressão que o contador de `attendances.agenda_emails_sent` existe para
  // travar, e a razão de ele existir. Enquanto o ledger era só o carimbo —
  // sobrescrito a cada envio —, os dois tetos somavam LINHAS carimbadas: este
  // par (fut, jogador) valia 1 para sempre, o cancelamento é isento da janela, e
  // alternar presença mandava um e-mail por ciclo INDEFINIDAMENTE. Cem ciclos
  // zeravam a cota do Resend e derrubavam junto o link de redefinição de acesso,
  // que é o que o sub-teto veio proteger.
  //
  // `flushAfter` dentro do laço: sem ele os despachos correm concorrentes e
  // vários leem a contagem antes de o carimbo do anterior cair, o que torna o
  // total não determinístico. Serializado, a borda é exata.
  it("o teto por caixa de entrada fecha o loop de alternar presença", async () => {
    const jogador = await jogadorLogado();
    const fut = await futQueAceitaEntrada(jogador);
    const fetchMock = stubResend();

    const VOLTAS = TETO_AGENDA_POR_JOGADOR_DIA * 2;
    for (let volta = 0; volta < VOLTAS; volta++) {
      await setMyAttendance(fut.id, "in");
      await flushAfter();
      await setMyAttendance(fut.id, "out");
      await flushAfter();
    }

    // Para no teto, e não em `VOLTAS + 1`: o número de e-mails deixou de
    // depender do número de ciclos, que é o ponto.
    expect(fetchMock).toHaveBeenCalledTimes(TETO_AGENDA_POR_JOGADOR_DIA);
    const [linha] = await db
      .select()
      .from(attendances)
      .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
    expect(linha.agendaEmailsSent).toBe(TETO_AGENDA_POR_JOGADOR_DIA);
  });

  it("o teto por caixa de entrada segura até o cancelamento", async () => {
    const jogador = await jogadorLogado();
    const fut = await criarFut(FUT_COM_HORA);
    await confirmarPresenca(fut, jogador);

    // Já recebeu o teto do dia em OUTROS futs — é assim que "criar 50 futs e
    // confirmar em cada um" é barrado, e a linha deste fut fica intocada.
    // `agendaEmailsSent: 1` porque é o que um envio de verdade grava: o teto
    // soma envios, e um carimbo sem contador seria uma linha que não gastou nada.
    for (let i = 0; i < TETO_AGENDA_POR_JOGADOR_DIA; i++) {
      const outro = await criarFut({ ...FUT_COM_HORA, location: `Quadra ${i}` });
      await confirmarPresenca(outro, jogador);
      await db
        .update(attendances)
        .set({ agendaEmailSentAt: sql`now() - interval '1 hour'`, agendaEmailsSent: 1 })
        .where(and(eq(attendances.matchDayId, outro.id), eq(attendances.playerId, jogador.id)));
    }

    const fetchMock = stubResend();
    await setMyAttendance(fut.id, "out");
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o sub-teto da instalação não deixa a agenda comer a cota do convite", async () => {
    const jogador = await jogadorLogado();
    const fut = await futQueAceitaEntrada(jogador);

    // TETO_AGENDA_DIA envios de agenda já carimbados, espalhados por outros
    // jogadores — a instalação gastou a fatia dela.
    for (let i = 0; i < TETO_AGENDA_DIA; i++) {
      const outro = await criarJogador();
      const outroFut = await criarFut({ ...FUT_COM_HORA, location: `Quadra ${i}` });
      await confirmarPresenca(outroFut, outro);
      await db
        .update(attendances)
        .set({ agendaEmailSentAt: sql`now() - interval '1 hour'`, agendaEmailsSent: 1 })
        .where(eq(attendances.matchDayId, outroFut.id));
    }

    const fetchMock = stubResend();
    await setMyAttendance(fut.id, "in");
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
