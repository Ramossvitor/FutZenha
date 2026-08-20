"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { agendarCancelamentosDeAgenda, agendarConvitesDeAgenda } from "@/lib/agenda-convite";
import { ehElegivel } from "@/lib/elegiveis";
import { comoEntraNoFut } from "@/lib/fut-entrada";
import { estaNaLista, estaNoCirculoDoFut } from "@/lib/fut-entrada-db";
import { listaFechada } from "@/lib/lista-presenca";
import { notificar } from "@/lib/notifications";
import { avisoDePromocao, entrarNaLista, sairDaLista, travarFut } from "@/lib/presenca";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { requirePlayer } from "@/lib/require-player";

// Só o próprio jogador logado marca a própria presença; quem não tem conta é
// marcado pelo admin do fut (definirPresenca, em ./gerenciar/actions.ts). O
// playerId vem sempre da sessão — nunca do cliente.
export async function setMyAttendance(matchDayId: number, status: "in" | "out") {
  const session = await requirePlayer();
  if (!session.player.active) return;

  const parsedId = z.number().int().positive().parse(matchDayId);
  const parsedStatus = z.enum(["in", "out"]).parse(status);

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, parsedId));
  if (!matchDay) return;
  if (listaFechada(matchDay.status)) {
    // Status mudou entre o render e o clique — revalida para a UI travar os botões.
    revalidatePath(`/fut/${parsedId}`);
    return;
  }

  // Fut de grupo é do grupo: sem isto, qualquer pessoa logada entra na lista
  // de qualquer fut da plataforma. A tela já não oferece o botão a quem não é
  // elegível, mas Server Action é endpoint público e não passa pelo proxy
  // (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
  if (!(await ehElegivel(matchDay, session.player.id))) return;

  // ...e em fut AVULSO a elegibilidade não basta, porque ali ela não filtra
  // nada: `condicaoElegivel` devolve `undefined` para fut sem grupo. Quem
  // nunca esteve nesta lista entra pelo caminho do consentimento — pedido,
  // convite ou link (ver src/lib/fut-entrada.ts) —, e não se auto-confirmando
  // no fut de um desconhecido.
  //
  // Quem JÁ tem linha na lista não passa por aqui: `comoEntraNoFut` devolve
  // "ja-esta" para ele, inclusive para quem marcou "Fora" e mudou de ideia. É
  // essa distinção que mantém o vaivém de presença funcionando como sempre.
  if (parsedStatus === "in") {
    const entrada = comoEntraNoFut(matchDay, {
      jaEstaNaLista: await estaNaLista(parsedId, session.player.id),
      elegivel: true,
      noCirculo: await estaNoCirculoDoFut(matchDay, session.player.id),
    });
    if (entrada === "pede-entrada") {
      redirect(`/fut/${parsedId}?erro=precisa-pedir-entrada`);
    }
  }

  let houvePromocao = false;
  let confirmei = false;
  let saiDeVaga = false;
  let promovidoDaEspera: number | null = null;
  await db.transaction(async (tx) => {
    // O teste de cima é o atalho barato; a palavra final é da linha travada. Sem
    // isto, um "Vou" concorrendo com o sorteio passava no status velho e entrava
    // numa lista que acabou de fechar.
    const fresca = await travarFut(tx, parsedId);
    if (listaFechada(fresca.status)) return;

    if (parsedStatus === "in") {
      const entrada = await entrarNaLista(tx, parsedId, session.player.id);
      // Só a transição para vaga gera convite de agenda — reconfirmar quem já
      // está `in` é a tela sendo idempotente, não um evento novo.
      confirmei = entrada.para === "in" && entrada.de !== "in";
    } else {
      const saida = await sairDaLista(tx, parsedId, session.player.id);
      saiDeVaga = saida.saiuDeVaga;
      if (saida.promovido !== null) {
        await notificar(tx, [avisoDePromocao(matchDay, saida.promovido)]);
        houvePromocao = true;
        promovidoDaEspera = saida.promovido;
      }
    }
  });
  // "Abriu vaga" é o aviso mais sensível a tempo do app — sai nesta invocação,
  // não na próxima varredura.
  if (houvePromocao) agendarDespachoDePush(true);
  // Agenda por e-mail: rede fora da transação, como todo efeito (ver
  // agenda-convite.ts — quem valida o estado é o próprio despacho).
  if (confirmei) agendarConvitesDeAgenda(parsedId, [session.player.id]);
  if (saiDeVaga) agendarCancelamentosDeAgenda(parsedId, [session.player.id]);
  if (promovidoDaEspera !== null) agendarConvitesDeAgenda(parsedId, [promovidoDaEspera]);

  revalidatePath("/");
  revalidatePath(`/fut/${parsedId}`);
  revalidatePath(`/fut/${parsedId}/gerenciar`);
}
