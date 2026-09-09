import { useEffect, useState } from "react";

/**
 * O estado de um botão de dois toques: o primeiro arma ("Confirma?"), o
 * segundo executa, e o armado se desarma sozinho em `ms` para o botão não
 * ficar engatilhado esquecido. Proteção contra dedo errado, não contra má-fé —
 * a de má-fé é regra do servidor.
 *
 * Uma definição para os dois botões que a usam: o desfazer da súmula
 * (fut/[id]/sumula/painel.tsx, que submete um form) e o "gerar outro" /
 * "revogar" do token do relógio (perfil/token-de-api.tsx, que chama a action
 * direto). O que muda entre eles é o que o segundo toque faz — não o timer.
 */
export function useArmado(ms = 4000): [boolean, (armado: boolean) => void] {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const timer = setTimeout(() => setArmado(false), ms);
    return () => clearTimeout(timer);
  }, [armado, ms]);
  return [armado, setArmado];
}
