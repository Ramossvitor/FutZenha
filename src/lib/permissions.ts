// Quem pode o quê. Módulo puro de propósito — sem `server-only`, sem drizzle,
// sem redirect: é a única forma de testar as regras no vitest, que aqui roda
// sem config e sem alias.
//
// A divisão é entre dois papéis de plataforma e três de grupo:
//
// - **Admin da plataforma** (`users.is_platform_admin`): contas, convites,
//   denúncias de nota injusta e supervisão de todas as peladas.
// - **Admin da pelada** (`match_days.created_by_player_id`): quem criou. Manda
//   naquela pelada — presenças, sorteio, placar, gols, encerramento e abertura
//   da votação de exclusão — e em nenhuma outra.
// - **Admin / organizador / membro do grupo** (`group_members.role`): valem só
//   dentro do grupo, e as regras deles moram em ./grupos-permissions.
//
// O admin da plataforma é fallback em qualquer pelada, inclusive nas órfãs.

export type Ator = { playerId: number; isPlatformAdmin: boolean };

/** Espelha `group_role` no schema. Fica aqui, no módulo raiz, para que
 *  ./grupos-permissions possa importar deste sem circularidade. */
export type PapelNoGrupo = "admin" | "organizer" | "member";

export type PeladaGerenciavel = {
  createdByPlayerId: number | null;
  /** Nulo em pelada avulsa — que é como tudo funcionava antes dos grupos. */
  groupId?: number | null;
};

/**
 * Quem administra esta pelada: o criador, o admin da plataforma e — em pelada
 * de grupo — o admin daquele grupo.
 *
 * A comparação com `null` é explícita porque pelada órfã (criada antes deste
 * modelo, ou de criador apagado) tem `createdByPlayerId` nulo — e uma coerção
 * distraída ali entregaria a pelada para qualquer um.
 *
 * `papelNoGrupo` é o papel do ator **no grupo desta pelada**. Passar o papel de
 * outro grupo entregaria a pelada ao admin errado, e é por isso que quem lê o
 * papel é o guard (src/lib/require-pelada-admin.ts), a partir de
 * `matchDay.groupId` — nunca de um id que veio do cliente. O default `null`
 * mantém honesto todo call site que não tem grupo em mãos.
 *
 * O organizador que **não** criou a pelada fica de fora de propósito: o poder
 * dele é criar (e, ao criar, ele vira o criador). Se gerenciasse a pelada dos
 * outros organizadores, mexeria em placar, gols e escalação alheios — e o V/E/D
 * e a artilharia de quem jogou saem justamente daí.
 *
 * O admin do grupo entra porque o grupo precisa de um fallback próprio: sem
 * ele, pelada de organizador que saiu do grupo só seria destravada pelo admin
 * da plataforma, que não escala num modelo com muitos grupos.
 */
export function podeGerenciarPelada(
  ator: Ator,
  pelada: PeladaGerenciavel,
  papelNoGrupo: PapelNoGrupo | null = null,
): boolean {
  if (ator.isPlatformAdmin) return true;
  if (pelada.createdByPlayerId !== null && pelada.createdByPlayerId === ator.playerId) return true;
  // O teste de `groupId` não é redundante: papel só existe dentro de grupo, e um
  // papel herdado de outra leitura entregaria pelada avulsa ao admin de um
  // grupo qualquer.
  return pelada.groupId != null && papelNoGrupo === "admin";
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
 * **A exceção da lista fechada.** Fechar a lista é sortear os times, e daí em
 * diante o organizador não monta mais lista: ele registra quem apareceu na
 * quadra. Alguém que não confirmou aparece toda semana, e sem esta exceção o
 * organizador ficaria esperando a pessoa abrir o celular no meio do jogo. Então,
 * com a lista fechada, ele inclui quem for **elegível** — membro do grupo, ou
 * jogador ativo se a pelada for avulsa (ver src/lib/elegiveis.ts).
 *
 * Três coisas seguram o afrouxamento, e nenhuma é dispensável:
 *
 * 1. só vale **depois** do sorteio, quando já existe pelada acontecendo — antes
 *    dele, a lista continua sendo auto-servível;
 * 2. o alvo precisa ser **elegível**, então o alcance de uma pelada de grupo é o
 *    grupo, e não a plataforma inteira;
 * 3. quem é incluído **recebe notificação** e vê em qual pelada — quem chama é
 *    que garante isso (ver definirPresenca).
 *
 * Continua sem parâmetro de papel de grupo, e continua de propósito: ser membro
 * não é consentimento para ser escalado numa pelada que ainda vai acontecer.
 * `elegivel` aqui é um piso, nunca uma autorização por si só.
 *
 * O admin da plataforma passa por cima — ele é o fallback de toda pelada, e é
 * quem conserta pelada órfã e pelada abandonada.
 */
export function podeDefinirPresencaPor(
  ator: Ator,
  alvo: { temContaAtiva: boolean; jaEstaNaPelada: boolean; elegivel: boolean },
  listaFechada: boolean,
): boolean {
  if (ator.isPlatformAdmin) return true;
  if (!alvo.temContaAtiva || alvo.jaEstaNaPelada) return true;
  return listaFechada && alvo.elegivel;
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
