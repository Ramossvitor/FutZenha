// Antes desta tabela havia vinte strings de largura espalhadas por doze
// arquivos — `min-w-44 flex-1`, `min-w-[10rem] flex-1`, `sm:w-32`, `w-60`… — e
// o problema não era a variedade, era ONDE a decisão morava. `flex-1` é
// `flex: 1 1 0%`: o ponto em que a linha quebra no celular sai da SOMA dos
// `min-w` de todos os irmãos, um dado que nenhum campo sozinho conhece. Daí os
// defeitos de mobile serem todos o mesmo bug em disfarces diferentes —
// "Término" ocupando 100% da tela, "Time B" caindo sozinho com outra largura.
// Ninguém tinha desenhado o mobile; o algoritmo de wrap improvisava.
//
// Irmã das classes de previa-do-item.tsx pela mesma razão dura: o
// Tailwind gera utilitário VARRENDO O FONTE, então `sm:max-w-${largura}` nunca
// existiria na folha final. A trilha é valor de CSS (vai num custom property) e
// a classe é literal — as duas coisas escritas à mão, de propósito.

/**
 * As larguras que um campo pode ter. Fechado de propósito: seis casos cobrem o
 * app inteiro, e o sétimo que alguém for inventar quase sempre é um destes seis
 * com outro nome.
 */
export type LarguraDeCampo = "minimo" | "curto" | "medio" | "longo" | "cheio" | "acao";

/**
 * A faixa que o campo ocupa numa LinhaDeCampos.
 *
 * `minmax(0, …)` e nunca um valor cru: item de grid tem `min-width: auto`, e o
 * min-content de um `<select>` é a MAIOR `<option>`. Sem o piso zero, um nome
 * de time comprido estoura a coluna e a página inteira ganha rolagem lateral.
 */
export const TRILHA_DA_LARGURA: Readonly<Record<LarguraDeCampo, string>> = {
  minimo: "minmax(0, 5rem)", // dois dígitos: gols, quantidade
  curto: "minmax(0, 9rem)", // data, horário, vagas, nº de times
  medio: "minmax(0, 16rem)", // nome, apelido, e-mail, senha, time
  longo: "minmax(0, 24rem)", // local, observações, busca
  cheio: "minmax(0, 1fr)", // come a sobra da linha
  acao: "min-content", // botão, checkbox, o "×" entre dois times
};

/**
 * A mesma escala para o campo que vive FORA de uma linha, num form em coluna.
 *
 * Teto, não largura, e só a partir do `sm:` — no celular todo campo continua
 * ocupando a tela inteira. É o que impede três campos de senha de virarem
 * barras de 926px para caber oito caracteres.
 */
export const CLASSES_DA_LARGURA: Readonly<Record<LarguraDeCampo, string>> = {
  minimo: "sm:max-w-20",
  curto: "sm:max-w-36",
  medio: "sm:max-w-64",
  longo: "sm:max-w-96",
  cheio: "",
  acao: "sm:max-w-max",
};

/** As larguras que existem, para quem precisa varrê-las (hoje só o teste). */
export const LARGURAS_DE_CAMPO = Object.keys(TRILHA_DA_LARGURA) as LarguraDeCampo[];
