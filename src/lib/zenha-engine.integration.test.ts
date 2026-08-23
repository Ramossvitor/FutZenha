// A liquidação da zenha contra o banco de verdade.
//
// A aritmética das quatro fontes já está travada em zenha.test.ts — o alvo aqui
// é a composição: os FATOS saírem certos do Postgres e chegarem ao motor puro.
// Quatro coisas só existem deste lado e não têm como ser exercitadas fora do
// banco: o PONTO DE PAGAMENTO do fut (a rodada de avaliação fechada, e só isso),
// o teto semanal pelo `date_trunc('week')`, a sequência de presenças lida de
// trás para frente e o extrato que sobrevive ao fut apagado.
//
// E, ao fim de todo cenário que paga, o mesmo fecho que
// carteira.integration.test.ts cobra: `saldo == sum(amount)`.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  attendances,
  groupMembers,
  matchDays,
  ratingReports,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  users,
  zenhaCarteiras,
  zenhaLedger,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { apagarFut } from "@/lib/deletion";
import { resolverDenuncia } from "@/lib/reports";
import { AJUSTES_PADRAO, ZENHA_DESDE, type Ajustes } from "@/lib/zenha";
import { salvarAjuste } from "@/lib/zenha-config";
import { futsALiquidar, liquidarFut, liquidarFutsProntos } from "@/lib/zenha-engine";
import { confirmarPresenca, criarFut, criarJogadorComConta } from "@/test/fixtures";
import { criarJogo } from "@/test/fixtures-avaliacao";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";

const MIN_CONTAS = AJUSTES_PADRAO.min_contas_para_pagar;
const PARTICIPACAO = AJUSTES_PADRAO.participacao;
const PREMIO_MVP = AJUSTES_PADRAO.mvp;
const PREMIO_STREAK = AJUSTES_PADRAO.streak_premio;
const POR_DECIMO = AJUSTES_PADRAO.nota_por_decimo;
const TAMANHO_DA_SEQUENCIA = AJUSTES_PADRAO.streak_tamanho;

// ── As datas ────────────────────────────────────────────────────────────────
//
// Nenhum "2026-09-01" literal no arquivo: ZENHA_DESDE é constante de PRODUTO e
// vai mudar no dia em que a economia estrear de novo num outro ambiente. O que
// cada teste afirma é sempre "tantos dias depois da estreia".

const UM_DIA_MS = 86_400_000;

function diaDaEconomia(dias: number): string {
  return new Date(Date.parse(`${ZENHA_DESDE}T00:00:00Z`) + dias * UM_DIA_MS)
    .toISOString()
    .slice(0, 10);
}

// Quantos dias da estreia até a primeira segunda-feira (getUTCDay: 0 = domingo).
const ATE_A_SEGUNDA = (8 - new Date(`${ZENHA_DESDE}T00:00:00Z`).getUTCDay()) % 7;

/**
 * O dia `dia` (0 = segunda) da `semana`-ésima semana a partir da estreia.
 *
 * O teto semanal compara `date_trunc('week')`, que no Postgres começa na
 * segunda-feira. Ancorar as datas numa segunda é o que faz "mesma semana" e
 * "semana seguinte" serem afirmações do teste, e não coincidências do
 * calendário em que ZENHA_DESDE calhou de cair.
 */
function diaDoFut(semana: number, dia = 0): string {
  return diaDaEconomia(ATE_A_SEGUNDA + semana * 7 + dia);
}

// ── Os construtores do cenário ──────────────────────────────────────────────

/**
 * Contas ativas já dentro do grupo.
 *
 * A entrada no grupo é carimbada ANTES da estreia da economia de propósito:
 * `lerSequencias` só mostra a cada jogador os futs posteriores à entrada dele, e
 * com o `now()` do banco a sequência passaria a depender de a suíte rodar antes
 * ou depois de ZENHA_DESDE — um teste verde hoje e vermelho em outubro.
 */
async function criarElenco(
  groupId: number,
  quantos: number,
  extraConta: { active?: boolean } = {},
): Promise<Player[]> {
  const elenco: Player[] = [];
  for (let i = 0; i < quantos; i += 1) {
    const { jogador } = await criarJogadorComConta({}, extraConta);
    await entrarNoGrupo(groupId, jogador);
    elenco.push(jogador);
  }
  await db
    .update(groupMembers)
    .set({ joinedAt: sql`${ZENHA_DESDE}::date - interval '1 year'` })
    .where(eq(groupMembers.groupId, groupId));
  return elenco;
}

/**
 * Um fut PAGÁVEL montado inteiro: de grupo, com data dentro da economia e com o
 * elenco em campo — seis contas ativas distintas, que é o piso do
 * `min_contas_para_pagar`. Uma a menos e o fut não paga nada a ninguém.
 *
 * Sai daqui ainda ABERTO: quem encerra e empurra o relógio é `amadurecer`, e
 * separar os dois é o que deixa os testes escolherem em que ponto o fut para.
 */
async function montarFutPago(
  opcoes: { groupId?: number; elenco?: Player[]; emCampo?: Player[]; data?: string } = {},
): Promise<{ fut: MatchDay; groupId: number; elenco: Player[]; emCampo: Player[] }> {
  const groupId = opcoes.groupId ?? (await criarGrupo());
  const elenco = opcoes.elenco ?? (await criarElenco(groupId, MIN_CONTAS));
  const emCampo = opcoes.emCampo ?? elenco;
  const data = opcoes.data ?? diaDoFut(0);

  const fut = await criarFut({ date: data, groupId });
  const metade = Math.ceil(emCampo.length / 2);
  await criarJogo(fut, emCampo.slice(0, metade), emCampo.slice(metade));
  for (const [i, j] of emCampo.entries()) {
    await confirmarPresenca(fut, j, { minutosAtras: 60 - i });
  }
  return { fut, groupId, elenco, emCampo };
}

/**
 * Encerra o fut e empurra o relógio até onde o teste quiser: `finished_at`
 * dentro da janela de liquidação, rodada no estado pedido e prazo de contestação
 * vencido ou correndo. Devolve o id da rodada, ou null quando o fut encerrou sem
 * avaliação nenhuma.
 *
 * `contestacao` NÃO decide mais se o fut paga — quem decide é `rodada`. Ela
 * continua aqui porque é o que monta o cenário em que a contestação chega depois
 * do dinheiro, que é a troca que o pagamento no fechamento aceita.
 *
 * Tudo pelo relógio do BANCO — o `finished_at` e os dois prazos são comparados
 * com `now()` dentro da query, e skew entre o runner e o container viraria flake.
 */
async function amadurecer(
  fut: MatchDay,
  opcoes: {
    rodada?: "sem" | "aberta" | "fechada";
    contestacao?: "vencida" | "correndo";
    encerradoHaDias?: number;
  } = {},
): Promise<number | null> {
  const { rodada = "fechada", contestacao = "vencida", encerradoHaDias = 2 } = opcoes;

  await db
    .update(matchDays)
    .set({
      status: "finished",
      finishedAt: sql`now() - make_interval(days => ${encerradoHaDias}::int)`,
    })
    .where(eq(matchDays.id, fut.id));

  if (rodada === "sem") return null;

  const [linha] = await db
    .insert(ratingRounds)
    .values({
      matchDayId: fut.id,
      status: rodada === "fechada" ? "closed" : "open",
      deadlineAt: sql`now() - interval '12 hours'`,
      closedAt: rodada === "fechada" ? sql`now() - interval '1 day'` : null,
      reportDeadlineAt:
        rodada === "aberta"
          ? null
          : contestacao === "vencida"
            ? sql`now() - interval '1 hour'`
            : sql`now() + interval '12 hours'`,
    })
    .returning({ id: ratingRounds.id });
  return linha.id;
}

/** O que cada avaliador fez na rodada. `enviou` sem `votouEm` é envio sem voto. */
type Ritual = { jogador: Player; enviou?: boolean; votouEm?: Player };

/**
 * O eleitorado congelado da rodada, com envio e voto. É daqui que sai o
 * "cumpriu o ritual" da participação — sem linha de rater, o jogador passa
 * direto (fut sem rodada é exatamente esse caso).
 */
async function registrarRaters(roundId: number, rituais: Ritual[]): Promise<void> {
  const contas = await db
    .select({ playerId: users.playerId, userId: users.id })
    .from(users)
    .where(
      inArray(
        users.playerId,
        rituais.map((r) => r.jogador.id),
      ),
    );
  const idDaConta = new Map(contas.map((c) => [c.playerId, c.userId]));

  await db.insert(ratingRoundRaters).values(
    rituais.map((r) => ({
      roundId,
      playerId: r.jogador.id,
      userId: idDaConta.get(r.jogador.id)!,
      submittedAt: (r.enviou ?? true) ? sql`now() - interval '1 day'` : null,
      mvpPlayerId: r.votouEm?.id ?? null,
    })),
  );
}

/**
 * Todo mundo enviou e votou no mesmo craque — o craque vota no vice, porque o
 * `rating_round_raters_mvp_no_self_check` do banco não deixa alguém votar em si.
 */
function ritualCompleto(raters: Player[], craque: Player, vice: Player): Ritual[] {
  return raters.map((j) => ({ jogador: j, votouEm: j.id === craque.id ? vice : craque }));
}

/** A linha de `skill_history` que a rodada produziu para este jogador. */
async function registrarNota(
  roundId: number,
  jogador: Player,
  antes: number,
  depois: number,
): Promise<void> {
  await db.insert(skillHistory).values({
    playerId: jogador.id,
    roundId,
    skillBefore: antes,
    skillAfter: depois,
    ratingsCount: 2,
    averageReceived: 8,
  });
}

/**
 * Uma denúncia sobre uma avaliação DA rodada.
 *
 * O caminho importa: o `exists` de `futsALiquidar` chega na denúncia por
 * `ratings.round_id`, e não pelo fut — denúncia sobre avaliação de outra rodada
 * não pode segurar o pagamento deste fut.
 */
async function denunciar(roundId: number, autor: Player, alvo: Player): Promise<number> {
  const [nota] = await db
    .insert(ratings)
    .values({ roundId, raterPlayerId: autor.id, ratedPlayerId: alvo.id, halfStars: 2 })
    .returning({ id: ratings.id });
  const [denuncia] = await db
    .insert(ratingReports)
    .values({
      ratingId: nota.id,
      reporterPlayerId: alvo.id,
      adminDeadlineAt: sql`now() + interval '2 days'`,
    })
    .returning({ id: ratingReports.id });
  return denuncia.id;
}

// ── As leituras ─────────────────────────────────────────────────────────────

const liquidar = (fut: MatchDay, ajustes: Ajustes = AJUSTES_PADRAO) =>
  db.transaction((tx) => liquidarFut(tx, fut.id, ajustes));

const varrer = () => db.transaction((tx) => liquidarFutsProntos(tx));

async function linhasDe(jogador: Player) {
  return db
    .select()
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, jogador.id))
    .orderBy(asc(zenhaLedger.id));
}

/** O extrato do jogador reduzido a { motivo: valor } — a forma em que as asserções ficam legíveis. */
async function motivosDe(jogador: Player): Promise<Record<string, number>> {
  return Object.fromEntries((await linhasDe(jogador)).map((l) => [l.motivo, l.amount]));
}

/** O que ESTE fut pagou a este jogador, ignorando o resto da história dele. */
async function motivosDoFut(jogador: Player, fut: MatchDay): Promise<Record<string, number>> {
  const linhas = await db
    .select({ motivo: zenhaLedger.motivo, amount: zenhaLedger.amount })
    .from(zenhaLedger)
    .where(and(eq(zenhaLedger.playerId, jogador.id), eq(zenhaLedger.matchDayId, fut.id)));
  return Object.fromEntries(linhas.map((l) => [l.motivo, l.amount]));
}

async function saldoDe(jogador: Player): Promise<number> {
  const [carteira] = await db
    .select({ saldo: zenhaCarteiras.saldo })
    .from(zenhaCarteiras)
    .where(eq(zenhaCarteiras.playerId, jogador.id));
  return carteira?.saldo ?? 0;
}

/**
 * O fecho da carteira, cobrado ao fim de TODO cenário que paga: o saldo é uma
 * cópia materializada da soma do extrato, e no minuto em que os dois divergem o
 * extrato deixa de explicar o saldo.
 */
async function conferirFecho(jogadores: readonly Player[]): Promise<void> {
  for (const j of jogadores) {
    const [soma] = await db
      .select({ total: sql<number>`coalesce(sum(${zenhaLedger.amount}), 0)::int` })
      .from(zenhaLedger)
      .where(eq(zenhaLedger.playerId, j.id));
    const saldo = await saldoDe(j);
    expect(saldo).toBe(soma?.total ?? 0);
    expect(saldo).toBeGreaterThanOrEqual(0);
  }
}

// ── O ponto de pagamento ────────────────────────────────────────────────────

describe("futsALiquidar", () => {
  // A ÚNICA coisa que segura o pagamento. Enquanto a rodada corre, a nota e o
  // MVP não existem — não há o que pagar, não é uma espera prudente.
  it("segura o fut cuja rodada de avaliação ainda está aberta", async () => {
    const { fut } = await montarFutPago();
    await amadurecer(fut, { rodada: "aberta" });

    expect(await futsALiquidar(db)).toEqual([]);
  });

  // A rodada fechada basta. O prazo de contestação começa a correr no fechamento
  // e por definição ainda está aberto quando a zenha sai — esperá-lo é o que esta
  // versão deixou de fazer, e é o que aproxima o pagamento do gesto.
  it("paga com o prazo de contestação ainda correndo", async () => {
    const { fut } = await montarFutPago();
    await amadurecer(fut, { contestacao: "correndo" });

    expect(await futsALiquidar(db)).toEqual([fut.id]);
  });

  // A troca aceita, do lado da fila: denúncia em aberto não segura mais nada.
  // O que ela pode mudar é a nota — nunca o extrato (ver o teste do desfecho
  // abaixo).
  it("paga mesmo com denúncia aberta sobre a rodada", async () => {
    const { fut, elenco } = await montarFutPago();
    const roundId = (await amadurecer(fut))!;
    await denunciar(roundId, elenco[0], elenco[1]);

    expect(await futsALiquidar(db)).toEqual([fut.id]);
  });

  // Fut encerrado sem escalação avaliável nunca abre rodada — e ainda assim
  // pagou participação a quem entrou em campo. Se a maturidade exigisse rodada,
  // esse fut ficaria preso para sempre.
  it("solta o fut que encerrou sem rodada nenhuma", async () => {
    const { fut } = await montarFutPago();
    await amadurecer(fut, { rodada: "sem" });

    expect(await futsALiquidar(db)).toEqual([fut.id]);
  });

  // Fut avulso não tem grupo para dar contexto a sequência, a teto nem a nada:
  // ele acontece normalmente e não paga.
  it("nunca liquida fut avulso, por mais maduro que esteja", async () => {
    const fut = await criarFut({ date: diaDoFut(0), groupId: null });
    const elenco = await criarElenco(await criarGrupo(), MIN_CONTAS);
    await criarJogo(fut, elenco.slice(0, 3), elenco.slice(3));
    await amadurecer(fut, { rodada: "sem" });

    expect(await futsALiquidar(db)).toEqual([]);
  });

  // A trava da estreia: sem ela, a primeira varredura pagaria a história inteira
  // do grupo de uma vez.
  it("nunca liquida fut anterior à estreia da economia", async () => {
    const { fut } = await montarFutPago({ data: diaDaEconomia(-1) });
    await amadurecer(fut, { rodada: "sem" });

    expect(await futsALiquidar(db)).toEqual([]);
  });

  it("some da lista depois de liquidado — é o `liquidado_em` que drena o candidato", async () => {
    const { fut } = await montarFutPago();
    await amadurecer(fut, { rodada: "sem" });
    expect(await futsALiquidar(db)).toEqual([fut.id]);

    await liquidar(fut);

    expect(await futsALiquidar(db)).toEqual([]);
  });

  // A janela é o que mantém o conjunto candidato pequeno: sem ela toda passada
  // do varredor reexaminaria fut encerrado de dois anos atrás. Um fut preso
  // além dela simplesmente não paga — e não pagar é melhor que pagar errado.
  it("ignora fut encerrado há mais de 30 dias, e ainda pega o de 29", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS);
    const velho = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(0) });
    const recente = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(1) });
    await amadurecer(velho.fut, { rodada: "sem", encerradoHaDias: 31 });
    await amadurecer(recente.fut, { rodada: "sem", encerradoHaDias: 29 });

    expect(await futsALiquidar(db)).toEqual([recente.fut.id]);
  });
});

// ── Pagamento ───────────────────────────────────────────────────────────────

describe("liquidarFut", () => {
  /** Fut maduro com rodada fechada e o ritual cumprido por todo mundo. */
  async function futAvaliado(opcoes: { rituais?: (elenco: Player[]) => Ritual[] } = {}) {
    const cenario = await montarFutPago();
    const roundId = (await amadurecer(cenario.fut))!;
    const [craque, vice] = cenario.elenco;
    await registrarRaters(
      roundId,
      opcoes.rituais?.(cenario.elenco) ?? ritualCompleto(cenario.elenco, craque, vice),
    );
    return { ...cenario, roundId, craque, vice };
  }

  it("paga participação a quem jogou, enviou a avaliação e votou no melhor em campo", async () => {
    const { fut, elenco } = await futAvaliado();

    expect(await liquidar(fut)).toBeGreaterThan(0);

    // elenco[2] não é craque nem vice e não tem skill_history: a participação é
    // a única fonte dele, e ela sai inteira.
    expect(await motivosDe(elenco[2])).toEqual({ participacao: PARTICIPACAO });
    await conferirFecho(elenco);
  });

  // O voto de MVP faz parte do tudo-ou-nada do envio: enviar as notas e pular o
  // voto é entregar meio ritual. Quem faz isso perde a participação — e só ele.
  it("quem enviou mas não votou no MVP não recebe participação, e os outros recebem", async () => {
    const { fut, elenco } = await futAvaliado({
      rituais: (e) => [
        ...ritualCompleto(e.slice(0, e.length - 1), e[0], e[1]),
        { jogador: e[e.length - 1], enviou: true },
      ],
    });
    const omisso = elenco[elenco.length - 1];

    await liquidar(fut);

    expect(await linhasDe(omisso)).toHaveLength(0);
    expect(await motivosDe(elenco[2])).toEqual({ participacao: PARTICIPACAO });
    await conferirFecho(elenco);
  });

  // A presença que vale é a ESCALAÇÃO, não o "Vou" da lista: um é o registro de
  // quem jogou, o outro é uma intenção. Quem ficou de fora do jogo não recebe
  // nem participação.
  it("quem confirmou presença mas não entrou em campo não recebe nada", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS + 1);
    const arquibancada = elenco[MIN_CONTAS];
    const { fut } = await montarFutPago({
      groupId: grupo,
      elenco,
      emCampo: elenco.slice(0, MIN_CONTAS),
    });
    await confirmarPresenca(fut, arquibancada, { minutosAtras: 5 });
    await amadurecer(fut, { rodada: "sem" });

    await liquidar(fut);

    expect(await linhasDe(arquibancada)).toHaveLength(0);
    expect(await motivosDe(elenco[0])).toEqual({ participacao: PARTICIPACAO });
    await conferirFecho(elenco);
  });

  // O mesmo filtro de todos os rankings: quem joga sem conta ativa conta para
  // placar e presença, mas não pontua em lugar nenhum — e não teria carteira.
  it("jogador com a conta desativada não recebe, e os outros seis recebem normalmente", async () => {
    const grupo = await criarGrupo();
    const ativos = await criarElenco(grupo, MIN_CONTAS);
    const [desligado] = await criarElenco(grupo, 1, { active: false });
    const { fut } = await montarFutPago({
      groupId: grupo,
      elenco: [...ativos, desligado],
      emCampo: [...ativos, desligado],
    });
    await amadurecer(fut, { rodada: "sem" });

    await liquidar(fut);

    expect(await linhasDe(desligado)).toHaveLength(0);
    expect(await motivosDe(ativos[0])).toEqual({ participacao: PARTICIPACAO });
    await conferirFecho([...ativos, desligado]);
  });

  // O piso de contas em campo é o freio de fabricação: qualquer um marca fut e
  // vira admin dele, e convidar cria jogador na própria tela. Cinco contas — ou
  // cinco contas e dois fantasmas — não bastam.
  it("fut com cinco contas em campo não paga nada a ninguém", async () => {
    const grupo = await criarGrupo();
    const ativos = await criarElenco(grupo, MIN_CONTAS - 1);
    const desligados = await criarElenco(grupo, 2, { active: false });
    const emCampo = [...ativos, ...desligados];
    const { fut } = await montarFutPago({ groupId: grupo, elenco: emCampo, emCampo });
    await amadurecer(fut, { rodada: "sem" });

    expect(await liquidar(fut)).toBe(0);

    expect(await db.select().from(zenhaLedger)).toHaveLength(0);
    await conferirFecho(emCampo);
  });

  // O CASO MAIS IMPORTANTE DO ARQUIVO. Não existe portão: nota que caiu apenas
  // não rende a fonte "nota" e não zera as outras. Todo jogador começa em 5,0,
  // então qualquer regra de piso castigaria justamente o novato, semana após
  // semana — e ele é quem mais precisa da participação.
  it("nota que subiu rende proporcional; nota que caiu não rende, mas a participação sai igual", async () => {
    const { fut, elenco, roundId } = await futAvaliado();
    const subiu = elenco[2];
    const caiu = elenco[3];
    await registrarNota(roundId, subiu, 5, 5.3);
    await registrarNota(roundId, caiu, 5, 4.7);

    await liquidar(fut);

    expect(await motivosDe(subiu)).toEqual({
      participacao: PARTICIPACAO,
      nota: 3 * POR_DECIMO,
    });
    expect(await motivosDe(caiu)).toEqual({ participacao: PARTICIPACAO });

    // A descrição é congelada na gravação, e é ela que explica o valor no
    // extrato depois que o fut deixar de existir.
    const [, linhaDaNota] = await linhasDe(subiu);
    expect(linhaDaNota.descricao).toMatch(/subiu 0,3/);
    await conferirFecho(elenco);
  });

  // Título dividido divide o prêmio: pagar o valor cheio a cada um faria do
  // empate a melhor coisa que pode acontecer com o grupo.
  it("MVP empatado a três paga a divisão inteira a cada vencedor", async () => {
    const cenario = await montarFutPago();
    const roundId = (await amadurecer(cenario.fut))!;
    const [a, b, c, ...resto] = cenario.elenco;

    // Dois votos para cada um dos três primeiros: mesmo número de votos e
    // nenhuma avaliação para desempatar pela média, então o título é dos três.
    await registrarRaters(roundId, [
      { jogador: a, votouEm: b },
      { jogador: resto[0], votouEm: b },
      { jogador: b, votouEm: c },
      { jogador: resto[1], votouEm: c },
      { jogador: c, votouEm: a },
      { jogador: resto[2], votouEm: a },
    ]);

    await liquidar(cenario.fut);

    const dividido = Math.floor(PREMIO_MVP / 3);
    for (const vencedor of [a, b, c]) {
      expect(await motivosDe(vencedor)).toEqual({
        participacao: PARTICIPACAO,
        mvp: dividido,
      });
    }
    expect(await motivosDe(resto[0])).toEqual({ participacao: PARTICIPACAO });
    await conferirFecho(cenario.elenco);
  });

  // As duas FKs são `set null` no banco, então elas não podem ser derivadas na
  // leitura: guardá-las é o que permite a linha do extrato levar de volta ao fut
  // enquanto ele existe. A `dedupe_key` tem o id, mas ela é chave, não navegação.
  it("grava match_day_id e round_id em toda linha do fut", async () => {
    const { fut, elenco, roundId, craque } = await futAvaliado();
    await registrarNota(roundId, craque, 5, 5.2);

    await liquidar(fut);

    const linhas = await linhasDe(craque);
    expect(linhas.map((l) => l.motivo).sort()).toEqual(["mvp", "nota", "participacao"]);
    expect(linhas.every((l) => l.matchDayId === fut.id)).toBe(true);
    expect(linhas.every((l) => l.roundId === roundId)).toBe(true);
    await conferirFecho(elenco);
  });

  // Fut sem rodada não tem roundId para guardar — e a `dedupe_key` continua
  // sendo por FUT justamente por isso.
  it("fut sem rodada grava round_id nulo e ainda assim paga participação", async () => {
    const { fut, elenco } = await montarFutPago();
    await amadurecer(fut, { rodada: "sem" });

    await liquidar(fut);

    const [linha] = await linhasDe(elenco[0]);
    expect(linha.motivo).toBe("participacao");
    expect(linha.matchDayId).toBe(fut.id);
    expect(linha.roundId).toBeNull();
    await conferirFecho(elenco);
  });
});

// ── Idempotência ────────────────────────────────────────────────────────────

describe("exatamente uma vez", () => {
  // Três camadas seguram isto (o claim do `liquidado_em`, a unique do dedupe e o
  // advisory lock do varredor), e a primeira já basta: a segunda chamada nem
  // chega a montar os fatos.
  it("liquidar o mesmo fut duas vezes não paga em dobro e não move o saldo", async () => {
    const { fut, elenco } = await montarFutPago();
    await amadurecer(fut, { rodada: "sem" });
    expect(await liquidar(fut)).toBe(MIN_CONTAS);
    const saldoAntes = await saldoDe(elenco[0]);
    const linhasAntes = await db.select().from(zenhaLedger);

    expect(await liquidar(fut)).toBe(0);

    expect(await saldoDe(elenco[0])).toBe(saldoAntes);
    expect(await db.select().from(zenhaLedger)).toHaveLength(linhasAntes.length);
    await conferirFecho(elenco);
  });

  it("a segunda varredura no mesmo estado é no-op", async () => {
    const { fut, elenco } = await montarFutPago();
    await amadurecer(fut, { rodada: "sem" });

    expect(await varrer()).toBe(1);
    const linhas = await db.select().from(zenhaLedger);

    expect(await varrer()).toBe(0);

    expect(await db.select().from(zenhaLedger)).toHaveLength(linhas.length);
    expect(await saldoDe(elenco[0])).toBe(PARTICIPACAO);
    expect(await futsALiquidar(db)).toEqual([]);
    await conferirFecho(elenco);
  });
});

// ── Teto semanal ────────────────────────────────────────────────────────────

describe("teto de futs pagos por semana", () => {
  // A semana é a do FUT (`match_days.date`), não a do pagamento: a liquidação
  // acontece dias depois, e contar pela data do crédito colocaria dois futs da
  // mesma semana em semanas diferentes. O corte é o `date_trunc('week')` do
  // Postgres — de segunda a domingo.
  it("o terceiro fut da mesma semana não paga; o da semana seguinte volta a pagar", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS);
    const semana = [];
    for (const dia of [0, 2, 4]) {
      const { fut } = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(0, dia) });
      await amadurecer(fut, { rodada: "sem" });
      semana.push(fut);
    }
    const seguinte = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(1) });
    await amadurecer(seguinte.fut, { rodada: "sem" });

    for (const fut of semana) await liquidar(fut);
    await liquidar(seguinte.fut);

    const [primeiro, segundo, terceiro] = semana;
    expect(await motivosDoFut(elenco[0], primeiro)).toEqual({ participacao: PARTICIPACAO });
    expect(await motivosDoFut(elenco[0], segundo)).toEqual({ participacao: PARTICIPACAO });
    expect(await motivosDoFut(elenco[0], terceiro)).toEqual({});
    expect(await motivosDoFut(elenco[0], seguinte.fut)).toEqual({ participacao: PARTICIPACAO });

    expect(await saldoDe(elenco[0])).toBe(3 * PARTICIPACAO);
    await conferirFecho(elenco);
  });
});

// ── Sequência de presenças ──────────────────────────────────────────────────

describe("sequência de presenças", () => {
  /**
   * Uma temporada do grupo: um fut por semana, todos maduros e sem rodada. Uma
   * semana cada porque o teto semanal é outra regra — misturar as duas faria o
   * teste da sequência falhar por um motivo que não é o dele.
   */
  async function temporada(
    groupId: number,
    elenco: Player[],
    semanas: number,
    emCampoNaSemana: (semana: number) => Player[] = () => elenco,
  ): Promise<MatchDay[]> {
    const futs: MatchDay[] = [];
    for (let semana = 0; semana < semanas; semana += 1) {
      const { fut } = await montarFutPago({
        groupId,
        elenco,
        emCampo: emCampoNaSemana(semana),
        data: diaDoFut(semana),
      });
      await amadurecer(fut, { rodada: "sem" });
      futs.push(fut);
    }
    return futs;
  }

  it("o prêmio sai no quinto fut seguido, e não antes", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS);
    const futs = await temporada(grupo, elenco, TAMANHO_DA_SEQUENCIA);

    for (const fut of futs) await liquidar(fut);

    const [assiduo] = elenco;
    const quarto = futs[TAMANHO_DA_SEQUENCIA - 2];
    const quinto = futs[TAMANHO_DA_SEQUENCIA - 1];
    expect(await motivosDoFut(assiduo, quarto)).toEqual({ participacao: PARTICIPACAO });
    expect(await motivosDoFut(assiduo, quinto)).toEqual({
      participacao: PARTICIPACAO,
      streak: PREMIO_STREAK,
    });
    expect(await saldoDe(assiduo)).toBe(TAMANHO_DA_SEQUENCIA * PARTICIPACAO + PREMIO_STREAK);
    await conferirFecho(elenco);
  });

  // Faltar tendo vaga quebra, e "nunca respondi" quebra igual: os dois são a
  // mesma ausência para quem estava esperando o time.
  it("uma ausência no meio quebra: o quinto fut não paga sequência", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS + 1);
    const faltoso = elenco[MIN_CONTAS];
    const futs = await temporada(grupo, elenco, TAMANHO_DA_SEQUENCIA, (semana) =>
      semana === 2 ? elenco.slice(0, MIN_CONTAS) : elenco,
    );

    for (const fut of futs) await liquidar(fut);

    const quinto = futs[TAMANHO_DA_SEQUENCIA - 1];
    expect(await motivosDoFut(faltoso, quinto)).toEqual({ participacao: PARTICIPACAO });
    // Quem não faltou fechou a sequência no mesmo fut — é a prova de que o que
    // segurou o faltoso foi a ausência dele, e não o fut.
    expect(await motivosDoFut(elenco[0], quinto)).toEqual({
      participacao: PARTICIPACAO,
      streak: PREMIO_STREAK,
    });
    await conferirFecho(elenco);
  });

  // A pessoa quis ir e o app não deixou: o fut simplesmente não existe para a
  // contagem dela. Cobrar por isso seria punir quem chegou tarde numa lista
  // cheia — e por isso a sequência dela fecha um fut depois, não nunca.
  it("ficar na lista de espera não quebra a sequência — só não conta como presença", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS + 1);
    const esperando = elenco[MIN_CONTAS];
    const futs = await temporada(grupo, elenco, TAMANHO_DA_SEQUENCIA + 1, (semana) =>
      semana === 2 ? elenco.slice(0, MIN_CONTAS) : elenco,
    );
    await db.insert(attendances).values({
      matchDayId: futs[2].id,
      playerId: esperando.id,
      status: "waitlist",
      confirmedAt: sql`now() - interval '30 minutes'`,
    });

    for (const fut of futs) await liquidar(fut);

    // Cinco presenças (semanas 0, 1, 3, 4 e 5) com a espera atravessada no meio:
    // o prêmio sai no SEXTO fut do grupo.
    const sexto = futs[TAMANHO_DA_SEQUENCIA];
    expect(await motivosDoFut(esperando, sexto)).toEqual({
      participacao: PARTICIPACAO,
      streak: PREMIO_STREAK,
    });
    await conferirFecho(elenco);
  });

  // A sequência é do GRUPO. Sem o corte por group_id, um fut de outro grupo no
  // meio da semana apareceria como ausência e quebraria a corrida de quem nem é
  // de lá — e quanto mais grupos a pessoa tivesse, menos prêmio ela veria.
  it("fut de outro grupo no meio não entra na conta", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS);
    const futs = await temporada(grupo, elenco, TAMANHO_DA_SEQUENCIA);

    // Fut de outro grupo, encerrado, entre o terceiro e o quarto — e sem
    // ninguém deste elenco em campo.
    const outroGrupo = await criarGrupo("Outro Grupo");
    const intrusos = await criarElenco(outroGrupo, MIN_CONTAS);
    const { fut: intruso } = await montarFutPago({
      groupId: outroGrupo,
      elenco: intrusos,
      data: diaDoFut(2, 3),
    });
    await amadurecer(intruso, { rodada: "sem" });

    for (const fut of futs) await liquidar(fut);

    expect(await motivosDoFut(elenco[0], futs[TAMANHO_DA_SEQUENCIA - 1])).toEqual({
      participacao: PARTICIPACAO,
      streak: PREMIO_STREAK,
    });
    await conferirFecho(elenco);
  });
});

// ── Ajustes do admin ────────────────────────────────────────────────────────

describe("ajustes do admin", () => {
  // Mudar um valor vale DALI PARA FRENTE. Nada é recalculado — o que já foi pago
  // está no ledger append-only, e é essa ausência de reprocessamento que torna o
  // painel do admin seguro.
  it("a sobrescrita muda o próximo fut liquidado e não mexe no que já foi pago", async () => {
    const grupo = await criarGrupo();
    const elenco = await criarElenco(grupo, MIN_CONTAS);
    const antes = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(0) });
    await amadurecer(antes.fut, { rodada: "sem" });
    await varrer();

    expect(await salvarAjuste(db, "participacao", 250, elenco[0].id)).toBeNull();

    const depois = await montarFutPago({ groupId: grupo, elenco, data: diaDoFut(1) });
    await amadurecer(depois.fut, { rodada: "sem" });
    await varrer();

    expect(await motivosDoFut(elenco[0], antes.fut)).toEqual({ participacao: PARTICIPACAO });
    expect(await motivosDoFut(elenco[0], depois.fut)).toEqual({ participacao: 250 });
    expect(await saldoDe(elenco[0])).toBe(PARTICIPACAO + 250);
    await conferirFecho(elenco);
  });
});

// ── A contestação que chega depois do dinheiro ──────────────────────────────

describe("denúncia aceita depois da liquidação", () => {
  // O desfecho da troca, e o teste que a documenta: pagar no fechamento põe a
  // zenha na frente da contestação. Aceitar a denúncia recalcula a NOTA — e não
  // estorna, não devolve e não completa nada no extrato, porque não existe código
  // de desfazimento em lugar nenhum do sistema. É a propriedade inteira.
  it("recalcula a nota e não move nem o extrato nem o saldo", async () => {
    const { fut, elenco } = await montarFutPago();
    const roundId = (await amadurecer(fut))!;
    await registrarRaters(roundId, ritualCompleto(elenco, elenco[0], elenco[1]));
    const premiado = elenco[2];
    await registrarNota(roundId, premiado, 5, 5.3);

    expect(await varrer()).toBe(1);
    const extratoAntes = await linhasDe(premiado);
    expect(await motivosDe(premiado)).toEqual({
      participacao: PARTICIPACAO,
      nota: 3 * POR_DECIMO,
    });

    // A avaliação denunciada é a que `premiado` recebeu — o caminho real: quem
    // apanhou na nota é quem contesta.
    const denunciaId = await denunciar(roundId, elenco[3], premiado);
    expect(
      await db.transaction((tx) => resolverDenuncia(tx, denunciaId, true, { tipo: "auto" })),
    ).toBe(true);

    // O replay reescreve `skill_history` do zero (ele apaga a tabela inteira e
    // reprojeta a partir das avaliações válidas), então a subida de 0,3 que
    // pagou a fonte "nota" some do histórico. É exatamente o fato pelo qual
    // ninguém é cobrado de volta — e é o que torna a asserção seguinte um
    // contrato, e não uma coincidência.
    expect(
      await db.select().from(skillHistory).where(eq(skillHistory.playerId, premiado.id)),
    ).toHaveLength(0);

    expect(await linhasDe(premiado)).toEqual(extratoAntes);
    expect(await saldoDe(premiado)).toBe(PARTICIPACAO + 3 * POR_DECIMO);
    // E o fut não volta para a fila: `liquidado_em` já está carimbado, então nem
    // uma varredura seguinte reabre a conta.
    expect(await futsALiquidar(db)).toEqual([]);
    expect(await varrer()).toBe(0);
    await conferirFecho(elenco);
  });
});

// ── Fut apagado ─────────────────────────────────────────────────────────────

describe("fut apagado depois de liquidado", () => {
  // As três FKs do ledger são `set null`, NUNCA cascade: apagar um fut não pode
  // evaporar dinheiro que já pode ter virado badge. É também por isso que a
  // `descricao` é congelada na gravação em vez de montada por join na leitura —
  // quando o fut morre, o texto do extrato continua fazendo sentido.
  it("as linhas ficam de pé com match_day_id nulo, o saldo intacto e a descrição legível", async () => {
    const { fut, elenco } = await montarFutPago();
    const roundId = (await amadurecer(fut))!;
    await registrarRaters(roundId, ritualCompleto(elenco, elenco[0], elenco[1]));
    await liquidar(fut);
    const saldoAntes = await saldoDe(elenco[2]);
    expect(saldoAntes).toBe(PARTICIPACAO);

    await db.transaction((tx) => apagarFut(tx, fut.id, `nota:teste:${fut.id}`));

    expect(await db.select().from(matchDays).where(eq(matchDays.id, fut.id))).toHaveLength(0);
    const linhas = await linhasDe(elenco[2]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].matchDayId).toBeNull();
    expect(linhas[0].roundId).toBeNull();
    expect(linhas[0].descricao).toMatch(/^Participação no fut de /);
    expect(await saldoDe(elenco[2])).toBe(saldoAntes);
    await conferirFecho(elenco);
  });
});
