// Comparação de segredos em tempo constante — o mesmo cuidado que
// src/lib/auth.ts toma com a assinatura do cookie. Um `!==` vazaria o prefixo
// correto pelo tempo de resposta.
//
// Nasceu dentro de /api/cron/pendencias e virou módulo quando o webhook de
// pagamento (src/app/api/pagamentos/) precisou da mesma comparação: duas cópias
// de código de segurança é uma a mais do que dá para auditar.
//
// Sem `server-only` de propósito: a função é pura e o teste unitário a alcança.

export function segredoConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < recebido.length; i++) {
    diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}
