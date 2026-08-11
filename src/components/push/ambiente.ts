"use client";

// Detecções de ambiente que o convite de instalar e o push compartilham.
// Client-only: tudo aqui lê navigator/window. A diretiva não é decorativa —
// `useNoCliente` sozinho já quebraria o build num Server Component, mas
// `ehIOS`/`emStandalone`/`snoozeVigente` são funções comuns: importadas do
// servidor elas compilam sem reclamar e só explodem em `navigator is not
// defined` no prerender. Com a diretiva, o erro é de build.

import { useSyncExternalStore } from "react";

const semAssinatura = () => () => {};

/**
 * `false` no servidor e durante a hidratação, `true` no cliente depois dela.
 *
 * É o que permite ler navigator/localStorage DIRETO no render (guardado por
 * este flag) em vez de copiá-los para estado num useEffect — padrão que o
 * lint react-hooks/set-state-in-effect recusa por causar render em cascata.
 * useSyncExternalStore com snapshots divergentes é o mecanismo do React para
 * exatamente isso: o servidor pinta o estado "escondido" e o cliente
 * re-renderiza uma vez com o real, sem erro de hidratação.
 */
export function useNoCliente(): boolean {
  return useSyncExternalStore(
    semAssinatura,
    () => true,
    () => false,
  );
}

export function ehIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

// Rodando como app instalado. O matchMedia é o caminho padrão; o
// navigator.standalone é o legado do Safari que ainda é quem responde em
// algumas versões de iOS.
export function emStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Snooze de convites via localStorage — por device de propósito: dispensar no
// celular não deveria calar o convite no tablet.
export function snoozeVigente(chave: string, dias: number): boolean {
  try {
    const desde = Number(localStorage.getItem(chave));
    return Number.isFinite(desde) && desde > 0 && Date.now() - desde < dias * 24 * 60 * 60 * 1000;
  } catch {
    // localStorage indisponível (modo privado antigo) — sem como lembrar a
    // dispensa, melhor não insistir a cada navegação.
    return true;
  }
}

export function gravarSnooze(chave: string): void {
  try {
    localStorage.setItem(chave, String(Date.now()));
  } catch {
    /* sem storage, sem snooze — o convite volta e paciência */
  }
}
