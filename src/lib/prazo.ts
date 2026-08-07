// O "relógio único" do design: todo prazo do produto — avaliação, votação,
// janela de correção, convite — usa o mesmo selo com ponto, e a cor sai daqui.
//
// A entrada é sempre `horasRestantes` já calculado no Postgres. É regra do
// projeto não usar Date.now() em render (quebraria a pureza do Server
// Component e daria número diferente a cada re-render), então nenhuma função
// aqui olha o relógio: elas só traduzem um número que já veio pronto.

export type TomDePrazo = "calmo" | "apertado" | "urgente" | "vencido";

/** Abaixo disto o selo fica âmbar. */
export const HORAS_APERTADO = 24;
/** Abaixo disto o selo fica vermelho e pulsa. */
export const HORAS_URGENTE = 6;

export function tomDePrazo(horasRestantes: number): TomDePrazo {
  if (horasRestantes <= 0) return "vencido";
  if (horasRestantes < HORAS_URGENTE) return "urgente";
  if (horasRestantes < HORAS_APERTADO) return "apertado";
  return "calmo";
}

/**
 * O texto do prazo, na voz do produto.
 *
 * Em dias quando falta mais de um, porque "faltam 43h" faz a pessoa fazer
 * conta. Abaixo de 24h vira hora, que é quando a hora passa a importar.
 */
export function textoDePrazo(horasRestantes: number): string {
  if (horasRestantes <= 0) return "prazo encerrado";
  if (horasRestantes < 24) {
    return horasRestantes === 1 ? "falta 1h" : `faltam ${horasRestantes}h`;
  }

  const dias = Math.floor(horasRestantes / 24);
  const horas = horasRestantes % 24;
  const parteDias = dias === 1 ? "1 dia" : `${dias} dias`;
  if (horas === 0) return dias === 1 ? "falta 1 dia" : `faltam ${parteDias}`;
  return `faltam ${parteDias} e ${horas}h`;
}
