// O sumário do guia. Puro e sem JSX de propósito: é o que o índice da página
// percorre e o que o teste unitário consegue importar.
//
// Os corpos dos capítulos moram em corpos.tsx, num Record indexado por
// IdDeCapitulo — o TypeScript obriga a cobrir todos os ids, então não existe
// capítulo no sumário sem texto nem texto fora do sumário.

export const CAMADAS = [
  { id: "no-fut", titulo: "No fut" },
  { id: "organiza", titulo: "Quem organiza" },
  { id: "deu-ruim", titulo: "Quando dá ruim" },
] as const;

export type IdDeCamada = (typeof CAMADAS)[number]["id"];

type Capitulo = {
  id: string;
  titulo: string;
  resumo: string;
  camada: IdDeCamada;
};

export const CAPITULOS = [
  { id: "como-funciona", titulo: "Como funciona", resumo: "O ciclo de um fut, do convite ao ranking.", camada: "no-fut" },
  { id: "a-lista", titulo: "A lista", resumo: "Confirmar presença, vagas e lista de espera.", camada: "no-fut" },
  { id: "os-times", titulo: "Os times", resumo: "Como o sorteio equilibra os lados.", camada: "no-fut" },
  { id: "a-avaliacao", titulo: "A avaliação", resumo: "Quem avalia quem, com que prazo e sob que sigilo.", camada: "no-fut" },
  { id: "a-nota", titulo: "A nota", resumo: "De onde ela sai e por que se mexe devagar.", camada: "no-fut" },
  { id: "o-mvp", titulo: "O melhor em campo", resumo: "A votação, o piso de votos e o desempate.", camada: "no-fut" },
  { id: "os-rankings", titulo: "Os rankings", resumo: "O que cada uma das cinco abas mede.", camada: "no-fut" },
  { id: "sua-conta", titulo: "Sua conta", resumo: "Por que sem conta você joga mas não pontua.", camada: "no-fut" },
  { id: "os-avisos", titulo: "Os avisos", resumo: "O que o app te avisa e quando.", camada: "no-fut" },
  { id: "as-zenhas", titulo: "As zenhas", resumo: "Como se ganha a moeda do fut e onde ela se gasta.", camada: "no-fut" },
  { id: "o-multiplicador", titulo: "O multiplicador", resumo: "A aposta que acelera sua nota — e o prazo para armá-la.", camada: "no-fut" },
  { id: "a-recarga", titulo: "A recarga", resumo: "Comprar zenhas por Pix — como funciona e o que não tem volta.", camada: "no-fut" },
  { id: "marcar-um-fut", titulo: "Marcar um fut", resumo: "Criar, definir vagas e cuidar da lista.", camada: "organiza" },
  { id: "a-sumula", titulo: "A súmula ao vivo", resumo: "Lançar gol em campo e passar a súmula.", camada: "organiza" },
  { id: "encerrar", titulo: "Encerrar o fut", resumo: "O que trava para sempre e o que ainda dá para corrigir.", camada: "organiza" },
  { id: "os-grupos", titulo: "Os grupos", resumo: "Papéis, convites e o ranking do grupo.", camada: "organiza" },
  { id: "nota-injusta", titulo: "Nota injusta", resumo: "Como contestar e o que acontece depois.", camada: "deu-ruim" },
  { id: "apagar-um-fut", titulo: "Apagar um fut", resumo: "A votação de quem jogou.", camada: "deu-ruim" },
] as const satisfies readonly Capitulo[];

export type IdDeCapitulo = (typeof CAPITULOS)[number]["id"];

export function capitulosDaCamada(camada: IdDeCamada) {
  return CAPITULOS.filter((c) => c.camada === camada);
}

export function tituloDaCamada(camada: IdDeCamada): string {
  return CAMADAS.find((c) => c.id === camada)!.titulo;
}
