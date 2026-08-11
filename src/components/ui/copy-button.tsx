"use client";

import { useState } from "react";
import { Button } from "./button";

/**
 * Copia um link para a área de transferência.
 *
 * Tem três consumidores em áreas diferentes do app (convite de jogador, link
 * do grupo, convite de fut), e por isso mora no kit e não junto de uma tela.
 *
 * `navigator.clipboard` exige contexto seguro — em http, fora de localhost, o
 * `writeText` rejeita. Por isso o catch: em vez de engolir o erro e fingir que
 * copiou, o botão avisa que não deu e o link continua selecionável na tela.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");

  const rotulo = { parado: "Copiar", copiado: "Copiado!", falhou: "Copie na mão" }[estado];

  return (
    <Button
      variante="secondary"
      tamanho="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setEstado("copiado");
        } catch {
          setEstado("falhou");
        }
        setTimeout(() => setEstado("parado"), 2000);
      }}
    >
      {rotulo}
    </Button>
  );
}
