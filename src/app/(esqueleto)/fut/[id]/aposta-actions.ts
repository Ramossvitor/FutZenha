"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { apostar, cancelarAposta } from "@/lib/aposta-engine";
import { requirePlayer } from "@/lib/require-player";
import { getAjustes } from "@/lib/zenha-config";

// As duas pontas da aposta. Nenhuma das duas confere o PRAZO aqui: quem confere
// é o `WHERE` das funções do motor, avaliado pelo Postgres no mesmo instante da
// escrita (ver `janelaDaAposta`). Ler o horário aqui e gravar depois abriria uma
// janela entre as duas coisas — e a aposta existe justamente para não haver.

const dadosDaAposta = z.object({
  matchDayId: z.number().int().positive(),
  // `coerce` porque o valor chega do `FormData` como string. Campo vazio vira
  // NaN, que o `int()` recusa — e vira o banner de sempre, não uma aposta de
  // zero.
  valor: z.coerce.number().int().positive(),
});

const idsDoCancelamento = z.object({
  matchDayId: z.number().int().positive(),
  apostaId: z.number().int().positive(),
});

/**
 * Aposta na própria vitória neste fut.
 *
 * O teto e o piso são conferidos aqui, e não no `WHERE`, porque são a única
 * recusa que merece texto próprio: "não deu" serve para prazo e presença (a tela
 * já sabe o que ofereceu), mas quem digitou 5000 precisa saber qual é o limite.
 */
export async function apostarAction(matchDayId: number, formData: FormData) {
  const session = await requirePlayer();
  if (!session.player.active) redirect(`/fut/${matchDayId}?erro=sem-permissao`);

  // `safeParse`, e não `parse`: o valor vem do corpo do POST, e um número
  // negativo num payload forjado tem que virar o banner de sempre — `parse`
  // lançaria, e o que a pessoa veria é a página de erro do Next.
  const parsed = dadosDaAposta.safeParse({ matchDayId, valor: formData.get("valor") ?? "" });
  if (!parsed.success) redirect(`/fut/${matchDayId}?erro=dados-invalidos`);
  const { matchDayId: parsedFut, valor: parsedValor } = parsed.data;

  const ajustes = await getAjustes(db);
  if (parsedValor < ajustes.aposta_min || parsedValor > ajustes.aposta_max) {
    redirect(`/fut/${parsedFut}?erro=aposta-fora-do-limite`);
  }

  const erro = await apostar(db, session.player.id, parsedFut, parsedValor);
  if (erro === "saldo-insuficiente") redirect(`/fut/${parsedFut}?erro=sem-saldo`);
  if (erro) redirect(`/fut/${parsedFut}?erro=aposta-indisponivel`);

  revalidatePath(`/fut/${parsedFut}`);
  revalidatePath("/zenhas");
  redirect(`/fut/${parsedFut}?ok=aposta-feita`);
}

/**
 * Cancela a aposta e devolve a zenha.
 *
 * A MESMA guarda de prazo do apostar, dentro de `cancelarAposta()`. Sem ela o
 * antiabuso seria decorativo: aposta na véspera, vê os times no sábado, cancela
 * antes da bola rolar.
 *
 * `apostaId` vem do cliente e é só uma REFERÊNCIA: o dono é reconferido no
 * `WHERE` contra o `player_id` da sessão.
 */
export async function cancelarApostaAction(matchDayId: number, apostaId: number) {
  const session = await requirePlayer();
  const parsed = idsDoCancelamento.safeParse({ matchDayId, apostaId });
  if (!parsed.success) redirect(`/fut/${matchDayId}?erro=dados-invalidos`);
  const { matchDayId: parsedFut, apostaId: parsedAposta } = parsed.data;

  const erro = await cancelarAposta(db, session.player.id, parsedAposta);
  if (erro) redirect(`/fut/${parsedFut}?erro=aposta-travada`);

  revalidatePath(`/fut/${parsedFut}`);
  revalidatePath("/zenhas");
  redirect(`/fut/${parsedFut}?ok=aposta-cancelada`);
}
