import { Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeSeta } from "@/components/ui/icons";
import { CAMADAS, CAPITULOS, capitulosDaCamada, tituloDaCamada } from "./capitulos";
import { CORPOS } from "./corpos";

export const metadata = { title: "Guia" }; // → "Guia — FutZenha", pelo template do raiz

export default function GuiaPage() {
  return (
    <div className="flex flex-col gap-8" id="topo">
      <PageHeader
        titulo="Guia do FutZenha"
        descricao="Como a lista funciona, de onde sai a nota, o que cada ranking mede e o
                   que acontece quando dá ruim. Tudo num lugar só."
      />

      {CAMADAS.map((camada) => (
        <Section key={camada.id} titulo={camada.titulo}>
          <HairlineList as="ul">
            {capitulosDaCamada(camada.id).map((c) => (
              <li key={c.id}>
                <HairlineRowLink href={`#${c.id}`}>
                  <span className="flex-1">
                    <span className="block font-display text-[14px] font-bold text-fg">
                      {c.titulo}
                    </span>
                    <span className="block text-[12.5px] text-fg-4">{c.resumo}</span>
                  </span>
                  <IconeSeta className="size-4 text-fg-dim" />
                </HairlineRowLink>
              </li>
            ))}
          </HairlineList>
        </Section>
      ))}

      {/* O scroll-mt existe porque a TopBar é sticky no celular: sem ele, o
          título do capítulo para debaixo dela ao saltar pela âncora. O rodapé
          já está resolvido pelo scroll-padding-bottom do :root. */}
      {CAPITULOS.map((c) => (
        <section key={c.id} id={c.id} className="flex scroll-mt-16 flex-col gap-3 lg:scroll-mt-6">
          <Eyebrow>{tituloDaCamada(c.camada)}</Eyebrow>
          <h2 className="font-display text-[19px] leading-[1.15] font-extrabold font-stretch-112% text-fg">
            {c.titulo}
          </h2>
          <div className="flex flex-col gap-2.5 text-[14px] leading-[1.55] text-fg-2">
            {CORPOS[c.id]}
          </div>
          <a href="#topo" className="self-start text-[12px] text-accent-ink hover:underline">
            Voltar ao índice
          </a>
        </section>
      ))}
    </div>
  );
}
