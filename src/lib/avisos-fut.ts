import { formatDate } from "./format";
import type { NovaNotificacao } from "./notifications";

// Os avisos do ciclo de vida do fut, no molde de avisoDePromocao
// (presenca.ts): construtores puros, um por evento, com dedupeKey estável — a
// unique (playerId, dedupeKey) é quem garante que reprocessar não duplica.
// Ficam num módulo próprio porque três call sites diferentes os usam (criar
// fut, sortear, varredura de véspera) e nenhum é dono natural dos outros.
//
// Os prefixos `pelada:` dos dedupeKey carregam o nome antigo do domínio de
// propósito: a unique (playerId, dedupeKey) é exatamente o que torna notificar
// idempotente, e as chaves já estão gravadas em produção. Renomear o prefixo
// sem backfill re-notificaria todo mundo de fut já avisado. avisos-fut.test.ts
// assere as três chaves literais — é o guarda contra um find-replace distraído,
// não um teste desatualizado para "consertar".

type FutParaAvisar = { id: number; date: string; location: string };

/** Marcaram fut: avisa os elegíveis com conta — menos quem marcou. */
export function avisoDeFutCriado(
  matchDay: FutParaAvisar,
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "pelada_criada",
    title: "Fut marcado",
    body: `${formatDate(matchDay.date)}, em ${matchDay.location}. Entra na lista se você vai.`,
    href: `/fut/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:criada`,
  };
}

/**
 * Times sorteados: avisa quem está na lista. O dedupeKey sem número de rodada
 * é deliberado — re-sortear é correção do admin, não novidade, e re-avisar
 * todo mundo a cada ajuste viraria ruído.
 */
export function avisoDeTimesSorteados(
  matchDay: FutParaAvisar,
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "pelada_times_sorteados",
    title: "Times sorteados",
    body: `Saíram os times do fut de ${formatDate(matchDay.date)}. Vem ver de que lado você joga.`,
    href: `/fut/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:sorteada`,
  };
}

/** Véspera sem resposta: lembra quem ainda não disse "vou" nem "fora". */
export function avisoDeVespera(matchDay: FutParaAvisar, playerId: number): NovaNotificacao {
  return {
    playerId,
    type: "pelada_lembrete_vespera",
    title: "Amanhã tem fut — você vai?",
    body: `${formatDate(matchDay.date)}, em ${matchDay.location}. Confirma para garantir a vaga.`,
    href: `/fut/${matchDay.id}`,
    dedupeKey: `pelada:${matchDay.id}:lembrete-vespera`,
  };
}
