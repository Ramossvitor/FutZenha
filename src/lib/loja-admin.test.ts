import { describe, expect, it } from "vitest";
import { lojaTipoEnum } from "@/db/schema";
import { camposDoItemSchema, dadosDoItemSchema, TIPOS_QUE_O_ADMIN_CRIA } from "./loja-admin";
import { corBateComTipo, DESCRICAO_MAXIMA, NOME_MAXIMO, PRECO_MAXIMO } from "./item-da-loja";

// O schema é o dono das regras do cadastro, e é a única metade da validação que
// dá para exercitar sem banco. A outra (a cor batendo com o tipo GRAVADO, o
// tipo imutável, a imagem obrigatória no badge) mora em loja-admin.integration.

const base = { nome: "Avaí", descricao: "O Leão da Ilha.", preco: 250, ativo: true };

describe("dadosDoItemSchema", () => {
  it("aceita um badge sem cor", () => {
    expect(dadosDoItemSchema.safeParse({ ...base, tipo: "badge", cor: null }).success).toBe(true);
  });

  it("aceita moldura e cor do nome COM cor", () => {
    for (const tipo of ["moldura", "cor_do_nome"] as const) {
      expect(dadosDoItemSchema.safeParse({ ...base, tipo, cor: "#0a2f7a" }).success).toBe(true);
    }
  });

  // O `refine` espelha o check do banco. Ele existe além do check porque a
  // diferença entre "o Postgres estourou 23514" e "o campo Cor ficou vazio" é a
  // diferença entre um 500 e um formulário que diz o que fazer.
  it("recusa moldura sem cor e badge com cor", () => {
    expect(dadosDoItemSchema.safeParse({ ...base, tipo: "moldura", cor: null }).success).toBe(
      false,
    );
    expect(dadosDoItemSchema.safeParse({ ...base, tipo: "badge", cor: "#0a2f7a" }).success).toBe(
      false,
    );
  });

  it("o refine e a função do módulo puro dizem a mesma coisa", () => {
    for (const tipo of lojaTipoEnum.enumValues) {
      for (const cor of ["#0a2f7a", null]) {
        const esperado = corBateComTipo(tipo, cor);
        // Só os tipos que o admin cria passam pelo schema; o resto é conferido
        // pela função direto (é o caminho da edição, onde o tipo vem do banco).
        if (!(TIPOS_QUE_O_ADMIN_CRIA as readonly string[]).includes(tipo)) continue;
        expect(dadosDoItemSchema.safeParse({ ...base, tipo, cor }).success).toBe(esperado);
      }
    }
  });

  // Consumível tem efeito, e efeito é código. Uma linha nova com
  // `efeito = 'multiplicador'` seria um segundo multiplicador que o motor não
  // espera; uma com efeito inventado não faria nada.
  it("recusa o tipo consumível — ele não nasce de uma tela", () => {
    expect(dadosDoItemSchema.safeParse({ ...base, tipo: "consumivel", cor: null }).success).toBe(
      false,
    );
  });

  it("recusa tipo que não existe", () => {
    expect(dadosDoItemSchema.safeParse({ ...base, tipo: "chuteira", cor: null }).success).toBe(
      false,
    );
  });

  it("todo tipo que o admin cria está no enum do banco", () => {
    for (const tipo of TIPOS_QUE_O_ADMIN_CRIA) {
      expect(lojaTipoEnum.enumValues).toContain(tipo);
    }
  });
});

describe("os campos", () => {
  const campos = { nome: "Avaí", descricao: "", preco: 250, cor: null, ativo: true };

  it("nome é obrigatório e não passa do limite do formulário", () => {
    expect(camposDoItemSchema.safeParse({ ...campos, nome: "" }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, nome: "   " }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, nome: "a".repeat(NOME_MAXIMO) }).success).toBe(
      true,
    );
    expect(
      camposDoItemSchema.safeParse({ ...campos, nome: "a".repeat(NOME_MAXIMO + 1) }).success,
    ).toBe(false);
  });

  // Mesma razão do nome de jogador: o `.trim()` corta as pontas, e uma quebra no
  // meio atravessaria a tela inteira (e o `alt` da imagem).
  it("recusa quebra de linha no meio do nome", () => {
    expect(camposDoItemSchema.safeParse({ ...campos, nome: "Ava\ní" }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, nome: "Ava\rí" }).success).toBe(false);
  });

  it("apara os espaços das pontas", () => {
    const lido = camposDoItemSchema.parse({ ...campos, nome: "  Avaí  " });
    expect(lido.nome).toBe("Avaí");
  });

  it("preço aceita de zero ao teto, e só inteiro", () => {
    expect(camposDoItemSchema.safeParse({ ...campos, preco: 0 }).success).toBe(true);
    expect(camposDoItemSchema.safeParse({ ...campos, preco: PRECO_MAXIMO }).success).toBe(true);
    expect(camposDoItemSchema.safeParse({ ...campos, preco: PRECO_MAXIMO + 1 }).success).toBe(
      false,
    );
    expect(camposDoItemSchema.safeParse({ ...campos, preco: -1 }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, preco: 12.5 }).success).toBe(false);
  });

  // O campo do formulário é texto; o `z.coerce` é o que traduz.
  it("preço vindo do formulário como texto é convertido", () => {
    expect(camposDoItemSchema.parse({ ...campos, preco: "480" }).preco).toBe(480);
    expect(camposDoItemSchema.safeParse({ ...campos, preco: "quatrocentos" }).success).toBe(false);
  });

  it("descrição é opcional e limitada", () => {
    expect(camposDoItemSchema.safeParse({ ...campos, descricao: "" }).success).toBe(true);
    expect(
      camposDoItemSchema.safeParse({ ...campos, descricao: "a".repeat(DESCRICAO_MAXIMA) }).success,
    ).toBe(true);
    expect(
      camposDoItemSchema.safeParse({ ...campos, descricao: "a".repeat(DESCRICAO_MAXIMA + 1) })
        .success,
    ).toBe(false);
  });

  // A forma canônica é minúscula, e o check do banco cobra a mesma — aceitar
  // maiúscula aqui gravaria duas formas da mesma cor.
  it("cor só passa em hexadecimal minúsculo de seis dígitos", () => {
    expect(camposDoItemSchema.safeParse({ ...campos, cor: "#0a2f7a" }).success).toBe(true);
    expect(camposDoItemSchema.safeParse({ ...campos, cor: "#0A2F7A" }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, cor: "azul" }).success).toBe(false);
    expect(camposDoItemSchema.safeParse({ ...campos, cor: "#abc" }).success).toBe(false);
  });
});
