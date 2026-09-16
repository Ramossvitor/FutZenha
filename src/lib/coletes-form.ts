// A leitura do formulário de colete — nome e cor —, a mesma nos três lugares
// que o editam: o /gerenciar do fut, o painel da súmula e os coletes do grupo.
// Puro e com zod, como grupos-form.ts: Server Action é endpoint POST público,
// e o que a tela impede (maxLength, rádio) um request forjado não impede.
//
// A cor chega em dois campos: o rádio `cor` (um hex das amostras, "outra" ou
// "sem") e o `<input type="color">` `corLivre`, que o browser SEMPRE envia — um
// seletor de cor não sabe ficar vazio. Por isso o rádio manda: `corLivre` só é
// lido quando a pessoa escolheu "outra"; senão, um form em que ela nunca tocou
// no seletor gravaria o cinza de placeholder por cima da amostra marcada.

import { z } from "zod";
import { normalizarCor } from "./cor";
import { NOME_DE_TIME_MAX, TIMES_MAX, TIMES_MIN } from "./regras";
import {
  chaveDoNomeDeTime,
  ESCOLHA_OUTRA_COR,
  ESCOLHA_SEM_COLETE,
  type Colete,
} from "./team-colors";

// O regex barra quebra de linha no meio (o `.trim()` só corta as pontas): o
// nome vai para o WhatsApp, o e-mail e a frase do relógio, todos de uma linha.
const nomeSchema = z.string().trim().min(1).max(NOME_DE_TIME_MAX).regex(/^[^\r\n]+$/);

export type ErroDoColete = "nome-de-time-invalido";
export type LeituraDoColete =
  | { success: true; data: Colete }
  | { success: false; erro: ErroDoColete };

/**
 * Um colete: `nome`, `cor` e `corLivre`, com o `sufixo` no nome de cada campo
 * (vazio no form de um time só; `-<i>` nos blocos do grupo).
 */
export function lerColeteDoForm(formData: FormData, sufixo = ""): LeituraDoColete {
  const nome = nomeSchema.safeParse(formData.get(`nome${sufixo}`) ?? "");
  if (!nome.success) return { success: false, erro: "nome-de-time-invalido" };

  const escolha = formData.get(`cor${sufixo}`);
  if (escolha === ESCOLHA_SEM_COLETE) return { success: true, data: { nome: nome.data, cor: null } };

  const cor = normalizarCor(
    escolha === ESCOLHA_OUTRA_COR ? formData.get(`corLivre${sufixo}`) : escolha,
  );
  if (cor === null) return { success: false, erro: "nome-de-time-invalido" };
  return { success: true, data: { nome: nome.data, cor } };
}

export type ErroDosColetes = ErroDoColete | "nome-de-time-repetido" | "coletes-incompletos";
export type LeituraDosColetes =
  | { success: true; data: Colete[] }
  | { success: false; erro: ErroDosColetes };

/**
 * Os coletes do grupo: até TIMES_MAX blocos `nome-<i>` / `cor-<i>` /
 * `corLivre-<i>`. Linha com nome em branco é linha não usada. As usadas têm de
 * ser as primeiras (sem pular), e ou não há nenhuma — o grupo volta aos
 * padrões — ou há pelo menos TIMES_MIN: um colete só não sorteia nada. Nome
 * repetido (pela chaveDoNomeDeTime) é recusado, pelo mesmo motivo do fut.
 */
export function lerColetesDoForm(formData: FormData): LeituraDosColetes {
  const usadas: number[] = [];
  for (let i = 0; i < TIMES_MAX; i++) {
    const nome = formData.get(`nome-${i}`);
    if (typeof nome === "string" && nome.trim() !== "") usadas.push(i);
  }
  if (usadas.length === 0) return { success: true, data: [] };
  if (usadas.length < TIMES_MIN || usadas.some((linha, posicao) => linha !== posicao)) {
    return { success: false, erro: "coletes-incompletos" };
  }

  const coletes: Colete[] = [];
  const chaves = new Set<string>();
  for (const i of usadas) {
    const lido = lerColeteDoForm(formData, `-${i}`);
    if (!lido.success) return lido;
    const chave = chaveDoNomeDeTime(lido.data.nome);
    if (chaves.has(chave)) return { success: false, erro: "nome-de-time-repetido" };
    chaves.add(chave);
    coletes.push(lido.data);
  }
  return { success: true, data: coletes };
}
