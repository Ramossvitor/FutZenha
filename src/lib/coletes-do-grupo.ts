import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { coletesDoGrupo, groups } from "@/db/schema";
import type { Colete } from "./team-colors";

// A metade com banco dos coletes do grupo. A pura (o tipo, os padrões e o
// completarColetes que o sorteio usa) mora em ./team-colors.ts, e a leitura do
// form em ./coletes-form.ts — o mesmo arranjo de resumo.ts / resumo-do-fut.ts.

/**
 * Os coletes do grupo na ordem do sorteio. Vazio para fut avulso (`groupId`
 * nulo) e para grupo que nunca definiu os seus — nos dois casos quem chama
 * completa com os padrões (completarColetes), então o chamador não distingue.
 */
export async function listarColetesDoGrupo(
  exec: Executor,
  groupId: number | null,
): Promise<Colete[]> {
  if (groupId === null) return [];
  return exec
    .select({ nome: coletesDoGrupo.nome, cor: coletesDoGrupo.cor })
    .from(coletesDoGrupo)
    .where(eq(coletesDoGrupo.groupId, groupId))
    .orderBy(asc(coletesDoGrupo.sortOrder));
}

/**
 * Substitui a lista inteira — apaga e regrava na ordem recebida. Chamar dentro
 * de uma transação: são no máximo seis linhas e o form manda todas de uma vez,
 * então não existe "editar a linha 2"; existe a lista nova. Lista vazia apaga
 * tudo, e o grupo volta aos padrões.
 *
 * A linha do grupo é travada antes do apaga-e-regrava — o mesmo papel do
 * travarFut (src/lib/presenca.ts). Sem a trava, duas gravações ao mesmo tempo
 * (dois admins, duas abas) fazem o DELETE da segunda esperar a primeira
 * commitar, pular o que ela apagou e não enxergar o que ela inseriu; o INSERT
 * da segunda colide na PK (group_id, sort_order) e a action cai num erro
 * genérico em vez de "a última gravação vale".
 */
export async function gravarColetesDoGrupo(
  exec: Executor,
  groupId: number,
  coletes: readonly Colete[],
): Promise<void> {
  await exec.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for("update");
  await exec.delete(coletesDoGrupo).where(eq(coletesDoGrupo.groupId, groupId));
  if (coletes.length === 0) return;
  await exec
    .insert(coletesDoGrupo)
    .values(coletes.map((c, i) => ({ groupId, sortOrder: i, nome: c.nome, cor: c.cor })));
}
