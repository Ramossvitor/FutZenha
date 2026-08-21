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
import { zenhaCarteiras, zenhaInventario, zenhaLedger, type Player } from "@/db/schema";
import { comprarItem } from "@/app/loja/actions";
import { CATALOGO, ID_DO_MULTIPLICADOR } from "@/lib/loja-catalogo";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

const BADGE = "dono-da-bola";

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
  it("compra e manda para o inventário, que é onde o item vira alguma coisa", async () => {
    const jogador = await jogadorLogadoCom(1000);

    const url = await esperaRedirect(comprarItem(BADGE));

    expect(url).toBe("/perfil/inventario?ok=compra-feita");
    expect(await inventarioDe(jogador)).toHaveLength(1);
  });

  // A trava que sustenta a economia inteira: sem ela, o `.bind` de qualquer
  // navegador anônimo compra.
  it("deslogado vai para o login e não compra nada", async () => {
    deslogar();

    const url = await esperaRedirect(comprarItem(BADGE));

    expect(url).toBe("/login");
    expect(await db.select().from(zenhaInventario)).toHaveLength(0);
  });

  // O id vem do corpo do POST. Um valor que o catálogo não conhece não tem
  // página de confirmação para onde voltar — o banner vai para a vitrine.
  it("id fora do catálogo volta para a loja, sem 500", async () => {
    const jogador = await jogadorLogadoCom(1000);

    const url = await esperaRedirect(comprarItem("camisa-do-flamengo"));

    expect(url).toBe("/loja?erro=item-indisponivel");
    expect(await inventarioDe(jogador)).toHaveLength(0);
  });

  it("sem saldo volta para a confirmação, que é onde o preço aparece", async () => {
    const jogador = await jogadorLogadoCom(1);

    const url = await esperaRedirect(comprarItem(BADGE));

    expect(url).toBe(`/loja/${BADGE}?erro=sem-saldo`);
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
    await esperaRedirect(comprarItem(BADGE));

    const url = await esperaRedirect(comprarItem(BADGE));

    expect(url).toBe(`/loja/${BADGE}?erro=ja-possui`);
    expect(await inventarioDe(jogador)).toHaveLength(1);
    const [carteira] = await db
      .select()
      .from(zenhaCarteiras)
      .where(eq(zenhaCarteiras.playerId, jogador.id));
    expect(carteira.saldo).toBe(1000 - CATALOGO[BADGE].preco);
  });

  // O consumível é a exceção do "já possui": comprar de novo é o esperado.
  it("o multiplicador pode ser comprado mais de uma vez", async () => {
    const jogador = await jogadorLogadoCom(1000);

    await esperaRedirect(comprarItem(ID_DO_MULTIPLICADOR));
    const url = await esperaRedirect(comprarItem(ID_DO_MULTIPLICADOR));

    expect(url).toBe("/perfil/inventario?ok=compra-feita");
    expect(await inventarioDe(jogador)).toHaveLength(2);
  });
});
