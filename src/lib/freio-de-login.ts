// Freio de força bruta no login, por instância e em memória.
//
// **É otimização, não garantia** — o mesmo contrato do throttle de
// `agendarProcessamento` (src/lib/pendencias.ts). Serverless não compartilha
// memória: cada instância conta as próprias tentativas, e quem cair em
// instâncias diferentes multiplica o teto pelo número delas. A defesa de
// verdade é da plataforma (Vercel Firewall), que custa R$ 0 e não é código.
//
// O que este módulo garante é mais modesto e mais concreto: acima do teto, a
// instância para de **pagar o scrypt**. Cada verificação custa 50–100 ms de CPU
// de uma função cobrada por tempo, então recusar antes da senha é o que impede
// uma rajada de virar indisponibilidade. Guardar o teto num banco seria o
// estado compartilhado que o README recusa — e criaria um problema pior, porque
// um contador durável vira tranca durável.
//
// A chave é o **username**, e isso é uma escolha:
//
// - Não é o IP. Num app de um grupo de amigos, meia dúzia de pessoas divide a
//   saída do mesmo escritório ou do mesmo CGNAT de operadora — travar por IP
//   derrubaria o grupo inteiro por causa de uma pessoa que errou a senha.
// - Sendo o username, um atacante consegue segurar UMA conta pela janela (60 s)
//   gastando 10 tentativas. É trade aceito: o teto está muito acima do erro
//   humano, a espera é curta, e a alternativa — não ter freio — deixa quem
//   quiser martelar o username do admin (que o .env.example já publicou num
//   repositório público) sem custo nenhum para o atacante e com custo integral
//   para nós.
//
// Módulo puro (sem `server-only`, sem drizzle) para o vitest alcançar a janela.

/** Falhas toleradas por username dentro da janela. Muito acima do erro humano. */
export const TENTATIVAS_POR_JANELA = 10;

/** O tamanho da janela. Curta de propósito: ela também é o tempo de espera. */
export const JANELA_MS = 60_000;

/**
 * Teto de usernames vigiados ao mesmo tempo. Sem ele, martelar nomes aleatórios
 * faria o Map crescer sem fim — trocaria um problema de CPU por um de memória.
 */
export const MAX_CHAVES = 5_000;

/** Os instantes das falhas recentes de uma chave, do mais antigo ao mais novo. */
const falhas = new Map<string, number[]>();

/**
 * Janela DESLIZANTE, não fixa. Guardar só um contador e o instante de início
 * seria mais barato, mas deixaria passar o dobro do teto na virada — 10 falhas
 * no fim de uma janela e 10 no começo da seguinte, em segundos. Como o teto é
 * de 10, a lista nunca passa de 10 números por chave, e o custo de manter os
 * instantes é irrisório perto do que ela evita.
 */
function recentes(chave: string, agora: number): number[] {
  const registro = falhas.get(chave);
  if (!registro) return [];
  return registro.filter((quando) => agora - quando < JANELA_MS);
}

/**
 * Esta tentativa pode pagar o scrypt?
 *
 * Quem chama devolve o MESMO erro genérico do login quando isto é `false` — o
 * bloqueio não pode virar um oráculo de quais usuários existem, que é
 * exatamente o que o DUMMY_HASH de src/lib/password.ts protege.
 */
export function permitirTentativaDeLogin(chave: string, agora = Date.now()): boolean {
  return recentes(chave, agora).length < TENTATIVAS_POR_JANELA;
}

/**
 * Registra uma falha desta chave. Só falha — acerto não conta.
 *
 * A lista é cortada no teto porque nada além dele é lido: guardar mais só
 * cresceria a memória de quem está sob ataque. Hoje quem chama já para de
 * registrar depois do bloqueio, mas o corte não pode depender disso — um call
 * site novo que registrasse sem consultar antes voltaria a crescer sem fim.
 */
export function registrarFalhaDeLogin(chave: string, agora = Date.now()): void {
  const lista = recentes(chave, agora);
  lista.push(agora);
  falhas.set(chave, lista.slice(-TENTATIVAS_POR_JANELA));
  if (falhas.size > MAX_CHAVES) podar(agora);
}

/**
 * Login deu certo: a chave sai do radar na hora.
 *
 * Sem isto, quem erra nove vezes e acerta na décima continuaria a um passo do
 * bloqueio pelo resto da janela — e o freio existe contra quem não acerta.
 */
export function esquecerFalhasDeLogin(chave: string): void {
  falhas.delete(chave);
}

/**
 * Tira do Map o que já venceu; se ainda assim estourar o teto, esvazia tudo.
 *
 * Esvaziar é aceitável porque isto é um freio, não um livro-caixa: perder a
 * contagem só faz a janela recomeçar, e a alternativa (uma fila ordenada para
 * despejar exatamente as mais antigas) é estrutura demais para um Map que só
 * cresce sob ataque — e sob ataque o que importa é não estourar a memória.
 */
function podar(agora: number): void {
  for (const [chave, registro] of falhas) {
    if (registro.every((quando) => agora - quando >= JANELA_MS)) falhas.delete(chave);
  }
  if (falhas.size > MAX_CHAVES) falhas.clear();
}

/** Só para teste: zera o freio entre casos. Espelha reiniciarThrottleDePush. */
export function reiniciarFreioDeLogin(): void {
  falhas.clear();
}
