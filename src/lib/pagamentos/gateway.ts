// O contrato de um gateway de pagamento — a única forma pela qual o resto do
// sistema fala de dinheiro de verdade.
//
// A recarga (src/lib/recarga.ts) só conhece este tipo: criar uma cobrança Pix,
// consultar um pagamento. O Mercado Pago (mercadopago.ts) é a única
// implementação hoje, e a razão de o contrato existir mesmo assim é a mesma da
// coluna `zenha_pedidos.gateway`: trocar de gateway amanhã é escrever um módulo
// novo aqui dentro, não reescrever a recarga — e o teste de integração injeta um
// fake deste contrato em vez de stubar fetch.
//
// Valores SEMPRE em centavos deste lado do contrato. Cada gateway converte para
// o formato dele (o Mercado Pago quer reais com decimais) no próprio módulo —
// ponto flutuante de dinheiro não circula pelo domínio.

/** O nome que vai em `zenha_pedidos.gateway` — o check do banco conhece a lista. */
export type NomeDeGateway = "mercadopago";

export type NovaCobrancaPix = {
  valorCentavos: number;
  /** O que aparece no app do banco de quem paga. */
  descricao: string;
  /** O e-mail do pagador, exigido pelo gateway. Ver `emailDoPagador` na recarga. */
  emailPagador: string;
  /**
   * Vai no `X-Idempotency-Key` da criação: um retry de rede não pode criar duas
   * cobranças. É a mesma chave gravada em `zenha_pedidos.idempotency_key`.
   */
  idempotencyKey: string;
  /** Também serve de `external_reference` — o pedido ainda não tem id quando a cobrança nasce. */
  expiraEmMinutos: number;
};

export type CobrancaPixCriada = {
  /** O id do pagamento LÁ — vai em `zenha_pedidos.gateway_id`, unique. */
  gatewayId: string;
  /** O copia-e-cola. */
  qrCode: string;
  /** A imagem do QR em base64 (PNG), quando o gateway a entrega. */
  qrCodeBase64: string | null;
};

export type ResultadoCriacao =
  | { ok: true; cobranca: CobrancaPixCriada }
  /**
   * `nao-configurado` = sem credencial no ambiente (a UI nem deveria ter
   * mostrado o botão); `recusado` = o gateway respondeu 4xx (payload ou
   * credencial errados — bug nosso, o log guarda o corpo); `indisponivel` =
   * 5xx, timeout ou rede. Nenhum dos três cria pedido pagável.
   */
  | { ok: false; motivo: "nao-configurado" | "recusado" | "indisponivel" };

/**
 * O status de um pagamento traduzido para o vocabulário da recarga. Cada
 * gateway faz a tradução no próprio módulo — os nomes de lá não vazam.
 */
export type StatusNoGateway = "pendente" | "pago" | "expirado" | "estornado";

export type ResultadoConsulta =
  | { ok: true; status: StatusNoGateway; bruto: unknown }
  | { ok: false; motivo: "nao-configurado" | "nao-encontrado" | "indisponivel" };

export type GatewayDePagamento = {
  nome: NomeDeGateway;
  configurado(): boolean;
  criarCobrancaPix(cobranca: NovaCobrancaPix): Promise<ResultadoCriacao>;
  consultarPagamento(gatewayId: string): Promise<ResultadoConsulta>;
};
