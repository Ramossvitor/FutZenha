// Como se entra num fut — as regras, sem banco.
//
// Módulo puro (sem `server-only`, sem drizzle), pelo mesmo motivo de
// ./permissions e ./grupos-permissions: são as decisões que mais merecem teste,
// e o vitest unit roda sem config e sem alias. Quem resolve os fatos é
// src/lib/fut-entrada-db.ts; quem autoriza a chamada é a action.
//
// ---------------------------------------------------------------------------
// O princípio
// ---------------------------------------------------------------------------
//
// **Ninguém entra numa lista por decisão de outra pessoa.** Antes disto, num fut
// avulso, quem criasse o fut podia marcar presença de qualquer jogador ativo da
// plataforma — e presença marcada dispara notificação, push e um e-mail de
// calendário com 500 caracteres de texto livre do organizador (as `notes` viram
// a DESCRIPTION do .ics) para a caixa da pessoa. O alcance era a plataforma
// inteira porque `condicaoElegivel` não filtra nada em fut sem grupo.
//
// O que substituiu a exceção são três caminhos, cada um com um decisor claro:
//
// | caminho | quem começa        | quem decide     |
// |---------|--------------------|-----------------|
// | convite | quem já jogou com você | VOCÊ        |
// | pedido  | você                | quem organiza  |
// | link    | quem organiza       | você, ao abrir |
//
// A exceção continua valendo para quem **não tem conta**: o convidado que chegou
// na hora não consegue se marcar sozinho, não tem caixa de entrada para ser
// incomodada, e é o caso para o qual ela foi escrita (ver podeDefinirPresencaPor
// em ./permissions).
//
// ---------------------------------------------------------------------------
// A outra metade: e depois que a pessoa diz não?
// ---------------------------------------------------------------------------
//
// Os três caminhos acima cobrem a ENTRADA. Só que a exceção que sobrou — fut de
// grupo com os times sorteados, e o admin da plataforma em qualquer fut — deixa
// alguém ser posto na lista mesmo assim, e aí o princípio precisa de um segundo
// tempo: **dizer não é a palavra final.**
//
// Existem duas formas de dizer não, e elas valem o mesmo:
//
// - recusar o convite (`declined`, em match_day_invitations);
// - tirar o próprio nome da lista (`opted_out_at`, em attendances).
//
// Qualquer uma bloqueia, NAQUELE fut, tanto marcar a presença da pessoa
// (podeDefinirPresencaPor) quanto chamá-la de novo (podeConvidarParaFut, logo
// abaixo) — contra todo mundo, inclusive o admin da plataforma. Quem junta as
// duas fontes num booleano é `situacaoDoAlvo`, em ./presenca; daqui para baixo
// a recusa é um `boolean` e ninguém precisa saber de onde veio.
//
// O desfazer é da pessoa e só dela: entrar por conta própria limpa a recusa —
// as DUAS fontes, o carimbo e o convite recusado. Limpar só uma deixava a pessoa
// na lista e recusada ao mesmo tempo, e aí nem quem organiza conseguia escalá-la
// num jogo que ela estava jogando (ver entrarNaLista, em ./presenca).

import type { Ator } from "./permissions";

/** O fut, no mínimo que estas regras olham. */
export type FutParaEntrada = {
  status: "scheduled" | "teams_drawn" | "finished";
  groupId: number | null;
};

/**
 * A lista ainda aceita gente entrando?
 *
 * Encerrado nunca; sorteado também não, e não é o mesmo motivo: com os times
 * sorteados a lista deixou de ser lista e virou registro de quem apareceu, e
 * quem entra depois disso entra pela mão de quem organiza (a exceção de
 * `podeDefinirPresencaPor`), não por convite nem por pedido.
 */
export function futAceitaEntrada(fut: FutParaEntrada): boolean {
  return fut.status === "scheduled";
}

/**
 * Quem pode CHAMAR alguém para este fut.
 *
 * Em fut de GRUPO, quem organiza — o alcance ali já é o grupo, e ser membro foi
 * o consentimento.
 *
 * Em fut AVULSO, quem já dividiu um fut com a pessoa — e **só** isso, inclusive
 * para quem organiza. Organizar não é credencial nenhuma aqui, porque criar fut
 * é auto-servível: qualquer conta marca um fut e vira organizadora dele. Com um
 * atalho por `ehOrganizador`, a plataforma inteira voltava ao alcance de
 * qualquer pessoa logada — um convite, com notificação e push, por jogador com
 * conta —, que é exatamente o megafone que `podeDefinirPresencaPor` acabou de
 * fechar; e ids de `players` são seriais, então nem descobrir os alvos custa.
 * Quem organiza e NÃO conhece a pessoa tem o caminho desenhado para isso: o
 * link do fut, que ela decide abrir.
 *
 * **`alvoRecusou` é a primeira condição, e vale contra o admin da plataforma.**
 * Quem já disse não para ESTE fut — recusando o convite ou tirando o nome da
 * lista — não é chamado de novo. Sem isso o bloqueio de `podeDefinirPresencaPor`
 * teria porta dos fundos: barrado no botão "Vai", quem organiza manda convite
 * atrás de convite, e cada um deles é uma notificação com push. O índice único
 * de `match_day_invitations` é parcial em `pending`, então uma recusa não
 * estorva a próxima linha — nada, além desta regra, limita quantas saem.
 *
 * O bloqueio é por par (fut, jogador) e morre com o fut: recusar hoje não tira
 * ninguém do fut da semana que vem, que é o que o comentário do índice descreve.
 *
 * `jaJogouComOAlvo` e `alvoRecusou` chegam resolvidos de fora — este módulo não
 * consulta nada.
 */
export function podeConvidarParaFut(
  ator: Ator,
  fut: FutParaEntrada,
  contexto: { ehOrganizador: boolean; jaJogouComOAlvo: boolean; alvoRecusou: boolean },
): boolean {
  if (contexto.alvoRecusou) return false;
  if (!futAceitaEntrada(fut)) return false;
  if (ator.isPlatformAdmin) return true;
  // Fut de grupo: quem não organiza não chama. O grupo tem os próprios convites.
  if (fut.groupId !== null) return contexto.ehOrganizador;
  return contexto.jaJogouComOAlvo;
}

/** O que acontece quando alguém de fora tenta entrar por conta própria. */
export type ResultadoDeEntradaNoFut =
  | "ja-esta"
  | "entra-direto"
  | "pede-entrada"
  | "fechada";

/**
 * Como esta pessoa entra neste fut, sozinha.
 *
 * A ordem importa, e é a mesma lição de `podeEntrarNoGrupo`: o estado do fut é
 * testado ANTES do vínculo. Um fut que já sorteou os times não aceita ninguém
 * entrando por conta própria, e olhar a elegibilidade primeiro deixaria membro
 * de grupo furar isso.
 *
 * `elegivel` é o que `ehElegivel` já responde: membro do grupo em fut de grupo,
 * qualquer jogador ativo em fut avulso. Em fut avulso, portanto, "elegível" não
 * quer dizer autorizado a entrar direto — só que a lista não o exclui. É a
 * distinção que faz o `pede-entrada` existir.
 */
export function comoEntraNoFut(
  fut: FutParaEntrada,
  pessoa: {
    jaEstaNaLista: boolean;
    elegivel: boolean;
    /**
     * O círculo do fut avulso: quem organiza, ou quem já dividiu um fut com
     * quem organiza. É o MESMO conjunto que `condicaoDeAviso` notifica — quem
     * é avisado de um fut consegue entrar nele, e quem não é, pede.
     *
     * Fut órfão (criador apagado) não tem círculo e não tem lista a proteger:
     * quem chama trata como `true`, que é o comportamento de sempre.
     */
    noCirculo: boolean;
  },
): ResultadoDeEntradaNoFut {
  if (pessoa.jaEstaNaLista) return "ja-esta";
  if (!futAceitaEntrada(fut)) return "fechada";
  // Fut de grupo: ser membro basta, e sempre bastou — entrar no grupo foi o
  // consentimento, e é o comportamento que o app sempre teve.
  if (fut.groupId !== null) return pessoa.elegivel ? "entra-direto" : "fechada";
  // Fut avulso: quem é do círculo entra direto (inclusive quem organiza, que
  // precisa confirmar a própria presença no próprio fut). Quem chegou pela aba
  // de explorar pede — é o que separa "qualquer um se marca" de "qualquer um é
  // marcado".
  return pessoa.noCirculo ? "entra-direto" : "pede-entrada";
}

// Quem decide um pedido e quem gera o link é quem gerencia o fut — e essa
// pergunta não mora aqui: `requireFutAdmin` já a responde, com 404 para quem
// não administra, e é ele que as actions chamam. Um predicado a mais neste
// módulo só repetiria o guard, com a chance de divergir dele.
