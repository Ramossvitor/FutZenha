// O cadastro da loja contra o banco de verdade.
//
// O que não tem como ser testado fora dele é o que este módulo existe para
// garantir:
//
// 1. o item e a imagem nascendo na MESMA transação — um badge com `imagem_hash`
//    apontando para uma linha que não existe é um `<img>` quebrado para sempre;
// 2. a troca de imagem mudando o hash, e portanto a URL — é o que faz a resposta
//    poder ser `immutable` por um ano;
// 3. o `on delete restrict` de `zenha_inventario`, que é quem de fato impede
//    apagar item vendido;
// 4. os checks que amarram cor, imagem e efeito ao tipo.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojaImagens, lojaItens, zenhaInventario } from "@/db/schema";
import { isForeignKeyViolation } from "@/lib/db-errors";
import { TAMANHO_MAXIMO_DA_IMAGEM } from "@/lib/item-da-loja";
import {
  apagarItem,
  criarItem,
  definirVenda,
  editarItem,
  lerConsumivel,
  type DadosDoItem,
} from "@/lib/loja-admin";
import { lerImagemDoItem, lerItem, lerItensAVenda, lerTodosOsItens } from "@/lib/loja-itens";
import { comprar } from "@/lib/loja";
import { criarBadge, garantirMultiplicador, jogadorComSaldo } from "@/test/fixtures-loja";
import { pngDeUmaCor } from "@/test/fixtures-imagem";

const badge: DadosDoItem = {
  tipo: "badge",
  nome: "Avaí",
  descricao: "O Leão da Ilha.",
  preco: 250,
  cor: null,
  ativo: true,
};

const moldura: DadosDoItem = {
  tipo: "moldura",
  nome: "Moldura de ouro",
  descricao: "",
  preco: 300,
  cor: "#7c5900",
  ativo: true,
};

const gif = Buffer.from("GIF89a\0\0\0\0", "latin1");

async function idCriado(dados: DadosDoItem, imagem: Uint8Array | null): Promise<number> {
  const resultado = await criarItem(dados, imagem);
  if (typeof resultado === "string") throw new Error(`esperava criar, veio ${resultado}`);
  return resultado.id;
}

describe("criarItem", () => {
  it("cria o badge e a imagem juntos, e o hash bate com os bytes", async () => {
    const arte = pngDeUmaCor("#0a2f7a");

    const id = await idCriado(badge, arte);

    const item = await lerItem(db, id);
    expect(item?.nome).toBe("Avaí");
    expect(item?.imagemHash).toMatch(/^[0-9a-f]{32}$/);

    const imagem = await lerImagemDoItem(db, id, item!.imagemHash!);
    expect(imagem?.mime).toBe("image/png");
    expect(Buffer.compare(imagem!.bytes, arte)).toBe(0);
  });

  // Badge SEM imagem não existe: a imagem é a identidade do produto. O check do
  // banco diz o mesmo, e o `imagem-ausente` é o que faz o formulário explicar.
  it("badge sem imagem é recusado, e nada é escrito", async () => {
    expect(await criarItem(badge, null)).toBe("imagem-ausente");

    expect(await db.select().from(lojaItens)).toHaveLength(0);
    expect(await db.select().from(lojaImagens)).toHaveLength(0);
  });

  it("imagem em formato recusado não cria nada", async () => {
    expect(await criarItem(badge, gif)).toBe("imagem-invalida");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  it("imagem acima do teto não cria nada", async () => {
    const gorda = Buffer.concat([pngDeUmaCor("#000000"), Buffer.alloc(TAMANHO_MAXIMO_DA_IMAGEM)]);

    expect(await criarItem(badge, gorda)).toBe("imagem-grande");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  it("moldura grava a cor e não grava imagem", async () => {
    const id = await idCriado(moldura, null);

    const item = await lerItem(db, id);
    expect(item?.cor).toBe("#7c5900");
    expect(item?.imagemHash).toBeNull();
    expect(await db.select().from(lojaImagens)).toHaveLength(0);
  });

  // O check do banco é a garantia; este teste prova que o módulo não a força.
  it("cor que não bate com o tipo é recusada antes de escrever", async () => {
    expect(await criarItem({ ...moldura, cor: null }, null)).toBe("dados-invalidos");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  it("item criado como fora de venda não aparece na loja", async () => {
    const id = await idCriado({ ...moldura, ativo: false }, null);

    expect((await lerItensAVenda(db)).map((i) => i.id)).not.toContain(id);
    expect((await lerTodosOsItens(db)).map((i) => i.id)).toContain(id);
  });

  it("item novo nasce sem efeito — efeito é código, não cadastro", async () => {
    const id = await idCriado(moldura, null);

    expect((await lerItem(db, id))?.efeito).toBeNull();
  });
});

describe("editarItem", () => {
  it("muda os campos e mantém a imagem quando nenhuma é enviada", async () => {
    const arte = pngDeUmaCor("#0a2f7a");
    const id = await idCriado(badge, arte);
    const antes = await lerItem(db, id);

    expect(
      await editarItem(
        id,
        { nome: "Avaí FC", descricao: "Novo texto", preco: 400, cor: null, ativo: true },
        null,
      ),
    ).toBeNull();

    const depois = await lerItem(db, id);
    expect(depois?.nome).toBe("Avaí FC");
    expect(depois?.preco).toBe(400);
    // A URL não mudou: quem tem a página aberta continua vendo a mesma arte.
    expect(depois?.imagemHash).toBe(antes?.imagemHash);
  });

  // O hash é o conteúdo, então trocar a arte troca a URL — e é isso que faz a
  // resposta poder ser cacheada para sempre sem prender ninguém na arte velha.
  it("trocar a imagem muda o hash, e a URL antiga deixa de responder", async () => {
    const id = await idCriado(badge, pngDeUmaCor("#0a2f7a"));
    const hashAntigo = (await lerItem(db, id))!.imagemHash!;

    await editarItem(
      id,
      { nome: badge.nome, descricao: "", preco: 250, cor: null, ativo: true },
      pngDeUmaCor("#1b1b1b"),
    );

    const hashNovo = (await lerItem(db, id))!.imagemHash!;
    expect(hashNovo).not.toBe(hashAntigo);
    expect(await lerImagemDoItem(db, id, hashNovo)).toBeDefined();
    expect(await lerImagemDoItem(db, id, hashAntigo)).toBeUndefined();
    // Uma linha de imagem por item: a troca é upsert, não acúmulo.
    expect(await db.select().from(lojaImagens).where(eq(lojaImagens.itemId, id))).toHaveLength(1);
  });

  it("imagem inválida na edição não altera nada", async () => {
    const id = await idCriado(badge, pngDeUmaCor("#0a2f7a"));
    const antes = await lerItem(db, id);

    expect(
      await editarItem(id, { nome: "Outro", descricao: "", preco: 1, cor: null, ativo: true }, gif),
    ).toBe("imagem-invalida");

    expect(await lerItem(db, id)).toEqual(antes);
  });

  // Imagem mandada para um tipo que não a usa é ruído do formulário (o campo
  // existe na mesma tela), não pedido — e gravá-la quebraria o check.
  it("imagem mandada para uma moldura é ignorada", async () => {
    const id = await idCriado(moldura, null);

    expect(
      await editarItem(
        id,
        { nome: moldura.nome, descricao: "", preco: 300, cor: "#7c5900", ativo: true },
        pngDeUmaCor("#0a2f7a"),
      ),
    ).toBeNull();

    expect((await lerItem(db, id))?.imagemHash).toBeNull();
    expect(await db.select().from(lojaImagens)).toHaveLength(0);
  });

  it("cor que não bate com o tipo GRAVADO é recusada", async () => {
    const id = await idCriado(badge, pngDeUmaCor("#0a2f7a"));

    expect(
      await editarItem(
        id,
        { nome: "Avaí", descricao: "", preco: 250, cor: "#0a2f7a", ativo: true },
        null,
      ),
    ).toBe("dados-invalidos");
  });

  it("item que não existe volta como não encontrado", async () => {
    expect(
      await editarItem(
        999_999,
        { nome: "X", descricao: "", preco: 1, cor: null, ativo: true },
        null,
      ),
    ).toBe("item-nao-encontrado");
  });

  // O preço do consumível é o primeiro degrau da escada — o admin edita, e o
  // efeito continua sendo dele.
  it("o consumível aceita edição de preço e texto", async () => {
    const multiplicador = await garantirMultiplicador(120);

    expect(
      await editarItem(
        multiplicador.id,
        { nome: "Multiplicador", descricao: "Aposta.", preco: 200, cor: null, ativo: true },
        null,
      ),
    ).toBeNull();

    const depois = await lerItem(db, multiplicador.id);
    expect(depois?.preco).toBe(200);
    expect(depois?.efeito).toBe("multiplicador");
  });
});

describe("definirVenda", () => {
  it("retirar tira da vitrine, e a compra passa a ser recusada", async () => {
    const jogador = await jogadorComSaldo(1000);
    const id = await idCriado(moldura, null);

    expect(await definirVenda(id, false)).toBeNull();

    expect((await lerItensAVenda(db)).map((i) => i.id)).not.toContain(id);
    expect(await comprar(jogador.id, id)).toBe("item-indisponivel");
  });

  // A contrapartida de retirar sem apagar: quem pagou continua com o item.
  it("quem já comprou continua com o item depois de ele sair de venda", async () => {
    const jogador = await jogadorComSaldo(1000);
    const item = await criarBadge("Raro", 10);
    await comprar(jogador.id, item.id);

    await definirVenda(item.id, false);

    const inventario = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.playerId, jogador.id));
    expect(inventario).toHaveLength(1);
    expect((await lerItem(db, item.id))?.ativo).toBe(false);
  });

  it("devolver à venda funciona, e item inexistente é recusado", async () => {
    const id = await idCriado({ ...moldura, ativo: false }, null);

    expect(await definirVenda(id, true)).toBeNull();
    expect((await lerItensAVenda(db)).map((i) => i.id)).toContain(id);
    expect(await definirVenda(999_999, false)).toBe("item-nao-encontrado");
  });
});

describe("apagarItem", () => {
  it("apaga o que ninguém comprou, junto com a imagem", async () => {
    const id = await idCriado(badge, pngDeUmaCor("#0a2f7a"));

    expect(await apagarItem(id)).toBeNull();

    expect(await lerItem(db, id)).toBeUndefined();
    // A imagem cai por cascade: item apagado não deixa bytes órfãos no banco.
    expect(await db.select().from(lojaImagens)).toHaveLength(0);
  });

  // Quem impede é o `on delete restrict`; o módulo só traduz a recusa no slug.
  it("item comprado não some, e a resposta explica o que fazer", async () => {
    const jogador = await jogadorComSaldo(1000);
    const item = await criarBadge("Comprado", 10);
    await comprar(jogador.id, item.id);

    expect(await apagarItem(item.id)).toBe("item-com-compras");

    expect(await lerItem(db, item.id)).toBeDefined();
  });

  // A garantia por baixo do módulo: um DELETE direto, sem conferência nenhuma,
  // tem que estourar — e com o código que `isForeignKeyViolation` reconhece,
  // senão o `catch` de `apagarItem` deixaria passar um 500.
  it("o banco recusa apagar item vendido, com o código que o módulo reconhece", async () => {
    const jogador = await jogadorComSaldo(1000);
    const item = await criarBadge("Comprado", 10);
    await comprar(jogador.id, item.id);

    let estouro: unknown;
    try {
      await db.delete(lojaItens).where(eq(lojaItens.id, item.id));
    } catch (erro) {
      estouro = erro;
    }

    expect(isForeignKeyViolation(estouro)).toBe(true);
    expect(await lerItem(db, item.id)).toBeDefined();
    expect(await db.select().from(zenhaInventario)).toHaveLength(1);
  });

  it("o consumível é protegido — o efeito dele é código", async () => {
    const multiplicador = await garantirMultiplicador();

    expect(await apagarItem(multiplicador.id)).toBe("item-protegido");

    expect(await lerItem(db, multiplicador.id)).toBeDefined();
  });

  it("item que não existe volta como não encontrado", async () => {
    expect(await apagarItem(999_999)).toBe("item-nao-encontrado");
  });
});

describe("lerTodosOsItens e lerConsumivel", () => {
  it("conta as vendas de cada item, inclusive zero", async () => {
    const jogador = await jogadorComSaldo(1000);
    const vendido = await criarBadge("Vendido", 10);
    const parado = await criarBadge("Parado", 10);
    await comprar(jogador.id, vendido.id);

    const todos = await lerTodosOsItens(db);

    expect(todos.find((i) => i.id === vendido.id)?.vendas).toBe(1);
    expect(todos.find((i) => i.id === parado.id)?.vendas).toBe(0);
  });

  it("acha o consumível pelo EFEITO, e não pelo id — que muda entre ambientes", async () => {
    await criarBadge("Ruído", 10);
    const multiplicador = await garantirMultiplicador();

    expect(await lerConsumivel()).toEqual({ id: multiplicador.id, nome: multiplicador.nome });
  });

  it("sem consumível cadastrado, devolve undefined em vez de estourar", async () => {
    expect(await lerConsumivel()).toBeUndefined();
  });
});
