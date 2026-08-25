// O slug nascendo pelos caminhos de verdade — a action de criar jogador e a de
// criar grupo —, porque é onde a colisão acontece.
//
// A unicidade em si é do banco (`players.slug` e `groups.slug` são UNIQUE); o
// que se testa aqui é o que o app faz ANTES de esbarrar nela: escolher um slug
// livre em silêncio, sem transformar homônimo em erro na tela.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPlayer } from "@/app/(esqueleto)/admin/(panel)/jogadores/actions";
import { criarGrupo as criarGrupoAction } from "@/app/(esqueleto)/grupos/novo/actions";
import { db } from "@/db";
import { groups, players } from "@/db/schema";
import { criarJogadorComConta, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

async function logarComoAdminDaPlataforma(): Promise<void> {
  const { conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
  await logarComo(conta);
}

async function logarComoJogador(): Promise<void> {
  const { conta } = await criarJogadorComConta();
  await logarComo(conta);
}

function formDeJogador(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

function formDeGrupo(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("visibility", "private");
  fd.set("joinPolicy", "request");
  return fd;
}

async function slugDoJogador(name: string): Promise<string> {
  const [jogador] = await db.select().from(players).where(eq(players.name, name));
  return jogador.slug;
}

describe("slug do jogador, na criação", () => {
  it("sai do nome inteiro, sem acento e sem espaço", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(createPlayer(formDeJogador("José Antônio da Silva")));

    expect(await slugDoJogador("José Antônio da Silva")).toBe("jose-antonio-da-silva");
  });

  // Nomes diferentes que normalizam para o mesmo slug: `players.name` é UNIQUE,
  // então o banco aceita os dois, e quem tem que desempatar é o slug.
  it("desempata quando dois nomes normalizam igual", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(createPlayer(formDeJogador("José Silva")));
    await esperaRedirect(createPlayer(formDeJogador("Jose Silva")));

    expect(await slugDoJogador("José Silva")).toBe("jose-silva");
    expect(await slugDoJogador("Jose Silva")).toBe("jose-silva-2");
  });

  // A regra que faz a URL antiga (/jogador/{id}) dar 404 em vez de servir o
  // perfil de outra pessoa por acaso.
  it("nome que é só número não vira slug numérico", async () => {
    await logarComoAdminDaPlataforma();

    await esperaRedirect(createPlayer(formDeJogador("2024")));

    expect(await slugDoJogador("2024")).toBe("jogador-2024");
  });
});

describe("slug do grupo, na criação", () => {
  it("dois grupos homônimos convivem, e o segundo é numerado", async () => {
    await logarComoJogador();

    const primeira = await esperaRedirect(criarGrupoAction(formDeGrupo("Fut da firma")));
    const segunda = await esperaRedirect(criarGrupoAction(formDeGrupo("Fut da firma")));

    expect(primeira).toBe("/grupo/fut-da-firma/gerenciar");
    // O ponto: o homônimo não virou `?erro=`. `groups.name` não é unique de
    // propósito (ver o comentário da tabela), e a unique do slug não pode
    // reintroduzir pela porta dos fundos um erro que denuncie a existência de um
    // grupo — inclusive privado — com o mesmo nome.
    expect(segunda).toBe("/grupo/fut-da-firma-2/gerenciar");

    const linhas = await db.select().from(groups).where(eq(groups.name, "Fut da firma"));
    expect(linhas).toHaveLength(2);
    expect(new Set(linhas.map((g) => g.slug)).size).toBe(2);
  });

  // A base cheia: `variacaoDeSlug` trunca para caber o sufixo, então o segundo
  // homônimo NÃO começa com `base-` — o terceiro só o enxerga porque a busca de
  // ocupados é pelo tronco (ver troncoDeColisao). Com a busca antiga, por
  // `base-%`, ele escolhia de novo o slug do segundo e estourava a unique.
  it("três homônimos com nome no limite ganham slugs distintos", async () => {
    await logarComoJogador();
    const nome = "A".repeat(60);

    const primeira = await esperaRedirect(criarGrupoAction(formDeGrupo(nome)));
    const segunda = await esperaRedirect(criarGrupoAction(formDeGrupo(nome)));
    const terceira = await esperaRedirect(criarGrupoAction(formDeGrupo(nome)));

    expect(primeira).toBe(`/grupo/${"a".repeat(60)}/gerenciar`);
    expect(segunda).toBe(`/grupo/${"a".repeat(58)}-2/gerenciar`);
    expect(terceira).toBe(`/grupo/${"a".repeat(58)}-3/gerenciar`);
  });
});
