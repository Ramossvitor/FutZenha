// Fakes de next/navigation para os testes de integração: no Next real,
// redirect() e notFound() lançam erros especiais que o framework captura. Aqui
// eles lançam erros próprios, e os helpers abaixo transformam "lançou o erro
// certo" em assert legível.

export class RedirectError extends Error {
  readonly url: string;
  readonly digest: string;

  constructor(url: string, tipo: "replace" | "push" = "replace") {
    super(`NEXT_REDIRECT: ${url}`);
    this.name = "RedirectError";
    this.url = url;
    this.digest = `NEXT_REDIRECT;${tipo};${url};307;`;
  }
}

export class NotFoundError extends Error {
  readonly digest = "NEXT_HTTP_ERROR_FALLBACK;404";

  constructor() {
    super("NEXT_HTTP_ERROR_FALLBACK;404");
    this.name = "NotFoundError";
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function permanentRedirect(url: string): never {
  throw new RedirectError(url);
}

export function notFound(): never {
  throw new NotFoundError();
}

/**
 * Roda a ação e devolve a URL do redirect que ela lançou. Falha se a ação
 * terminar sem redirecionar ou lançar qualquer outra coisa.
 */
export async function esperaRedirect(acao: Promise<unknown> | (() => Promise<unknown>)): Promise<string> {
  try {
    await (typeof acao === "function" ? acao() : acao);
  } catch (erro) {
    if (erro instanceof RedirectError) return erro.url;
    throw erro;
  }
  throw new Error("Esperava um redirect, mas a ação terminou sem redirecionar.");
}

/** Igual ao esperaRedirect, para ações que devem cair no notFound(). */
export async function esperaNotFound(acao: Promise<unknown> | (() => Promise<unknown>)): Promise<void> {
  try {
    await (typeof acao === "function" ? acao() : acao);
  } catch (erro) {
    if (erro instanceof NotFoundError) return;
    throw erro;
  }
  throw new Error("Esperava notFound(), mas a ação terminou normalmente.");
}
