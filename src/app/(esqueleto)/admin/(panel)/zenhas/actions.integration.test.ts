// O painel da economia contra o banco de verdade.
//
// O que se prova aqui não é o SQL — esse é de zenha-config.ts e já tem teste
// próprio. É a fronteira da ACTION: quem pode mexer, o que ela aceita do
// formulário, e o que sobra na tabela quando ela recusa.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { zenhaConfig } from "@/db/schema";
import { salvarAjustes } from "@/app/(esqueleto)/admin/(panel)/zenhas/actions";
import { AJUSTES, AJUSTES_PADRAO } from "@/lib/zenha";
import { getAjustes, salvarAjuste } from "@/lib/zenha-config";
import { criarJogador, criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";

async function logarComoAdminDaPlataforma(): Promise<number> {
  const { jogador, conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
  await logarComo(conta);
  return jogador.id;
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [nome, valor] of Object.entries(campos)) fd.set(nome, valor);
  return fd;
}

async function linhaDe(chave: string) {
  const linhas = await db.select().from(zenhaConfig);
  return linhas.find((l) => l.chave === chave) ?? null;
}

describe("salvarAjustes", () => {
  it("o admin da plataforma grava e o valor passa a valer", async () => {
    const adminId = await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(salvarAjustes(formulario({ participacao: "250" })));

    expect(url).toBe("/admin/zenhas?ok=ajustes-salvos");
    expect((await getAjustes(db)).participacao).toBe(250);
    // A auditoria da tela sai daqui: sem o autor, "quem mexeu" seria um campo
    // vazio na primeira vez que alguém precisasse da resposta.
    expect((await linhaDe("participacao"))?.atualizadoPorPlayerId).toBe(adminId);
  });

  it("salva vários campos da mesma seção num submit só", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(
      salvarAjustes(formulario({ streak_premio: "400", streak_tamanho: "8" })),
    );

    const ajustes = await getAjustes(db);
    expect(ajustes.streak_premio).toBe(400);
    expect(ajustes.streak_tamanho).toBe(8);
  });

  // O campo que não veio no formulário é campo de OUTRA seção — cada submit
  // manda só o que estava à vista de quem clicou.
  it("não toca na chave que o formulário não trouxe", async () => {
    const jogador = await criarJogador();
    await salvarAjuste(db, "mvp", 300, jogador.id);
    await logarComoAdminDaPlataforma();

    await esperaRedirect(salvarAjustes(formulario({ participacao: "250" })));

    expect((await getAjustes(db)).mvp).toBe(300);
  });

  it("jogador comum é barrado com 404, e nada é gravado", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    // requirePlatformAdmin responde notFound() para quem está logado sem a
    // flag: mandar para /login quem já entrou daria um loop.
    await esperaNotFound(salvarAjustes(formulario({ participacao: "250" })));

    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });

  it("deslogado vai para o login, e nada é gravado", async () => {
    deslogar();

    const url = await esperaRedirect(salvarAjustes(formulario({ participacao: "250" })));

    expect(url).toBe("/login");
    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });

  it("valor fora da faixa volta marcando o campo e NÃO grava", async () => {
    await logarComoAdminDaPlataforma();
    const acimaDoTeto = String(AJUSTES.participacao.max + 1);

    const url = await esperaRedirect(salvarAjustes(formulario({ participacao: acimaDoTeto })));

    expect(url).toBe("/admin/zenhas?erro=ajuste-recusado&campo=participacao");
    expect(await linhaDe("participacao")).toBeNull();
  });

  it("valor quebrado volta marcando o campo e NÃO grava", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(salvarAjustes(formulario({ mvp: "cento e cinquenta" })));

    expect(url).toBe("/admin/zenhas?erro=ajuste-recusado&campo=mvp");
    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });

  // Tudo ou nada: o admin nunca fica com metade de uma decisão aplicada, e é o
  // que deixa a mensagem dizer "nada foi salvo" sem mentir.
  it("um valor recusado derruba os que vieram antes no mesmo submit", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(
      salvarAjustes(
        formulario({ participacao: "250", mvp: String(AJUSTES.mvp.max + 1) }),
      ),
    );

    expect(url).toBe("/admin/zenhas?erro=ajuste-recusado&campo=mvp");
    expect(await db.select().from(zenhaConfig)).toHaveLength(0);
  });

  // O fator vira fração exata dentro do cálculo da nota: percentual fora da
  // lista abriria a porta do ponto flutuante no único lugar que não pode ter.
  it("o fator do multiplicador só aceita a lista fechada", async () => {
    await logarComoAdminDaPlataforma();

    const recusado = await esperaRedirect(
      salvarAjustes(formulario({ multiplicador_fator: "130" })),
    );
    expect(recusado).toBe("/admin/zenhas?erro=ajuste-recusado&campo=multiplicador_fator");
    expect(await linhaDe("multiplicador_fator")).toBeNull();

    const aceito = await esperaRedirect(salvarAjustes(formulario({ multiplicador_fator: "200" })));
    expect(aceito).toBe("/admin/zenhas?ok=ajustes-salvos");
    expect((await getAjustes(db)).multiplicador_fator).toBe(200);
  });

  // Preço saiu daqui: ele é coluna de `loja_itens` e se edita em /admin/loja. A
  // chave `preco:{itemId}` foi apagada pela migration 0033, e o formulário nem a
  // monta mais — mas uma aba velha ou um curl ainda podem mandá-la, e o que se
  // cobra é que ela seja IGNORADA em vez de gravar linha órfã.
  it("chave de preço antiga não é aceita nem grava linha", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(
      salvarAjustes(formulario({ participacao: "250", "preco:7": "480" })),
    );

    // O campo desconhecido é ignorado no parse (a action só procura as chaves que
    // conhece), então o resto do formulário grava normalmente.
    expect(url).toBe("/admin/zenhas?ok=ajustes-salvos");
    expect((await getAjustes(db)).participacao).toBe(250);
    expect(await linhaDe("preco:7")).toBeNull();
  });
});

describe("voltar ao padrão", () => {
  it("a caixa marcada apaga a linha e o valor volta ao padrão do código", async () => {
    const jogador = await criarJogador();
    await salvarAjuste(db, "streak_premio", 900, jogador.id);
    await logarComoAdminDaPlataforma();

    await esperaRedirect(
      salvarAjustes(formulario({ streak_premio: "900", "padrao:streak_premio": "on" })),
    );

    expect(await linhaDe("streak_premio")).toBeNull();
    expect((await getAjustes(db)).streak_premio).toBe(AJUSTES_PADRAO.streak_premio);
  });

  it("campo esvaziado é a mesma coisa que voltar ao padrão", async () => {
    const jogador = await criarJogador();
    await salvarAjuste(db, "mvp", 480, jogador.id);
    await logarComoAdminDaPlataforma();

    await esperaRedirect(salvarAjustes(formulario({ mvp: "" })));

    expect(await linhaDe("mvp")).toBeNull();
    expect((await getAjustes(db)).mvp).toBe(AJUSTES_PADRAO.mvp);
  });

  // A tabela guarda SÓ o que foi mudado: uma linha com o número de hoje
  // congelaria o número de hoje, e o valor deixaria de acompanhar sozinho uma
  // mudança futura em zenha.ts.
  it("digitar exatamente o padrão apaga a sobrescrita em vez de gravá-la", async () => {
    const jogador = await criarJogador();
    await salvarAjuste(db, "participacao", 250, jogador.id);
    await logarComoAdminDaPlataforma();

    await esperaRedirect(
      salvarAjustes(formulario({ participacao: String(AJUSTES_PADRAO.participacao) })),
    );

    expect(await linhaDe("participacao")).toBeNull();
    expect((await getAjustes(db)).participacao).toBe(AJUSTES_PADRAO.participacao);
  });
});
