// Quem pode o quê. Módulo puro de propósito — sem `server-only`, sem drizzle,
// sem redirect: é a única forma de testar as regras no vitest, que aqui roda
// sem config e sem alias.
//
// A divisão é entre dois papéis de plataforma e três de grupo:
//
// - **Admin da plataforma** (`users.is_platform_admin`): contas, convites,
//   denúncias de nota injusta e supervisão de todos os futs.
// - **Admin do fut** (`match_days.created_by_player_id`): quem criou. Manda
//   naquele fut — presenças, sorteio, placar, gols, encerramento e abertura
//   da votação de exclusão — e em nenhuma outra.
// - **Admin / organizador / membro do grupo** (`group_members.role`): valem só
//   dentro do grupo, e as regras deles moram em ./grupos-permissions.
//
// O admin da plataforma é fallback em qualquer fut, inclusive nos órfãos.

export type Ator = { playerId: number; isPlatformAdmin: boolean };

/** Espelha `group_role` no schema. Fica aqui, no módulo raiz, para que
 *  ./grupos-permissions possa importar deste sem circularidade. */
export type PapelNoGrupo = "admin" | "organizer" | "member";

export type FutGerenciavel = {
  createdByPlayerId: number | null;
  /** Nulo em fut avulso — que é como tudo funcionava antes dos grupos. */
  groupId?: number | null;
};

/**
 * Quem administra este fut: o criador, o admin da plataforma e — em fut
 * de grupo — o admin daquele grupo.
 *
 * A comparação com `null` é explícita porque fut órfão (criado antes deste
 * modelo, ou de criador apagado) tem `createdByPlayerId` nulo — e uma coerção
 * distraída ali entregaria o fut para qualquer um.
 *
 * `papelNoGrupo` é o papel do ator **no grupo deste fut**. Passar o papel de
 * outro grupo entregaria o fut ao admin errado, e é por isso que quem lê o
 * papel é o guard (src/lib/require-fut-admin.ts), a partir de
 * `matchDay.groupId` — nunca de um id que veio do cliente. O default `null`
 * mantém honesto todo call site que não tem grupo em mãos.
 *
 * O organizador que **não** criou o fut fica de fora de propósito: o poder
 * dele é criar (e, ao criar, ele vira o criador). Se gerenciasse o fut dos
 * outros organizadores, mexeria em placar, gols e escalação alheios — e o V/E/D
 * e a artilharia de quem jogou saem justamente daí.
 *
 * O admin do grupo entra porque o grupo precisa de um fallback próprio: sem
 * ele, fut de organizador que saiu do grupo só seria destravada pelo admin
 * da plataforma, que não escala num modelo com muitos grupos.
 */
export function podeGerenciarFut(
  ator: Ator,
  fut: FutGerenciavel,
  papelNoGrupo: PapelNoGrupo | null = null,
): boolean {
  if (ator.isPlatformAdmin) return true;
  if (fut.createdByPlayerId !== null && fut.createdByPlayerId === ator.playerId) return true;
  // O teste de `groupId` não é redundante: papel só existe dentro de grupo, e um
  // papel herdado de outra leitura entregaria fut avulso ao admin de um
  // grupo qualquer.
  return fut.groupId != null && papelNoGrupo === "admin";
}

/**
 * Por quem o admin do fut pode marcar presença (e a quem pode pôr em jogo).
 *
 * O override existe para quem **não consegue se marcar**: o jogador cadastrado
 * que ainda não resgatou o convite, ou que teve a conta desativada. Esse caso
 * continua livre — é o que o README descreve como "cadastrar quem chegou de
 * última hora".
 *
 * Quem tem conta ativa é outra história desde que qualquer jogador logado cria
 * fut. Sem esta regra, alguém marcava um fut, escalava meia dúzia de
 * gente com conta que nunca ouviu falar do jogo, encerrava, e a presença e o
 * V/E/D dessas pessoas mudavam — os rankings só contam quem tem conta ativa
 * (ver src/lib/stats.ts), então o estrago cai justamente sobre elas. Uma vez
 * que a pessoa entrou no fut por conta própria, o organizador volta a mandar:
 * é ele quem corrige presença depois do sorteio.
 *
 * **A exceção da lista fechada.** Fechar a lista é sortear os times, e daí em
 * diante o organizador não monta mais lista: ele registra quem apareceu na
 * quadra. Alguém que não confirmou aparece toda semana, e sem esta exceção o
 * organizador ficaria esperando a pessoa abrir o celular no meio do jogo. Então,
 * com a lista fechada, ele inclui quem for **elegível** — membro do grupo, ou
 * jogador ativo se o fut for avulso (ver src/lib/elegiveis.ts).
 *
 * Três coisas seguram o afrouxamento, e nenhuma é dispensável:
 *
 * 1. só vale **depois** do sorteio, quando já existe fut acontecendo — antes
 *    dele, a lista continua sendo auto-servível;
 * 2. o alvo precisa ser **elegível**, então o alcance de um fut de grupo é o
 *    grupo, e não a plataforma inteira;
 * 3. quem é incluído **recebe notificação** e vê em qual fut — quem chama é
 *    que garante isso (ver definirPresenca).
 *
 * Continua sem parâmetro de papel de grupo, e continua de propósito: ser membro
 * não é consentimento para ser escalado num fut que ainda vai acontecer.
 * `elegivel` aqui é um piso, nunca uma autorização por si só.
 *
 * **`ehDeGrupo` é a quarta condição, e ela não estava aqui.** A frase acima —
 * "o alcance de um fut de grupo é o grupo" — descrevia metade da verdade: em
 * fut AVULSO, `condicaoElegivel` não filtra nada (src/lib/elegiveis.ts devolve
 * `undefined`, que o `and()` do drizzle descarta em silêncio), então "elegível"
 * ali quer dizer *todo jogador ativo da plataforma*. O degrau que segurava o
 * afrouxamento não segurava nada no caminho mais fácil de alcançar: qualquer
 * pessoa logada cria um fut avulso, sorteia com dois convidados de mentira e
 * passa a poder marcar presença de quem quiser — o que dispara notificação,
 * push e um e-mail de calendário com texto livre dela para a caixa da vítima.
 *
 * Num fut de grupo o degrau continua valendo, porque ali "elegível" significa
 * mesmo alguma coisa: entrar no grupo FOI o consentimento. Num fut avulso não
 * há consentimento nenhum a invocar, e por isso a exceção some — quem tem conta
 * se marca sozinho, e quem não tem continua sendo marcado pelo organizador
 * (esse é o ramo de cima, e é o caso que a exceção existe para servir).
 *
 * O admin da plataforma passa por cima — ele é o fallback de todo fut, e é
 * quem conserta fut órfão e fut abandonado.
 *
 * **`recusou` vem antes de tudo, inclusive do admin da plataforma.** Todas as
 * regras acima decidem quem pode PÔR alguém numa lista; esta decide quando não
 * há mais o que decidir, porque a pessoa já respondeu. Ela cobre as duas formas
 * de dizer não que o app tem — recusar o convite do fut (`declined` em
 * match_day_invitations) e tirar o próprio nome da lista (`opted_out_at`) —, e
 * quem junta as duas num booleano é `situacaoDoAlvo`, em ./presenca.
 *
 * Sem ela o contrapeso da exceção da lista fechada não fechava o ciclo: o item 3
 * ali em cima promete que quem é incluído recebe notificação, mas notificar não
 * serve de nada se a única reação possível — sair — puder ser desfeita pelo
 * mesmo organizador, quantas vezes ele quiser. `jaEstaNoFut` devolvia `true`
 * para quem tem linha `out`, então sair da lista era o que MAIS liberava o
 * organizador a repor.
 *
 * O admin da plataforma entra na regra, e é a única coisa neste módulo que ele
 * não atravessa. O fallback dele existe para consertar fut órfão e fut
 * abandonado — coisas que ninguém mais pode consertar. Desfazer o "não" de uma
 * pessoa não é conserto, e é justamente o que ninguém mais deveria poder fazer.
 * Quem quiser voltar volta sozinho: a própria pessoa nunca é barrada, porque
 * `avaliarMarcacao` decide antes disto quando ator e alvo são o mesmo.
 */
export function podeDefinirPresencaPor(
  ator: Ator,
  alvo: { temContaAtiva: boolean; jaEstaNoFut: boolean; elegivel: boolean; recusou: boolean },
  fut: { listaFechada: boolean; ehDeGrupo: boolean },
): boolean {
  if (alvo.recusou) return false;
  if (ator.isPlatformAdmin) return true;
  if (!alvo.temContaAtiva || alvo.jaEstaNoFut) return true;
  return fut.ehDeGrupo && fut.listaFechada && alvo.elegivel;
}

/**
 * Quem opera a súmula ao vivo (/fut/[id]/sumula): quem gerencia o fut, ou quem
 * recebeu a súmula por delegação ("passar a súmula", tabela sumula_operadores).
 *
 * `ehDelegado` chega resolvido de fora — este módulo é puro e não consulta a
 * tabela; quem lê é o guard (src/lib/require-operador-sumula.ts), pelo par
 * (matchDayId, playerId) da sessão, nunca por id vindo do cliente.
 *
 * A delegação dá SÓ a súmula — mas a súmula inteira: o delegado abre e
 * finaliza jogos (iniciarJogo/finalizarJogo), lança gol e desfaz o lançamento
 * mais recente de cada lado. Vale registrar que abrir jogo tira o snapshot da
 * escalação, que é a fonte do V/E/D e do universo de avaliação — por isso o
 * texto do painel diz isso a quem concede, e não só "lança gol".
 *
 * O que NÃO vem junto é o /gerenciar: presenças, sorteio, edição irrestrita de
 * placar e gols, delegar a súmula adiante e encerrar o fut continuam atrás de
 * `podeGerenciarFut`.
 */
export function podeOperarSumula(
  ator: Ator,
  fut: FutGerenciavel,
  papelNoGrupo: PapelNoGrupo | null = null,
  ehDelegado = false,
): boolean {
  return ehDelegado || podeGerenciarFut(ator, fut, papelNoGrupo);
}

// Não existe aqui um `podeGerarConvite`, e é de propósito. A regra — convite
// para quem já tem conta é reset de senha, logo é da plataforma e só dela — não
// tem onde ser avaliada: `createInvite` é exclusiva do admin da plataforma
// (src/app/(esqueleto)/admin/(panel)/jogadores/actions.ts) e `convidarParaFut` só cria
// jogador novo, que por definição não tem conta. Uma função que ninguém chama
// não é regra, é comentário que o leitor confunde com trava.

/**
 * Denúncia de nota injusta é da plataforma — e de quem ficou de fora da rodada.
 *
 * As duas condições existem pelo mesmo motivo. O julgador precisa não ser parte
 * da rodada: quem jogou saberia, ao ver "Fulano contesta uma nota 1★", que a
 * denúncia é contra a estrela que ele mesmo deu — e o anonimato do avaliador,
 * que src/lib/anonimato.ts protege com tanto cuidado, cairia pelo lado do
 * julgador. Some-se a isso que aceitar uma denúncia dispara `aplicarReplay`,
 * que recalcula a nota de todo mundo: é decisão de plataforma, não de fut.
 *
 * Ser admin da plataforma não dispensa a segunda condição. O admin é jogador
 * como qualquer outro (ver src/db/schema.ts), então joga, recebe nota e pode
 * denunciar; sem este `&&` bastaria denunciar a própria nota para abrir, em
 * /admin/avaliacoes, a lista de quem lhe deu cada estrela.
 */
export function podeJulgarDenuncia(
  ator: Ator,
  denuncia: { julgadorJogouARodada: boolean },
): boolean {
  return ator.isPlatformAdmin && !denuncia.julgadorJogouARodada;
}
