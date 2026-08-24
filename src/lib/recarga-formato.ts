import type { RecargaStatus } from "@/db/schema";
import type { BadgeTom } from "@/components/ui/badge";

// Formatação da recarga — o vocabulário visual dos pedidos, numa casa só.
//
// Três telas mostram um pedido (a lista, a tela do QR e o painel do admin), e o
// rótulo e o tom de cada status precisam ser os MESMOS nas três: "pago" verde
// numa e amarelo noutra viraria dois sistemas na cabeça de quem olha. Sem
// `server-only` porque é puro e o teste unitário alcança.

/** Centavos → "R$ 10,00". A única formatação de dinheiro do sistema. */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * O rótulo e o tom do selo de cada status de pedido.
 *
 * `pendente` leva ponto e tom neutro (está vivo, esperando); `pago` é a notícia
 * boa em accent; `expirado` e `cancelado` são cinza — nada foi cobrado, nada a
 * lamentar; `estornado` é warn porque pede atenção de quem administra.
 */
export function rotuloDoStatus(status: RecargaStatus): {
  texto: string;
  tom: BadgeTom;
  ponto: boolean;
} {
  switch (status) {
    case "pendente":
      return { texto: "aguardando Pix", tom: "neutral", ponto: true };
    case "pago":
      return { texto: "pago", tom: "accent", ponto: false };
    case "expirado":
      return { texto: "expirado", tom: "outline", ponto: false };
    case "cancelado":
      return { texto: "não gerado", tom: "outline", ponto: false };
    case "estornado":
      return { texto: "estornado", tom: "warn", ponto: false };
  }
}
