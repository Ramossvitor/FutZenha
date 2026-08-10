// Captura dos efeitos de after() nos testes de integração.
//
// O mock de next/server (setup-integration.ts) roda o callback inline e
// registra a promessa aqui. A action não espera por ela — como no Next real —,
// então um teste que depende do efeito consumado (ex.: o aviso de grupo por
// email) chama flushAfter() antes de asserir.

const pendentes: Promise<unknown>[] = [];

export function registrarAfter(promessa: Promise<unknown>): void {
  pendentes.push(promessa);
}

/**
 * Espera todos os after() capturados até aqui. `allSettled` de propósito:
 * como no Next real, erro dentro do after() não derruba ninguém — o teste
 * asserta o efeito (ou a ausência dele), não a promessa.
 *
 * O beforeEach do setup também chama, antes de truncar: soltar a referência sem
 * esperar deixaria a escrita de um after() esquecido correndo contra o truncate
 * do teste seguinte — e os tetos de e-mail contam linhas da instalação inteira,
 * então uma linha vazada move as asserções de borda (89/90, 39/40).
 */
export async function flushAfter(): Promise<void> {
  const lote = pendentes.splice(0);
  await Promise.allSettled(lote);
}
