// A fronteira das actions do inventário.
//
// `equipar`/`desequipar` já têm teste contra o banco em loja.integration.test.ts,
// inclusive item de outro dono e slot de outro dono. O que sobra aqui é a casca:
// quem pode chamar, o slot validado contra o ENUM DO BANCO, e os slugs.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { zenhaCarteiras, zenhaEquipados, zenhaInventario, type Player } from "@/db/schema";
import { equiparItem, desequiparSlot } from "@/app/perfil/inventario/actions";
import { comprarItem } from "@/app/loja/actions";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

const BADGE = "dono-da-bola";

async function jogadorComItem(): Promise<{ jogador: Player; inventarioId: number }> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 0 });
  const [item] = await db
    .insert(zenhaInventario)
    .values({ playerId: jogador.id, itemId: BADGE, precoPago: 0, consumivel: false })
    .returning({ id: zenhaInventario.id });
  return { jogador, inventarioId: item.id };
}

const equipadosDe = (jogador: Player) =>
  db.select().from(zenhaEquipados).where(eq(zenhaEquipados.playerId, jogador.id));

describe("equiparItem", () => {
  it("equipa e volta para o inventário com o aviso", async () => {
    const { jogador, inventarioId } = await jogadorComItem();

    const url = await esperaRedirect(equiparItem(inventarioId));

    expect(url).toBe("/perfil/inventario?ok=item-equipado");
    expect(await equipadosDe(jogador)).toHaveLength(1);
  });

  it("deslogado vai para o login e não equipa nada", async () => {
    const { inventarioId } = await jogadorComItem();
    deslogar();

    const url = await esperaRedirect(equiparItem(inventarioId));

    expect(url).toBe("/login");
    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
  });

  // O id viaja no corpo do POST: um valor absurdo tem que virar banner, não
  // página de erro.
  it("id inválido vira dados-invalidos, sem 500", async () => {
    await jogadorComItem();

    expect(await esperaRedirect(equiparItem(-1))).toBe("/perfil/inventario?erro=dados-invalidos");
    expect(await esperaRedirect(equiparItem(0))).toBe("/perfil/inventario?erro=dados-invalidos");
  });

  // A posse é reconferida no `WHERE` de `equipar`, contra o player da SESSÃO —
  // mandar o id do item alheio é a primeira coisa que alguém tenta.
  it("item de outra pessoa é recusado", async () => {
    const alheio = await jogadorComItem();
    // Agora quem está logado é outra pessoa.
    const { jogador: eu } = await jogadorComItem();

    const url = await esperaRedirect(equiparItem(alheio.inventarioId));

    expect(url).toBe("/perfil/inventario?erro=item-nao-e-seu");
    expect(await equipadosDe(eu)).toHaveLength(0);
    expect(await equipadosDe(alheio.jogador)).toHaveLength(0);
  });
});

describe("desequiparSlot", () => {
  it("esvazia o slot", async () => {
    const { jogador, inventarioId } = await jogadorComItem();
    await esperaRedirect(equiparItem(inventarioId));

    const url = await esperaRedirect(desequiparSlot("badge"));

    expect(url).toBe("/perfil/inventario?ok=item-desequipado");
    expect(await equipadosDe(jogador)).toHaveLength(0);
  });

  // O slot é validado contra `zenhaSlotEnum.enumValues`, e não contra uma lista
  // repetida na action: um slot novo na migration não pode deixar a validação
  // para trás.
  it("slot fora do enum vira dados-invalidos", async () => {
    await jogadorComItem();

    const url = await esperaRedirect(desequiparSlot("chuteira-de-ouro"));

    expect(url).toBe("/perfil/inventario?erro=dados-invalidos");
  });

  // Desequipar o que já não está equipado é o estado que a pessoa pediu — dois
  // toques no mesmo botão não podem virar banner vermelho.
  it("desequipar slot já vazio é sucesso, não erro", async () => {
    await jogadorComItem();

    const url = await esperaRedirect(desequiparSlot("badge"));

    expect(url).toBe("/perfil/inventario?ok=item-desequipado");
  });

  it("deslogado vai para o login", async () => {
    await jogadorComItem();
    deslogar();

    expect(await esperaRedirect(desequiparSlot("badge"))).toBe("/login");
  });
});

// A compra manda para cá de propósito: o item comprado só serve depois de
// equipado, e voltar para a vitrine deixaria a metade que importa por fazer.
describe("o caminho inteiro: comprar e equipar", () => {
  it("compra, equipa, e o cosmético fica registrado no slot", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo: 1000 });

    expect(await esperaRedirect(comprarItem(BADGE))).toBe("/perfil/inventario?ok=compra-feita");
    const [item] = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.playerId, jogador.id));
    await esperaRedirect(equiparItem(item.id));

    const [equipado] = await equipadosDe(jogador);
    expect(equipado.slot).toBe("badge");
    expect(equipado.inventarioId).toBe(item.id);
  });
});
