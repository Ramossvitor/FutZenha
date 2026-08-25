// As duas defesas do evento de agenda contra quem administra o fut.
//
// O evento vai para a agenda de terceiros, e quem administra reescreve o bloco
// de todo mundo que confirmou. São dois abusos possíveis e duas travas:
//   - tamanho — o match_days_duracao_check, que este arquivo testa por INSERT
//     cru, sem passar pelo zod: é a garantia que sobrevive a uma action nova;
//   - frequência — o freio de agenda-freio.ts, que segura a enxurrada de
//     "o fut mudou" sem impedir a mudança em si.

import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays } from "@/db/schema";
import { updateMatchDay } from "@/app/(esqueleto)/fut/[id]/gerenciar/actions";
import { LIMITE_PUSHES_AGENDA_DIA } from "@/lib/agenda-freio";
import {
  confirmarPresenca,
  criarFut,
  criarJogadorComConta,
  logarComo,
} from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { flushAfter } from "@/test/after-flush";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

const EMAIL = "jogador@example.com";

function formDoFut(campos: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData();
  form.set("date", campos.date ?? "2026-08-22");
  form.set("startTime", campos.startTime ?? "20:00");
  form.set("endTime", campos.endTime ?? "");
  form.set("location", campos.location ?? "Quadra de Teste");
  form.set("notes", campos.notes ?? "");
  form.set("maxPlayers", campos.maxPlayers ?? "");
  return form;
}

/**
 * A constraint que o Postgres recusou, ou null se o insert passou.
 *
 * O drizzle embrulha o erro do driver e a mensagem de fora só diz "Failed
 * query" — o nome da constraint mora na cadeia de `cause`, como em
 * src/lib/db-errors.ts. Sem isto o teste passaria com qualquer erro, inclusive
 * um typo no SQL.
 */
async function constraintViolada(query: Promise<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (erro: unknown) {
    let atual: unknown = erro;
    while (typeof atual === "object" && atual !== null) {
      // 23514 = check_violation. O nome vem em `constraint_name` (postgres.js).
      if ("constraint_name" in atual && typeof atual.constraint_name === "string") {
        return atual.constraint_name;
      }
      atual = (atual as { cause?: unknown }).cause;
    }
    throw erro;
  }
}

/** Fut com admin logado e uma pessoa confirmada — quem receberia os avisos. */
async function futComConfirmado() {
  const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
  await logarComo(conta);
  const fut = await criarFut({
    date: "2026-08-22",
    startTime: "20:00:00",
    createdByPlayerId: admin.id,
  });
  await confirmarPresenca(fut, admin);
  return fut;
}

describe("match_days_duracao_check", () => {
  // INSERT cru de propósito: o zod de match-day-form.ts dá a mensagem, mas quem
  // garante é o banco. Se um dia outra action gravar match_days sem passar por
  // aquele schema, é esta constraint que impede o fut de dois dias.
  it("recusa fut que tomaria o dia de quem confirmou", async () => {
    const constraint = await constraintViolada(
      db.execute(
        sql`insert into match_days (date, start_time, end_time, location) values ('2026-08-22', '08:00', '23:00', 'Quadra')`,
      ),
    );
    expect(constraint).toBe("match_days_duracao_check");
  });

  it("recusa término sem início e duração curta demais", async () => {
    for (const valores of [
      "('2026-08-22', null, '22:00', 'Quadra')",
      "('2026-08-22', '20:00', '20:10', 'Quadra')",
      // 23h59 pela virada de meia-noite — o caso que só o teto pega.
      "('2026-08-22', '20:00', '19:59', 'Quadra')",
    ]) {
      const constraint = await constraintViolada(
        db.execute(
          sql.raw(
            `insert into match_days (date, start_time, end_time, location) values ${valores}`,
          ),
        ),
      );
      expect(constraint).toBe("match_days_duracao_check");
    }
  });

  // A virada de meia-noite tem que passar nos dois lados iguais — o SQL usa
  // `+ interval '24 hours'`, o zod usa duracaoDoFut. Divergir aqui faria o
  // formulário aceitar o que o banco recusa, e o erro cairia como 500.
  it("aceita o que o formulário aceita: virada de meia-noite e fut sem término", async () => {
    expect(
      await constraintViolada(
        db.execute(
          sql`insert into match_days (date, start_time, end_time, location) values ('2026-08-22', '22:00', '00:30', 'Quadra')`,
        ),
      ),
    ).toBeNull();
    // Fut anterior a este campo: end_time nulo passa sem o check reclamar.
    expect(
      await constraintViolada(
        db.execute(
          sql`insert into match_days (date, start_time, location) values ('2026-08-22', '20:00', 'Quadra')`,
        ),
      ),
    ).toBeNull();
  });
});

/** Envelhece o carimbo de envio do par, para sair da janela por (fut, jogador). */
async function envelhecerCarimboDeAgenda(matchDayId: number, minutos: number): Promise<void> {
  await db
    .update(attendances)
    .set({
      agendaEmailSentAt: sql`now() - interval '${sql.raw(String(Math.trunc(minutos)))} minutes'`,
    })
    .where(eq(attendances.matchDayId, matchDayId));
}

describe("freio do aviso de agenda", () => {
  // São DUAS travas empilhadas, e esta é a de fora: a janela por par
  // (fut, jogador) de ./freios-de-envio. Ela é mais estreita que a cota do fut,
  // então numa enxurrada é ela que responde — cinco salvamentos seguidos viram
  // UM e-mail, não cinco. Antes dela, a cota do fut deixava passar os cinco.
  it("a janela por par transforma a enxurrada num e-mail só", async () => {
    const fut = await futComConfirmado();
    const fetchMock = stubResend();

    for (let i = 0; i < LIMITE_PUSHES_AGENDA_DIA; i++) {
      await updateMatchDay(fut.id, formDoFut({ startTime: `${10 + i}:00` }));
    }
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O banco nunca mente sobre o fut: o que ficou para trás é o e-mail.
    const [depois] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(depois.startTime).toBe("14:00:00");
  });

  // E esta é a de dentro: mesmo com a janela por par sempre vencida — o caso de
  // quem espaça os salvamentos de propósito —, o fut só dispara LIMITE lotes.
  it("a cota do fut segura mesmo com a janela por par vencida", async () => {
    const fut = await futComConfirmado();
    const fetchMock = stubResend();

    for (let i = 0; i < LIMITE_PUSHES_AGENDA_DIA; i++) {
      await envelhecerCarimboDeAgenda(fut.id, 11);
      await updateMatchDay(fut.id, formDoFut({ startTime: `${10 + i}:00` }));
      await flushAfter();
    }
    expect(fetchMock).toHaveBeenCalledTimes(LIMITE_PUSHES_AGENDA_DIA);

    // A seguinte estoura a cota: salva, avisa quem administra e não manda nada.
    await envelhecerCarimboDeAgenda(fut.id, 11);
    const destino = await esperaRedirect(() =>
      updateMatchDay(fut.id, formDoFut({ startTime: "19:00" })),
    );
    await flushAfter();

    expect(destino).toBe(`/fut/${fut.id}/gerenciar?ok=salvo-sem-avisar`);
    expect(fetchMock).toHaveBeenCalledTimes(LIMITE_PUSHES_AGENDA_DIA);
    const [depois] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(depois.startTime).toBe("19:00:00");
  });

  // A cota volta aos poucos (token bucket), não de uma vez na virada de uma
  // janela. É o que impede o dobro do teto em dois minutos: cinco no fim de uma
  // janela fixa e cinco no começo da seguinte.
  it("a cota volta de uma em uma, não em bloco", async () => {
    const fut = await futComConfirmado();
    const fetchMock = stubResend();

    // Exatamente o teto: a cota fica zerada, e nenhum destes redireciona.
    for (let i = 0; i < LIMITE_PUSHES_AGENDA_DIA; i++) {
      await envelhecerCarimboDeAgenda(fut.id, 11);
      await updateMatchDay(fut.id, formDoFut({ startTime: `${10 + i}:00` }));
      await flushAfter();
    }
    expect(fetchMock).toHaveBeenCalledTimes(LIMITE_PUSHES_AGENDA_DIA);

    // 5h depois: uma cota repôs (o intervalo é 24h/5 = 4h48), e só uma.
    await db
      .update(matchDays)
      .set({ calendarPushesSince: sql`now() - interval '5 hours'` })
      .where(eq(matchDays.id, fut.id));

    await envelhecerCarimboDeAgenda(fut.id, 11);
    await updateMatchDay(fut.id, formDoFut({ startTime: "07:00" }));
    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(LIMITE_PUSHES_AGENDA_DIA + 1);

    // A seguinte já não tem saldo: a reposição é de uma, não do teto inteiro.
    await envelhecerCarimboDeAgenda(fut.id, 11);
    await esperaRedirect(() => updateMatchDay(fut.id, formDoFut({ startTime: "06:00" })));
    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(LIMITE_PUSHES_AGENDA_DIA + 1);
  });

  // Cota gasta num fut sem ninguém confirmado é cota que falta na mudança que
  // importa — e o organizador não teria como saber por que acabou.
  it("não consome cota quando não há ninguém para avisar", async () => {
    const { jogador: admin, conta } = await criarJogadorComConta({}, { email: EMAIL });
    await logarComo(conta);
    const fut = await criarFut({
      date: "2026-08-22",
      startTime: "20:00:00",
      createdByPlayerId: admin.id,
    });
    const fetchMock = stubResend();

    // Dez salvamentos sem ninguém na lista: nenhum e-mail, nenhuma cota.
    for (let i = 0; i < 10; i++) {
      await updateMatchDay(fut.id, formDoFut({ startTime: `${10 + i}:00` }));
    }
    await flushAfter();
    expect(fetchMock).not.toHaveBeenCalled();

    const [linha] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(linha.calendarPushes).toBe(0);
  });

  // O freio pega só o broadcast — o alvo dele é "quantas vezes um fut dispara um
  // lote". Quem limita convite e cancelamento é a janela por par de
  // ./freios-de-envio, testada em agenda-convite.integration.test.ts.
  it("não conta salvamento que não mexe no evento", async () => {
    const fut = await futComConfirmado();
    const fetchMock = stubResend();

    for (let i = 0; i < LIMITE_PUSHES_AGENDA_DIA + 3; i++) {
      await updateMatchDay(fut.id, formDoFut({ notes: `observação ${i}` }));
    }
    await flushAfter();

    expect(fetchMock).not.toHaveBeenCalled();
    // A cota continua inteira: a próxima mudança de verdade ainda avisa.
    await updateMatchDay(fut.id, formDoFut({ notes: "final", endTime: "22:00" }));
    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).subject).toContain("Fut atualizado:");
  });
});
