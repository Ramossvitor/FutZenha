// Os coletes do grupo: a action substitui a lista inteira, e as recusas da
// leitura (src/lib/coletes-form.ts) chegam à tela com o slug de cada uma. Quem
// os usa é o sorteio — coberto em fut/[id]/gerenciar/times-actions.

import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { coletesDoGrupo, type Group } from "@/db/schema";
import { listarColetesDoGrupo } from "@/lib/coletes-do-grupo";
import { CORES_DE_COLETE, ESCOLHA_SEM_COLETE } from "@/lib/team-colors";
import { criarJogadorComConta, logarComo } from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";
import { definirColetesDoGrupo } from "./actions";

async function grupoComPapelLogado(papel: "admin" | "organizer"): Promise<Group> {
  const { jogador, conta } = await criarJogadorComConta();
  const grupo = await criarGrupo();
  await entrarNoGrupo(grupo.id, jogador, papel);
  await logarComo(conta);
  return grupo;
}

/** Os blocos como o browser manda — inclusive o seletor livre de cada um. */
function formDeColetes(linhas: { nome: string; cor: string }[]): FormData {
  const form = new FormData();
  for (const [i, linha] of linhas.entries()) {
    form.set(`nome-${i}`, linha.nome);
    form.set(`cor-${i}`, linha.cor);
    form.set(`corLivre-${i}`, "#888888");
  }
  return form;
}

async function coletesDoBanco(groupId: number) {
  return db
    .select({ sortOrder: coletesDoGrupo.sortOrder, nome: coletesDoGrupo.nome, cor: coletesDoGrupo.cor })
    .from(coletesDoGrupo)
    .where(eq(coletesDoGrupo.groupId, groupId))
    .orderBy(asc(coletesDoGrupo.sortOrder));
}

describe("definirColetesDoGrupo", () => {
  it("grava as linhas na ordem e avisa no ?ok=", async () => {
    const grupo = await grupoComPapelLogado("admin");

    const url = await esperaRedirect(
      definirColetesDoGrupo(
        grupo.id,
        formDeColetes([
          { nome: "Com Colete", cor: "#f2740f" },
          { nome: "Sem Colete", cor: ESCOLHA_SEM_COLETE },
          { nome: "Reserva", cor: "#16a868" },
        ]),
      ),
    );

    expect(url).toBe(`/grupo/${grupo.slug}/gerenciar?ok=coletes-atualizados`);
    expect(await coletesDoBanco(grupo.id)).toEqual([
      { sortOrder: 0, nome: "Com Colete", cor: "#f2740f" },
      { sortOrder: 1, nome: "Sem Colete", cor: null },
      { sortOrder: 2, nome: "Reserva", cor: "#16a868" },
    ]);
  });

  it("salvar de novo substitui a lista inteira; tudo em branco apaga", async () => {
    const grupo = await grupoComPapelLogado("admin");
    await esperaRedirect(
      definirColetesDoGrupo(
        grupo.id,
        formDeColetes([
          { nome: "A", cor: "#15181a" },
          { nome: "B", cor: "#e8edea" },
          { nome: "C", cor: "#16a868" },
        ]),
      ),
    );

    await esperaRedirect(
      definirColetesDoGrupo(
        grupo.id,
        formDeColetes([
          { nome: "X", cor: "#15181a" },
          { nome: "Y", cor: "#e8edea" },
        ]),
      ),
    );
    expect((await coletesDoBanco(grupo.id)).map((c) => c.nome)).toEqual(["X", "Y"]);

    const url = await esperaRedirect(
      definirColetesDoGrupo(
        grupo.id,
        formDeColetes([
          { nome: "", cor: "#15181a" },
          { nome: "  ", cor: "#e8edea" },
        ]),
      ),
    );
    expect(url).toBe(`/grupo/${grupo.slug}/gerenciar?ok=coletes-atualizados`);
    expect(await coletesDoBanco(grupo.id)).toEqual([]);
  });

  it("recusa um só, linha pulada, nome repetido e cor inválida — sem gravar", async () => {
    const grupo = await grupoComPapelLogado("admin");
    const casos: [FormData, string][] = [
      [formDeColetes([{ nome: "Só um", cor: "#15181a" }]), "coletes-incompletos"],
      [
        formDeColetes([
          { nome: "A", cor: "#15181a" },
          { nome: "", cor: "#e8edea" },
          { nome: "C", cor: "#16a868" },
        ]),
        "coletes-incompletos",
      ],
      [
        formDeColetes([
          { nome: "Preto", cor: "#15181a" },
          { nome: " preto ", cor: "#e8edea" },
        ]),
        "nome-de-time-repetido",
      ],
      [
        formDeColetes([
          { nome: "A", cor: "#15181a" },
          { nome: "B", cor: "roxo" },
        ]),
        "nome-de-time-invalido",
      ],
    ];

    for (const [form, slug] of casos) {
      expect(await esperaRedirect(definirColetesDoGrupo(grupo.id, form))).toBe(
        `/grupo/${grupo.slug}/gerenciar?erro=${slug}`,
      );
    }
    expect(await coletesDoBanco(grupo.id)).toEqual([]);
  });

  it("organizador não define coletes — é coisa de quem administra", async () => {
    const grupo = await grupoComPapelLogado("organizer");

    await esperaNotFound(
      definirColetesDoGrupo(
        grupo.id,
        formDeColetes([
          { nome: "A", cor: "#15181a" },
          { nome: "B", cor: "#e8edea" },
        ]),
      ),
    );
    expect(await coletesDoBanco(grupo.id)).toEqual([]);
  });
});

describe("listarColetesDoGrupo", () => {
  // Gravado fora de ordem de propósito: os outros testes inserem já na ordem
  // numa tabela recém-truncada, e aí a ordem do heap coincide com o sort_order
  // — passariam sem o `orderBy`. A ordem é o contrato ("na ordem em que os
  // times saem"), então precisa de um teste que só passa por causa dele.
  it("devolve pelo sort_order, não pela ordem em que as linhas foram gravadas", async () => {
    const grupo = await criarGrupo();
    await db.insert(coletesDoGrupo).values([
      { groupId: grupo.id, sortOrder: 1, nome: "B", cor: null },
      { groupId: grupo.id, sortOrder: 0, nome: "A", cor: CORES_DE_COLETE.azul },
    ]);

    expect(await listarColetesDoGrupo(db, grupo.id)).toEqual([
      { nome: "A", cor: CORES_DE_COLETE.azul },
      { nome: "B", cor: null },
    ]);
  });
});
