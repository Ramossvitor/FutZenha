import type { SVGProps } from "react";

// Nenhuma biblioteca de ícones: são poucos, e o design os desenha como forma
// simples. Todos herdam `currentColor` e o tamanho vem de classe (`size-*`).
//
// Isto substitui os emoji que faziam papel de ícone (⚽ 🥅 🧤 🔔 🥇 ★): emoji
// muda de desenho a cada sistema, ignora a cor do texto e desalinha da linha
// de base.

type Icone = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A marca: um colete com a gola recortada. */
export function Marca({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 38" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M0 5a5 5 0 0 1 5-5h24a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5z"
      />
      {/* a gola é vazada, então mostra o fundo de quem estiver atrás */}
      <path fill="var(--canvas)" d="M10.5 0h13v2a6.5 6.5 0 0 1-13 0z" />
    </svg>
  );
}

export function IconeCampo(props: Icone) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <path d="M12 5v14" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function IconeCalendario(props: Icone) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconeGrafico(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="M5 20V12M12 20V4M19 20v-6" />
    </svg>
  );
}

export function IconePessoa(props: Icone) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconeSino(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconeGrupo(props: Icone) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8M17.5 19a6 6 0 0 0-1.7-4.2" />
    </svg>
  );
}

export function IconeLuva(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="M7 21v-4.5C5.5 15.5 4.5 14 4.5 12V8a1.5 1.5 0 0 1 3 0v2m0-2V4.5a1.5 1.5 0 0 1 3 0V10m0-5.5a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v6c0 2-1 3.5-2.5 4.5V21" />
    </svg>
  );
}

export function IconeCadeado(props: Icone) {
  return (
    <svg {...base} {...props}>
      <rect x="4.5" y="10" width="15" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function IconeAlerta(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  );
}

export function IconeCheck(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconeSeta(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconeBola(props: Icone) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7.5 3.8 2.8-1.5 4.5H9.7l-1.5-4.5z" />
      <path d="M12 3v4.5M4 10.5l4.2-.2M20 10.5l-4.2-.2M7.3 19l2.4-4.2M16.7 19l-2.4-4.2" />
    </svg>
  );
}

/** Arco aberto que gira com `animate-spin` — o spinner dos botões em pending. */
export function IconeCarregando(props: Icone) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
