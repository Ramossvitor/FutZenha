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
  // Painel da economia. O texto é genérico porque a tela destaca o campo
  // recusado e diz ali o que ele aceita — o slug carrega o "nada foi salvo",
  // que é a parte que o admin não teria como deduzir olhando os campos.
  "ajuste-recusado": "Valor recusado — nada foi salvo. Confira o campo destacado.",

  // fut
  "poucos-jogadores": "Confirmados insuficientes para esse número de times.",
  "jogos-lancados": "Já existem jogos lançados — apague os jogos antes de re-sortear.",
  "jogo-sem-time": "Todo jogo precisa de pelo menos um jogador de cada lado.",
  "time-vazio": "Cada time precisa de pelo menos um jogador.",
  "jogador-sem-time":
    "Todo confirmado precisa de um time — quem não vai jogar, marque fora da lista.",
  "jogador-fora-da-lista": "Só quem está confirmado entra num time.",
  "artilheiro-fora-do-jogo":
    "Só quem entrou nesse jogo pode marcar gol nele. Ajuste a escalação primeiro.",
  "precisa-confirmar":
    "Enquanto a lista está aberta, quem tem conta ativa marca a própria presença. Depois do sorteio você pode incluir quem for do grupo.",
  // As duas faces da recusa. `recusou` é a tela de gestão tentando marcar
  // presença; `alvo-recusou` é a tentativa de chamar a pessoa de novo. Os dois
  // textos dizem a mesma coisa de propósito — e dizem o conserto, porque ele
  // existe e não é óbvio: quem recusou continua podendo voltar sozinha, e o
  // botão "Vou" reaparece para ela mesmo depois do sorteio.
  recusou:
    "Essa pessoa retirou o nome da lista deste fut (ou recusou o convite). Só ela pode voltar a entrar — pela página do fut, no celular dela.",
  "alvo-recusou":
    "Essa pessoa já disse que não vai a este fut. Não dá para chamá-la de novo — se ela mudar de ideia, entra sozinha pela página do fut.",
  "lista-aberta": "Isso só vale depois de fechar a lista — sorteie os times primeiro.",
  "escalacao-travada":
    "O fut já foi encerrado e a escalação não muda mais. Para corrigir, é preciso excluir o fut — o que exige votação dos jogadores.",
  "data-travada":
    "O fut já foi encerrado e a data e o horário não mudam mais — é a ordem dos futs que define o cálculo das notas. Local, vagas e observações você ainda pode ajustar.",
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
  "jogador-fora-do-jogo": "Só quem entrou nesse jogo pode trocar de lado nele.",
  "troca-ja-feita": "Alguém já trocou essa pessoa de lado — confira a escalação.",

  // Multiplicador. Os dois textos explicam o PRAZO, e não o botão, porque é o
  // prazo que a pessoa não vê: o corte é o horário de início do fut, e não o
  // encerramento — que costuma acontecer horas depois de a bola parar. Sem
  // dizer isso, "não deu" vira "o app está quebrado".
  "multiplicador-indisponivel":
    "Não deu para armar o multiplicador. Ele só vale até o horário de início do fut — depois disso, fica para o próximo.",
  "multiplicador-travado":
    "O fut já começou, então o multiplicador não sai mais. Desarmar depois de jogar seria desfazer a aposta já sabendo o resultado.",
  "sumula-indisponivel": "A súmula ao vivo só abre depois do sorteio dos times.",

  // Loja e inventário. Os três primeiros são as três recusas de `comprar`, e os
  // três dizem o que NÃO aconteceu com o saldo — porque é a primeira pergunta de
  // quem clicou em comprar e voltou para a mesma tela.
  "sem-saldo":
    "Zenha insuficiente para este item. Nada foi cobrado — o saldo sobe sozinho a cada fut apurado.",
  "ja-possui": "Você já tem esse item, e ele não foi cobrado de novo. Ele está no seu inventário.",
  "item-indisponivel":
    "Esse item não está mais à venda. Quem já comprou continua com ele — e continua exibindo.",
  // A mesma resposta para "não é seu", "não existe" e "não é do tipo certo":
  // separar os casos transformaria o formulário num oráculo do inventário alheio.
  "item-nao-e-seu": "Esse item não está no seu inventário.",
  // A vitrine tem cinco vagas e o botão já vem desabilitado quando elas acabam —
  // este slug é para as duas abas abertas que contaram quatro cada uma. Diz o
  // conserto, porque ele não é óbvio: tirar um é no mesmo lugar.
  "vitrine-cheia":
    "Sua vitrine já tem cinco badges. Tire um da vitrine para pôr este no lugar — o que sair continua no seu inventário.",

  // Recarga (compra de zenhas por Pix). Os dois dizem o que NÃO aconteceu com
  // o dinheiro — a primeira pergunta de quem tentou pagar e voltou para a tela.
  "pacote-indisponivel": "Esse pacote não está mais à venda. Nada foi cobrado — escolha outro.",
  "gateway-indisponivel":
    "O sistema de pagamento não respondeu e o Pix não foi gerado. Nada foi cobrado — tente de novo em instantes.",
  "pacote-nao-encontrado": "Esse pacote não existe mais.",

  // Cadastro da loja (painel do admin). Os três da imagem dizem o que fazer, e
  // não só o que deu errado: quem está cadastrando tem o arquivo na mão.
  "imagem-ausente": "Badge precisa de imagem — é ela que o jogador vai ostentar no perfil.",
  "imagem-invalida":
    "A imagem precisa ser PNG, JPEG ou WebP. SVG e GIF não entram: um é documento com script dentro, o outro anima.",
  "imagem-grande":
    "A imagem passou de 200 KB. Com JavaScript ligado o navegador recorta e reduz sozinho — sem ele, reduza antes de enviar.",
  "item-nao-encontrado": "Esse item não existe mais.",
  "item-com-compras":
    "Alguém já comprou esse item, então ele não pode ser apagado. Tire de venda: ele some da vitrine e continua no perfil de quem pagou.",
  "item-protegido":
    "O multiplicador é parte do jogo: o efeito dele é código. Dá para mudar preço e texto, não para apagar.",

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
  "multiplicador-armado":
    "Multiplicador armado. Ele vale neste fut e some do inventário quando o fut for encerrado.",
  "multiplicador-desarmado": "Multiplicador desarmado — ele voltou para o seu inventário.",
  // Comprar já COLOCA: badge vai para a primeira vaga livre da vitrine,
  // cosmético ocupa o slot se ele estiver vazio. O texto hedge de propósito — a
  // vitrine pode estar cheia e o slot ocupado, e nesses casos o item fica só
  // guardado. Prometer "já está no perfil" sem ressalva mentiria justamente para
  // quem tem mais itens.
  "compra-feita": "Comprado. Já entrou no seu perfil — aqui você confere e troca de ideia.",
  "item-equipado": "Pronto, ele já aparece no seu perfil.",
  "item-desequipado": "Item guardado. Ele continua seu — só saiu do perfil.",
  "item-na-vitrine": "Na vitrine. Ele já aparece no seu perfil.",
  "item-fora-da-vitrine": "Saiu da vitrine. Continua seu, guardado no inventário.",
  "destaque-definido":
    "Em destaque: é ele que anda junto do seu nome no ranking, na escalação e na lista de presença.",
  // Pacotes de recarga (painel do admin). "Vale daqui para frente" é a mesma
  // promessa da loja: o que já virou pedido está congelado.
  "pacote-criado": "Pacote criado. Ele já aparece na tela de recarga.",
  "pacote-salvo": "Pacote salvo. Vale daqui para frente — pedidos já criados não mudam.",
  "pacote-retirado": "Pacote fora de venda. Pedidos antigos continuam legíveis.",
  "pacote-republicado": "Pacote de volta à venda.",
  "item-criado": "Item criado. Ele já está na loja.",
  "item-salvo": "Item salvo. Vale daqui para frente — quem já comprou não muda.",
  "item-retirado": "Item fora de venda. Some da vitrine e continua no perfil de quem comprou.",
  "item-republicado": "Item de volta à venda.",
  "item-apagado": "Item apagado.",
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
  // Entrada no fut — os três caminhos de src/app/fut/[id]/entrada-actions.ts.
  // Os slugs genéricos ("convite-enviado", "pedido-cancelado", "pedido-aprovado",
  // "pedido-recusado", "convite-recusado", "convite-invalido") são os MESMOS dos
  // grupos e dizem a mesma coisa nos dois domínios — reusar é o certo. Os de
  // baixo existem porque a frase muda: em grupo quem decide é o administrador,
  // aqui é quem organiza, e "entrada fechada" tem motivo diferente.
  //
  // `fut-entrou` é um deles, e não o `entrou` genérico logo acima: aquele diz
  // "você está no grupo", que é a frase errada para quem acabou de entrar numa
  // LISTA. Reusar o slug daria a mensagem de outro domínio no banner.
  "fut-entrou": "Pronto, você está na lista.",
  "fut-pedido-enviado": "Pedido enviado. Quem organiza o fut decide.",
  "fut-entrada-fechada":
    "Este fut não aceita mais gente entrando: os times já foram sorteados.",
  "fut-fechado": "Este fut não aceita mais gente entrando.",
  "sem-vinculo-para-convidar":
    "Você só chama para um fut avulso quem já jogou com você. Para quem ainda não jogou, mande o link do fut.",
  "convidado-sem-conta":
    "Essa pessoa ainda não tem conta e não conseguiria responder ao convite. Cadastre e marque a presença dela pela tela de gestão.",
  "ja-esta-na-lista": "Essa pessoa já está na lista deste fut.",
  "precisa-pedir-entrada":
    "Você ainda não jogou neste fut. Peça para entrar — quem organiza decide — ou entre pelo link que ele mandar.",
  // Os tetos de src/lib/tetos-de-criacao.ts. O texto diz "hoje" e não "agora"
  // porque a janela é de 24h corridas — prometer que volta já seria mentira.
  "muitos-futs":
    "Você marcou muitos futs hoje. Espere algumas horas para marcar outro — o limite existe para o aviso e o e-mail de agenda não virarem enxurrada.",
  "muitos-grupos": "Você criou muitos grupos hoje. Espere algumas horas para criar outro.",
  "muitos-jogadores":
    "Você cadastrou muitos jogadores hoje. Espere algumas horas para cadastrar outro.",
  "ajustes-salvos": "Ajustes salvos. Valem daqui para frente — nada do que já foi pago mudou.",
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
