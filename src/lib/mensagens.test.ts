import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROS_LOGIN } from "./erros-login";
import { MENSAGENS, resolverMensagem } from "./mensagens";

const APP = fileURLToPath(new URL("../app", import.meta.url));

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return arquivos(caminho);
    return e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [caminho] : [];
  });
}

// Duas formas de emitir slug no app:
//   redirect(`/rota?erro=slug`)          — literal na query string
//   erro(groupId, "slug")                — helper do grupo/[id]/gerenciar
const NA_QUERY = /[?&](?:erro|ok)=([a-z0-9-]+)/g;
const NO_HELPER = /\b(?:erro|ok)\(\s*[A-Za-z0-9_.]+\s*,\s*"([a-z0-9-]+)"\s*\)/g;

function slugsEmitidos(): Map<string, string[]> {
  const achados = new Map<string, string[]>();
  for (const arquivo of arquivos(APP)) {
    const fonte = readFileSync(arquivo, "utf8");
    for (const re of [NA_QUERY, NO_HELPER]) {
      for (const m of fonte.matchAll(re)) {
        const slug = m[1];
        const onde = achados.get(slug) ?? [];
        const curto = arquivo.slice(APP.length + 1).replace(/\\/g, "/");
        if (!onde.includes(curto)) onde.push(curto);
        achados.set(slug, onde);
      }
    }
  }
  return achados;
}

describe("cobertura dos slugs", () => {
  // Esta é a razão de o arquivo existir. Um slug emitido sem mensagem não
  // quebra nada: o banner só não aparece, e ninguém descobre até um usuário
  // reclamar que "clicou e não deu nada".
  it("toda action que emite um slug tem mensagem para ele", () => {
    const emitidos = slugsEmitidos();
    expect(emitidos.size).toBeGreaterThan(30);

    const orfaos = [...emitidos.entries()]
      .filter(([slug]) => !(slug in MENSAGENS) && !(slug in ERROS_LOGIN))
      .map(([slug, onde]) => `${slug} (emitido em ${onde.join(", ")})`);

    expect(orfaos).toEqual([]);
  });

  it("não guarda mensagem para slug que ninguém emite", () => {
    const emitidos = slugsEmitidos();
    const naoUsados = Object.keys(MENSAGENS).filter((slug) => !emitidos.has(slug));
    expect(naoUsados).toEqual([]);
  });
});

describe("resolverMensagem", () => {
  it("resolve pelo dicionário global", () => {
    expect(resolverMensagem("saiu")).toBe("Você saiu do grupo.");
  });

  it("deixa a página sobrescrever com um texto mais específico", () => {
    const local = { "dados-invalidos": "Dados inválidos — confira data e local." };
    expect(resolverMensagem("dados-invalidos", local)).toBe(
      "Dados inválidos — confira data e local.",
    );
    // e o global segue valendo para os slugs que a página não redefine
    expect(resolverMensagem("saiu", local)).toBe("Você saiu do grupo.");
  });

  it("devolve null para ausente, desconhecido ou repetido na query", () => {
    expect(resolverMensagem(undefined)).toBeNull();
    expect(resolverMensagem("nao-existe")).toBeNull();
    // ?erro=a&erro=b chega como array — não é slug, não vira mensagem
    expect(resolverMensagem(["saiu", "entrou"])).toBeNull();
  });

  it("não vaza texto arbitrário da query string para dentro do banner", () => {
    expect(resolverMensagem("<script>alert(1)</script>")).toBeNull();
    expect(resolverMensagem("Ligue para 0800-123-4567")).toBeNull();
  });
});
