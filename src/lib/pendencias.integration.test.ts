// A etapa de véspera da varredura: pelada marcada para amanhã lembra quem é
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
  criarPelada,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";

// A data sai do relógio do BANCO, regra da casa: calcular "amanhã em São
// Paulo" no runner colocaria dois relógios na mesma conta e viraria flake de
// virada de dia.
const AMANHA_SP = sql`((now() at time zone 'America/Sao_Paulo')::date + 1)` as unknown as string;

const notificacoesDe = (jogador: Player) =>
  db.select().from(notifications).where(eq(notifications.playerId, jogador.id));

describe("processarPendencias — lembrete de véspera", () => {
  it("lembra quem tem conta e não respondeu; ignora quem respondeu, quem não tem conta e pelada de outro dia", async () => {
    const pelada = await criarPelada({ date: AMANHA_SP });
    const { jogador: semResposta } = await criarJogadorComConta();
    const { jogador: jaConfirmou } = await criarJogadorComConta();
    const { jogador: jaRecusou } = await criarJogadorComConta();
    const semConta = await criarJogador();
    // Conta desativada é diferente de "sem conta": a linha em users existe, e
    // sem o eq(users.active, true) ela receberia lembrete de uma pelada em que
    // não consegue nem entrar.
    const { jogador: contaDesativada } = await criarJogadorComConta({}, { active: false });
    await confirmarPresenca(pelada, jaConfirmou, { minutosAtras: 10 });
    await confirmarPresenca(pelada, jaRecusou, { status: "out" });
    // Pelada de depois de amanhã não entra na véspera de hoje.
    await criarPelada({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date + 2)` as unknown as string,
      location: "Quadra de Depois",
    });

    const resultado = await processarPendencias();

    expect(resultado.lembretesDeVespera).toBe(1);
    const avisos = await notificacoesDe(semResposta);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_lembrete_vespera",
      dedupeKey: `pelada:${pelada.id}:lembrete-vespera`,
      href: `/pelada/${pelada.id}`,
    });
    expect(await notificacoesDe(jaConfirmou)).toHaveLength(0);
    expect(await notificacoesDe(jaRecusou)).toHaveLength(0);
    expect(await notificacoesDe(semConta)).toHaveLength(0);
    expect(await notificacoesDe(contaDesativada)).toHaveLength(0);
  });

  // O estado normal na véspera de um jogo já organizado é `teams_drawn` —
  // perguntar "você vai?" para quem já está escalado é o falso positivo mais
  // barulhento possível num canal que agora vai para a tela de bloqueio.
  it("só pelada ainda aberta lembra: com times sorteados ou encerrada, não", async () => {
    const { jogador } = await criarJogadorComConta();
    for (const status of ["teams_drawn", "finished"] as const) {
      await criarPelada({ date: AMANHA_SP, status, location: `Quadra ${status}` });
    }

    const resultado = await processarPendencias();

    expect(resultado.lembretesDeVespera).toBe(0);
    expect(await notificacoesDe(jogador)).toHaveLength(0);
  });

  it("rodar de novo não duplica o lembrete — o dedupe segura o piggyback de cada minuto", async () => {
    await criarPelada({ date: AMANHA_SP });
    const { jogador } = await criarJogadorComConta();

    await processarPendencias();
    await processarPendencias();

    expect(await notificacoesDe(jogador)).toHaveLength(1);
  });

  it("pelada de grupo lembra só os membros do grupo", async () => {
    const groupId = await criarGrupo();
    await criarPelada({ date: AMANHA_SP, groupId });
    const { jogador: doGrupo } = await criarJogadorComConta();
    const { jogador: deFora } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, doGrupo);

    await processarPendencias();

    expect(await notificacoesDe(doGrupo)).toHaveLength(1);
    expect(await notificacoesDe(deFora)).toHaveLength(0);
  });
});
