// O ciclo do evento de agenda, do clique ao anexo: quem recebe convite, quem
// recebe cancelamento e com que SEQUENCE. O .ics é lido de volta do payload do
// Resend — é o que o cliente de e-mail veria, e é onde a regressão apareceria.

import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
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
import { esperaRedirect } from "@/test/navigation-fake";
import { flushAfter } from "@/test/after-flush";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

const EMAIL = "jogador@example.com";
const FUT_COM_HORA = { date: "2026-08-22", startTime: "20:00:00" };

/** O .ics de dentro do anexo do envio `indice`. */
function icsDoEnvio(fetchMock: ReturnType<typeof vi.fn>, indice = 0): string {
  const anexos = payloadDoEnvio(fetchMock, indice).attachments;
  if (!anexos || anexos.length === 0) throw new Error("envio sem anexo .ics");
  return Buffer.from(anexos[0].content, "base64").toString("utf-8");
}

/** Jogador com conta e e-mail — o caso que recebe convite. */
async function jogadorComEmail(email = EMAIL): Promise<Player> {
  const { jogador } = await criarJogadorComConta({}, { email });
  return jogador;
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
    const fut = await criarFut(FUT_COM_HORA);
    const fetchMock = stubResend();

    const uid = `UID:fut-${fut.id}-${jogador.id}@futzenha.com.br`;

    await setMyAttendance(fut.id, "in");
    await flushAfter();
    expect(icsDoEnvio(fetchMock, 0)).toContain("METHOD:REQUEST");
    expect(icsDoEnvio(fetchMock, 0)).toContain("SEQUENCE:0");

    await setMyAttendance(fut.id, "out");
    await flushAfter();
    expect(payloadDoEnvio(fetchMock, 1).subject).toContain("Fora da lista:");
    expect(icsDoEnvio(fetchMock, 1)).toContain("METHOD:CANCEL");
    expect(icsDoEnvio(fetchMock, 1)).toContain("SEQUENCE:1");

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
    const fut = await criarFut({ ...FUT_COM_HORA, maxPlayers: 2 });
    for (const jogador of cheios) await confirmarPresenca(fut, jogador);
    const atrasado = await jogadorLogado("c@example.com");
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
