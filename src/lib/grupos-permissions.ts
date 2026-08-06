// Quem pode o quê dentro de um grupo. Módulo puro, pelo mesmo motivo de
// ./permissions — sem `server-only`, sem drizzle, sem redirect: é a única forma
// de testar as regras no vitest, que aqui roda sem config e sem alias.
//
// Os três papéis, do enunciado da feature:
//
// - **admin**: quem criou. Manda no grupo — dados, visibilidade, política de
//   entrada, papéis, remoção de membro e exclusão do grupo. Um por grupo,
//   garantido pelo índice parcial `group_members_admin_unico_idx`.
// - **organizer**: cria peladas do grupo e convida gente. Promovido pelo admin,
//   sem limite de quantos.
// - **member**: confirma presença nas peladas, acompanha e entra no ranking do
//   grupo.
//
// O admin da plataforma é fallback aqui como é em pelada — mesma lógica de
// ./permissions.

import type { Ator, PapelNoGrupo } from "./permissions";

/** Papel do jogador neste grupo. `null` = não é membro. */
export type Vinculo = PapelNoGrupo | null;

/** Rótulo de cada papel, para a interface. Fica junto das regras porque é a
 *  mesma lista de papéis — três telas mostravam a própria cópia. */
export const papelLabel: Record<PapelNoGrupo, string> = {
  admin: "administrador",
  organizer: "organizador",
  member: "membro",
};

export type GrupoVisivel = { visibility: "private" | "public" };
export type GrupoEntravel = GrupoVisivel & { joinPolicy: "request" | "open" };

/** Alvo de uma mudança de papel ou de uma remoção. */
export type AlvoNoGrupo = { papelAtual: Vinculo; ehOAtor: boolean };

/**
 * Gestão do grupo: nome, descrição, visibilidade, política de entrada, papéis,
 * remoção de membro, fila de pedidos e exclusão.
 *
 * Só o admin. O organizador fica de fora de propósito: se ele pudesse promover,
 * viraria uma fábrica de organizadores e o admin perderia o controle da própria
 * portaria — quem entra no grupo decide quem entra nas peladas dele e, por
 * tabela, quem aparece no ranking do grupo.
 */
export function podeGerenciarGrupo(ator: Ator, papel: Vinculo): boolean {
  return ator.isPlatformAdmin || papel === "admin";
}

/**
 * Criar pelada com este `group_id`. Admin e organizador — e mais ninguém.
 *
 * O `false` para quem não é membro é a trava mais importante deste arquivo.
 * Qualquer jogador logado cria pelada avulsa hoje (ver
 * src/app/peladas/nova/actions.ts), e `groupId` chega pelo formulário: sem esta
 * regra, bastaria trocar o valor do `<select>` para criar pelada dentro de um
 * grupo alheio e injetar gols, presenças e V/E/D no ranking de gente que nunca
 * ouviu falar de você.
 */
export function podeCriarPeladaNoGrupo(ator: Ator, papel: Vinculo): boolean {
  return ator.isPlatformAdmin || papel === "admin" || papel === "organizer";
}

/** Gerar e revogar o link do grupo, convidar nominalmente e revogar convite. */
export function podeConvidarParaGrupo(ator: Ator, papel: Vinculo): boolean {
  return ator.isPlatformAdmin || papel === "admin" || papel === "organizer";
}

/**
 * Promover a organizador ou rebaixar a membro.
 *
 * Nunca toca no papel `admin`, nas duas pontas. Sem a recusa de
 * `alvo.papelAtual === "admin"`, um segundo admin — que só existiria por bug,
 * mas a regra não pode depender disso — rebaixaria o primeiro por aqui e
 * assumiria o grupo sem passar por `transferirAdministracao`. E a recusa de
 * `ehOAtor` espelha `setPlatformAdmin` (src/app/admin/(panel)/jogadores/actions.ts),
 * que também não deixa ninguém se auto-rebaixar: o grupo ficaria sem quem
 * administra, e é o mesmo buraco que `podeSairDoGrupo` fecha do outro lado.
 *
 * Alvo que não é membro também é recusado — promover quem está de fora criaria
 * um organizador que nunca entrou no grupo.
 *
 * Não recebe o papel de destino porque não há decisão a tomar com ele: o tipo
 * do parâmetro na action já exclui `admin`, e promover a organizador e rebaixar
 * a membro têm exatamente as mesmas condições.
 */
export function podePromover(ator: Ator, papelDoAtor: Vinculo, alvo: AlvoNoGrupo): boolean {
  if (!podeGerenciarGrupo(ator, papelDoAtor)) return false;
  if (alvo.ehOAtor) return false;
  if (alvo.papelAtual === null) return false;
  return alvo.papelAtual !== "admin";
}

/**
 * Remover alguém do grupo. Nunca o admin (que precisa transferir antes) e nunca
 * a si mesmo — para sair existe `podeSairDoGrupo`.
 *
 * As condições são exatamente as de `podePromover`, e delegar é o que garante
 * que continuem sendo: mudar quem pode mexer no papel de alguém sem mudar quem
 * pode removê-lo daria no mesmo resultado por outro caminho.
 */
export function podeRemoverMembro(ator: Ator, papelDoAtor: Vinculo, alvo: AlvoNoGrupo): boolean {
  return podePromover(ator, papelDoAtor, alvo);
}

/**
 * Ver o ranking do grupo — e, do outro lado, sair dele.
 *
 * Só quem é do grupo. O ranking mostra quem jogou as peladas do grupo, que num
 * grupo privado é a mesma lista de membros que `podeVerGrupo` esconde.
 */
export function podeVerRankingDoGrupo(ator: Ator, papel: Vinculo): boolean {
  return ator.isPlatformAdmin || papel !== null;
}

/**
 * Sair do grupo por conta própria.
 *
 * O admin não sai sem transferir: o grupo ficaria órfão, com peladas marcadas
 * que ninguém pode encerrar e uma fila de pedidos que ninguém aprova. É o mesmo
 * problema da pelada órfã em ./permissions, e ali a saída foi o admin da
 * plataforma — que não escala quando há muitos grupos.
 */
export function podeSairDoGrupo(papel: Vinculo): boolean {
  return papel !== null && papel !== "admin";
}

/**
 * Enxergar o grupo: a página, a lista de membros e o ranking dele.
 *
 * Grupo privado é invisível para quem está de fora, e o guard responde o mesmo
 * 404 de id inexistente (src/lib/require-grupo.ts). Sem isso, varrer
 * `/grupo/1`, `/grupo/2`, ... entregaria a lista de membros de todo grupo
 * privado da plataforma.
 */
export function podeVerGrupo(ator: Ator, grupo: GrupoVisivel, papel: Vinculo): boolean {
  return grupo.visibility === "public" || papel !== null || ator.isPlatformAdmin;
}

/** O que acontece quando alguém de fora tenta entrar. */
export type ResultadoEntrada = "ja-membro" | "entra-direto" | "pede-entrada" | "so-convite";

/**
 * Como se entra neste grupo.
 *
 * A visibilidade é testada **antes** da política, e essa ordem é a regra. Um
 * grupo público com entrada livre que depois vira privado mantém
 * `join_policy = 'open'` gravado — é herança, não intenção. Olhar a política
 * primeiro deixaria qualquer um entrar direto num grupo que acabou de ser
 * fechado, que é exatamente o oposto do que o admin pediu ao fechá-lo.
 */
export function podeEntrarNoGrupo(grupo: GrupoEntravel, papel: Vinculo): ResultadoEntrada {
  if (papel !== null) return "ja-membro";
  if (grupo.visibility === "private") return "so-convite";
  return grupo.joinPolicy === "open" ? "entra-direto" : "pede-entrada";
}
