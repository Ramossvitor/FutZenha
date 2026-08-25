"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * O botão de copiar o copia-e-cola do Pix.
 *
 * Client component pequeno porque `navigator.clipboard` só existe no cliente. O
 * "Copiado" volta a ser "Copiar" sozinho: quem cola no app do banco e não paga
 * na hora volta para cá, e um botão preso em "Copiado" mentiria sobre o estado
 * da área de transferência.
 *
 * O fallback do `catch` importa: em WebView antiga (ou http fora do localhost)
 * o clipboard é negado, e selecionar o texto do <textarea> ao lado é o caminho
 * manual — o botão avisa em vez de fingir que copiou.
 */
export function CopiarPix({ codigo }: { codigo: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
    setTimeout(() => setEstado("parado"), 4_000);
  }

  return (
    <Button tamanho="lg" className="w-full" onClick={copiar}>
      {estado === "parado" && "Copiar código Pix"}
      {estado === "copiado" && "Copiado — cole no app do banco"}
      {estado === "falhou" && "Não deu — selecione o código e copie"}
    </Button>
  );
}
