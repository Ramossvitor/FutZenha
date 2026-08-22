import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLASSES_DA_LARGURA, LARGURAS_DE_CAMPO, TRILHA_DA_LARGURA } from "./larguras-de-campo";

// O projeto unit roda em Node e não renderiza .tsx, então quem confere o
// desenho da linha é o e2e/alinhamento.spec.ts. O que sobra para cá é a trava
// contra a REINCIDÊNCIA: os três padrões que produziram os desalinhamentos
// auditados, proibidos no fonte, com o caminho do arquivo no erro e sem
// browser nem banco no caminho.

// As DUAS raízes, e não só `src/app`: o aviso-de-email-de-contato.tsx mora em
// src/components e é call site de <Field> como qualquer página. Trava que não
// alcança todo call site é trava que mente.
const RAIZES = ["../../app", "../../components"].map((r) =>
  fileURLToPath(new URL(r, import.meta.url)),
);

// Onde o padrão legitimamente nasce. O field.tsx é o dono do checkbox e das
// classes do controle; proibi-los lá seria proibir o primitivo de existir.
const PRIMITIVOS = new Set(["field.tsx", "linha-de-campos.tsx"]);

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosTsx(p);
    return e.name.endsWith(".tsx") && !PRIMITIVOS.has(e.name) ? [p] : [];
  });
}

const FONTES = RAIZES.flatMap(arquivosTsx).map((f) => ({
  caminho: path.relative(process.cwd(), f),
  // Normaliza CRLF pelo mesmo motivo do selo.test.ts: sem isto os padrões
  // multi-linha só falhariam no Windows, passando no CI — que é o pior lugar
  // para uma trava mentir.
  fonte: readFileSync(f, "utf8").replace(/\r\n/g, "\n"),
}));

/**
 * As tags `<Field …>` de um arquivo, da abertura até o `>` que a fecha.
 *
 * Contando chaves, e não com `[^>]*`: aquilo parava no primeiro `>`, então uma
 * tag com `=>` numa prop devolvia meia tag e o `className` depois dela passava
 * sem conferência. Verde falso numa trava é o pior modo de falha que existe.
 *
 * Um `>` dentro de string continua fora do alcance disto, e por isso o caso
 * "sabe achar a tag inteira" mais abaixo confere as tags que ela devolve.
 */
function tagsDeField(fonte: string): string[] {
  const tags: string[] = [];

  for (const abertura of fonte.matchAll(/<Field\b/g)) {
    const inicio = abertura.index;
    let profundidade = 0;
    for (let i = inicio; i < fonte.length; i++) {
      const c = fonte[i];
      if (c === "{") profundidade++;
      else if (c === "}") profundidade--;
      else if (c === ">" && profundidade === 0) {
        tags.push(fonte.slice(inicio, i + 1));
        break;
      }
    }
  }

  return tags;
}

describe("a escala de largura", () => {
  it("dá a toda largura uma trilha e uma classe", () => {
    // O Record fechado já garante isto em compile time; aqui é a metade que o
    // tipo não vê — que as duas tabelas continuam falando das mesmas chaves.
    expect(Object.keys(TRILHA_DA_LARGURA).sort()).toEqual(Object.keys(CLASSES_DA_LARGURA).sort());
  });

  it("põe piso zero em toda trilha que não é min-content", () => {
    // Sem o `minmax(0, …)` a trilha herda `min-width: auto`, e o min-content de
    // um <select> é a maior <option>: nome de time comprido estoura a coluna e
    // a página inteira ganha rolagem lateral no celular.
    const semPiso = LARGURAS_DE_CAMPO.filter((l) => {
      const trilha = TRILHA_DA_LARGURA[l];
      return trilha !== "min-content" && !trilha.startsWith("minmax(0,");
    });

    expect(semPiso).toEqual([]);
  });

  it("mede a mesma coisa nas duas tabelas", () => {
    // As duas dizem ser "a mesma escala": a trilha vale dentro de uma linha, a
    // classe vale no campo avulso. Nada além deste caso mantém isso de pé —
    // mexer numa só faz `largura="medio"` e `colunas={["medio"]}` saírem com
    // larguras diferentes, sem erro de tipo em lugar nenhum.
    //
    // O passo de espaçamento do Tailwind é 0.25rem, daí o × 4.
    const divergentes = LARGURAS_DE_CAMPO.filter((l) => {
      const rem = /^minmax\(0, (\d+(?:\.\d+)?)rem\)$/.exec(TRILHA_DA_LARGURA[l])?.[1];
      const passo = /^sm:max-w-(\d+(?:\.\d+)?)$/.exec(CLASSES_DA_LARGURA[l])?.[1];
      // `cheio` (1fr) e `acao` (min-content) não são medida fixa: não têm o que
      // comparar, e ficam de fora dos dois lados ou de nenhum.
      if (rem === undefined && passo === undefined) return false;
      return rem === undefined || passo === undefined || Number(rem) * 4 !== Number(passo);
    });

    expect(divergentes).toEqual([]);
  });

  it("escreve a classe de largura literal, nunca por interpolação", () => {
    // Mesma regra de previa-do-item.tsx: o Tailwind gera utilitário varrendo o
    // fonte, então `sm:max-w-${largura}` não existiria na folha final e o campo
    // sairia sem teto nenhum — sem erro em lugar nenhum do caminho.
    for (const largura of LARGURAS_DE_CAMPO) {
      const classe = CLASSES_DA_LARGURA[largura];
      if (classe !== "") expect(classe).toMatch(/^sm:max-w-[\w-]+$/);
    }
  });
});

describe("as páginas não improvisam layout de formulário", () => {
  it("sabe achar a tag inteira do Field", () => {
    // A trava conferindo a si mesma. As três abaixo só olham o que `tagsDeField`
    // devolve: se ela truncar uma tag, elas ficam verdes por não ter olhado — e
    // não há como saber disso pelo resultado delas.
    //
    // Duas provas: toda ocorrência de `<Field` virou uma tag (nenhuma se perdeu
    // no caminho), e toda tag devolvida fecha em `>` com as chaves balanceadas.
    const ocorrencias = FONTES.reduce(
      (n, { fonte }) => n + [...fonte.matchAll(/<Field\b/g)].length,
      0,
    );
    const tags = FONTES.flatMap(({ fonte }) => tagsDeField(fonte));

    expect(tags).toHaveLength(ocorrencias);
    expect(ocorrencias).toBeGreaterThan(20);

    const malformadas = tags.filter((t) => {
      const abre = (t.match(/\{/g) ?? []).length;
      const fecha = (t.match(/\}/g) ?? []).length;
      return !t.endsWith(">") || abre !== fecha;
    });

    expect(malformadas).toEqual([]);
  });

  it("não alinha campos na mão", () => {
    // Alinhar Field pela borda da caixa alinha o parágrafo de ajuda de um com o
    // input do outro — o Field é uma coluna cuja altura depende de o rótulo ter
    // quebrado e de haver `ajuda`. Quem põe campos em linha usa LinhaDeCampos.
    //
    // A proximidade importa: proibir `items-end` no ARQUIVO daria falso
    // positivo eterno no painel da súmula, que tem <Field> e um items-end
    // legítimo de tipografia a 200 linhas de distância.
    const suspeitos = FONTES.filter(({ fonte }) =>
      /className="[^"]*items-(?:end|start)[^"]*"[\s\S]{0,240}?<Field\b/.test(fonte),
    ).map(({ caminho }) => caminho);

    expect(suspeitos).toEqual([]);
  });

  it("não põe largura no className do Field", () => {
    // Largura de campo é token (prop `largura`) ou da coluna (prop `colunas` da
    // linha) — nunca invenção do call site. Eram vinte strings distintas, e o
    // ponto de quebra da linha no celular saía da soma dos `min-w` de irmãos
    // que nenhum campo sozinho enxerga.
    const suspeitos = FONTES.filter(({ fonte }) =>
      tagsDeField(fonte).some((tag) => /className="[^"]*(?:\bw-|min-w-|max-w-|flex-1|basis-)/.test(tag)),
    ).map(({ caminho }) => caminho);

    expect(suspeitos).toEqual([]);
  });

  it("não põe alinhamento no className do Field", () => {
    // `items-*` num Field alinha o conteúdo dele; `self-*` o tira da faixa que
    // a linha montou. Os dois desfazem, de dentro, a garantia do primitivo.
    const suspeitos = FONTES.filter(({ fonte }) =>
      tagsDeField(fonte).some((tag) => /className="[^"]*(?:items-|self-|justify-)/.test(tag)),
    ).map(({ caminho }) => caminho);

    expect(suspeitos).toEqual([]);
  });

  it("não escreve checkbox à mão", () => {
    // Eram três, e os três resolveram o alinhamento de um jeito diferente — um
    // inventou h-10, outro não pôs altura, o terceiro se enfiou entre o
    // controle e a ajuda de um Field. Agora é o <Checkbox> do field.tsx.
    const suspeitos = FONTES.filter(({ fonte }) => /type="checkbox"/.test(fonte)).map(
      ({ caminho }) => caminho,
    );

    expect(suspeitos).toEqual([]);
  });
});
