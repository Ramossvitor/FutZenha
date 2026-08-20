// A etapa de véspera da varredura: fut marcado para amanhã lembra quem é
// elegível, tem conta ativa e ainda não respondeu — uma vez só, graças ao
// dedupe. As outras etapas da varredura (rodadas, denúncias, votações) já são
// cobertas pelos testes dos módulos que elas chamam.

import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, type Player } from "@/db/schema";
import { processarPendencias } from "@/lib/pendencias";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarFut,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";

// A data sai do relógio do BANCO, regra da casa: calcular "amanhã em São
// Paulo" no runner colocaria dois relógios na mesma conta e viraria flake de
// virada de dia.
const AMANHA_SP = sql`((now() at time zone 'America/Sao_Paulo')::date + 1)` as unknown as string;

const notificacoesDe = (jogador: Player) =>
  db.select().from(notifications).where(eq(notifications.playerId, jogador.id));

describe("processarPendencias — lembrete de véspera", () => {
  it("lembra quem tem conta e não respondeu; ignora quem respondeu, quem não tem conta e fut de outro dia", async () => {
    // O fut avulso precisa de criador: o alcance do lembrete é o círculo de
    // quem marcou (ver condicaoDeAviso), não a plataforma inteira.
    const { jogador: criador } = await criarJogadorComConta();
    const fut = await criarFut({ date: AMANHA_SP, createdByPlayerId: criador.id });
    const { jogador: semResposta } = await criarJogadorComConta();
    const { jogador: jaConfirmou } = await criarJogadorComConta();
    const { jogador: jaRecusou } = await criarJogadorComConta();
    const semConta = await criarJogador();
    // Conta desativada é diferente de "sem conta": a linha em users existe, e
    // sem o eq(users.active, true) ela receberia lembrete de um fut em que
    // não consegue nem entrar.
    const { jogador: contaDesativada } = await criarJogadorComConta({}, { active: false });

    // O histórico que põe todos no círculo de quem marcou — sem ele, ninguém
    // seria lembrado e o teste mediria o filtro errado.
    const anterior = await criarFut({ date: "2026-01-10" });
    for (const p of [criador, semResposta, jaConfirmou, jaRecusou, semConta, contaDesativada]) {
      await confirmarPresenca(anterior, p);
    }
    await confirmarPresenca(fut, jaConfirmou, { minutosAtras: 10 });
    await confirmarPresenca(fut, jaRecusou, { status: "out" });
    // Fut de depois de amanhã não entra na véspera de hoje.
    await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date + 2)` as unknown as string,
      location: "Quadra de Depois",
    });

    const resultado = await processarPendencias();

    // Dois: `semResposta` e o próprio `criador`, que também não confirmou. O
    // lembrete de véspera não exclui quem marcou — ao contrário do aviso de
    // "fut marcado" —, e é o certo: quem organiza também esquece de entrar na
    // própria lista.
    expect(resultado.lembretesDeVespera).toBe(2);
    expect(await notificacoesDe(criador)).toHaveLength(1);
    const avisos = await notificacoesDe(semResposta);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_lembrete_vespera",
      dedupeKey: `pelada:${fut.id}:lembrete-vespera`,
      href: `/fut/${fut.id}`,
    });
    expect(await notificacoesDe(jaConfirmou)).toHaveLength(0);
    expect(await notificacoesDe(jaRecusou)).toHaveLength(0);
    expect(await notificacoesDe(semConta)).toHaveLength(0);
    expect(await notificacoesDe(contaDesativada)).toHaveLength(0);
  });

  // O estado normal na véspera de um jogo já organizado é `teams_drawn` —
  // perguntar "você vai?" para quem já está escalado é o falso positivo mais
  // barulhento possível num canal que agora vai para a tela de bloqueio.
  it("só fut ainda aberto lembra: com times sorteados ou encerrado, não", async () => {
    const { jogador } = await criarJogadorComConta();
    for (const status of ["teams_drawn", "finished"] as const) {
      await criarFut({ date: AMANHA_SP, status, location: `Quadra ${status}` });
    }

    const resultado = await processarPendencias();

    expect(resultado.lembretesDeVespera).toBe(0);
    expect(await notificacoesDe(jogador)).toHaveLength(0);
  });

  it("rodar de novo não duplica o lembrete — o dedupe segura o piggyback de cada minuto", async () => {
    const { jogador: criador } = await criarJogadorComConta();
    const { jogador } = await criarJogadorComConta();
    const anterior = await criarFut({ date: "2026-01-10" });
    await confirmarPresenca(anterior, criador);
    await confirmarPresenca(anterior, jogador);
    await criarFut({ date: AMANHA_SP, createdByPlayerId: criador.id });

    await processarPendencias();
    await processarPendencias();

    expect(await notificacoesDe(jogador)).toHaveLength(1);
  });

  // A mesma regressão do createMatchDay, no outro caminho que emitia o aviso:
  // o lembrete de véspera também lia `condicaoElegivel`, que devolve
  // `undefined` em fut avulso — e o `and()` do drizzle o descartava, mandando
  // "amanhã tem fut" para toda a plataforma.
  it("fut avulso não lembra quem nunca jogou com quem marcou", async () => {
    const { jogador: criador } = await criarJogadorComConta();
    const { jogador: estranho } = await criarJogadorComConta();
    await criarFut({ date: AMANHA_SP, createdByPlayerId: criador.id });

    const resultado = await processarPendencias();

    expect(resultado.lembretesDeVespera).toBe(0);
    expect(await notificacoesDe(estranho)).toHaveLength(0);
  });

  // Fut órfão (criador apagado — a FK é `set null`) não tem círculo a quem
  // avisar. `condicaoDeAviso` devolve `false` explícito nesse caso, e é a
  // diferença entre "ninguém" e "todo mundo".
  it("fut avulso órfão não lembra ninguém", async () => {
    const { jogador } = await criarJogadorComConta();
    await criarFut({ date: AMANHA_SP, createdByPlayerId: null });

    const resultado = await processarPendencias();

    expect(resultado.lembretesDeVespera).toBe(0);
    expect(await notificacoesDe(jogador)).toHaveLength(0);
  });

  it("fut de grupo lembra só os membros do grupo", async () => {
    const groupId = await criarGrupo();
    await criarFut({ date: AMANHA_SP, groupId });
    const { jogador: doGrupo } = await criarJogadorComConta();
    const { jogador: deFora } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, doGrupo);

    await processarPendencias();

    expect(await notificacoesDe(doGrupo)).toHaveLength(1);
    expect(await notificacoesDe(deFora)).toHaveLength(0);
  });
});
