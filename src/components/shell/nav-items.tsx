import type { ReactNode } from "react";
import {
  IconeCalendario,
  IconeCampo,
  IconeGrafico,
  IconeGrupo,
  IconeLivro,
  IconePessoa,
  IconeSino,
  IconeCadeado,
  IconeBola,
  IconeZenha,
} from "@/components/ui/icons";

export type ItemDeNavegacao = {
  href: string;
  label: string;
  icone: ReactNode;
  exato?: boolean;
};

/**
 * As quatro abas de baixo, no celular. Quatro é o teto: com cinco, o alvo de
 * toque de cada uma cai abaixo do confortável num aparelho de 360px.
 *
 * A última troca de identidade conforme a sessão. Sem isso, tocar PERFIL
 * deslogado seria um pulo para /login — o proxy protege a rota — e a aba
 * mentiria sobre para onde leva.
 */
export function abas(logado: boolean): ItemDeNavegacao[] {
  return [
    { href: "/", label: "Início", icone: <IconeCampo />, exato: true },
    { href: "/futs", label: "Futs", icone: <IconeCalendario /> },
    { href: "/rankings", label: "Ranking", icone: <IconeGrafico /> },
    logado
      ? { href: "/perfil", label: "Perfil", icone: <IconePessoa /> }
      : { href: "/login", label: "Entrar", icone: <IconePessoa /> },
  ];
}

/**
 * A navegação do desktop. Cabe mais do que quatro, então aqui aparecem os
 * lugares que no celular ficam no topo (Grupos, Avisos) ou dentro do perfil.
 */
export function itensLaterais({
  logado,
  isPlatformAdmin,
}: {
  logado: boolean;
  isPlatformAdmin: boolean;
}): ItemDeNavegacao[] {
  const itens: ItemDeNavegacao[] = [
    { href: "/", label: "Início", icone: <IconeCampo />, exato: true },
    { href: "/futs", label: "Futs", icone: <IconeCalendario /> },
    { href: "/rankings", label: "Rankings", icone: <IconeGrafico /> },
  ];
  if (logado) {
    itens.push(
      { href: "/grupos", label: "Grupos", icone: <IconeGrupo /> },
      { href: "/avaliar", label: "Avaliar", icone: <IconeBola /> },
      { href: "/notificacoes", label: "Avisos", icone: <IconeSino /> },
      // Só aqui, e não nas abas: `abas()` tem quatro itens e quatro é o teto.
      // No celular a porta da loja é a lista "Sua conta" do /perfil — sem
      // aquelas linhas ela ficaria inalcançável no aparelho que é o alvo do
      // produto.
      { href: "/loja", label: "Loja", icone: <IconeZenha /> },
    );
    if (isPlatformAdmin) {
      itens.push({ href: "/admin", label: "Plataforma", icone: <IconeCadeado /> });
    }
  }
  itens.push({ href: "/guia", label: "Guia", icone: <IconeLivro /> });
  return itens;
}
