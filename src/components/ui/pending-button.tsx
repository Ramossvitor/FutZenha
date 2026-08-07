"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "./button";

/**
 * Botão que se desabilita sozinho enquanto o form envia.
 *
 * Só onde clicar duas vezes causa dano de verdade: re-sortear apaga o sorteio,
 * encerrar é irreversível, gerar link do grupo revoga o que acabou de ir pro
 * zap. Nos outros ~55 botões o feedback nativo do browser basta e não vale um
 * quilobyte de JS.
 *
 * `useFormStatus` lê o <form> ancestral, então este componente precisa estar
 * dentro dele. A página em volta continua Server Component — um servidor
 * renderizar um filho cliente é o caminho normal.
 */
export function PendingButton(props: ComponentProps<typeof SubmitButton>) {
  const { pending } = useFormStatus();
  return <SubmitButton {...props} pending={props.pending || pending} />;
}
