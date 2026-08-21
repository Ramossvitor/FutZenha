// O e-mail de resumo contra o banco de verdade: quem recebe, o que vai dentro,
// e o ledger que impede o segundo envio.
//
// Tudo passa pelo `confirmarEncerramento` + `flushAfter()`, porque o envio mora
// num `after()` — testar a função interna direto pularia justamente o
// agendamento, que é onde o kill switch e o `try/catch` moram.

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmarEncerramento } from "@/app/fut/[id]/gerenciar/encerrar/actions";
import { db } from "@/db";
import { attendances, matchDays, players, users, type Player } from "@/db/schema";
import { retomarResumosPendentes } from "@/lib/email-resumo";
import { TETO_RESUMO_DIA } from "@/lib/freios-de-envio";
import { criarFut, criarJogadorComConta, criarJogador, logarComo } from "@/test/fixtures";
import {
  criarJogoComPresenca,
  criarTrioComConta,
  definirPlacar,
  lancarGols,
} from "@/test/fixtures-avaliacao";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { flushAfter } from "@/test/after-flush";
import { esperaRedirect } from "@/test/navigation-fake";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Contas de fixture nascem sem endereço nenhum, e `emailDeDestino()` é
 * `coalesce(users.email, users.contact_email)` — sem isto o lote sai vazio e
 * todo teste daqui passaria verde sem mandar nada.
 */
async function darEmail(jogadores: Player[]): Promise<void> {
  for (const j of jogadores) {
    await db
      .update(users)
      .set({ email: `jogador${j.id}@example.com` })
      .where(eq(users.playerId, j.id));
  }
}

async function carimboDe(fut: { id: number }, jogador: Player) {
  const [linha] = await db
    .select({ em: attendances.resumoEmailSentAt })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha?.em ?? null;
}

/**
 * Gasta `quantos` e-mails de resumo da cota do dia, em outro fut.
 *
 * O resumo conta LINHAS carimbadas (uma linha é um e-mail — ver
 * `enviadosPeloResumoNoDia`), então precisa de gente de verdade pela FK. Em
 * dois round-trips, e não num laço de `criarJogador`: são dezenas de linhas, e
 * o laço sozinho custava mais que o resto do teste.
 */
async function ocuparCotaDeResumo(quantos: number): Promise<void> {
  const enchendo = await criarFut();
  const inseridos = await db
    .insert(players)
    .values(Array.from({ length: quantos }, (_, i) => ({ name: `Cota resumo ${i}` })))
    .returning({ id: players.id });
  await db.insert(attendances).values(
    inseridos.map((p) => ({
      matchDayId: enchendo.id,
      playerId: p.id,
      status: "in" as const,
      resumoEmailSentAt: sql`now() - interval '1 hour'`,
    })),
  );
}

/**
 * Gasta `quantos` e-mails de agenda da cota do dia.
 *
 * Uma linha só: a agenda soma `agenda_emails_sent` em vez de contar linhas,
 * justamente porque o carimbo dela é sobrescrito a cada reenvio.
 */
async function ocuparCotaDeAgenda(quantos: number): Promise<void> {
  const enchendo = await criarFut();
  const jogador = await criarJogador();
  await db.insert(attendances).values({
    matchDayId: enchendo.id,
    playerId: jogador.id,
    status: "in" as const,
    agendaEmailSentAt: sql`now() - interval '1 hour'`,
    agendaEmailsSent: quantos,
  });
}

/** Fut de grupo com placar e gols, pronto para encerrar. */
async function montarFutComPlacar() {
  const admin = await criarJogadorComConta();
  const groupId = await criarGrupo();
  await entrarNoGrupo(groupId, admin.jogador, "admin");
  const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });

  const timeA = await criarTrioComConta();
  const timeB = await criarTrioComConta();
  for (const j of [...timeA.jogadores, ...timeB.jogadores]) await entrarNoGrupo(groupId, j);
  await darEmail([...timeA.jogadores, ...timeB.jogadores]);

  const jogo = await criarJogoComPresenca(fut, timeA.jogadores, timeB.jogadores);
  await definirPlacar(jogo, 2, 1);
  await lancarGols(jogo, [
    { jogador: timeA.jogadores[0], quantidade: 2 },
    { side: "B", quantidade: 1 },
  ]);

  return { admin, groupId, fut, jogo, timeA, timeB };
}

async function encerrar(fut: { id: number }, admin: { conta: Parameters<typeof logarComo>[0] }) {
  await logarComo(admin.conta);
  await esperaRedirect(confirmarEncerramento(fut.id));
  await flushAfter();
}

describe("e-mail de resumo do fut", () => {
  it("um e-mail por jogador com conta, e nenhum para quem não jogou", async () => {
    const { fut, admin, groupId, timeA, timeB } = await montarFutComPlacar();
    const deFora = await criarJogadorComConta();
    await entrarNoGrupo(groupId, deFora.jogador);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const destinatarios = Array.from({ length: 6 }, (_, i) => payloadDoEnvio(fetchMock, i).to[0]);
    for (const j of [...timeA.jogadores, ...timeB.jogadores]) {
      expect(await carimboDe(fut, j)).not.toBeNull();
    }
    // Quem não jogou não aparece em nenhum `to` — nem tem linha para carimbar.
    expect(destinatarios).toHaveLength(new Set(destinatarios).size);
    expect(await carimboDe(fut, deFora.jogador)).toBeNull();
  });

  it("quem jogou sem conta não recebe", async () => {
    const admin = await criarJogadorComConta();
    const groupId = await criarGrupo();
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    const semConta = await criarJogador();
    await darEmail([...timeA.jogadores, ...timeB.jogadores]);
    const jogo = await criarJogoComPresenca(fut, timeA.jogadores, [
      semConta,
      ...timeB.jogadores,
    ]);
    await definirPlacar(jogo, 1, 0);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await carimboDe(fut, semConta)).toBeNull();
  });

  it("o e-mail leva o placar, os gols e o link de avaliar", async () => {
    const { fut, admin } = await montarFutComPlacar();
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    const email = payloadDoEnvio(fetchMock);
    expect(email.subject).toContain("Como foi o fut");
    expect(email.text).toMatch(/2 x 1/);
    expect(email.text).toContain("Gol contra / sem autor");
    expect(email.text).toMatch(/\/avaliar\/\d+/);
    expect(email.html).toMatch(/\/avaliar\/\d+/);
  });

  // A mesma distinção do aviso: quem não é avaliador elegível recebe o resumo
  // sem a chamada, e com o link do fut.
  it("quem jogou e não avalia recebe o link do fut, sem a cobrança", async () => {
    const admin = await criarJogadorComConta();
    const groupId = await criarGrupo();
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });
    const um = await criarJogadorComConta();
    const outro = await criarJogadorComConta();
    await darEmail([um.jogador, outro.jogador]);
    const jogo = await criarJogoComPresenca(fut, [um.jogador], [outro.jogador]);
    await definirPlacar(jogo, 3, 3);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const email = payloadDoEnvio(fetchMock);
    expect(email.text).toContain(`/fut/${fut.id}`);
    expect(email.text).not.toContain("/avaliar/");
    expect(email.html).toContain("Ver o fut");
  });

  // A precedência de emailDeDestino é regra de segurança: o endereço verificado
  // pelo Google vence o autodeclarado.
  it("manda para users.email quando há os dois", async () => {
    const { fut, admin, timeA } = await montarFutComPlacar();
    await db
      .update(users)
      .set({ email: "verificado@example.com", contactEmail: "autodeclarado@example.com" })
      .where(eq(users.playerId, timeA.jogadores[0].id));
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    const enviados = Array.from({ length: 6 }, (_, i) => payloadDoEnvio(fetchMock, i).to[0]);
    expect(enviados).toContain("verificado@example.com");
    expect(enviados).not.toContain("autodeclarado@example.com");
  });

  it("sem RESEND_API_KEY não sai e-mail nem carimbo", async () => {
    const { fut, admin, timeA } = await montarFutComPlacar();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await encerrar(fut, admin);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await carimboDe(fut, timeA.jogadores[0])).toBeNull();
  });

  it("fut sem jogo lançado não gera e-mail", async () => {
    const admin = await criarJogadorComConta();
    const groupId = await criarGrupo();
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("o ledger do resumo", () => {
  it("falha do Resend não carimba — quem não recebeu continua elegível", async () => {
    const { fut, admin } = await montarFutComPlacar();
    // O primeiro falha (500 não é retentado), os cinco seguintes passam.
    const fetchMock = stubResend(500, 200);

    await encerrar(fut, admin);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const carimbados = await db
      .select({ id: attendances.playerId })
      .from(attendances)
      .where(
        and(eq(attendances.matchDayId, fut.id), isNotNull(attendances.resumoEmailSentAt)),
      );
    expect(carimbados).toHaveLength(5);
  });

  // A idempotência do envio. O `after` pode ser cortado pelo maxDuration e
  // retomado; sem isto, a retomada mandaria tudo de novo.
  it("uma segunda passada não manda nada para quem já recebeu", async () => {
    const { fut, admin } = await montarFutComPlacar();
    const primeiro = stubResend();
    await encerrar(fut, admin);
    expect(primeiro).toHaveBeenCalledTimes(6);

    const { agendarResumoDoFut } = await import("./email-resumo");
    const segundo = stubResend();
    agendarResumoDoFut(fut.id);
    await flushAfter();

    expect(segundo).not.toHaveBeenCalled();
  });

  it("o lote que não cabe na cota da instalação não sai — nenhum e-mail, não metade", async () => {
    const { fut, admin, timeA } = await montarFutComPlacar();
    // Enche com AGENDA, não com resumo: assim quem barra é o TETO_DIARIO, e não
    // o sub-teto do teste abaixo. A agenda soma `agenda_emails_sent`, então uma
    // linha só carrega os 95 (ver enviadosPelaAgendaNoDia).
    await ocuparCotaDeAgenda(95);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await carimboDe(fut, timeA.jogadores[0])).toBeNull();
  });

  // O sub-teto do resumo, que é o que devolve ao convite a folga perdida quando
  // o TETO_DIARIO subiu para 100. Os números são escolhidos para que só ele
  // possa ter barrado: 58 + 6 passa longe dos 100 da instalação e estoura os 60
  // do resumo.
  it("o sub-teto do resumo barra o lote antes de a cota da instalação acabar", async () => {
    const { fut, admin, timeA } = await montarFutComPlacar();
    await ocuparCotaDeResumo(58);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await carimboDe(fut, timeA.jogadores[0])).toBeNull();
  });

  // O contrapeso do teste acima: logo abaixo da linha, o mesmo lote sai. Sem
  // ele, um sub-teto de zero passaria nos dois.
  it("logo abaixo do sub-teto o lote sai inteiro", async () => {
    const { fut, admin } = await montarFutComPlacar();
    // 54 + 6 = 60, que é o teto e não o ultrapassa.
    await ocuparCotaDeResumo(54);
    const fetchMock = stubResend();

    await encerrar(fut, admin);

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("retomada do resumo", () => {
  /** Carimba à mão, simulando quem JÁ recebeu antes do corte da invocação. */
  async function carimbar(fut: { id: number }, jogadores: Player[]): Promise<void> {
    for (const j of jogadores) {
      await db
        .update(attendances)
        .set({ resumoEmailSentAt: sql`now()` })
        .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, j.id)));
    }
  }

  /** Encerra com o envio desligado: o fut fica `finished` sem nenhum carimbo. */
  async function encerrarSemEnviar(
    fut: { id: number },
    admin: { conta: Parameters<typeof logarComo>[0] },
  ): Promise<void> {
    const semKey = vi.fn();
    vi.stubGlobal("fetch", semKey);
    await encerrar(fut, admin);
    expect(semKey).not.toHaveBeenCalled();
  }

  // O caso central: a invocação morreu depois de cinco dos seis.
  it("completa quem ficou de fora do lote cortado no meio", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    const [faltando, ...jaReceberam] = [...timeA.jogadores, ...timeB.jogadores];
    await carimbar(fut, jaReceberam);

    const fetchMock = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 1, adiados: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).to[0]).toBe(`jogador${faltando.id}@example.com`);
    expect(await carimboDe(fut, faltando)).not.toBeNull();
  });

  it("uma segunda passada não manda nada", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    await carimbar(fut, [...timeA.jogadores, ...timeB.jogadores].slice(1));

    stubResend();
    await retomarResumosPendentes();
    const segunda = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });
    expect(segunda).not.toHaveBeenCalled();
  });

  it("fut com todo mundo carimbado nem é candidato", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    await carimbar(fut, [...timeA.jogadores, ...timeB.jogadores]);

    const fetchMock = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A prova de que o `emailDeDestino() is not null` está na consulta de
  // CANDIDATOS, e não só no envio: sem ele este fut giraria a cada tick por 24h.
  it("quem não tem endereço não faz o fut virar candidato eterno", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    const todos = [...timeA.jogadores, ...timeB.jogadores];
    const semEmail = todos[0];
    await db.update(users).set({ email: null }).where(eq(users.playerId, semEmail.id));
    await carimbar(fut, todos.slice(1));

    const fetchMock = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fut encerrado há mais de 24h sai da janela", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    await carimbar(fut, [...timeA.jogadores, ...timeB.jogadores].slice(1));
    await db
      .update(matchDays)
      .set({ finishedAt: sql`now() - interval '25 hours'` })
      .where(eq(matchDays.id, fut.id));

    const fetchMock = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fut que ainda não encerrou não é candidato", async () => {
    // Montado e deixado `scheduled` de propósito — ninguém chamou o encerrar.
    await montarFutComPlacar();

    const fetchMock = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // O segundo caso definitivo que a retomada cobre: o lote recusado inteiro pela
  // cota de ontem sai quando a cota renova.
  it("o lote recusado pela cota sai quando a cota renova", async () => {
    const { fut, admin } = await montarFutComPlacar();
    // Enche a cota do resumo antes do encerramento: o lote não cabe e nada sai.
    const enchendo = await criarFut();
    const volume = [];
    for (let i = 0; i < TETO_RESUMO_DIA; i += 1) volume.push(await criarJogador());
    await db.insert(attendances).values(
      volume.map((p) => ({
        matchDayId: enchendo.id,
        playerId: p.id,
        status: "in" as const,
        resumoEmailSentAt: sql`now() - interval '1 hour'`,
      })),
    );

    const recusado = stubResend();
    await encerrar(fut, admin);
    expect(recusado).not.toHaveBeenCalled();

    // A cota "renova": os carimbos velhos saem da janela de 24h.
    await db
      .update(attendances)
      .set({ resumoEmailSentAt: sql`now() - interval '25 hours'` })
      .where(eq(attendances.matchDayId, enchendo.id));

    const depois = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 1, adiados: 0 });
    expect(depois).toHaveBeenCalledTimes(6);
  });

  it("mais futs que o teto por varredura: o resto fica para o próximo tick", async () => {
    const pendentes = [];
    for (let i = 0; i < 3; i += 1) {
      const { fut, admin, timeA, timeB } = await montarFutComPlacar();
      await encerrarSemEnviar(fut, admin);
      await carimbar(fut, [...timeA.jogadores, ...timeB.jogadores].slice(1));
      pendentes.push(fut);
    }

    const primeira = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 2, adiados: 1 });
    expect(primeira).toHaveBeenCalledTimes(2);

    const segunda = stubResend();
    expect(await retomarResumosPendentes()).toEqual({ futs: 1, adiados: 0 });
    expect(segunda).toHaveBeenCalledTimes(1);
  });

  it("sem RESEND_API_KEY não varre nem consulta", async () => {
    const { fut, admin, timeA, timeB } = await montarFutComPlacar();
    await encerrarSemEnviar(fut, admin);
    await carimbar(fut, [...timeA.jogadores, ...timeB.jogadores].slice(1));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const selectSpy = vi.spyOn(db, "selectDistinct");

    expect(await retomarResumosPendentes()).toEqual({ futs: 0, adiados: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
  });
});
