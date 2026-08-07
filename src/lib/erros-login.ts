// Mensagens dos erros que o callback do OAuth devolve na query string.
//
// Vivem num módulo próprio porque quem escreve o código do erro (o route
// handler) e quem o exibe (/login e /perfil) são arquivos diferentes — e um
// código sem mensagem correspondente vira tela em branco no pior momento.

export const ERROS_LOGIN: Record<string, string> = {
  "google-indisponivel": "O login pelo Google não está configurado neste ambiente.",
  "sessao-expirada": "O pedido demorou demais e expirou. Tente entrar de novo.",
  "state-invalido": "Não foi possível validar o pedido. Tente entrar de novo.",
  cancelado: "Login pelo Google cancelado.",
  "troca-falhou": "O Google não confirmou o login. Tente de novo.",
  "email-nao-verificado": "O e-mail dessa conta Google não está verificado.",
  "sem-convite": "Você ainda não tem conta aqui. Peça um convite a quem organiza a pelada.",
  "convite-invalido": "Convite inválido ou expirado. Fala com o admin para gerar outro.",
  "convite-sem-email":
    "Esse convite é do tipo antigo, de usuário e senha. Abra o link do convite e crie sua conta por lá.",
  "email-nao-confere": "Esse convite é para outra conta Google.",
  "jogador-inativo": "Jogador inativo — fala com o admin.",
  "conta-inativa": "Sua conta está desativada. Fala com o admin.",
  "google-ja-vinculado": "Essa conta Google já está vinculada a outro jogador.",
  "erro-inesperado": "Algo deu errado do nosso lado. Tente de novo em instantes.",
};

// O `esperado` chega pela query string, então qualquer um pode escolher o que
// vai aparecer dentro da nossa caixa de erro, no nosso domínio — terreno bom
// para um "ligue para 0800…". Ele só é emitido pelo mascararEmail, e é essa
// forma, e só ela, que aceitamos de volta.
const ESPERADO_MASCARADO = /^.{0,2}•••@[^\s@]{1,80}$/;

/**
 * A mensagem, já com o e-mail esperado quando o erro carrega um.
 *
 * O `Object.hasOwn` é o mesmo cuidado do resolverMensagem: `erro` vem da query
 * string e `ERROS_LOGIN` é um object literal, então `?erro=toString` devolvia a
 * função do Object.prototype — truthy, escapava do `if` e ia parar dentro do
 * Banner, que é Server Component e estoura ao serializar.
 */
export function mensagemDeErro(
  erro: string | string[] | undefined,
  esperado?: string | string[],
): string | null {
  if (typeof erro !== "string") return null;
  if (!Object.hasOwn(ERROS_LOGIN, erro)) return null;
  const mensagem = ERROS_LOGIN[erro];
  if (
    erro === "email-nao-confere" &&
    typeof esperado === "string" &&
    ESPERADO_MASCARADO.test(esperado)
  ) {
    return `Esse convite é para ${esperado}. Entre com essa conta Google.`;
  }
  return mensagem;
}
