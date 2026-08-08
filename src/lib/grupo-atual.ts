import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getGrupo, papelNoGrupo } from "./grupos";
import { getSession } from "./session";
import type { PapelNoGrupo } from "./permissions";

// Em qual grupo a pessoa está navegando. Início, /peladas e /rankings filtram
// por ele; o hub /grupos é a única porta que o troca.
//
// A ausência do cookie é um estado legítimo, não um erro: "todas as peladas".
// Precisa existir porque `match_days.group_id` é nullable — pelada avulsa é
// como o produto funcionava antes de haver grupo, e continua funcionando.
export const GRUPO_COOKIE = "futzenha_grupo";

// Sem httpOnly de propósito: não é credencial, é preferência de navegação. O
// que protege não é o cookie ser ilegível — é a reconferência de papel abaixo.
// 1 ano: a pessoa joga no mesmo grupo toda semana; expirar isso seria só um
// incômodo recorrente.
export const GRUPO_COOKIE_OPTIONS = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
} as const;

export type GrupoAtual = {
  id: number;
  name: string;
  papel: PapelNoGrupo;
};

/**
 * Para onde a troca de grupo leva depois de gravar o cookie — ver `trocarGrupo`.
 *
 * Mora aqui, e não junto da action, porque o painel do seletor precisa do tipo
 * para declarar a prop da Server Action que recebe do layout: com ele em
 * `src/app/grupos/actions`, `src/components/` passaria a nomear `src/app/`, que
 * é a única direção de import que o projeto não tem em lugar nenhum.
 */
export type DestinoDaTroca = "ficar" | "ir-para-inicio";

/**
 * O grupo em que a pessoa está navegando, ou null para "todas as peladas".
 *
 * O cookie é só uma dica — qualquer um edita o valor no DevTools. A autoridade
 * é o `papelNoGrupo`: se a pessoa não é (ou deixou de ser) membro, o contexto
 * cai para "todos" em silêncio, e o nome do grupo não chega a ser lido.
 *
 * Isso não é redundante com a checagem que a action de troca já faz. A action
 * impede o cookie de nascer sujo; esta função cobre o cookie que ficou sujo —
 * a pessoa saiu do grupo, foi removida, ou o grupo foi apagado — sem que
 * ninguém tenha reescrito o cookie no caminho.
 *
 * `cache()` porque top bar, sidebar e a própria página perguntam a mesma coisa
 * no mesmo render.
 */
export const getGrupoAtual = cache(async (): Promise<GrupoAtual | null> => {
  const session = await getSession();
  if (!session) return null;

  const bruto = (await cookies()).get(GRUPO_COOKIE)?.value;
  if (!bruto) return null;

  const id = Number(bruto);
  if (!Number.isInteger(id) || id <= 0) return null;

  // Em paralelo de propósito: buscar o nome de um grupo de que a pessoa saiu é
  // inofensivo (o resultado é descartado pelo papel nulo), e a espera some do
  // caminho crítico do layout — que roda isto em TODA navegação.
  const [papel, grupo] = await Promise.all([
    papelNoGrupo(id, session.player.id),
    getGrupo(id),
  ]);
  if (!papel || !grupo) return null;

  return { id: grupo.id, name: grupo.name, papel };
});

/**
 * Só o id, para passar de escopo às consultas de stats.
 *
 * Sem parâmetro `playerId` de propósito: recebê-lo criaria uma API em que
 * passar o id de outra pessoa devolve o contexto dela, e quebraria o `cache()`,
 * que precisa ser por request e não por argumento.
 */
export async function getGroupIdAtual(): Promise<number | undefined> {
  return (await getGrupoAtual())?.id;
}
