// O carregador do painel de gestão contra o banco de verdade.
//
// As filas de entrada já têm teste em src/lib/fut-entrada-db.ts; o que este
// arquivo prova é a COSTURA que só existe aqui: o badge em destaque de quem pede
// entrada (ou foi chamado) é procurado pelo id do JOGADOR, e não pelo id do
// pedido ou do convite. Os três são serial e começam em 1, então num banco
// pequeno coincidem o tempo inteiro — com a chave errada, o badge de um jogador
// aparecia ao lado do nome de outro, e num fut com um único pedido o defeito
// nem seria visível.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { matchDayInvitations, matchDayJoinRequests } from "@/db/schema";
import { comprar } from "@/lib/loja";
import { criarFut } from "@/test/fixtures";
import { criarBadge, jogadorComSaldo } from "@/test/fixtures-loja";
import { carregarPainel } from "./dados";

describe("carregarPainel", () => {
  it("acha o destaque de quem pede entrada pelo id do JOGADOR, não pelo do pedido", async () => {
    // O criador nasce primeiro de propósito: ele é o jogador 1, e o primeiro
    // pedido e o primeiro convite também são o 1. É a coincidência que a chave
    // errada precisava — e ele tem badge, para a chave errada ter o que achar.
    const criador = await jogadorComSaldo(100);
    const pedinte = await jogadorComSaldo(100);
    const convidado = await jogadorComSaldo(100);
    const fut = await criarFut({ createdByPlayerId: criador.id });
    const badges = new Map<number, number>();
    for (const jogador of [criador, pedinte, convidado]) {
      const badge = await criarBadge(`Badge de ${jogador.id}`, 10);
      // Comprar já põe o badge na vitrine e, sendo o primeiro, em destaque.
      expect(await comprar(jogador.id, badge.id)).toBeNull();
      badges.set(jogador.id, badge.id);
    }
    await db.insert(matchDayJoinRequests).values({ matchDayId: fut.id, playerId: pedinte.id });
    await db.insert(matchDayInvitations).values({
      matchDayId: fut.id,
      playerId: convidado.id,
      invitedByPlayerId: criador.id,
    });

    const painel = await carregarPainel(fut.id, criador.id);

    expect(painel.pedidosDeEntrada.map((p) => p.playerId)).toEqual([pedinte.id]);
    expect(painel.convitesDeFut.map((c) => c.playerId)).toEqual([convidado.id]);
    expect(painel.destaques.get(pedinte.id)?.itemId).toBe(badges.get(pedinte.id));
    expect(painel.destaques.get(convidado.id)?.itemId).toBe(badges.get(convidado.id));
    // O criador não está em fila nenhuma, então não pode estar no mapa — é
    // exatamente o que o id do pedido (que coincide com o dele) traria.
    expect(painel.destaques.has(criador.id)).toBe(false);
  });
});
