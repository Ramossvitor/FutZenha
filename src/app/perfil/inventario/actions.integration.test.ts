// A fronteira das actions do inventário.
//
// O que cada gesto faz com o banco já tem teste em loja.integration.test.ts,
// inclusive item de outro dono e slot de outro dono. O que sobra aqui é a casca:
// quem pode chamar, o slot validado contra o ENUM DO BANCO, e os slugs — que são
// o contrato com src/lib/mensagens.ts.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  zenhaCarteiras,
  zenhaEquipados,
  zenhaInventario,
  zenhaVitrine,
  type Player,
} from "@/db/schema";
import {
  desequiparSlot,
  destacarBadge,
  equiparItem,
  porBadgeNaVitrine,
  tirarBadgeDaVitrine,
} from "@/app/perfil/inventario/actions";
import { comprarItem } from "@/app/loja/actions";
import { VAGAS_NA_VITRINE } from "@/lib/item-da-loja";
import { criarBadge, criarMoldura } from "@/test/fixtures-loja";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

/**
 * Um jogador logado com um item já no inventário, inserido direto.
 *
 * Sem passar pela compra de propósito: aqui o item precisa nascer GUARDADO, e
 * comprar já o coloca (na vitrine ou no slot). Quem testa o caminho da compra é
 * o bloco do fim do arquivo.
 */
async function jogadorComItemGuardado(
  tipo: "badge" | "moldura" = "moldura",
): Promise<{ jogador: Player; inventarioId: number }> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 0 });
  const item = tipo === "badge" ? await criarBadge(`Badge de ${jogador.id}`) : await criarMoldura();
  const [linha] = await db
    .insert(zenhaInventario)
    .values({ playerId: jogador.id, itemId: item.id, precoPago: 0, consumivel: false })
    .returning({ id: zenhaInventario.id });
  return { jogador, inventarioId: linha.id };
}

const equipadosDe = (jogador: Player) =>
  db.select().from(zenhaEquipados).where(eq(zenhaEquipados.playerId, jogador.id));

const vitrineDe = (jogador: Player) =>
  db.select().from(zenhaVitrine).where(eq(zenhaVitrine.playerId, jogador.id));

describe("equiparItem", () => {
  it("equipa e volta para o inventário com o aviso", async () => {
    const { jogador, inventarioId } = await jogadorComItemGuardado();

    const url = await esperaRedirect(equiparItem(inventarioId));

    expect(url).toBe("/perfil/inventario?ok=item-equipado");
    expect(await equipadosDe(jogador)).toHaveLength(1);
  });

  it("deslogado vai para o login e não equipa nada", async () => {
    const { inventarioId } = await jogadorComItemGuardado();
    deslogar();

    const url = await esperaRedirect(equiparItem(inventarioId));

    expect(url).toBe("/login");
    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
  });

  // O id viaja no corpo do POST: um valor absurdo tem que virar banner, não
  // página de erro.
  it("id inválido vira dados-invalidos, sem 500", async () => {
    await jogadorComItemGuardado();

    expect(await esperaRedirect(equiparItem(-1))).toBe("/perfil/inventario?erro=dados-invalidos");
    expect(await esperaRedirect(equiparItem(0))).toBe("/perfil/inventario?erro=dados-invalidos");
  });

  // A posse é reconferida no `WHERE` de `equipar`, contra o player da SESSÃO —
  // mandar o id do item alheio é a primeira coisa que alguém tenta.
  it("item de outra pessoa é recusado", async () => {
    const alheio = await jogadorComItemGuardado();
    // Agora quem está logado é outra pessoa.
    const { jogador: eu } = await jogadorComItemGuardado();

    const url = await esperaRedirect(equiparItem(alheio.inventarioId));

    expect(url).toBe("/perfil/inventario?erro=item-nao-e-seu");
    expect(await equipadosDe(eu)).toHaveLength(0);
    expect(await equipadosDe(alheio.jogador)).toHaveLength(0);
  });

  // Badge não tem slot: ele vai para a vitrine. A action recusa com a mesma
  // resposta opaca de "não é seu".
  it("badge não equipa", async () => {
    const { inventarioId } = await jogadorComItemGuardado("badge");

    expect(await esperaRedirect(equiparItem(inventarioId))).toBe(
      "/perfil/inventario?erro=item-nao-e-seu",
    );
  });
});

describe("desequiparSlot", () => {
  it("esvazia o slot", async () => {
    const { jogador, inventarioId } = await jogadorComItemGuardado();
    await esperaRedirect(equiparItem(inventarioId));

    const url = await esperaRedirect(desequiparSlot("moldura"));

    expect(url).toBe("/perfil/inventario?ok=item-desequipado");
    expect(await equipadosDe(jogador)).toHaveLength(0);
  });

  // O slot é validado contra `zenhaSlotEnum.enumValues`, e não contra uma lista
  // repetida na action: um slot que sai da migration não pode continuar aceito.
  it("slot fora do enum vira dados-invalidos", async () => {
    await jogadorComItemGuardado();

    expect(await esperaRedirect(desequiparSlot("chuteira-de-ouro"))).toBe(
      "/perfil/inventario?erro=dados-invalidos",
    );
    // "badge" saiu do enum quando badge virou coleção — e a validação
    // acompanhou sozinha, que é justamente o ponto de ela ser derivada.
    expect(await esperaRedirect(desequiparSlot("badge"))).toBe(
      "/perfil/inventario?erro=dados-invalidos",
    );
  });

  // Desequipar o que já não está equipado é o estado que a pessoa pediu — dois
  // toques no mesmo botão não podem virar banner vermelho.
  it("desequipar slot já vazio é sucesso, não erro", async () => {
    await jogadorComItemGuardado();

    const url = await esperaRedirect(desequiparSlot("moldura"));

    expect(url).toBe("/perfil/inventario?ok=item-desequipado");
  });

  it("deslogado vai para o login", async () => {
    await jogadorComItemGuardado();
    deslogar();

    expect(await esperaRedirect(desequiparSlot("moldura"))).toBe("/login");
  });
});

describe("a vitrine de badges", () => {
  it("põe, tira e destaca, cada um com o seu aviso", async () => {
    const { jogador, inventarioId } = await jogadorComItemGuardado("badge");

    expect(await esperaRedirect(porBadgeNaVitrine(inventarioId))).toBe(
      "/perfil/inventario?ok=item-na-vitrine",
    );
    expect(await vitrineDe(jogador)).toHaveLength(1);

    expect(await esperaRedirect(destacarBadge(inventarioId))).toBe(
      "/perfil/inventario?ok=destaque-definido",
    );
    expect((await vitrineDe(jogador))[0].destaque).toBe(true);

    expect(await esperaRedirect(tirarBadgeDaVitrine(inventarioId))).toBe(
      "/perfil/inventario?ok=item-fora-da-vitrine",
    );
    expect(await vitrineDe(jogador)).toHaveLength(0);
  });

  it("a sexta vaga volta como vitrine-cheia, e não como 500", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 0 });

    const ids: number[] = [];
    for (let i = 0; i < VAGAS_NA_VITRINE + 1; i += 1) {
      const badge = await criarBadge(`Badge ${i}`, 0);
      const [linha] = await db
        .insert(zenhaInventario)
        .values({ playerId: jogador.id, itemId: badge.id, precoPago: 0, consumivel: false })
        .returning({ id: zenhaInventario.id });
      ids.push(linha.id);
    }
    for (const id of ids.slice(0, VAGAS_NA_VITRINE)) {
      await esperaRedirect(porBadgeNaVitrine(id));
    }

    const url = await esperaRedirect(porBadgeNaVitrine(ids[VAGAS_NA_VITRINE]));

    expect(url).toBe("/perfil/inventario?erro=vitrine-cheia");
    expect(await vitrineDe(jogador)).toHaveLength(VAGAS_NA_VITRINE);
  });

  it("badge de outra pessoa é recusado", async () => {
    const alheio = await jogadorComItemGuardado("badge");
    const { jogador: eu } = await jogadorComItemGuardado("badge");

    expect(await esperaRedirect(porBadgeNaVitrine(alheio.inventarioId))).toBe(
      "/perfil/inventario?erro=item-nao-e-seu",
    );
    expect(await vitrineDe(eu)).toHaveLength(0);
    expect(await vitrineDe(alheio.jogador)).toHaveLength(0);
  });

  // Tirar não tem caminho de erro, então a única prova é a linha do dono
  // continuar lá — e em destaque, que é o que "destacar" alheio não pode mover.
  it("tirar e destacar o badge de outra pessoa não mexem na vitrine dela", async () => {
    const alheio = await jogadorComItemGuardado("badge");
    await esperaRedirect(porBadgeNaVitrine(alheio.inventarioId));
    await esperaRedirect(destacarBadge(alheio.inventarioId));
    // Agora sou eu quem está logado.
    await jogadorComItemGuardado("badge");

    expect(await esperaRedirect(tirarBadgeDaVitrine(alheio.inventarioId))).toBe(
      "/perfil/inventario?ok=item-fora-da-vitrine",
    );
    expect(await esperaRedirect(destacarBadge(alheio.inventarioId))).toBe(
      "/perfil/inventario?erro=item-nao-e-seu",
    );

    const [linha] = await vitrineDe(alheio.jogador);
    expect(linha.inventarioId).toBe(alheio.inventarioId);
    expect(linha.destaque).toBe(true);
  });

  it("destacar o que não está na vitrine é recusado", async () => {
    const { inventarioId } = await jogadorComItemGuardado("badge");

    expect(await esperaRedirect(destacarBadge(inventarioId))).toBe(
      "/perfil/inventario?erro=item-nao-e-seu",
    );
  });

  it("id absurdo vira dados-invalidos nas três", async () => {
    await jogadorComItemGuardado("badge");

    for (const action of [porBadgeNaVitrine, tirarBadgeDaVitrine, destacarBadge]) {
      expect(await esperaRedirect(action(-1))).toBe("/perfil/inventario?erro=dados-invalidos");
    }
  });

  it("deslogado vai para o login nas três", async () => {
    const { inventarioId } = await jogadorComItemGuardado("badge");
    deslogar();

    for (const action of [porBadgeNaVitrine, tirarBadgeDaVitrine, destacarBadge]) {
      expect(await esperaRedirect(action(inventarioId))).toBe("/login");
    }
    expect(await db.select().from(zenhaVitrine)).toHaveLength(0);
  });
});

// Comprar já COLOCA o item — é a promessa que o texto do banner faz.
describe("o caminho inteiro: comprar e ver onde foi parar", () => {
  it("badge comprado já está na vitrine, em destaque", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 1000 });
    const badge = await criarBadge("Dono da bola", 250);

    expect(await esperaRedirect(comprarItem(badge.id))).toBe(
      "/perfil/inventario?ok=compra-feita",
    );

    const [naVitrine] = await vitrineDe(jogador);
    expect(naVitrine.posicao).toBe(1);
    expect(naVitrine.destaque).toBe(true);
  });

  it("moldura comprada já está equipada, e dá para tirar", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 1000 });
    const moldura = await criarMoldura("Moldura de ouro", 100);

    await esperaRedirect(comprarItem(moldura.id));
    expect(await equipadosDe(jogador)).toHaveLength(1);

    await esperaRedirect(desequiparSlot("moldura"));
    expect(await equipadosDe(jogador)).toHaveLength(0);
  });
});
