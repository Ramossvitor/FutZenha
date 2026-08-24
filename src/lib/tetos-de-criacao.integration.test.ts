// Os tetos diários de criação, pelas actions que eles protegem.
//
// Nenhum deles é vulnerabilidade sozinho — são o multiplicador das outras.
// Criar fut é auto-servível por design, e cada fut novo é um fan-out de aviso
// e uma cota de e-mail de agenda própria; cada jogador novo toma um nome no
// namespace UNIQUE de `players`. Sem teto, "quantos" é infinito.

import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, matchDays, players } from "@/db/schema";
import { createMatchDay } from "@/app/futs/novo/actions";
import { criarGrupo as criarGrupoAction } from "@/app/grupos/novo/actions";
import { convidarParaFut } from "@/app/fut/[id]/gerenciar/actions";
import {
  TETO_FUTS_POR_DIA,
  TETO_GRUPOS_POR_DIA,
  TETO_JOGADORES_POR_DIA,
} from "@/lib/tetos-de-criacao";
import { criarFut, criarJogadorComConta, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

function formDeFut(campos: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData();
  form.set("date", campos.date ?? "2026-08-20");
  form.set("startTime", "");
  form.set("endTime", "");
  form.set("location", campos.location ?? "Quadra Nova");
  form.set("notes", "");
  form.set("maxPlayers", "");
  return form;
}

function formDeGrupo(nome: string): FormData {
  const form = new FormData();
  form.set("name", nome);
  form.set("description", "");
  form.set("visibility", "private");
  form.set("joinPolicy", "request");
  return form;
}

function formDeConvidado(nome: string): FormData {
  const form = new FormData();
  form.set("name", nome);
  form.set("email", "");
  return form;
}

/** Linhas já criadas por este jogador, inseridas direto — o teto conta a coluna,
 *  não o caminho, e passar pela action gastaria minutos de scrypt e e-mail. */
async function jaCriou(
  tabela: "match_days" | "groups" | "players",
  playerId: number,
  quantas: number,
  horasAtras = 1,
): Promise<void> {
  for (let i = 0; i < quantas; i++) {
    if (tabela === "match_days") {
      await db.insert(matchDays).values({
        date: "2026-08-20",
        location: `Quadra ${i}`,
        createdByPlayerId: playerId,
        createdAt: sql`now() - make_interval(hours => ${horasAtras})`,
      });
    } else if (tabela === "groups") {
      await db.insert(groups).values({
        name: `Grupo ${playerId}-${i}-${horasAtras}`,
        slug: `grupo-${playerId}-${i}-${horasAtras}`,
        createdByPlayerId: playerId,
        createdAt: sql`now() - make_interval(hours => ${horasAtras})`,
      });
    } else {
      await db.insert(players).values({
        name: `Convidado ${playerId}-${i}-${horasAtras}`,
        slug: `convidado-${playerId}-${i}-${horasAtras}`,
        createdByPlayerId: playerId,
        createdAt: sql`now() - make_interval(hours => ${horasAtras})`,
      });
    }
  }
}

describe("teto de futs por dia", () => {
  it("um a menos que o teto ainda passa", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await jaCriou("match_days", jogador.id, TETO_FUTS_POR_DIA - 1);

    const url = await esperaRedirect(createMatchDay(formDeFut()));

    expect(url).toMatch(/^\/fut\/\d+\/gerenciar$/);
  });

  it("no teto, recusa com banner e não grava", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await jaCriou("match_days", jogador.id, TETO_FUTS_POR_DIA);

    const url = await esperaRedirect(createMatchDay(formDeFut({ location: "A recusada" })));

    expect(url).toBe("/futs/novo?erro=muitos-futs");
    const criados = await db
      .select()
      .from(matchDays)
      .where(eq(matchDays.location, "A recusada"));
    expect(criados).toHaveLength(0);
  });

  // A janela é de 24h corridas: o que ficou para trás não conta mais.
  it("o que passou de 24h não conta", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await jaCriou("match_days", jogador.id, TETO_FUTS_POR_DIA, 25);

    const url = await esperaRedirect(createMatchDay(formDeFut()));

    expect(url).toMatch(/^\/fut\/\d+\/gerenciar$/);
  });

  // O admin da plataforma é quem conserta as coisas; um teto que trave o
  // conserto é pior que teto nenhum. Mesma isenção de podeGerenciarFut.
  it("admin da plataforma passa por cima", async () => {
    const { jogador, conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
    await logarComo(conta);
    await jaCriou("match_days", jogador.id, TETO_FUTS_POR_DIA * 2);

    const url = await esperaRedirect(createMatchDay(formDeFut()));

    expect(url).toMatch(/^\/fut\/\d+\/gerenciar$/);
  });
});

describe("teto de grupos por dia", () => {
  it("no teto, recusa com banner", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await jaCriou("groups", jogador.id, TETO_GRUPOS_POR_DIA);

    const url = await esperaRedirect(criarGrupoAction(formDeGrupo("Grupo recusado")));

    expect(url).toBe("/grupos/novo?erro=muitos-grupos");
    expect(await db.select().from(groups).where(eq(groups.name, "Grupo recusado"))).toHaveLength(0);
  });

  it("um a menos que o teto ainda passa", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await jaCriou("groups", jogador.id, TETO_GRUPOS_POR_DIA - 1);

    const url = await esperaRedirect(criarGrupoAction(formDeGrupo("Grupo que entra")));

    // Slug, não id: a URL do grupo deixou de ser numérica (ver src/lib/slug.ts).
    expect(url).toMatch(/^\/grupo\/[a-z0-9._-]+\/gerenciar$/);
  });
});

describe("teto de jogadores por dia", () => {
  it("no teto, convidarParaFut recusa e não toma o nome", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    const fut = await criarFut({ createdByPlayerId: jogador.id });
    await jaCriou("players", jogador.id, TETO_JOGADORES_POR_DIA);

    const url = await esperaRedirect(convidarParaFut(fut.id, formDeConvidado("Nome Disputado")));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=muitos-jogadores`);
    // O ponto do teto: `players.name` é UNIQUE, então cadastrar é TOMAR.
    expect(await db.select().from(players).where(eq(players.name, "Nome Disputado"))).toHaveLength(
      0,
    );
  });

  it("um a menos que o teto ainda cadastra, e carimba quem criou", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    const fut = await criarFut({ createdByPlayerId: jogador.id });
    await jaCriou("players", jogador.id, TETO_JOGADORES_POR_DIA - 1);

    await convidarParaFut(fut.id, formDeConvidado("Convidado da Quadra"));

    const [criado] = await db
      .select()
      .from(players)
      .where(eq(players.name, "Convidado da Quadra"));
    expect(criado).toBeDefined();
    // A auditoria: quando um nome vira disputa, esta coluna diz quem chegou
    // primeiro — e é por ela que o teto conta.
    expect(criado.createdByPlayerId).toBe(jogador.id);
  });
});
