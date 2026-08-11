"use client";

import { linkWaMe } from "@/lib/whatsapp";
import { Button } from "./button";

/**
 * Compartilha um texto pronto no WhatsApp (convocação, times sorteados).
 *
 * Dois consumidores em telas diferentes da pelada, por isso mora no kit, como o
 * CopyButton. No celular, `navigator.share` abre o sheet do sistema — a pessoa
 * escolhe o grupo e pronto. Onde não existe (desktop, WebView antiga), o wa.me
 * abre o WhatsApp Web com a mensagem montada. Cancelar o sheet é AbortError e
 * não é falha: a pessoa desistiu, o botão fica quieto.
 */
export function WhatsAppShareButton({
  texto,
  rotulo = "Compartilhar no WhatsApp",
  className,
}: {
  texto: string;
  rotulo?: string;
  className?: string;
}) {
  return (
    <Button
      variante="secondary"
      tamanho="sm"
      className={className}
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ text: texto });
            return;
          } catch (erro) {
            if (erro instanceof DOMException && erro.name === "AbortError") return;
            // share existia mas falhou de verdade (política de permissão,
            // iframe) — cai no wa.me em vez de morrer calado.
          }
        }
        window.open(linkWaMe(texto), "_blank", "noopener");
      }}
    >
      {rotulo}
    </Button>
  );
}
