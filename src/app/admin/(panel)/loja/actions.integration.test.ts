// A fronteira das actions do cadastro da loja.
//
// O que cada gesto faz com o banco já está em loja-admin.integration.test.ts. O
// que sobra aqui é a casca, e ela é a mais sensível do app: Server Action é POST
// público que NÃO passa pelo proxy, então um `criarItemAction` sem
// `requirePlatformAdmin` seria qualquer jogador logado cadastrando item na loja
// de todo mundo — com upload de arquivo junto.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { lojaImagens, lojaItens } from "@/db/schema";
import {
  apagarItemAction,
  criarItemAction,
  definirVendaAction,
  editarItemAction,
} from "@/app/admin/(panel)/loja/actions";
import { apagarItem } from "@/lib/loja-admin";
import { lerItem } from "@/lib/loja-itens";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { arquivoPng } from "@/test/fixtures-imagem";
import { criarBadge, garantirMultiplicador } from "@/test/fixtures-loja";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";

async function logarComoAdminDaPlataforma(): Promise<void> {
  const { conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
  await logarComo(conta);
}

async function logarComoJogadorComum(): Promise<void> {
  const { conta } = await criarJogadorComConta();
  await logarComo(conta);
}

/** O formulário do admin, como ele chega: tudo texto, mais o arquivo. */
function formulario(campos: Record<string, string>, arquivo?: File): FormData {
  const fd = new FormData();
  for (const [nome, valor] of Object.entries(campos)) fd.set(nome, valor);
  if (arquivo) fd.set("imagem", arquivo);
  return fd;
}

const camposDeBadge = { tipo: "badge", nome: "Avaí", descricao: "O Leão.", preco: "250", ativo: "on" };

describe("criarItemAction", () => {
  it("cria o item com a imagem que veio no FormData", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(
      criarItemAction(formulario(camposDeBadge, arquivoPng("#0a2f7a"))),
    );

    const [item] = await db.select().from(lojaItens);
    expect(url).toBe(`/admin/loja/${item.id}?ok=item-criado`);
    expect(item.nome).toBe("Avaí");
    expect(item.tipo).toBe("badge");
    expect(await db.select().from(lojaImagens)).toHaveLength(1);
  });

  // A trava. Sem ela, qualquer conta logada cadastra item na loja de todo mundo.
  it("jogador comum leva 404 e não cria nada", async () => {
    await logarComoJogadorComum();

    await esperaNotFound(criarItemAction(formulario(camposDeBadge, arquivoPng("#0a2f7a"))));

    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  it("deslogado vai para o login e não cria nada", async () => {
    deslogar();

    expect(
      await esperaRedirect(criarItemAction(formulario(camposDeBadge, arquivoPng("#0a2f7a")))),
    ).toBe("/login");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  // O tipo volta na query: sem ele a tela reabriria como badge, e quem estava
  // cadastrando uma moldura veria um formulário de outra forma.
  it("campo inválido volta para o formulário DO MESMO TIPO sem criar", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(
      criarItemAction(
        formulario({ tipo: "moldura", nome: "   ", descricao: "", preco: "300", cor: "#7c5900" }),
      ),
    );

    expect(url).toBe("/admin/loja/novo?erro=dados-invalidos&tipo=moldura");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  it("badge sem arquivo volta com o slug da imagem ausente", async () => {
    await logarComoAdminDaPlataforma();

    const url = await esperaRedirect(criarItemAction(formulario(camposDeBadge)));

    expect(url).toBe("/admin/loja/novo?erro=imagem-ausente&tipo=badge");
    expect(await db.select().from(lojaItens)).toHaveLength(0);
  });

  // O `<input type="color">` sempre manda um valor (não existe "cor vazia" no
  // navegador). Num badge, gravá-lo quebraria o check que amarra cor ao tipo —
  // então a action só lê a cor quando o tipo a pede.
  it("cor mandada junto de um badge é ignorada", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(
      criarItemAction(formulario({ ...camposDeBadge, cor: "#000000" }, arquivoPng("#0a2f7a"))),
    );

    const [item] = await db.select().from(lojaItens);
    expect(item.cor).toBeNull();
  });

  it("moldura grava a cor, normalizada para minúsculas", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(
      criarItemAction(
        formulario({
          tipo: "moldura",
          nome: "Moldura de ouro",
          descricao: "",
          preco: "300",
          cor: "#7C5900",
          ativo: "on",
        }),
      ),
    );

    const [item] = await db.select().from(lojaItens);
    expect(item.cor).toBe("#7c5900");
  });

  // Checkbox desmarcado não é enviado pelo HTML — o item nasce fora de venda.
  it("sem a caixa 'à venda', o item nasce escondido", async () => {
    await logarComoAdminDaPlataforma();
    const { ativo: _, ...semAtivo } = camposDeBadge;

    await esperaRedirect(criarItemAction(formulario(semAtivo, arquivoPng("#0a2f7a"))));

    const [item] = await db.select().from(lojaItens);
    expect(item.ativo).toBe(false);
  });
});

describe("editarItemAction", () => {
  it("salva e volta para a tela do item", async () => {
    await logarComoAdminDaPlataforma();
    const item = await criarBadge("Antes", 100);

    const url = await esperaRedirect(
      editarItemAction(
        item.id,
        formulario({ tipo: "badge", nome: "Depois", descricao: "", preco: "150", ativo: "on" }),
      ),
    );

    expect(url).toBe(`/admin/loja/${item.id}?ok=item-salvo`);
    const depois = await lerItem(db, item.id);
    expect(depois?.nome).toBe("Depois");
    expect(depois?.preco).toBe(150);
  });

  it("jogador comum leva 404 e não altera nada", async () => {
    const item = await criarBadge("Intocado", 100);
    await logarComoJogadorComum();

    await esperaNotFound(
      editarItemAction(
        item.id,
        formulario({ tipo: "badge", nome: "Hackeado", descricao: "", preco: "1", ativo: "on" }),
      ),
    );

    expect((await lerItem(db, item.id))?.nome).toBe("Intocado");
  });

  it("id absurdo volta para a lista sem 500", async () => {
    await logarComoAdminDaPlataforma();

    expect(
      await esperaRedirect(
        editarItemAction(
          -1,
          formulario({ tipo: "badge", nome: "X", descricao: "", preco: "1", ativo: "on" }),
        ),
      ),
    ).toBe("/admin/loja?erro=item-nao-encontrado");
  });

  // A tela do item responde 404 quando ele não existe — o aviso só aparece se
  // a volta for para a lista. Vale para editar e para apagar.
  it("item que sumiu no meio do caminho volta para a LISTA, com o aviso", async () => {
    await logarComoAdminDaPlataforma();
    const item = await criarBadge("Efêmero", 100);
    await apagarItem(item.id);

    expect(
      await esperaRedirect(
        editarItemAction(
          item.id,
          formulario({ tipo: "badge", nome: "Tarde", descricao: "", preco: "1", ativo: "on" }),
        ),
      ),
    ).toBe("/admin/loja?erro=item-nao-encontrado");
    expect(await esperaRedirect(apagarItemAction(item.id))).toBe(
      "/admin/loja?erro=item-nao-encontrado",
    );
  });
});

describe("definirVendaAction e apagarItemAction", () => {
  it("retira e devolve à venda, cada um com o seu aviso", async () => {
    await logarComoAdminDaPlataforma();
    const item = await criarBadge("Vaivém", 100);

    expect(await esperaRedirect(definirVendaAction(item.id, false))).toBe(
      "/admin/loja?ok=item-retirado",
    );
    expect((await lerItem(db, item.id))?.ativo).toBe(false);

    expect(await esperaRedirect(definirVendaAction(item.id, true))).toBe(
      "/admin/loja?ok=item-republicado",
    );
    expect((await lerItem(db, item.id))?.ativo).toBe(true);
  });

  it("apaga o que ninguém comprou", async () => {
    await logarComoAdminDaPlataforma();
    const item = await criarBadge("Descartável", 100);

    expect(await esperaRedirect(apagarItemAction(item.id))).toBe("/admin/loja?ok=item-apagado");

    expect(await lerItem(db, item.id)).toBeUndefined();
  });

  it("o consumível não se apaga, e a volta explica por quê", async () => {
    await logarComoAdminDaPlataforma();
    const multiplicador = await garantirMultiplicador();

    expect(await esperaRedirect(apagarItemAction(multiplicador.id))).toBe(
      `/admin/loja/${multiplicador.id}?erro=item-protegido`,
    );
    expect(await lerItem(db, multiplicador.id)).toBeDefined();
  });

  it("jogador comum leva 404 nas duas", async () => {
    const item = await criarBadge("Intocado", 100);
    await logarComoJogadorComum();

    await esperaNotFound(definirVendaAction(item.id, false));
    await esperaNotFound(apagarItemAction(item.id));

    expect((await lerItem(db, item.id))?.ativo).toBe(true);
  });

  it("deslogado vai para o login nas duas", async () => {
    const item = await criarBadge("Intocado", 100);
    deslogar();

    expect(await esperaRedirect(definirVendaAction(item.id, false))).toBe("/login");
    expect(await esperaRedirect(apagarItemAction(item.id))).toBe("/login");
    expect((await lerItem(db, item.id))?.ativo).toBe(true);
  });
});
