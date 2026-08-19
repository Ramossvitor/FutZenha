// Mensagens dos slugs que as Server Actions devolvem em `?erro=` e `?ok=`.
//
// Antes isto era um `const errorMessages` copiado em 11 páginas, e o modo de
// falha era silencioso: uma action passava a emitir um slug novo, a página não
// tinha a entrada, `errorMessages[slug]` saía `undefined` e o banner
// simplesmente não aparecia — sem erro, sem log, sem nada. O usuário clicava,
// nada acontecia e a tela não explicava por quê.
//
// Agora o dicionário é um só e há um teste que varre as actions e cobra que
// todo slug emitido tenha mensagem aqui (ou em ERROS_LOGIN). Página que quiser
// um texto mais específico passa `locais` para o resolverMensagem — o global
// continua sendo a rede de segurança.
//
// Os erros do OAuth ficam em erros-login.ts, de propósito: são de outro domínio
// (o callback do Google, não uma action), têm lógica própria de e-mail
// mascarado, e o mesmo slug quer dizer coisas diferentes nos dois lugares —
// "convite-invalido" aqui é convite de grupo, lá é convite de conta.
//
// Os prazos vêm interpolados das constantes, e não escritos à mão: estas
// mensagens são a outra metade dos banners de src/app/fut/[id]/gerenciar e do
// que a página /guia promete ao jogador. Um número cravado aqui mentiria no dia
// em que o prazo mudasse — e mentiria justamente na tela de quem acabou de
// esbarrar no prazo.

import { JANELA_CORRECAO_HORAS } from "./regras";
import { PRAZO_ABERTURA_EXCLUSAO_HORAS } from "./votacao";

export const MENSAGENS: Record<string, string> = {
  // ----- erros -----
  "dados-invalidos": "Dados inválidos — confira os campos.",
  "sem-permissao": "Você não pode fazer isso.",
  "sem-permissao-no-grupo":
    "Você não pode marcar fut nesse grupo — só o administrador e os organizadores.",
  "nome-duplicado": "Já existe um jogador com esse nome.",
  "email-invalido": "E-mail inválido — confira o endereço da conta Google.",
  // Separado do de cima de propósito: são dois campos com propósitos opostos —
  // um é a conta Google que resgata o convite, o outro é só onde a pessoa
  // recebe aviso. Reaproveitar o texto reataria justamente a confusão.
  "email-contato-invalido": "E-mail de contato inválido — confira o endereço.",
  "auto-rebaixamento":
    "Você não pode tirar o próprio papel de admin da plataforma — peça a outro admin.",

  // fut
  "poucos-jogadores": "Confirmados insuficientes para esse número de times.",
  "jogos-lancados": "Já existem jogos lançados — apague os jogos antes de re-sortear.",
  "jogo-sem-time": "Todo jogo precisa de pelo menos um jogador de cada lado.",
  "artilheiro-fora-do-jogo":
    "Só quem entrou nesse jogo pode marcar gol nele. Ajuste a escalação primeiro.",
  "precisa-confirmar":
    "Enquanto a lista está aberta, quem tem conta ativa marca a própria presença. Depois do sorteio você pode incluir quem for do grupo.",
  "lista-aberta": "Isso só vale depois de fechar a lista — sorteie os times primeiro.",
  "escalacao-travada":
    "O fut já foi encerrado e a escalação não muda mais. Para corrigir, é preciso excluir o fut — o que exige votação dos jogadores.",
  "janela-encerrada": `As ${JANELA_CORRECAO_HORAS}h para corrigir placar e gols já passaram. Para alterar, é preciso excluir o fut — o que exige votação dos jogadores.`,
  "precisa-votacao":
    "Fut encerrado não se apaga direto — abra a votação de exclusão para o grupo decidir.",
  "motivo-curto": "Escreva o motivo com pelo menos 10 caracteres.",
  "exclusao-prazo-encerrado": `O prazo para pedir a exclusão deste fut já passou — ele vale até ${PRAZO_ABERTURA_EXCLUSAO_HORAS} horas depois do fim do prazo de contestação das notas.`,

  // súmula ao vivo
  "ja-tem-jogo-aberto":
    "Já existe um jogo em andamento — finalize a súmula dele antes de iniciar outro.",
  "jogo-nao-esta-aberto": "Esse jogo não está mais em andamento.",
  "desfazer-indisponivel":
    "Só dá para desfazer o último lançamento de cada lado enquanto o jogo está em andamento. Fale com quem organiza o fut.",
  "jogo-em-andamento":
    "Há um jogo com súmula em andamento — finalize-o antes de encerrar o fut.",
  "operador-invalido":
    "Só quem está na lista deste fut e tem conta ativa pode receber a súmula.",
  "fut-encerrado": "Este fut já foi encerrado — a súmula ao vivo não está mais disponível.",
  "sumula-indisponivel": "A súmula ao vivo só abre depois do sorteio dos times.",

  // grupo
  "entrada-fechada": "Este grupo não está aceitando entradas agora.",
  "admin-precisa-transferir":
    "Você administra o grupo. Transfira a administração para outra pessoa antes de sair.",
  "sem-conta": "Esse jogador ainda não tem conta — convide-o por um fut primeiro.",
  "ja-membro": "Essa pessoa já está no grupo.",
  "alvo-nao-e-membro": "Só dá para transferir para alguém que já está no grupo.",
  "alvo-ja-e-admin": "Essa pessoa já administra o grupo.",
  "alvo-sem-conta":
    "Essa pessoa não tem conta ativa. Quem administra precisa conseguir entrar — senão o grupo fica sem ninguém no comando.",
  "nao-e-o-admin": "Só quem administra o grupo transfere a administração.",
  "transferencia-para-si": "Você já administra o grupo.",
  "confirmacao-nao-confere": "O nome digitado não confere com o do grupo.",
  "convite-invalido": "Esse convite não está mais disponível.",
  "link-invalido":
    "Esse link do grupo não vale mais — ele expirou, foi revogado ou já bateu o limite de usos. Peça um novo a quem administra o grupo.",

  // convite por email (ver src/lib/email-convite.ts)
  "email-nao-enviado":
    "O convite está criado, mas o e-mail não saiu. Copie o link e mande no WhatsApp.",
  "email-limite":
    "Limite diário de e-mails atingido. Copie o link e mande no WhatsApp — amanhã o envio volta.",
  "email-limite-do-convidante":
    "Você já enviou muitos convites por e-mail nas últimas 24 horas. Copie o link e mande no WhatsApp — o envio volta conforme o dia corre.",
  "email-rajada":
    "Muitos e-mails saíram num intervalo curto. Espere alguns segundos e tente de novo — ou copie o link e mande no WhatsApp.",
  "email-recente":
    "Esse convite já saiu por e-mail há pouco. Espere alguns minutos ou copie o link e mande no WhatsApp.",
  "convite-nao-reenviavel":
    "Esse convite não está mais pendente ou não tem e-mail. Gere um convite novo.",

  // ----- confirmações -----
  entrou: "Pronto, você está no grupo.",
  saiu: "Você saiu do grupo.",
  "pedido-enviado": "Pedido enviado. O administrador vai decidir.",
  "pedido-cancelado": "Pedido cancelado.",
  "pedido-aprovado": "Pedido aprovado.",
  "pedido-recusado": "Pedido recusado.",
  "convite-enviado": "Convite enviado.",
  "convite-enviado-por-email": "Convite enviado por e-mail.",
  "convite-revogado": "Convite revogado.",
  "convite-recusado": "Convite recusado.",
  "grupo-atualizado": "Grupo atualizado.",
  "grupo-excluido": "Grupo excluído.",
  "papel-alterado": "Papel alterado.",
  "administracao-transferida": "Administração transferida.",
  "membro-removido":
    "Membro removido. O link do grupo foi revogado junto — gere outro para continuar convidando.",
  "link-gerado": "Link novo gerado — o anterior deixou de valer.",
  "link-revogado": "Link revogado.",
  // Salvou, mas o aviso de agenda ficou retido pelo freio de
  // src/lib/agenda-freio.ts. Dizer isso é o ponto: quem administra precisa saber
  // que a agenda de quem confirmou está com o dado anterior.
  "salvo-sem-avisar":
    "Salvo. O aviso na agenda de quem confirmou não saiu: o limite de atualizações de hoje foi atingido — a agenda deles fica com o dado anterior até amanhã.",
  excluido: "Fut excluído. As notas de todo mundo foram recalculadas do zero.",
  "excluido-sem-votacao":
    "Fut apagado direto: ninguém com conta jogou, então não havia quem votasse. As notas foram recalculadas.",
};

/**
 * A mensagem de um slug vindo da query string.
 *
 * `locais` tem prioridade sobre o dicionário global — é como uma página diz
 * "aqui `dados-invalidos` quer dizer *confira data e local*", sem que o slug
 * genérico deixe de ter cobertura em todas as outras.
 *
 * O parâmetro chega como `string | string[] | undefined` porque é isso que o
 * `searchParams` do Next entrega; qualquer coisa que não seja string vira null.
 *
 * O `Object.hasOwn` não é preciosismo: o slug vem da query string e os dois
 * dicionários são object literals, então `MENSAGENS["toString"]` devolve a
 * função do Object.prototype. Com indexação crua, `?erro=toString` fazia esta
 * função devolver uma função — o `??` não pega, o tipo de retorno mente, e o
 * Banner tenta renderizar isso dentro de um Server Component, o que estoura a
 * serialização e derruba a página inteira.
 */
export function resolverMensagem(
  slug: string | string[] | undefined,
  locais?: Record<string, string>,
): string | null {
  if (typeof slug !== "string") return null;
  if (locais && Object.hasOwn(locais, slug)) return locais[slug];
  return Object.hasOwn(MENSAGENS, slug) ? MENSAGENS[slug] : null;
}
