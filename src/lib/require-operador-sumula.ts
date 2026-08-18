import "server-only";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays, sumulaOperadores, type MatchDay } from "@/db/schema";
import { papelNoGrupo } from "./grupos";
import { podeGerenciarFut, podeOperarSumula } from "./permissions";
import { getSession, type Session } from "./session";
import { ehElegivelParaSumula } from "./sumula-elegiveis";

export type OperadorDeSumula = {
  session: Session;
  matchDay: MatchDay;
  /**
   * true = passa por `podeGerenciarFut`; false = está aqui por delegação.
   * É o que decide o alcance do desfazer (src/lib/sumula.ts) e se a seção
   * "passar a súmula" aparece no painel.
   */
  ehAdminDoFut: boolean;
};

/**
 * Exige quem opera a súmula ao vivo deste fut: quem o gerencia, ou quem
 * recebeu a súmula (sumula_operadores). Irmão de require-fut-admin.ts, com as
 * mesmas decisões — o papel no grupo sai de `matchDay.groupId` e a delegação
 * do par (fut, jogador da sessão), nunca de ids do cliente; fut inexistente e
 * fut alheio dão o mesmo 404, porque quem não opera não precisa saber que o
 * id existe.
 *
 * A consulta à delegação só roda para quem NÃO gerencia — o caminho do admin
 * continua custando o mesmo que no guard irmão.
 *
 * A decisão em si é de `podeOperarSumula` (src/lib/permissions.ts), como em
 * todo guard da casa: aqui só se resolvem os fatos (papel no grupo, delegação),
 * lá se aplica a regra. Enquanto este arquivo reescrevia a regra por conta
 * própria, os testes de `podeOperarSumula` davam garantia sobre uma função que
 * nada chamava.
 */
export async function requireOperadorSumula(matchDayId: number): Promise<OperadorDeSumula> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!Number.isInteger(matchDayId)) notFound();

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) notFound();

  const papel =
    matchDay.groupId !== null ? await papelNoGrupo(matchDay.groupId, session.player.id) : null;

  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const ehAdminDoFut = podeGerenciarFut(ator, matchDay, papel);
  const ehDelegado = ehAdminDoFut
    ? false
    : await temSumulaDelegada(matchDayId, session.player.id);

  if (!podeOperarSumula(ator, matchDay, papel, ehDelegado)) notFound();

  return { session, matchDay, ehAdminDoFut };
}

/**
 * A delegação, revalidada contra as MESMAS condições que `delegarSumula` exigiu
 * para criá-la: presença `in` e conta ativa.
 *
 * Reafirmar na leitura é o que faz a revogação seguir a lista sozinha — quem
 * sai do fut (`out`/`no_show`) ou tem a conta desativada perde a súmula na
 * hora, sem ninguém precisar lembrar de apagar a linha. Antes bastava a linha
 * existir, e o poder sobrevivia à desistência.
 *
 * Exportada porque a página pública do fut precisa da mesma resposta para
 * decidir se mostra o link do painel: com duas leituras diferentes, ela
 * oferecia um caminho que o guard depois recusava com 404.
 */
export async function temSumulaDelegada(matchDayId: number, playerId: number): Promise<boolean> {
  const [delegacao] = await db
    .select({ playerId: sumulaOperadores.playerId })
    .from(sumulaOperadores)
    .where(
      and(eq(sumulaOperadores.matchDayId, matchDayId), eq(sumulaOperadores.playerId, playerId)),
    );
  if (!delegacao) return false;

  return ehElegivelParaSumula(matchDayId, playerId);
}
