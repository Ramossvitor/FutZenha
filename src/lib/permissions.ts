// Quem pode o quê. Módulo puro de propósito — sem `server-only`, sem drizzle,
// sem redirect: é a única forma de testar as regras no vitest, que aqui roda
// sem config e sem alias.
//
// A divisão é entre dois papéis:
//
// - **Admin da plataforma** (`users.is_platform_admin`): contas, convites,
//   denúncias de nota injusta e supervisão de todas as peladas.
// - **Admin da pelada** (`match_days.created_by_player_id`): quem criou. Manda
//   naquela pelada — presenças, sorteio, placar, gols, encerramento e abertura
//   da votação de exclusão — e em nenhuma outra.
//
// O admin da plataforma é fallback em qualquer pelada, inclusive nas órfãs.

export type Ator = { playerId: number; isPlatformAdmin: boolean };

export type PeladaGerenciavel = { createdByPlayerId: number | null };

/**
 * Quem administra esta pelada: o criador ou o admin da plataforma.
 *
 * A comparação com `null` é explícita porque pelada órfã (criada antes deste
 * modelo, ou de criador apagado) tem `createdByPlayerId` nulo — e uma coerção
 * distraída ali entregaria a pelada para qualquer um.
 */
export function podeGerenciarPelada(ator: Ator, pelada: PeladaGerenciavel): boolean {
  if (ator.isPlatformAdmin) return true;
  return pelada.createdByPlayerId !== null && pelada.createdByPlayerId === ator.playerId;
}

/**
 * Por quem o admin da pelada pode marcar presença (e a quem pode pôr em jogo).
 *
 * O override existe para quem **não consegue se marcar**: o jogador cadastrado
 * que ainda não resgatou o convite, ou que teve a conta desativada. Esse caso
 * continua livre — é o que o README descreve como "cadastrar quem chegou de
 * última hora".
 *
 * Quem tem conta ativa é outra história desde que qualquer jogador logado cria
 * pelada. Sem esta regra, alguém marcava uma pelada, escalava meia dúzia de
 * gente com conta que nunca ouviu falar do jogo, encerrava, e a presença e o
 * V/E/D dessas pessoas mudavam — os rankings só contam quem tem conta ativa
 * (ver src/lib/stats.ts), então o estrago cai justamente sobre elas. Uma vez
 * que a pessoa entrou na pelada por conta própria, o organizador volta a mandar:
 * é ele quem corrige presença depois do sorteio.
 *
 * O admin da plataforma passa por cima — ele é o fallback de toda pelada, e é
 * quem conserta pelada órfã e pelada abandonada.
 */
export function podeDefinirPresencaPor(
  ator: Ator,
  alvo: { temContaAtiva: boolean; jaEstaNaPelada: boolean },
): boolean {
  if (ator.isPlatformAdmin) return true;
  return !alvo.temContaAtiva || alvo.jaEstaNaPelada;
}

// Não existe aqui um `podeGerarConvite`, e é de propósito. A regra — convite
// para quem já tem conta é reset de senha, logo é da plataforma e só dela — não
// tem onde ser avaliada: `createInvite` é exclusiva do admin da plataforma
// (src/app/admin/(panel)/jogadores/actions.ts) e `convidarParaPelada` só cria
// jogador novo, que por definição não tem conta. Uma função que ninguém chama
// não é regra, é comentário que o leitor confunde com trava.

/**
 * Denúncia de nota injusta é da plataforma — e de quem ficou de fora da rodada.
 *
 * As duas condições existem pelo mesmo motivo. O julgador precisa não ser parte
 * da rodada: quem jogou saberia, ao ver "Fulano contesta uma nota 1★", que a
 * denúncia é contra a estrela que ele mesmo deu — e o anonimato do avaliador,
 * que src/lib/anonimato.ts protege com tanto cuidado, cairia pelo lado do
 * julgador. Some-se a isso que aceitar uma denúncia dispara `aplicarReplay`,
 * que recalcula a nota de todo mundo: é decisão de plataforma, não de pelada.
 *
 * Ser admin da plataforma não dispensa a segunda condição. O admin é jogador
 * como qualquer outro (ver src/db/schema.ts), então joga, recebe nota e pode
 * denunciar; sem este `&&` bastaria denunciar a própria nota para abrir, em
 * /admin/avaliacoes, a lista de quem lhe deu cada estrela.
 */
export function podeJulgarDenuncia(
  ator: Ator,
  denuncia: { julgadorJogouARodada: boolean },
): boolean {
  return ator.isPlatformAdmin && !denuncia.julgadorJogouARodada;
}
