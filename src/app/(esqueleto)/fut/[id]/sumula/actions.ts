"use server";

// As actions da súmula ao vivo. O contrato do painel é diferente do /gerenciar:
// lá o admin digita um resultado pronto; aqui cada toque é um evento — o placar
// incrementa e o gol entra na MESMA transação, então os dois nunca nascem
// dessincronizados (o dado continua independente: o /gerenciar segue podendo
// divergi-los, ver o comentário de `goals` no schema).
//
// O corpo de cada operação mora em src/lib/sumula-servico.ts, que tem a API do
// relógio (src/app/api/sumula) como segundo chamador. O que fica aqui é o
// contrato do painel: o guard por cookie, a leitura do FormData e a tradução do
// `ErroDaSumula` no redirect com o slug na query string que cada action sempre
// emitiu — a URL é a mesma de quando o corpo era dela. Os slugs de parse
// continuam literais de propósito: é assim que mensagens.test.ts enxerga que
// eles são emitidos (os do serviço ele enxerga no `new ErroDaSumula` com a
// string literal).

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sumulaOperadores } from "@/db/schema";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { requireOperadorSumula } from "@/lib/require-operador-sumula";
import { ehElegivelParaSumula } from "@/lib/sumula-elegiveis";
import * as servico from "@/lib/sumula-servico";
import { revalidateMatchDay } from "../revalidate";

/**
 * Roda o serviço e converte a recusa dele no redirect que o painel espera.
 *
 * `redirect()` lança, então a saída por aqui é a de sempre: a action termina no
 * NEXT_REDIRECT e nada abaixo dela roda — inclusive o revalidate. Qualquer
 * outro erro sobe intacto: recusa de negócio tem slug, falha de infraestrutura
 * não, e disfarçá-la de banner esconderia o incidente.
 */
async function traduzindoErros<T>(matchDayId: number, executar: () => Promise<T>): Promise<T> {
  try {
    return await executar();
  } catch (erro) {
    if (erro instanceof servico.ErroDaSumula) {
      redirect(`/fut/${matchDayId}/sumula?erro=${erro.slug}`);
    }
    throw erro;
  }
}

export async function iniciarJogo(matchDayId: number, formData: FormData) {
  const operador = await requireOperadorSumula(matchDayId);
  // Sem checagem de forma aqui: o serviço recusa não-inteiro e times iguais
  // com o mesmo `dados-invalidos` que esta action emitia.
  const teamAId = Number(formData.get("teamAId"));
  const teamBId = Number(formData.get("teamBId"));

  await traduzindoErros(matchDayId, () => servico.iniciarJogo(operador, { teamAId, teamBId }));
  revalidateMatchDay(matchDayId);
}

export async function lancarGol(matchDayId: number, gameId: number, formData: FormData) {
  const operador = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(gameId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  const side = formData.get("side");
  if (side !== "A" && side !== "B") redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  const playerIdRaw = formData.get("playerId");
  const playerId =
    playerIdRaw === null || playerIdRaw === "" ? null : Number(playerIdRaw);
  if (playerId !== null && !Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);
  }

  await traduzindoErros(matchDayId, () =>
    servico.lancarGol(operador, { gameId, side, playerId }),
  );
  revalidateMatchDay(matchDayId);
}

export async function desfazerLancamento(matchDayId: number, goalId: number) {
  const operador = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(goalId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  await traduzindoErros(matchDayId, () => servico.desfazerLancamento(operador, { goalId }));
  revalidateMatchDay(matchDayId);
}

export async function trocarDeLado(matchDayId: number, gameId: number, playerId: number) {
  const operador = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(gameId) || !Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);
  }

  await traduzindoErros(matchDayId, () => servico.trocarDeLado(operador, { gameId, playerId }));
  revalidateMatchDay(matchDayId);
}

export async function finalizarJogo(matchDayId: number, gameId: number) {
  const operador = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(gameId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  await traduzindoErros(matchDayId, () => servico.finalizarJogo(operador, { gameId }));
  revalidateMatchDay(matchDayId);
}

/**
 * "Passar a súmula". Guard de admin, não de operador: delegado não delega —
 * senão a lista de quem pode lançar cresceria fora do controle de quem
 * organiza, e a delegação é justamente a resposta ao abuso.
 */
export async function delegarSumula(matchDayId: number, formData: FormData) {
  const { session } = await requireFutAdmin(matchDayId);
  const playerId = Number(formData.get("playerId"));
  if (!Number.isInteger(playerId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  // Conta ativa e presença `in` neste fut — a condição mora em
  // src/lib/sumula-elegiveis.ts, junto com o select que oferece os candidatos e
  // o guard que a reafirma a cada request.
  if (!(await ehElegivelParaSumula(matchDayId, playerId))) {
    redirect(`/fut/${matchDayId}/sumula?erro=operador-invalido`);
  }

  await db
    .insert(sumulaOperadores)
    .values({ matchDayId, playerId, createdByPlayerId: session.player.id })
    .onConflictDoNothing();
  revalidateMatchDay(matchDayId);
}

export async function revogarSumula(matchDayId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  if (!Number.isInteger(playerId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  await db
    .delete(sumulaOperadores)
    .where(
      and(eq(sumulaOperadores.matchDayId, matchDayId), eq(sumulaOperadores.playerId, playerId)),
    );
  revalidateMatchDay(matchDayId);
}
