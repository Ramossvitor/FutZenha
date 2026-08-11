import { formatDate } from "./format";
import type { NovaNotificacao } from "./notifications";

// Os avisos do ciclo de vida da pelada, no molde de avisoDePromocao
// (presenca.ts): construtores puros, um por evento, com dedupeKey estável — a
// unique (playerId, dedupeKey) é quem garante que reprocessar não duplica.
// Ficam num módulo próprio porque três call sites diferentes os usam (criar
// pelada, sortear, varredura de véspera) e nenhum é dono natural dos outros.

type PeladaParaAvisar = { id: number; date: string; location: string };

/** Marcaram pelada: avisa os elegíveis com conta — menos quem marcou. */
export function avisoDePeladaCriada(
  matchDay: PeladaParaAvisar,
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "pelada_criada",
    title: "Pelada marcada",
    body: `${formatDate(matchDay.date)}, em ${matchDay.location}. Entra na lista se você vai.`,
    href: `/pelada/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:criada`,
  };
}

/**
 * Times sorteados: avisa quem está na lista. O dedupeKey sem número de rodada
 * é deliberado — re-sortear é correção do admin, não novidade, e re-avisar
 * todo mundo a cada ajuste viraria ruído.
 */
export function avisoDeTimesSorteados(
  matchDay: PeladaParaAvisar,
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "pelada_times_sorteados",
    title: "Times sorteados",
    body: `Saíram os times da pelada de ${formatDate(matchDay.date)}. Vem ver de que lado você joga.`,
    href: `/pelada/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:sorteada`,
  };
}

/** Véspera sem resposta: lembra quem ainda não disse "vou" nem "fora". */
export function avisoDeVespera(matchDay: PeladaParaAvisar, playerId: number): NovaNotificacao {
  return {
    playerId,
    type: "pelada_lembrete_vespera",
    title: "Amanhã tem pelada — você vai?",
    body: `${formatDate(matchDay.date)}, em ${matchDay.location}. Confirma para garantir a vaga.`,
    href: `/pelada/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:lembrete-vespera`,
  };
}
