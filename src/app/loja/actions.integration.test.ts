// A fronteira da ACTION da loja contra o banco de verdade.
//
// O que a compra faz com o dinheiro já está travado em loja.integration.test.ts.
// O que sobra aqui é a casca, e ela é endereço público: quem pode chamar, o que
// ela aceita do `.bind` (que viaja no corpo do POST, não na sessão), e para onde
// cada recusa manda a pessoa. Um `comprarItem` sem `requirePlayer` seria uma
// loja que qualquer um abre com um curl.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojaItens, zenhaCarteiras, zenhaInventario, zenhaLedger, type Player } from "@/db/schema";
import { comprarItem } from "@/app/loja/actions";
import { criarBadge, garantirMultiplicador } from "@/test/fixtures-loja";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

/** Um jogador logado, com a carteira já com saldo. */
async function jogadorLogadoCom(saldo: number): Promise<Player> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  await db.insert(zenhaCarteiras).values({ playerId: jogador.id, saldo });
  // O fecho `saldo == sum(amount)` vale para o app inteiro, então a fixture
  // paga a linha do extrato em vez de inventar saldo do nada.
  await db.insert(zenhaLedger).values({
    playerId: jogador.id,
    motivo: "boas_vindas",
    amount: saldo,
    dedupeKey: "saldo-de-fixture",
    descricao: "Saldo de fixture",
  });
  return jogador;
}

const inventarioDe = (jogador: Player) =>
  db.select().from(zenhaInventario).where(eq(zenhaInventario.playerId, jogador.id));

describe("comprarItem", () => {
  it("compra e manda para o inventário, que é onde se confere onde o item foi parar", async () => {
    const jogador = await jogadorLogadoCom(1000);
    const badge = await criarBadge("Dono da bola", 250);

    const url = await esperaRedirect(comprarItem(badge.id));

    expect(url).toBe("/perfil/inventario?ok=compra-feita");
    expect(await inventarioDe(jogador)).toHaveLength(1);
  });

  // A trava que sustenta a economia inteira: sem ela, o `.bind` de qualquer
  // navegador anônimo compra.
  it("deslogado vai para o login e não compra nada", async () => {
    const badge = await criarBadge("Dono da bola", 250);
    deslogar();

    const url = await esperaRedirect(comprarItem(badge.id));

    expect(url).toBe("/login");
    expect(await db.select().from(zenhaInventario)).toHaveLength(0);
  });

  // O id vem do corpo do POST. Um item que não existe não tem página de
  // confirmação para onde voltar — o banner vai para a vitrine.
  it("id que não existe volta para a loja, sem 500", async () => {
    const jogador = await jogadorLogadoCom(1000);

    const url = await esperaRedirect(comprarItem(999_999));

    expect(url).toBe("/loja?erro=item-indisponivel");
    expect(await inventarioDe(jogador)).toHaveLength(0);
  });

  // O zod recusa antes de ir ao banco: id absurdo é POST forjado, não engano.
  it("id absurdo vira banner, e não página de erro", async () => {
    const jogador = await jogadorLogadoCom(1000);

    expect(await esperaRedirect(comprarItem(-1))).toBe("/loja?erro=item-indisponivel");
    expect(await esperaRedirect(comprarItem(0))).toBe("/loja?erro=item-indisponivel");
    expect(await inventarioDe(jogador)).toHaveLength(0);
  });

  it("item fora de venda volta para a loja", async () => {
    const jogador = await jogadorLogadoCom(1000);
    const badge = await criarBadge("Fora", 10);
    await db.update(lojaItens).set({ ativo: false }).where(eq(lojaItens.id, badge.id));

    const url = await esperaRedirect(comprarItem(badge.id));

    expect(url).toBe("/loja?erro=item-indisponivel");
    expect(await inventarioDe(jogador)).toHaveLength(0);
  });

  it("sem saldo volta para a confirmação, que é onde o preço aparece", async () => {
    const jogador = await jogadorLogadoCom(1);
    const badge = await criarBadge("Dono da bola", 250);

    const url = await esperaRedirect(comprarItem(badge.id));

    expect(url).toBe(`/loja/${badge.id}?erro=sem-saldo`);
    expect(await inventarioDe(jogador)).toHaveLength(0);
    // E o saldo continua intacto: recusa não cobra.
    const [carteira] = await db
      .select()
      .from(zenhaCarteiras)
      .where(eq(zenhaCarteiras.playerId, jogador.id));
    expect(carteira.saldo).toBe(1);
  });

  it("comprar de novo o mesmo cosmético é recusado, e não cobra duas vezes", async () => {
    const jogador = await jogadorLogadoCom(1000);
    const badge = await criarBadge("Dono da bola", 250);
    await esperaRedirect(comprarItem(badge.id));

    const url = await esperaRedirect(comprarItem(badge.id));

    expect(url).toBe(`/loja/${badge.id}?erro=ja-possui`);
    expect(await inventarioDe(jogador)).toHaveLength(1);
    const [carteira] = await db
      .select()
      .from(zenhaCarteiras)
      .where(eq(zenhaCarteiras.playerId, jogador.id));
    expect(carteira.saldo).toBe(750);
  });

  // O consumível é a exceção do "já possui": comprar de novo é o esperado.
  it("o multiplicador pode ser comprado mais de uma vez", async () => {
    const jogador = await jogadorLogadoCom(1000);
    const multiplicador = await garantirMultiplicador();

    await esperaRedirect(comprarItem(multiplicador.id));
    const url = await esperaRedirect(comprarItem(multiplicador.id));

    expect(url).toBe("/perfil/inventario?ok=compra-feita");
    expect(await inventarioDe(jogador)).toHaveLength(2);
  });
});
