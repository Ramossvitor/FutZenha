"use client";

import { Input } from "./field";

/**
 * O seletor nativo de cor do CamposDoColete, com um enfeite: mexer nele marca
 * o rádio "Outra cor" sozinho. Sem isto a pessoa escolhia um tom, esquecia de
 * tocar em "Outra cor" e o servidor — que só lê `corLivre` quando o rádio diz
 * "outra", de propósito (ver coletes-form.ts) — gravava a amostra marcada.
 *
 * Client component só por causa do `onInput`; sem JavaScript o formulário
 * continua inteiro, só exige o toque no rádio.
 *
 * O `w-12` fica no span, e não no Input: o `controle` do field.tsx traz
 * `w-full`, e duas larguras na mesma lista de classes decidem pelo acaso da
 * ordem na folha, não pela ordem no atributo.
 */
export function CorLivre({
  id,
  name,
  idDoRadioOutra,
  defaultValue,
}: {
  id: string;
  name: string;
  /** O id do rádio "Outra cor" do mesmo bloco. */
  idDoRadioOutra: string;
  defaultValue: string;
}) {
  return (
    <span className="w-12 shrink-0">
      <Input
        id={id}
        name={name}
        type="color"
        defaultValue={defaultValue}
        aria-label="Escolher outra cor"
        className="px-1"
        onInput={() => {
          const radio = document.getElementById(idDoRadioOutra);
          if (radio instanceof HTMLInputElement) radio.checked = true;
        }}
      />
    </span>
  );
}
