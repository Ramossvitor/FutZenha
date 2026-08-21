import "server-only";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "@/db";
import {
  gamePlayers,
  games,
  matchDays,
  ratingRounds,
  zenhaInventario,
  zenhaMultiplicadores,
} from "@/db/schema";
import { BOLA_JA_ROLOU_HOJE, KICKOFF_DO_FUT, PRIMEIRO_SINAL_DE_BOLA } from "./kickoff";
import { decidirNoEncerramento, TEXTO_DA_DEVOLUCAO } from "./multiplicador";
import { notificar } from "./notifications";
import type { FatorDaRodada } from "./skill";
import { fatorDoPercentual } from "./zenha";

// O ciclo do multiplicador no banco: armar, desarmar, congelar e ler.
//
// A decisão de SE vale mora em src/lib/multiplicador.ts, que é puro e testado.
// Aqui só se resolvem fatos e se escreve — e a fronteira importa, porque a
// tentação de "só checar o prazo aqui mesmo" é o que faz antiabuso virar
// promessa sem teste.
//
// Armar e desarmar são um `UPDATE ... WHERE <todas as condições> RETURNING`
// cada. Uma statement só, sem ler-decidir-escrever: o corte é avaliado pelo
// PRÓPRIO Postgres, no mesmo instante da escrita, então não existe janela entre
// conferir o horário e gravar. É o mesmo idioma de `fecharRodada` e do débito
// da carteira.

/**
 * A guarda de prazo, escrita UMA vez.
 *
 * Três lugares precisam concordar sobre ela — `armar`, `desarmar` e o `aceita`
 * que a tela do fut lê — e enquanto forem três expressões, um lado oferece o que
 * o outro recusa. É a mesma razão de `KICKOFF_DO_FUT` e `FIM_DA_JANELA_CORRECAO`
 * existirem: extrair a constante e deixar o predicado ao redor duplicado só move
 * o problema de lugar.
 *
 * O que ela pede: fut ainda não encerrado, relógio antes do kickoff, e nenhum
 * sinal de que a bola já rolou hoje (ver `BOLA_JA_ROLOU_HOJE`).
 *
 * Recebe a coluna do fut porque os três chamadores chegam por caminhos
 * diferentes: dois pelo `armado_match_day_id` do inventário, um pelo id que veio
 * da rota.
 */
const janelaDoArme = (idDoFut: SQL | AnyPgColumn) => sql`exists (
  select 1 from ${matchDays}
  where ${matchDays.id} = ${idDoFut}
    and ${matchDays.status} in ('scheduled', 'teams_drawn')
    and now() < ${KICKOFF_DO_FUT}
    and not ${BOLA_JA_ROLOU_HOJE}
)`;

/** A guarda de prazo para quem chega pelo arme já gravado no inventário. */
const FUT_AINDA_ACEITA = janelaDoArme(zenhaInventario.armadoMatchDayId);

/**
 * Arma um multiplicador do inventário num fut.
 *
 * Devolve o slug do erro, ou `null` quando armou. As condições estão todas no
 * `WHERE` de propósito: item do próprio jogador, consumível, ainda não armado, e
 * fut que ainda aceita. Zero linhas devolvidas é recusa — e não interessa qual
 * das condições falhou, porque a tela já sabe o que ofereceu.
 *
 * `corte_previsto` é congelado aqui, a partir do horário que o fut tem AGORA.
 * É esse congelamento que faz adiar o fut depois não abrir janela para quem já
 * sabe como jogou.
 */
export async function armar(
  exec: Executor,
  playerId: number,
  matchDayId: number,
  inventarioId: number,
): Promise<"multiplicador-indisponivel" | null> {
  const armados = await exec
    .update(zenhaInventario)
    .set({
      armadoMatchDayId: matchDayId,
      armadoEm: sql`now()`,
      cortePrevisto: sql`(select ${KICKOFF_DO_FUT} from ${matchDays} where ${matchDays.id} = ${matchDayId})`,
    })
    .where(
      and(
        eq(zenhaInventario.id, inventarioId),
        eq(zenhaInventario.playerId, playerId),
        eq(zenhaInventario.consumivel, true),
        isNull(zenhaInventario.armadoMatchDayId),
        // A trava de verdade contra rearmar o que já foi gasto. A tela não
        // oferece, mas Server Action é endpoint público: o id de um item
        // consumido continua existindo e continua sendo desta pessoa.
        isNull(zenhaInventario.consumidoEm),
        // Um arme por fut. O índice parcial `zenha_inventario_arme_unico_idx`
        // garante isso no banco, mas garantir com EXCEÇÃO devolveria 500 para
        // um POST forjado em vez do redirect com o slug — e a action é endpoint
        // público. Aqui a mesma regra vira zero linhas, que é a recusa normal.
        sql`not exists (
          select 1 from ${zenhaInventario} outro
          where outro.player_id = ${playerId}
            and outro.armado_match_day_id = ${matchDayId}
        )`,
        janelaDoArme(sql`${matchDayId}`),
      ),
    )
    .returning({ id: zenhaInventario.id });

  return armados.length > 0 ? null : "multiplicador-indisponivel";
}

/**
 * Desarma, devolvendo o item ao inventário.
 *
 * **A MESMA guarda de prazo do armar**, e é o ponto mais importante deste
 * arquivo. Sem ela o antiabuso não existe: arma na sexta, joga mal no sábado,
 * desarma no domingo antes de o admin encerrar. A trava só vale nas duas pontas.
 */
export async function desarmar(
  exec: Executor,
  playerId: number,
  inventarioId: number,
): Promise<"multiplicador-travado" | null> {
  const desarmados = await exec
    .update(zenhaInventario)
    .set({ armadoMatchDayId: null, armadoEm: null, cortePrevisto: null })
    .where(
      and(
        eq(zenhaInventario.id, inventarioId),
        eq(zenhaInventario.playerId, playerId),
        sql`${zenhaInventario.armadoMatchDayId} is not null`,
        FUT_AINDA_ACEITA,
      ),
    )
    .returning({ id: zenhaInventario.id });

  return desarmados.length > 0 ? null : "multiplicador-travado";
}

/** O que a página do fut precisa saber para desenhar (ou esconder) o card. */
export type SituacaoDoMultiplicador = {
  /** O item que este jogador armou NESTE fut, se houver. */
  armadoAqui: number | null;
  /** Um item livre no inventário dele, pronto para armar. */
  disponivel: number | null;
  /** O fut ainda está antes da bola rolar. */
  aceita: boolean;
};

/**
 * A situação do multiplicador deste jogador neste fut.
 *
 * `aceita` sai do MESMO predicado que as actions usam — o relógio do Postgres
 * contra o `KICKOFF_DO_FUT` —, e não de uma conta em JavaScript. É o motivo de
 * o `FIM_DA_JANELA_CORRECAO` existir como expressão única em janela-correcao.ts:
 * enquanto a tela e a action tiverem cada uma a sua conta, uma oferece o que a
 * outra recusa.
 *
 * Ainda assim a tela é só a tela: o `WHERE` das actions decide de novo, no
 * instante da escrita. Esconder o botão não é a trava; é a cortesia.
 */
export async function situacaoDoMultiplicador(
  exec: Executor,
  playerId: number,
  matchDayId: number,
): Promise<SituacaoDoMultiplicador> {
  const [itens, [fut]] = await Promise.all([
    exec
      .select({
        id: zenhaInventario.id,
        armadoMatchDayId: zenhaInventario.armadoMatchDayId,
      })
      .from(zenhaInventario)
      .where(
        and(
          eq(zenhaInventario.playerId, playerId),
          eq(zenhaInventario.consumivel, true),
          // Item já gasto continua na tabela (o fato do replay aponta para ele),
          // mas não é oferecido de novo.
          isNull(zenhaInventario.consumidoEm),
        ),
      ),
    exec
      // Pelo id que veio da rota, e não por `matchDays.id` da linha externa: o
      // `from ${matchDays}` de dentro do exists sombrearia o de fora, e a
      // condição viraria `id = id` — verdadeira para qualquer fut.
      .select({ aceita: sql<boolean>`${janelaDoArme(sql`${matchDayId}`)}` })
      .from(matchDays)
      .where(eq(matchDays.id, matchDayId)),
  ]);

  return {
    armadoAqui: itens.find((i) => i.armadoMatchDayId === matchDayId)?.id ?? null,
    disponivel: itens.find((i) => i.armadoMatchDayId === null)?.id ?? null,
    aceita: fut?.aceita ?? false,
  };
}

/**
 * Transforma os armes deste fut em fato durável — ou devolve o item.
 *
 * Roda dentro da transação de `confirmarEncerramento`, logo depois de
 * `abrirRodada`, e no MESMO commit: um fut que ficasse encerrado com armes
 * pendurados deixaria o jogador sem o item e sem o efeito.
 *
 * O que NÃO se decide aqui é a falta de avaliação: a rodada acabou de abrir e
 * ainda não existe `skill_history`. Esse caso cai na liquidação, dias depois —
 * ver `devolverMultiplicadoresSemNota`.
 */
export async function congelarMultiplicadores(
  exec: Executor,
  matchDayId: number,
  roundId: number | null,
): Promise<void> {
  const armes = await exec
    .select({
      inventarioId: zenhaInventario.id,
      playerId: zenhaInventario.playerId,
      fatorPercent: zenhaInventario.fatorPercent,
      armadoEm: zenhaInventario.armadoEm,
      cortePrevisto: zenhaInventario.cortePrevisto,
      kickoffAtual: sql<Date>`${KICKOFF_DO_FUT}`,
      primeiroSinalDeBola: sql<Date>`${PRIMEIRO_SINAL_DE_BOLA}`,
      jogou: sql<boolean>`exists (
        select 1 from ${gamePlayers}
          join ${games} on ${games.id} = ${gamePlayers.gameId}
        where ${games.matchDayId} = ${matchDayId}
          and ${gamePlayers.playerId} = ${zenhaInventario.playerId}
      )`,
    })
    .from(zenhaInventario)
    .innerJoin(matchDays, eq(matchDays.id, zenhaInventario.armadoMatchDayId))
    .where(eq(zenhaInventario.armadoMatchDayId, matchDayId));

  if (armes.length === 0) return;

  const devolvidos: { playerId: number; motivo: keyof typeof TEXTO_DA_DEVOLUCAO }[] = [];
  const aGravar: (typeof zenhaMultiplicadores.$inferInsert)[] = [];

  for (const arme of armes) {
    // Arme sem carimbo é dado impossível (as três colunas são escritas juntas),
    // mas tratar como inválido é o que impede um null virar `new Date(0)` e
    // aprovar tudo silenciosamente.
    if (!arme.armadoEm || !arme.cortePrevisto || arme.fatorPercent === null) {
      devolvidos.push({ playerId: arme.playerId, motivo: "corte-antecipado" });
      continue;
    }
    const motivo = decidirNoEncerramento(
      {
        armadoEm: arme.armadoEm,
        cortePrevisto: arme.cortePrevisto,
        kickoffAtual: new Date(arme.kickoffAtual),
        primeiroSinalDeBola: new Date(arme.primeiroSinalDeBola),
      },
      { jogou: arme.jogou, houveRodada: roundId !== null },
    );

    if (motivo) {
      devolvidos.push({ playerId: arme.playerId, motivo });
      continue;
    }
    const fator = fatorDoPercentual(arme.fatorPercent);
    aGravar.push({
      matchDayId,
      playerId: arme.playerId,
      inventarioId: arme.inventarioId,
      fatorNum: fator.num,
      fatorDen: fator.den,
    });
  }

  if (aGravar.length > 0) {
    // `onConflictDoNothing` na PK: encerrar duas vezes não pode consumir dois
    // itens. A guarda de verdade é o `WHERE status <> 'finished' RETURNING` do
    // encerramento, mas esta é barata e fecha o caso de um retry.
    await exec.insert(zenhaMultiplicadores).values(aGravar).onConflictDoNothing();
  }

  // O arme sai do inventário em todos os casos — as três colunas juntas, porque
  // é o conjunto delas que significa "armado".
  //
  // Mas os dois desfechos são DIFERENTES, e confundi-los custa caro: o
  // consumido ganha `consumido_em` e nunca mais volta à prateleira; o devolvido
  // fica sem marca e pode ser armado de novo. Limpar só o arme nos dois casos
  // devolveria o item já gasto — uma compra viraria multiplicador infinito.
  //
  // A linha do consumido NÃO é apagada: `zenha_multiplicadores.inventario_id`
  // aponta para ela com cascade, e apagar aqui evaporaria o fato que o replay
  // da nota consome.
  const consumidos = aGravar.map((g) => g.inventarioId);
  if (consumidos.length > 0) {
    // Só o carimbo de consumido: o UPDATE logo abaixo desarma TODO mundo deste
    // fut, consumidos inclusive, então repetir as três colunas do arme aqui
    // seria escrever duas vezes o mesmo valor.
    await exec
      .update(zenhaInventario)
      .set({ consumidoEm: sql`now()` })
      .where(inArray(zenhaInventario.id, consumidos));
  }

  await exec
    .update(zenhaInventario)
    .set({ armadoMatchDayId: null, armadoEm: null, cortePrevisto: null })
    .where(eq(zenhaInventario.armadoMatchDayId, matchDayId));

  await notificar(
    exec,
    devolvidos.map((d) => ({
      playerId: d.playerId,
      type: "multiplicador_devolvido" as const,
      title: "Seu multiplicador voltou",
      body: TEXTO_DA_DEVOLUCAO[d.motivo],
      href: "/perfil/inventario",
      dedupeKey: `multiplicador-devolvido:fut:${matchDayId}`,
    })),
  );
}

/**
 * Devolve o item de quem armou e não foi avaliado.
 *
 * Chamado na liquidação, que é o primeiro momento em que `skill_history` existe
 * e dá para saber se a nota da pessoa se moveu. Sem isto, quem caiu num lado
 * pequeno demais para avaliar (ver lineup.ts) queimaria o multiplicador por um
 * fato que não estava na mão dele.
 *
 * Apagar a linha de `zenha_multiplicadores` é seguro e é o certo: ela é a
 * entrada do replay, e um fator sobre uma rodada em que o jogador não recebeu
 * avaliação nenhuma não teria efeito nenhum de qualquer forma.
 *
 * Devolver é DUAS escritas, não uma. Apagar o fato sem limpar o `consumido_em`
 * que `congelarMultiplicadores` carimbou deixaria o item invisível para sempre
 * — `armar` e `situacaoDoMultiplicador` filtram por `consumido_em is null` —, e
 * a notificação estaria mentindo: a pessoa pagou, não teve efeito nenhum na
 * nota, foi avisada de que o item voltou, e não voltou.
 */
export async function devolverMultiplicadoresSemNota(
  exec: Executor,
  matchDayId: number,
  roundId: number,
): Promise<void> {
  const semNota = await exec
    .delete(zenhaMultiplicadores)
    .where(
      and(
        eq(zenhaMultiplicadores.matchDayId, matchDayId),
        sql`not exists (
          select 1 from skill_history sh
          where sh.round_id = ${roundId}
            and sh.player_id = ${zenhaMultiplicadores.playerId}
        )`,
      ),
    )
    .returning({
      playerId: zenhaMultiplicadores.playerId,
      inventarioId: zenhaMultiplicadores.inventarioId,
    });

  if (semNota.length === 0) return;

  // O item volta para a prateleira: sem isto ele fica com o carimbo de consumido
  // que o encerramento pôs, e "voltou" não passa de uma notificação.
  await exec
    .update(zenhaInventario)
    .set({ consumidoEm: null })
    .where(
      inArray(
        zenhaInventario.id,
        semNota.map((d) => d.inventarioId),
      ),
    );

  await notificar(
    exec,
    semNota.map((d) => ({
      playerId: d.playerId,
      type: "multiplicador_devolvido" as const,
      title: "Seu multiplicador voltou",
      body: TEXTO_DA_DEVOLUCAO["sem-avaliacao"],
      href: "/perfil/inventario",
      dedupeKey: `multiplicador-sem-nota:fut:${matchDayId}`,
    })),
  );
}

/**
 * Quantos dias depois do kickoff um fut não encerrado é dado por abandonado.
 *
 * Folgado de propósito: encerrar dias depois é rotina (o admin viaja, a súmula
 * fica para o fim de semana seguinte), e soltar o arme cedo demais devolveria
 * item de fut que ainda vai ser fechado — a pessoa armaria em outro fut e o
 * encerramento atrasado não acharia nada. Uma semana é mais que o atraso comum
 * e menos que a janela de 30 dias da liquidação.
 */
const DIAS_PARA_FUT_ABANDONADO = 7;

/**
 * Solta os armes presos em futs que ninguém encerrou.
 *
 * Sem isto o item fica preso PARA SEMPRE, e esse é o ponto: `desarmar` exige
 * `FUT_AINDA_ACEITA`, que é falso depois do kickoff, e a única outra liberação é
 * `congelarMultiplicadores`, que só roda no encerramento. Fut que passou da hora
 * e nunca foi encerrado — o estado que faz a liquidação precisar de uma janela
 * de 30 dias — deixaria o multiplicador comprado num limbo: não dá para
 * desarmar, não dá para armar em outro lugar, e nunca vira fato. Zenha gasta,
 * item nenhum.
 *
 * Só limpa o ARME, nunca `consumido_em`: o item volta inteiro porque nunca
 * chegou a ser consumido. Se o admin encerrar o fut depois disso,
 * `congelarMultiplicadores` simplesmente não acha arme nenhum — coerente com a
 * devolução já anunciada.
 */
export async function soltarArmesDeFutsAbandonados(exec: Executor): Promise<number> {
  // Lidos ANTES do update, e não pelo `RETURNING`: o `RETURNING` do Postgres
  // devolve a linha DEPOIS da escrita, e o que se quer notificar é justamente o
  // `armado_match_day_id` que o update acabou de zerar.
  const presos = await exec
    .select({
      id: zenhaInventario.id,
      playerId: zenhaInventario.playerId,
      matchDayId: zenhaInventario.armadoMatchDayId,
    })
    .from(zenhaInventario)
    .innerJoin(matchDays, eq(matchDays.id, zenhaInventario.armadoMatchDayId))
    .where(
      and(
        sql`${matchDays.status} <> 'finished'`,
        sql`now() > ${KICKOFF_DO_FUT} + make_interval(days => ${DIAS_PARA_FUT_ABANDONADO})`,
      ),
    );

  if (presos.length === 0) return 0;

  const soltos = await exec
    .update(zenhaInventario)
    .set({ armadoMatchDayId: null, armadoEm: null, cortePrevisto: null })
    .where(
      inArray(
        zenhaInventario.id,
        presos.map((p) => p.id),
      ),
    )
    .returning({ id: zenhaInventario.id });

  const soltosIds = new Set(soltos.map((s) => s.id));
  const avisar = presos.filter((p) => soltosIds.has(p.id));
  if (avisar.length === 0) return 0;

  await notificar(
    exec,
    avisar.map((s) => ({
      playerId: s.playerId,
      type: "multiplicador_devolvido" as const,
      title: "Seu multiplicador voltou",
      body: TEXTO_DA_DEVOLUCAO["fut-abandonado"],
      href: "/perfil/inventario",
      dedupeKey: `multiplicador-abandonado:fut:${s.matchDayId}`,
    })),
  );

  return avisar.length;
}

/**
 * Solta os multiplicadores de um fut que está prestes a ser apagado.
 *
 * Chamado por `apagarFut` ANTES do delete, e não depois: `zenha_multiplicadores`
 * aponta para o fut com `on delete cascade`, então depois do delete não há mais
 * como saber quais itens foram consumidos ali.
 *
 * O cascade sozinho não devolve nada — essa é a armadilha. Ele some com o fato
 * do multiplicador, mas `zenha_inventario.consumido_em` é coluna do inventário e
 * fica onde estava, prendendo um item pago num fut que não existe mais. O mesmo
 * vale para o arme: a FK é `on delete set null`, então `armado_match_day_id`
 * zera sozinho, mas `armado_em` e `corte_previsto` não — e são as três juntas
 * que significam "armado".
 *
 * Fut apagado é fut que não aconteceu: quem armou não gastou, e quem teve o item
 * consumido no encerramento recebe de volta. Sem notificação, porque a exclusão
 * do fut já avisa por si.
 */
export async function soltarMultiplicadoresDoFut(
  exec: Executor,
  matchDayId: number,
): Promise<void> {
  const consumidos = await exec
    .select({ inventarioId: zenhaMultiplicadores.inventarioId })
    .from(zenhaMultiplicadores)
    .where(eq(zenhaMultiplicadores.matchDayId, matchDayId));

  if (consumidos.length > 0) {
    await exec
      .update(zenhaInventario)
      .set({ consumidoEm: null })
      .where(
        inArray(
          zenhaInventario.id,
          consumidos.map((c) => c.inventarioId),
        ),
      );
  }

  // Quem ainda estava armado (fut apagado antes do encerramento): limpa as
  // companheiras que o `set null` da FK não alcança.
  await exec
    .update(zenhaInventario)
    .set({ armadoMatchDayId: null, armadoEm: null, cortePrevisto: null })
    .where(eq(zenhaInventario.armadoMatchDayId, matchDayId));
}

/**
 * Os fatores de cada rodada, para o replay.
 *
 * Lido a cada `aplicarReplay` porque o replay é COMPLETO: ele reconstrói a nota
 * desde 5,0, e reconstruir a nota de uma rodada antiga exige o multiplicador que
 * valia nela. O fator vem congelado da tabela, nunca derivado do ajuste atual.
 */
export async function lerMultiplicadoresPorRodada(
  exec: Executor,
  roundIds: number[],
): Promise<Map<number, Map<number, FatorDaRodada>>> {
  const porRodada = new Map<number, Map<number, FatorDaRodada>>();
  if (roundIds.length === 0) return porRodada;

  const linhas = await exec
    .select({
      roundId: ratingRounds.id,
      playerId: zenhaMultiplicadores.playerId,
      num: zenhaMultiplicadores.fatorNum,
      den: zenhaMultiplicadores.fatorDen,
    })
    .from(zenhaMultiplicadores)
    .innerJoin(ratingRounds, eq(ratingRounds.matchDayId, zenhaMultiplicadores.matchDayId))
    .where(inArray(ratingRounds.id, roundIds));

  for (const l of linhas) {
    const daRodada = porRodada.get(l.roundId) ?? new Map<number, FatorDaRodada>();
    daRodada.set(l.playerId, { num: l.num, den: l.den });
    porRodada.set(l.roundId, daRodada);
  }
  return porRodada;
}
