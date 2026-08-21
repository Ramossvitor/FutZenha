import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGO, type TokenDeItem } from "@/lib/loja-catalogo";
import { CLASSES_DO_TOKEN, TOKENS_DE_ITEM } from "./tokens-de-item";

// O Selo em si (selo.tsx) não é testado aqui: o projeto unit roda em Node e não
// renderiza .tsx — quem passa os olhos no componente é o E2E. O que sobra é
// justamente o que quebra calado, e é tudo o que este arquivo cobra: a corrente
// entre o `tokenId` do catálogo, a classe do Tailwind e a variável do CSS.

const GLOBALS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

/**
 * O corpo de um bloco do CSS, contando chaves a partir do marcador.
 *
 * Contar chaves em vez de cortar no primeiro `}` porque um dos blocos é a media
 * query do tema escuro, que aninha o `:root` dentro dela — o corte ingênuo
 * pararia na linha errada e o teste passaria com o bloco pela metade.
 */
function bloco(fonte: string, marcador: string): string {
  const inicio = fonte.indexOf(marcador);
  if (inicio < 0) throw new Error(`Bloco não encontrado em globals.css: ${marcador}`);

  const abre = fonte.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    if (fonte[i] === "}" && --nivel === 0) return fonte.slice(abre, i);
  }
  throw new Error(`Bloco sem fechamento em globals.css: ${marcador}`);
}

describe("tokens de item", () => {
  it("cobre exatamente os tokens que o catálogo usa", () => {
    const noCatalogo = new Set(Object.values(CATALOGO).map((item) => item.tokenId));

    // Faltando: o TypeScript já barraria (o Record é fechado pelo tipo), mas o
    // tipo não é quem roda no CI do CSS — e este lado da conta é de graça.
    expect([...noCatalogo].filter((t) => !(t in CLASSES_DO_TOKEN))).toEqual([]);
    // Sobrando: token sem nenhum item é cor que ninguém vê, e ela envelhece no
    // arquivo até alguém a reaproveitar sem conferir contraste.
    expect(TOKENS_DE_ITEM.filter((t) => !noCatalogo.has(t))).toEqual([]);
  });

  it("escreve a classe com o nome do token, letra por letra", () => {
    // A regra do team-colors.ts valendo aqui: nome de classe não se monta por
    // interpolação, porque o Tailwind gera utilitário varrendo o fonte. Se
    // alguém trocar as strings por um template, o utilitário some do CSS final
    // e o item comprado renderiza sem cor — sem erro nenhum no caminho.
    for (const token of TOKENS_DE_ITEM) {
      const classes = CLASSES_DO_TOKEN[token];
      expect(classes.texto).toBe(`text-${token}`);
      expect(classes.fundo).toBe(`bg-${token}`);
      expect(classes.anel).toBe(`ring-${token}`);
      expect(classes.borda).toMatch(new RegExp(`^border-${token}(/\\d+)?$`));
    }
  });
});

describe("a família --zenha-* em globals.css", () => {
  // Sem o normaliza-quebra-de-linha os marcadores de duas linhas não casariam
  // num checkout com CRLF, e o teste falharia só na máquina de quem desenvolve
  // no Windows — passando no CI, que é o pior lugar para uma trava mentir.
  const fonte = readFileSync(GLOBALS, "utf8").replace(/\r\n/g, "\n");

  // Os QUATRO carregadores de tema, e não dois: o par de blocos `[data-theme]`
  // existe para vencer a media query nos dois sentidos (ver o comentário deles
  // no globals.css). Token esquecido lá não some da tela — ele fica com o valor
  // do outro tema no dia em que houver um seletor de tema, que é pior, porque
  // ninguém procura um bug de cor num arquivo que "já tem o token".
  const BLOCOS: readonly [string, string][] = [
    ["tema claro (padrão)", ":root {\n  color-scheme: light dark;"],
    ["tema escuro do sistema", "@media (prefers-color-scheme: dark) {"],
    ["override claro", ':root[data-theme="light"] {'],
    ["override escuro", ':root[data-theme="dark"] {'],
  ];

  // Esta é a razão de o arquivo ler CSS com fs. Sem a trava, o item novo do
  // catálogo nasce com um token que só alguém definiu no tema claro: no escuro
  // o `var(--zenha-x)` cai inválido, a cor vira herdada, e o badge que a pessoa
  // pagou aparece igual ao texto comum — para metade dos usuários, e para
  // nenhum dos que revisaram o PR de dia.
  it("define cada token nos dois temas, nos quatro blocos", () => {
    const faltando = BLOCOS.flatMap(([nome, marcador]) => {
      const corpo = bloco(fonte, marcador);
      return TOKENS_DE_ITEM.filter((t) => !corpo.includes(`--${t}:`)).map(
        (t) => `--${t} (ausente em: ${nome})`,
      );
    });

    expect(faltando).toEqual([]);
  });

  it("expõe cada token como utilitário no @theme inline", () => {
    const corpo = bloco(fonte, "@theme inline {");
    // `var(--x)` e não o valor: sem o `inline`, o Tailwind congela a cor do tema
    // claro dentro do utilitário — o mesmo motivo que o cabeçalho do arquivo
    // explica.
    const semUtilitario = TOKENS_DE_ITEM.filter(
      (t: TokenDeItem) => !new RegExp(`--color-${t}:\\s*var\\(--${t}\\);`).test(corpo),
    );

    expect(semUtilitario).toEqual([]);
  });
});
