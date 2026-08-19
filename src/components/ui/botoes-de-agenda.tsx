import { urlGoogleAgenda, urlOutlookAgenda, type FutParaAgenda } from "@/lib/agenda";

// Server Component de propósito (sem "use client"): as três saídas são links —
// dois para fora e um download servido por rota — sem action nem pending.
// As classes espelham o `secondary`/`sm` de button.tsx, que é client e só
// renderiza <button>/<Link>; um <a> cru evita puxar aquele módulo para cá.
const CLASSE_LINK =
  "inline-flex h-8 items-center justify-center gap-2 rounded-ctl border border-line-strong " +
  "bg-transparent px-3 font-display text-[12px] font-semibold font-stretch-112% " +
  "whitespace-nowrap text-fg select-none transition-[background-color,border-color,color] " +
  "duration-150 hover:border-line-hover hover:bg-surface-2";

export function BotoesDeAgenda({ fut, urlBase }: { fut: FutParaAgenda; urlBase: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 self-start">
      <a
        className={CLASSE_LINK}
        href={urlGoogleAgenda(fut, urlBase)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Google Agenda
      </a>
      <a
        className={CLASSE_LINK}
        href={urlOutlookAgenda(fut, urlBase)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Outlook
      </a>
      {/* Rota, não data: URI — o Safari do iPhone ignora `download` em data: e
          abriria o .ics como texto. O Content-Disposition mora lá (ver
          ./fut/[id]/agenda.ics/route.ts). */}
      <a className={CLASSE_LINK} href={`/fut/${fut.id}/agenda.ics`}>
        Apple e outros (.ics)
      </a>
    </div>
  );
}
