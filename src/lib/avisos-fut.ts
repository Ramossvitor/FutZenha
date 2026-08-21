import { formatDate } from "./format";
import type { NovaNotificacao } from "./notifications";
import { PRAZO_AVALIACAO_HORAS } from "./regras";

// Os avisos do ciclo de vida do fut, no molde de avisoDePromocao
// (presenca.ts): construtores puros, um por evento, com dedupeKey estável — a
// unique (playerId, dedupeKey) é quem garante que reprocessar não duplica.
// Ficam num módulo próprio porque quatro call sites diferentes os usam (criar
// fut, sortear, varredura de véspera, encerrar) e nenhum é dono natural dos
// outros.
//
// Os prefixos `pelada:` dos dedupeKey carregam o nome antigo do domínio de
// propósito: a unique (playerId, dedupeKey) é exatamente o que torna notificar
// idempotente, e as chaves já estão gravadas em produção. Renomear o prefixo
// sem backfill re-notificaria todo mundo de fut já avisado. avisos-fut.test.ts
// assere as chaves literais — é o guarda contra um find-replace distraído,
// não um teste desatualizado para "consertar".
//
// As duas do encerramento nascem com `fut:`, e a mistura é deliberada: elas
// nunca foram gravadas, então não há o que preservar, e o enum já abriu a
// família `fut_*` (fut_convite, fut_pedido). O legado fica onde ele custa
// alguma coisa mudar, e só ali.

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

/**
 * Encerraram o fut que você jogou — o aviso ÚNICO do encerramento.
 *
 * Empacota o que antes eram duas coisas: o `rating_round_open` que `abrirRodada`
 * mandava e a novidade de que o placar saiu. Dois avisos no mesmo segundo
 * competem pela mesma atenção e a pessoa abre um só; o que ela quer no fim do
 * jogo é ver como foi, e avaliar é o que ela faz depois de ver.
 *
 * O destino muda por pessoa, e é por isso que ele vem de fora: quem é avaliador
 * elegível cai no formulário (que mostra o resumo antes das estrelas), e quem
 * jogou mas não avalia — lado sem três contas ativas, ou fut sem rodada
 * nenhuma — cai na página do fut. Sem isso, o mesmo href levaria metade do
 * elenco a um 404.
 *
 * **O corpo não carrega o placar, de propósito.** Montá-lo exigiria consultar o
 * resumo dentro da transação do encerramento; `notifications.body` nunca é
 * reescrito e o placar é corrigível por 24h (ver ./janela-correcao), então a
 * caixa de entrada guardaria um placar mentiroso para sempre; e o push corta em
 * 120 caracteres de qualquer jeito. O placar mora no e-mail e na tela.
 */
export function avisoDeFutEncerrado(
  matchDay: FutParaAvisar,
  playerId: number,
  destino: { href: string; podeAvaliar: boolean },
): NovaNotificacao {
  return {
    playerId,
    type: "fut_encerrado",
    title: destino.podeAvaliar ? "Fut encerrado — avalie a rapaziada" : "Fut encerrado",
    body: destino.podeAvaliar
      ? `Saiu o resultado do fut de ${formatDate(matchDay.date)}. Vem ver como foi e avaliar quem jogou com você — você tem ${PRAZO_AVALIACAO_HORAS} horas.`
      : `Saiu o resultado do fut de ${formatDate(matchDay.date)}. Vem ver os placares e os gols.`,
    href: destino.href,
    dedupeKey: `fut:${matchDay.id}:encerrado`,
  };
}

/**
 * Encerraram um fut do seu grupo, e você não jogou.
 *
 * Tipo próprio, e não o mesmo do de cima, pela razão de sempre nesta base:
 * `type` é a única classificação da caixa de entrada legível por máquina, e
 * "encerraram o fut que você jogou" não é o mesmo evento que "o grupo jogou
 * ontem". Sem e-mail — quem não esteve lá não precisa de súmula na caixa de
 * entrada.
 *
 * Vai também para quem recusou o convite ou tirou o próprio nome deste fut:
 * recusar é dizer "não vou jogar", não "não quero saber do grupo". A omissão do
 * filtro por `recusouEsteFut` (./presenca) é deliberada, não esquecimento.
 */
export function avisoDeFutEncerradoNoGrupo(
  matchDay: FutParaAvisar,
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "fut_encerrado_no_grupo",
    title: "Encerraram um fut do seu grupo",
    body: `${formatDate(matchDay.date)}, em ${matchDay.location}. Vem ver como foi.`,
    href: `/fut/${matchDay.id}`,
    dedupeKey: `fut:${matchDay.id}:encerrado-grupo`,
  };
}
