import { Children, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { TRILHA_DA_LARGURA, type LarguraDeCampo } from "./larguras-de-campo";

// Havia vinte e uma linhas de campos escritas à mão no app, em seis formatos
// diferentes — `flex flex-wrap items-end gap-2`, `…gap-3`, `flex flex-col gap-4
// sm:flex-row sm:items-end`, `flex flex-wrap gap-4` sem alinhamento nenhum — e
// metade delas desalinhada. Não era descuido: não havia norma da qual desviar.
// Card, Field e Button eram componentes; a composição deles, não.

// O subgrid é imposto pela LINHA e não declarado lá dentro pelo Field. Assim o
// Field avulso continua uma coluna flex simples, nenhum call site consegue
// optar por não alinhar, e quem vence a disputa de `display` é a especificidade
// (`.linha > [data-faixas]` = 0,2,0 contra o `.flex` = 0,1,0 do Field) — não a
// ordem no CSS, que com um cx() sem merge seria aposta.
//
// As duas strings dizem a mesma coisa, uma com `sm:` e outra sem. Montá-las com
// um prefixo variável não é opção: o Tailwind varre o fonte, e classe que não
// aparece literal aqui não existe na folha.
//
// O `auto-cols` é rede de segurança para o filho que passou do que `colunas`
// declara: ele cai numa coluna IMPLÍCITA, e implícita nasce `auto` — ou seja,
// com `min-width: auto`, cujo min-content num <select> é a maior <option>.
// Seria de novo o bug de rolagem lateral que o minmax(0, …) das trilhas existe
// para impedir, e por uma porta que as trilhas declaradas não cobrem.
const empilhando =
  "flex flex-col gap-4 " +
  "sm:grid sm:grid-cols-[var(--trilhas)] sm:grid-rows-[auto_auto_auto] sm:gap-x-3 sm:gap-y-1.5 " +
  "sm:auto-cols-[minmax(0,1fr)] " +
  "sm:[&>[data-faixas]]:grid sm:[&>[data-faixas]]:grid-rows-subgrid " +
  "sm:[&>[data-faixas]]:row-span-3 sm:[&>[data-faixas]]:items-end " +
  "sm:[&>[data-faixas]]:min-w-0";

const sempreEmLinha =
  "grid grid-cols-[var(--trilhas)] grid-rows-[auto_auto_auto] gap-x-3 gap-y-1.5 " +
  "auto-cols-[minmax(0,1fr)] " +
  "[&>[data-faixas]]:grid [&>[data-faixas]]:grid-rows-subgrid " +
  "[&>[data-faixas]]:row-span-3 [&>[data-faixas]]:items-end " +
  "[&>[data-faixas]]:min-w-0";

/**
 * Uma linha de campos, e o único jeito de escrever uma.
 *
 * O problema que ela existe para tornar IMPOSSÍVEL: o Field é uma coluna cuja
 * altura depende de duas coisas que o vizinho não controla — se o rótulo quebrou
 * em duas linhas, e se há ou não `ajuda`. Alinhar campos pela borda da caixa
 * (`items-end` ou `items-start`, tanto faz) alinha portanto o parágrafo de ajuda
 * de um com o input do outro. O alinhamento certo era acidente: valia enquanto
 * ninguém acrescentasse um texto.
 *
 * Aqui o alinhamento deixa de ser opinião do call site. A linha declara TRÊS
 * FAIXAS — rótulo, controle, ajuda/erro — e cada campo é um subgrid que ocupa as
 * três. O controle de todas as colunas nasce e termina na mesma faixa, aconteça
 * o que acontecer com o texto em volta: rótulo que quebra em duas linhas engorda
 * a primeira faixa PARA TODOS, e a ajuda que só uma coluna tem vive na terceira,
 * embaixo da linha inteira, sem empurrar ninguém.
 *
 * No celular não há grade nenhuma: é pilha, cada campo com a largura toda.
 * Metade dos defeitos de mobile do app era o `flex-wrap` improvisando a quebra —
 * e pilha não tem wrap para improvisar.
 *
 * Onde `subgrid` não existisse, a declaração cai e os campos voltam a se alinhar
 * como antes: degrada para o defeito, não para tela quebrada.
 */
export function LinhaDeCampos({
  colunas,
  empilhaNoCelular = true,
  className,
  children,
}: {
  /**
   * Uma largura por coluna, na ordem dos filhos. Ver larguras-de-campo.ts.
   *
   * A largura é da COLUNA e não do campo porque quem decide largura precisa
   * enxergar os irmãos — e o campo não enxerga.
   *
   * Convenção: até quatro colunas. Acima disso as trilhas ficam menores que o
   * conteúdo já nos 640px em que a grade começa; parta em duas linhas, como
   * /futs/novo faz.
   */
  colunas: LarguraDeCampo[];
  /**
   * Empilhar no celular é o certo para formulário, e por isso é o padrão.
   *
   * A exceção é o punhado de controles em que a disposição lado a lado É o
   * significado — "Time A × Time B" da súmula, que empilhado deixa o "×" sozinho
   * no meio da tela e desfaz a leitura de confronto. Só use com trilhas
   * estreitas, senão a linha estoura em 390px.
   */
  empilhaNoCelular?: boolean;
  /**
   * Só layout: `mt-2`, `border-t`, `pt-3`. Nunca alinhamento nem largura — as
   * duas coisas têm dono, e é para não terem mais um que este componente
   * existe.
   */
  className?: string;
  children: ReactNode;
}) {
  // O `auto-cols` das strings acima limita o estrago de um descompasso; este
  // aviso diz ONDE ele está, que é o que o CSS não sabe dizer. Só em dev: em
  // produção não há o que fazer com a informação.
  //
  // `toArray` e não `Children.count`: o count enxerga o `false` de um
  // `{cond && <Field/>}` como filho, e é justamente o filho condicional que
  // produz o descompasso — ver as colunas ramificadas de CamposDoJogador.
  if (process.env.NODE_ENV !== "production") {
    const filhos = Children.toArray(children).length;
    if (filhos !== colunas.length) {
      console.error(
        `LinhaDeCampos: ${filhos} filho(s) para ${colunas.length} coluna(s) — ` +
          `o que sobra cai em coluna implícita e sai da grade das faixas.`,
      );
    }
  }

  return (
    <div
      // O gancho do CSS é o mesmo que o teste de alinhamento usa para achar as
      // linhas — não é data-testid pendurado só para o Playwright.
      data-linha-de-campos
      // A template vai por custom property porque é montada em runtime a partir
      // dos tokens, e o Tailwind varre o fonte: `grid-cols-[${…}]` nunca
      // existiria na folha. É o mesmo caso que o Card documenta no `style` —
      // valor calculado, não cor nem padding.
      style={{ "--trilhas": colunas.map((c) => TRILHA_DA_LARGURA[c]).join(" ") } as CSSProperties}
      className={cx(empilhaNoCelular ? empilhando : sempreEmLinha, className)}
    >
      {children}
    </div>
  );
}

/**
 * O que divide a linha com campos sem ser campo: botão, checkbox, o "×" entre
 * dois times.
 *
 * Ocupa as três faixas como um campo e joga o filho na faixa DO CONTROLE — que
 * é o que o `pb-2.5` do painel da súmula e o `h-10` do label do admin faziam a
 * dedo, cada um com um número chutado no olho para imitar a altura do Input.
 *
 * No celular vira `items-start`, senão o botão estica e aparece como barra de
 * largura total no meio do formulário.
 *
 * O `row-start-2` vai sem `sm:` de propósito: enquanto a linha está empilhada
 * isto aqui é um flex e a regra é inerte, e assim a mesma classe serve às duas
 * variantes de linha sem uma segunda string literal.
 */
export function AcaoDaLinha({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-faixas className={cx("flex flex-col items-start [&>*]:row-start-2", className)}>
      {children}
    </div>
  );
}
