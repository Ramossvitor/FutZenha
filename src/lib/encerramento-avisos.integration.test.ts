// Quem é avisado quando o fut encerra, contra o banco de verdade.
//
// Tudo passa pelo `confirmarEncerramento`, e não pelo `notificarEncerramento`
// direto: o que importa provar é o pacote que sai do encerramento inteiro —
// inclusive que o `rating_round_open` NÃO sai mais junto.

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { confirmarEncerramento } from "@/app/fut/[id]/gerenciar/encerrar/actions";
import { db } from "@/db";
import {
  attendances,
  matchDayInvitations,
  notifications,
  type Player,
} from "@/db/schema";
import { notificarEncerramento } from "@/lib/encerramento-avisos";
import { recusouEsteFut } from "@/lib/presenca";
import {
  criarFut,
  criarJogador,
  criarJogadorComConta,
  confirmarPresenca,
  logarComo,
} from "@/test/fixtures";
import { criarJogoComPresenca, criarTrioComConta } from "@/test/fixtures-avaliacao";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";

async function avisosDe(jogador: Player) {
  return db.select().from(notifications).where(eq(notifications.playerId, jogador.id));
}

/** Fut de grupo, dois trios com conta em campo, e o admin que encerra. */
async function montarFutDeGrupo() {
  const admin = await criarJogadorComConta();
  const groupId = (await criarGrupo()).id;
  await entrarNoGrupo(groupId, admin.jogador, "admin");

  const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });
  const timeA = await criarTrioComConta();
  const timeB = await criarTrioComConta();
  for (const j of [...timeA.jogadores, ...timeB.jogadores]) await entrarNoGrupo(groupId, j);
  await criarJogoComPresenca(fut, timeA.jogadores, timeB.jogadores);

  return { admin, groupId, fut, timeA, timeB };
}

async function encerrar(fut: { id: number }, admin: { conta: Parameters<typeof logarComo>[0] }) {
  await logarComo(admin.conta);
  return esperaRedirect(confirmarEncerramento(fut.id));
}

describe("avisos do encerramento", () => {
  it("quem jogou recebe UM aviso, levando à avaliação", async () => {
    const { fut, admin, timeA, timeB } = await montarFutDeGrupo();

    await encerrar(fut, admin);

    const [rodada] = await db
      .select({ id: notifications.href })
      .from(notifications)
      .where(eq(notifications.type, "fut_encerrado"))
      .limit(1);

    for (const j of [...timeA.jogadores, ...timeB.jogadores]) {
      const avisos = await avisosDe(j);
      expect(avisos).toHaveLength(1);
      expect(avisos[0].type).toBe("fut_encerrado");
      expect(avisos[0].href).toBe(rodada.id);
      expect(avisos[0].href).toMatch(/^\/avaliar\/\d+$/);
      expect(avisos[0].dedupeKey).toBe(`fut:${fut.id}:encerrado`);
    }
  });

  // O guarda do empacotamento: o aviso de avaliar saía daqui em paralelo com o
  // resto, e eram dois na mesma caixa no mesmo segundo.
  it("nenhum rating_round_open é emitido", async () => {
    const { fut, admin } = await montarFutDeGrupo();

    await encerrar(fut, admin);

    const antigos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "rating_round_open"));
    expect(antigos).toHaveLength(0);
  });

  it("membro do grupo que não jogou recebe o aviso curto, com href do fut", async () => {
    const { fut, admin, groupId } = await montarFutDeGrupo();
    const deFora = await criarJogadorComConta();
    await entrarNoGrupo(groupId, deFora.jogador);

    await encerrar(fut, admin);

    const avisos = await avisosDe(deFora.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("fut_encerrado_no_grupo");
    expect(avisos[0].href).toBe(`/fut/${fut.id}`);
    expect(avisos[0].dedupeKey).toBe(`fut:${fut.id}:encerrado-grupo`);
  });

  it("ninguém recebe os dois — quem jogou não é 'de fora'", async () => {
    const { fut, admin, timeA } = await montarFutDeGrupo();

    await encerrar(fut, admin);

    const doGrupo = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.playerId, timeA.jogadores[0].id),
          eq(notifications.type, "fut_encerrado_no_grupo"),
        ),
      );
    expect(doGrupo).toHaveLength(0);
  });

  // Quem clicou em "encerrar" não precisa ser avisado de que encerrou.
  it("quem encerrou não recebe o aviso de grupo", async () => {
    const { fut, admin } = await montarFutDeGrupo();

    await encerrar(fut, admin);

    expect(await avisosDe(admin.jogador)).toHaveLength(0);
  });

  it("quem jogou sem conta não recebe nada", async () => {
    const admin = await criarJogadorComConta();
    const groupId = (await criarGrupo()).id;
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });

    const timeA = await criarTrioComConta();
    const semConta = await criarJogador();
    const timeB = await criarTrioComConta();
    await criarJogoComPresenca(fut, [...timeA.jogadores, semConta], timeB.jogadores);

    await encerrar(fut, admin);

    expect(await avisosDe(semConta)).toHaveLength(0);
  });

  it("lado sem três contas cai na página do fut, e o outro lado na avaliação", async () => {
    const admin = await criarJogadorComConta();
    const groupId = (await criarGrupo()).id;
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });

    // Três contas de um lado (viram avaliadores) e duas do outro — abaixo do
    // MIN_GRUPO_AVALIACAO, então essas duas jogam e não avaliam.
    const trio = await criarTrioComConta();
    const dupla = [await criarJogadorComConta(), await criarJogadorComConta()];
    await criarJogoComPresenca(
      fut,
      trio.jogadores,
      dupla.map((d) => d.jogador),
    );

    await encerrar(fut, admin);

    for (const j of trio.jogadores) {
      const [aviso] = await avisosDe(j);
      expect(aviso.href).toMatch(/^\/avaliar\/\d+$/);
      expect(aviso.title).toContain("avalie");
    }
    for (const d of dupla) {
      const [aviso] = await avisosDe(d.jogador);
      expect(aviso.type).toBe("fut_encerrado");
      expect(aviso.href).toBe(`/fut/${fut.id}`);
      expect(aviso.title).toBe("Fut encerrado");
    }
  });

  it("sem rodada nenhuma, todo mundo que jogou vai para a página do fut", async () => {
    const admin = await criarJogadorComConta();
    const groupId = (await criarGrupo()).id;
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });

    // Um de cada lado com conta: ninguém alcança o mínimo, `abrirRodada` → null.
    const um = await criarJogadorComConta();
    const outro = await criarJogadorComConta();
    await criarJogoComPresenca(fut, [um.jogador], [outro.jogador]);

    await encerrar(fut, admin);

    for (const p of [um, outro]) {
      const [aviso] = await avisosDe(p.jogador);
      expect(aviso.type).toBe("fut_encerrado");
      expect(aviso.href).toBe(`/fut/${fut.id}`);
    }
  });

  it("fut sem jogo lançado não avisa quem jogou — não jogou ninguém", async () => {
    const admin = await criarJogadorComConta();
    const groupId = (await criarGrupo()).id;
    await entrarNoGrupo(groupId, admin.jogador, "admin");
    const fut = await criarFut({ groupId, createdByPlayerId: admin.jogador.id });
    const membro = await criarJogadorComConta();
    await entrarNoGrupo(groupId, membro.jogador);
    await confirmarPresenca(fut, membro.jogador);

    await encerrar(fut, admin);

    const jogaram = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fut_encerrado"));
    expect(jogaram).toHaveLength(0);
    // O membro do grupo continua sabendo que o fut acabou.
    expect((await avisosDe(membro.jogador))[0].type).toBe("fut_encerrado_no_grupo");
  });
});

describe("avisos do encerramento e a recusa", () => {
  // Decisão de produto registrada: recusar um fut é dizer "não vou jogar", não
  // "não quero saber do grupo". Este teste existe para que remover o aviso seja
  // uma escolha explícita, e não um "conserto" de quem cruzar com o
  // `recusouEsteFut` e achar que faltou um filtro.
  it("quem tirou o próprio nome ainda recebe o aviso do grupo", async () => {
    const { fut, admin, groupId } = await montarFutDeGrupo();
    const desistente = await criarJogadorComConta();
    await entrarNoGrupo(groupId, desistente.jogador);
    await confirmarPresenca(fut, desistente.jogador, { status: "out" });
    // O carimbo do consentimento retirado — as duas fontes de `recusouEsteFut`.
    await db
      .update(attendances)
      .set({ optedOutAt: sql`now()` })
      .where(
        and(
          eq(attendances.matchDayId, fut.id),
          eq(attendances.playerId, desistente.jogador.id),
        ),
      );
    await db.insert(matchDayInvitations).values({
      matchDayId: fut.id,
      playerId: desistente.jogador.id,
      status: "declined",
    });
    expect(await recusouEsteFut(fut.id, desistente.jogador.id)).toBe(true);

    await encerrar(fut, admin);

    const avisos = await avisosDe(desistente.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("fut_encerrado_no_grupo");
  });

  it("quem confirmou e faltou também recebe o aviso do grupo", async () => {
    const { fut, admin, groupId } = await montarFutDeGrupo();
    const faltou = await criarJogadorComConta();
    await entrarNoGrupo(groupId, faltou.jogador);
    await confirmarPresenca(fut, faltou.jogador);

    await encerrar(fut, admin);

    const avisos = await avisosDe(faltou.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("fut_encerrado_no_grupo");
  });
});

describe("avisos do encerramento em fut avulso", () => {
  // A regressão que o `condicaoDeAviso` existe para travar: com
  // `condicaoElegivel` cru, o `undefined` some dentro do `and()` do drizzle e o
  // aviso vaza para TODO jogador ativo da plataforma, com push junto.
  it("avisa quem já dividiu um fut com quem criou, e mais ninguém", async () => {
    const admin = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogoComPresenca(fut, timeA.jogadores, timeB.jogadores);

    // Do círculo: dividiu um fut ANTIGO com quem criou este.
    const conhecido = await criarJogadorComConta();
    const futAntigo = await criarFut({ createdByPlayerId: admin.jogador.id });
    await confirmarPresenca(futAntigo, admin.jogador);
    await confirmarPresenca(futAntigo, conhecido.jogador);

    // Fora do círculo: nunca cruzou com ninguém daqui.
    const estranho = await criarJogadorComConta();

    await encerrar(fut, admin);

    expect((await avisosDe(conhecido.jogador))[0].type).toBe("fut_encerrado_no_grupo");
    expect(await avisosDe(estranho.jogador)).toHaveLength(0);
  });

  // Direto no notificarEncerramento, e não pelo confirmarEncerramento: um fut
  // avulso sem criador não tem admin, então não há quem clique em "encerrar".
  // O estado existe mesmo assim (a FK é `set null`), e é o caso em que o
  // `undefined` engolido pelo `and()` virava "avise a plataforma inteira".
  it("fut avulso órfão não avisa ninguém de fora", async () => {
    const criador = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: criador.jogador.id });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogoComPresenca(fut, timeA.jogadores, timeB.jogadores);

    const conhecido = await criarJogadorComConta();
    await confirmarPresenca(fut, conhecido.jogador);

    await notificarEncerramento(
      db,
      { ...fut, createdByPlayerId: null },
      null,
      criador.jogador.id,
    );

    // Quem jogou continua sendo avisado — o órfão só apaga o círculo de fora.
    expect((await avisosDe(timeA.jogadores[0]))[0].type).toBe("fut_encerrado");
    expect(await avisosDe(conhecido.jogador)).toHaveLength(0);
  });
});

describe("idempotência do aviso de encerramento", () => {
  it("a unique (playerId, dedupeKey) impede o segundo aviso", async () => {
    const { fut, admin, timeA } = await montarFutDeGrupo();

    await encerrar(fut, admin);
    // Encerrar de novo cai no redirect de "já encerrada" antes de qualquer
    // escrita — mas mesmo que não caísse, a chave é quem garante.
    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(fut.id));

    expect(await avisosDe(timeA.jogadores[0])).toHaveLength(1);
  });
});
