import "server-only";
import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { teams } from "@/db/schema";
import { travarFut } from "./presenca";
import { chaveDoNomeDeTime } from "./team-colors";

export type ErroAoEditarTime = "dados-invalidos" | "nome-de-time-repetido" | "escalacao-travada";

/**
 * Renomeia e recolore UM time do fut. Chamar DENTRO de db.transaction: trava o
 * fut (travarFut) como moverJogadorAction, porque o status precisa vir fresco
 * — um encerramento pode ter commitado entre a guarda da action e este UPDATE,
 * e a escalação de fut encerrado é imutável, nome inclusive: é o que a
 * avaliação e o e-mail de resumo já mostraram a todo mundo.
 *
 * Devolve o motivo da recusa em vez de lançar: o slug vira `?erro=` na action,
 * onde mensagens.test.ts consegue ler o literal — daqui de src/lib ele não lê.
 * Compartilhada pelo /gerenciar (quem gerencia o fut) e pela súmula (quem está
 * com ela, delegado inclusive): a regra é uma só, o guard é de cada tela.
 */
export async function atualizarTime(
  tx: Executor,
  {
    matchDayId,
    teamId,
    nome,
    cor,
  }: { matchDayId: number; teamId: number; nome: string; cor: string | null },
): Promise<ErroAoEditarTime | null> {
  const fresca = await travarFut(tx, matchDayId);
  if (fresca.status === "finished") return "escalacao-travada";

  const doFut = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.matchDayId, matchDayId));
  if (!doFut.some((t) => t.id === teamId)) return "dados-invalidos";

  // Dois times com o mesmo nome seriam dois botões "Gol do X" na súmula — e o
  // WhatsApp, o e-mail e o extrato da aposta só carregam o nome.
  const chave = chaveDoNomeDeTime(nome);
  if (doFut.some((t) => t.id !== teamId && chaveDoNomeDeTime(t.name) === chave)) {
    return "nome-de-time-repetido";
  }

  await tx
    .update(teams)
    .set({ name: nome, cor })
    .where(and(eq(teams.id, teamId), eq(teams.matchDayId, matchDayId)));
  return null;
}
