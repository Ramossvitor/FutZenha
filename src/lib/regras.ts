// Os números das regras do produto que não tinham um lar puro.
//
// Dois problemas convergiram aqui. O primeiro é a duplicação: os 7 dias de
// validade viviam copiados em três arquivos (convites.ts, grupos.ts e
// db/migrate.ts), cada um com um comentário explicando que a cópia era
// proposital porque o vizinho é `server-only` e o migrate roda sob tsx, fora do
// Next. O segundo é a página /guia, que explica essas regras ao jogador: um guia
// que escreve "36 horas" à mão mente no dia em que o prazo muda.
//
// Sendo puro — sem banco, sem `server-only` — este módulo serve aos três
// importadores e à página de texto, sem arrastar drizzle junto.
//
// O que NÃO está aqui continua onde sempre esteve, porque aqueles módulos já são
// puros e já são importáveis: a escala da nota em skill.ts, o quórum e os prazos
// da votação em votacao.ts, o piso do MVP em mvp.ts, o mínimo do lado em
// lineup.ts.
//
// Prazos viram timestamp ABSOLUTO na criação de cada rodada, denúncia ou
// votação — mudar um valor aqui não mexe no que já está em curso.

/** Encerrar o fut → avaliar os companheiros. */
export const PRAZO_AVALIACAO_HORAS = 36;

/** Apurar a rodada → contestar uma nota injusta. */
export const PRAZO_DENUNCIA_HORAS = 24;

/** Contestar → quem administra responder. O silêncio aceita a contestação. */
export const PRAZO_ADMIN_HORAS = 48;

/**
 * Contestar só faz sentido a partir daqui: com uma única avaliação recebida,
 * reportar seria apontar o dedo para uma pessoa óbvia.
 */
export const MIN_AVALIACOES_PARA_DENUNCIAR = 2;

/**
 * Encerrar o fut → corrigir placar e gols.
 *
 * A escalação não entra: ela define quem avalia quem e é imutável desde o
 * encerramento. Placar e gols não mexem nisso, então ganham esta janela.
 */
export const JANELA_CORRECAO_HORAS = 24;

/**
 * Validade do convite de conta e do link de convite de grupo.
 *
 * O link corre num grupo de WhatsApp, e uma semana é o que separa "o pessoal
 * ainda está entrando" de "isso vazou faz tempo".
 */
export const VALIDADE_CONVITE_DIAS = 7;

/** A mesma validade em milissegundos, que é como o código de convite conta. */
export const VALIDADE_CONVITE_MS = 1000 * 60 * 60 * 24 * VALIDADE_CONVITE_DIAS;

/** Quantos jogos alguém precisa ter para entrar no ranking de aproveitamento. */
export const MIN_JOGOS_APROVEITAMENTO = 3;

/** Times que o sorteio aceita montar. */
export const TIMES_MIN = 2;
export const TIMES_MAX = 6;

/**
 * O piso da senha, e o teto.
 *
 * Dez, e não os seis de antes. O login não tem tranca durável — o freio de
 * src/lib/freio-de-login.ts é por instância e assumidamente uma otimização —,
 * então o comprimento é a única barreira que não depende de onde a requisição
 * caiu. Seis caracteres são adivinháveis por dicionário; dez tiram a força
 * bruta da mesa sem exigir símbolo nem maiúscula, que é o tipo de regra que
 * empurra gente para o post-it. O teto não é de segurança, é de custo: o scrypt
 * processa o que receber.
 *
 * Moram AQUI, e não junto do `senhaSchema` em src/lib/password.ts, por um
 * motivo mecânico: os dois formulários de senha são Client Components, e
 * `password.ts` importa `node:crypto`. Um `minLength={MIN_SENHA}` que viesse de
 * lá arrastaria o módulo inteiro para o bundle do cliente. O schema fica lá, o
 * número fica aqui, e as quatro cópias de "6" nos formulários deixam de existir.
 */
export const MIN_SENHA = 10;
export const MAX_SENHA = 100;
