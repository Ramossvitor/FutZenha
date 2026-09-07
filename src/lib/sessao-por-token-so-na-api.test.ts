import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Por que isto é um teste e não um comentário.
//
// O token de API do relógio autentica a súmula ao vivo e só ela. É o que
// limita o estrago de um token vazado — ele fica gravado dentro de um atalho,
// num aparelho que se perde — a lançar gol num fut que a pessoa já opera. A
// garantia não mora em permissão nenhuma: mora no fato de que NENHUMA rota
// fora de src/app/api/sumula/ pergunta quem é o dono do token. Uma rota nova
// que importasse `sessaoPorToken` "porque já estava pronto" ampliaria o alcance
// da credencial sem que nenhum teste de comportamento percebesse.
//
// Mesmo truque de email-contato-nao-autentica.test.ts: ler a fonte.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const IMPORTA_O_MODULO = /sessao-por-token["']/;
const PASTA_PERMITIDA = "app/api/sumula/";

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [caminho] : [];
  });
}

describe("o token de API só autentica a API da súmula", () => {
  it("nenhum módulo fora de src/app/api/sumula importa sessaoPorToken", () => {
    const importadores = arquivos(SRC)
      .filter((arquivo) => !arquivo.endsWith("sessao-por-token.ts"))
      .filter((arquivo) => IMPORTA_O_MODULO.test(readFileSync(arquivo, "utf8")))
      .map((arquivo) => relative(SRC, arquivo).replace(/\\/g, "/"));

    // Alguém tem que importar — senão o teste passaria em vão.
    expect(importadores.length).toBeGreaterThan(0);
    const foraDaApi = importadores.filter((caminho) => !caminho.startsWith(PASTA_PERMITIDA));
    expect(foraDaApi).toEqual([]);
  });
});
