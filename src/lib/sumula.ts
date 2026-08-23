// As regras da súmula ao vivo que dá para decidir sem banco. Módulo puro de
// propósito (sem drizzle, sem server-only) — mesma razão de permissions.ts:
// é a única forma de testar a matriz de decisão no vitest. Quem resolve os
// booleanos de entrada (SQL de "último do lado", guard de operador) são as
// actions em src/app/fut/[id]/sumula/actions.ts.
//
// O import de `MatchDay` é só de tipo: some na compilação e não traz drizzle
// para cá em tempo de execução.

import type { MatchDay } from "@/db/schema";

/**
 * Quando a súmula ao vivo existe para este fut.
 *
 * Antes do sorteio não há lado para creditar gol; depois do encerramento a
 * correção é do /gerenciar (com a janela de 24h de lá). Uma definição só,
 * porque ela decide TRÊS coisas que precisam concordar: se o link aparece
 * (/fut/[id] e /fut/[id]/gerenciar), se a página abre, e se o `iniciarJogo`
 * aceita. Quando eram três expressões, a página deixava passar `scheduled` e
 * só o "sem times" adiante barrava, com mensagem que não explicava nada.
 */
export function sumulaDisponivel(fut: Pick<MatchDay, "status">): boolean {
  return fut.status === "teams_drawn";
}

/**
 * Jogo em andamento ⇔ começou e não terminou. Jogo do fluxo clássico do
 * /gerenciar nasce com os dois timestamps nulos e nunca entra aqui — é o que
 * mantém o painel invisível para tudo que já existia.
 */
export function jogoEmAndamento(g: {
  startedAt: Date | null;
  finishedAt: Date | null;
}): boolean {
  return g.startedAt !== null && g.finishedAt === null;
}

/**
 * O desfazer do painel. A regra do delegado é "o lançamento ativo mais recente
 * de cada lado, só com o jogo em andamento":
 *
 * - **por lado**, e não o último geral, porque o erro típico (lado errado,
 *   autor errado) é percebido na hora ou no gol seguinte — que pode vir do
 *   outro lado e não deve trancar a correção;
 * - **sem janela de tempo**: um jogo de fut dura poucos minutos e finalizar já
 *   encerra a exposição; um relógio de "2 min" só criaria um segundo prazo
 *   para explicar sem reduzir abuso real. De quebra, "último do lado" é
 *   verificável inteiro em SQL, sem relógio da aplicação.
 *
 * O admin do fut desfaz qualquer lançamento pelo painel enquanto o jogo está
 * em andamento — e fora dele continua com a edição irrestrita do /gerenciar
 * (deleteGoal/updateGameScore, com as travas de lá).
 */
export function podeDesfazerLancamento(args: {
  ehAdminDoFut: boolean;
  jogoEmAndamento: boolean;
  ultimoDoLado: boolean;
}): boolean {
  if (!args.jogoEmAndamento) return false;
  return args.ehAdminDoFut || args.ultimoDoLado;
}

/** O que `marcarPodeDesfazer` precisa saber de cada linha da lista. */
export type LancamentoDesfazivel = { id: number; side: "A" | "B" | null; desfeito: boolean };

/**
 * Marca cada lançamento do jogo aberto com o `podeDesfazer` que a UI usa para
 * decidir se mostra o botão.
 *
 * Mora aqui, e não na página, por dois motivos. O primeiro é cobertura: um
 * `page.tsx` está fora do coverage do vitest (ver `vitest.config.mts`), então
 * a regra ficava sem teste justamente na metade que o usuário enxerga. O
 * segundo é não ter uma segunda definição de "último do lado" — a autoridade é
 * o `ULTIMO_DO_LADO` da action, e esta função existe para concordar com ele: o
 * mesmo recorte por lado, os desfeitos fora da conta, e a decisão final
 * delegada a `podeDesfazerLancamento`. Divergir daria botão que o servidor
 * recusa.
 *
 * Independe da ordem da lista (usa o maior id de cada lado), como o `not
 * exists ... id > ...` do SQL.
 */
export function marcarPodeDesfazer<T extends LancamentoDesfazivel>(
  lancamentos: readonly T[],
  ehAdminDoFut: boolean,
): (T & { podeDesfazer: boolean })[] {
  const ultimoAtivoPorLado = new Map<"A" | "B", number>();
  for (const l of lancamentos) {
    if (l.desfeito || l.side === null) continue;
    const atual = ultimoAtivoPorLado.get(l.side);
    if (atual === undefined || l.id > atual) ultimoAtivoPorLado.set(l.side, l.id);
  }

  return lancamentos.map((l) => ({
    ...l,
    podeDesfazer:
      !l.desfeito &&
      // Sem lado não há placar de onde sair, e a action recusa mesmo para o
      // admin — a UI não pode oferecer o que o servidor nega.
      l.side !== null &&
      podeDesfazerLancamento({
        ehAdminDoFut,
        // A lista só existe para o jogo aberto — quem a monta é o painel.
        jogoEmAndamento: true,
        ultimoDoLado: ultimoAtivoPorLado.get(l.side) === l.id,
      }),
  }));
}

/**
 * A linha do tempo do painel: os gols e as trocas de lado do jogo aberto numa
 * lista só, do mais recente para o mais antigo.
 *
 * A ordenação é por `criadoEm` (epoch que o POSTGRES calculou) e não por id:
 * as duas tabelas têm sequências próprias, então um id 7 de `trocas_de_lado`
 * não diz nada sobre um id 7 de `goals`.
 *
 * O empate desce para o id porque o segundo é grosso demais para um painel em
 * que dois toques seguidos cabem no mesmo — e, entre tabelas diferentes, o gol
 * vem primeiro: quem lê a lista está conferindo placar, e o gol é o evento que
 * o placar explica.
 *
 * Genérica nas duas pontas para a página decidir o formato das linhas: aqui só
 * se sabe ordenar, e um tipo concreto obrigaria este módulo puro a conhecer
 * apelido, rótulo e tudo o mais que a UI monta.
 */
export type EventoDaSumula<G, T> = ({ tipo: "gol" } & G) | ({ tipo: "troca" } & T);

export function montarLinhaDoTempo<
  G extends { id: number; criadoEm: number },
  T extends { id: number; criadoEm: number },
>(gols: readonly G[], trocas: readonly T[]): EventoDaSumula<G, T>[] {
  const eventos: EventoDaSumula<G, T>[] = [
    ...gols.map((g) => ({ tipo: "gol" as const, ...g })),
    ...trocas.map((t) => ({ tipo: "troca" as const, ...t })),
  ];
  return eventos.sort(
    (a, b) =>
      b.criadoEm - a.criadoEm ||
      // Gol antes de troca no mesmo instante.
      (a.tipo === b.tipo ? b.id - a.id : a.tipo === "gol" ? -1 : 1),
  );
}

/**
 * "há N min" a partir de segundos que o POSTGRES contou — a página nunca olha o
 * relógio da aplicação (regra de pureza do render), e por isso o rótulo congela
 * até o próximo refresh, o que para uma súmula é o comportamento certo: quem
 * quer o placar novo puxa para atualizar.
 */
export function tempoAtras(segundos: number): string {
  if (segundos < 60) return "agora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  return `há ${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}
