// Comparação de e-mail entre dois lados que não escrevem igual: o admin digita
// o endereço no formulário de convite, e o Google devolve o da conta.
//
// Módulo puro — sem `server-only` e sem drizzle — porque o vitest aqui roda sem
// config e sem alias.

// No Gmail, ponto no local part não existe: `vitor.ramos@` e `vitorramos@` são a
// mesma caixa, e o `+tag` é a mesma caixa com etiqueta. Fora do Gmail isso não
// vale — há provedor em que o ponto distingue duas pessoas —, então a regra é
// deliberadamente estreita.
const DOMINIOS_COM_PONTO_IGNORADO = new Set(["gmail.com", "googlemail.com"]);

/**
 * A forma canônica, só para **comparar**. O que é gravado continua sendo o
 * endereço como veio — do formulário ou do Google —, porque é o que a pessoa
 * reconhece na tela e o que a unique de `users.email` protege.
 *
 * Sem isto, um convite para "vitor.ramos@gmail.com" nunca casaria com a conta
 * "vitorramos@gmail.com", e a mensagem de erro esconde justamente a parte que
 * difere (ver `mascararEmail`) — quem convidou e quem foi convidado ficariam
 * sem saber o que houve.
 */
export function canonicalizarEmail(email: string): string {
  const normalizado = email.trim().toLowerCase();
  const arroba = normalizado.lastIndexOf("@");
  if (arroba <= 0) return normalizado;

  const local = normalizado.slice(0, arroba);
  const dominio = normalizado.slice(arroba + 1);
  if (!DOMINIOS_COM_PONTO_IGNORADO.has(dominio)) return normalizado;

  const semTag = local.split("+")[0].replaceAll(".", "");
  // Um local part que era só pontos e etiqueta não sobrou nada: devolver ""
  // faria endereços diferentes colidirem, que é o oposto do propósito daqui.
  return semTag === "" ? normalizado : `${semTag}@${dominio}`;
}

/** Os dois endereços chegam na mesma caixa? */
export function mesmoEmail(a: string, b: string): boolean {
  return canonicalizarEmail(a) === canonicalizarEmail(b);
}
