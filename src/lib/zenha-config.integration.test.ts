// As sobrescritas do admin contra o banco de verdade. O que importa aqui não é
// o SQL — é a fronteira: o que a tabela ACEITA guardar, e o que ela devolve
// quando não guardou nada.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { zenhaConfig } from "@/db/schema";
import { getAjustes, lerSobrescritas, limparAjuste, salvarAjuste } from "@/lib/zenha-config";
import { AJUSTES, AJUSTES_PADRAO } from "@/lib/zenha";
import { criarJogador } from "@/test/fixtures";

async function linhaDe(chave: string) {
  const [linha] = await db.select().from(zenhaConfig).where(eq(zenhaConfig.chave, chave));
  return linha ?? null;
}

describe("salvarAjuste", () => {
  it("grava a sobrescrita e carimba quem mexeu", async () => {
    const admin = await criarJogador();

    expect(await salvarAjuste(db, "participacao", 250, admin.id)).toBeNull();

    const linha = await linhaDe("participacao");
    expect(linha?.valor).toBe(250);
    expect(linha?.atualizadoPorPlayerId).toBe(admin.id);
    expect((await getAjustes(db)).participacao).toBe(250);
  });

  it("regravar a mesma chave substitui o valor em vez de duplicar", async () => {
    const [primeiro, segundo] = [await criarJogador(), await criarJogador()];
    await salvarAjuste(db, "mvp", 200, primeiro.id);

    expect(await salvarAjuste(db, "mvp", 300, segundo.id)).toBeNull();

    expect(await db.select().from(zenhaConfig)).toHaveLength(1);
    const linha = await linhaDe("mvp");
    expect(linha?.valor).toBe(300);
    expect(linha?.atualizadoPorPlayerId).toBe(segundo.id);
  });

  it("valor fora da faixa é recusado com mensagem e NÃO grava", async () => {
    const admin = await criarJogador();
    const acimaDoTeto = AJUSTES.participacao.max + 1;

    const erro = await salvarAjuste(db, "participacao", acimaDoTeto, admin.id);

    expect(erro).toBe(`Use um número de ${AJUSTES.participacao.min} a ${AJUSTES.participacao.max}.`);
    expect(await linhaDe("participacao")).toBeNull();
  });

  // A recusa não pode derrubar o que já estava valendo: o admin errou o número
  // novo, não pediu para voltar ao padrão.
  it("valor recusado preserva a sobrescrita anterior", async () => {
    const admin = await criarJogador();
    await salvarAjuste(db, "participacao", 250, admin.id);

    expect(await salvarAjuste(db, "participacao", -1, admin.id)).not.toBeNull();

    expect((await linhaDe("participacao"))?.valor).toBe(250);
  });

  // O fator do multiplicador só aceita a lista fechada — ele vira fração exata
  // dentro do cálculo da nota, e percentual arbitrário abriria a porta do ponto
  // flutuante no único lugar que não pode ter.
  it("recusa percentual fora da lista do multiplicador", async () => {
    const admin = await criarJogador();

    const erro = await salvarAjuste(db, "multiplicador_fator", 140, admin.id);

    expect(erro).toBe("Valores aceitos: 125, 150, 200.");
    expect(await linhaDe("multiplicador_fator")).toBeNull();
  });

  // Preço saiu desta tabela: ele é `loja_itens.preco`, editado em /admin/loja. A
  // chave `preco:{itemId}` existiu enquanto o catálogo era código, e a migration
  // 0033 apagou as linhas. O que se cobra agora é que ela seja tratada como
  // qualquer outra chave desconhecida — e, principalmente, que NÃO grave: uma
  // linha órfã aqui apareceria no "Sobrescrito hoje" do painel e um dia alguém
  // confiaria nela.
  it("recusa chave desconhecida — inclusive as chaves de preço aposentadas", async () => {
    const admin = await criarJogador();

    expect(await salvarAjuste(db, "participacaozinha", 10, admin.id)).toBe(
      "Esse ajuste não existe.",
    );
    expect(await salvarAjuste(db, "preco:7", 480, admin.id)).toBe("Esse ajuste não existe.");
    expect(await salvarAjuste(db, "preco:", 10, admin.id)).toBe("Esse ajuste não existe.");
    // O preço-base do multiplicador também era ajuste, e virou coluna do item.
    expect(await salvarAjuste(db, "multiplicador_preco_base", 200, admin.id)).toBe(
      "Esse ajuste não existe.",
    );
    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });

  it("recusa valor quebrado", async () => {
    const admin = await criarJogador();

    expect(await salvarAjuste(db, "participacao", 12.5, admin.id)).toBe("Use um número inteiro.");
    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });
});

describe("limparAjuste", () => {
  it("apaga a linha e o valor volta ao padrão do código", async () => {
    const admin = await criarJogador();
    await salvarAjuste(db, "streak_premio", 900, admin.id);
    expect((await getAjustes(db)).streak_premio).toBe(900);

    await limparAjuste(db, "streak_premio");

    expect(await linhaDe("streak_premio")).toBeNull();
    expect((await getAjustes(db)).streak_premio).toBe(AJUSTES_PADRAO.streak_premio);
  });

  it("limpar chave que não estava lá é no-op", async () => {
    await expect(limparAjuste(db, "mvp")).resolves.toBeUndefined();
  });
});

describe("getAjustes", () => {
  it("com a tabela vazia, devolve os padrões inteiros", async () => {
    expect(await getAjustes(db)).toEqual(AJUSTES_PADRAO);
    expect(await lerSobrescritas(db)).toEqual(new Map());
  });

  it("mistura sobrescritas com padrões — chave ausente vale o padrão", async () => {
    const admin = await criarJogador();
    await salvarAjuste(db, "participacao", 250, admin.id);

    const ajustes = await getAjustes(db);

    expect(ajustes.participacao).toBe(250);
    expect(ajustes.mvp).toBe(AJUSTES_PADRAO.mvp);
  });

  // A leitura não pode quebrar por causa de um valor gravado quando a faixa era
  // outra: economia que para de funcionar é pior que economia no padrão. Quem
  // valida é a escrita, que é onde dá para avisar.
  it("ignora sobrescrita fora de faixa gravada por fora", async () => {
    await db.insert(zenhaConfig).values({ chave: "participacao", valor: 999999 });

    expect((await getAjustes(db)).participacao).toBe(AJUSTES_PADRAO.participacao);
  });

  // Linha órfã na tabela — de um ajuste que saiu do código, ou de uma chave de
  // preço que a migration 0033 não tenha alcançado — não pode derrubar a
  // economia: ela é DESCARTADA na leitura dos ajustes e o resto continua valendo.
  it("chave desconhecida gravada por fora não vaza para os ajustes", async () => {
    await db.insert(zenhaConfig).values({ chave: "preco:7", valor: 480 });

    expect(await getAjustes(db)).toEqual(AJUSTES_PADRAO);
    // Ela continua visível na leitura crua, que é o que o painel usa para
    // mostrá-la no "Sobrescrito hoje" e o admin poder limpá-la.
    expect((await lerSobrescritas(db)).get("preco:7")).toBe(480);
  });
});
