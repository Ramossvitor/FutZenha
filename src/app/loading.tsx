import { PageSkeleton } from "@/components/ui/skeleton";

// O fallback instantâneo da navegação — ver o porquê em ui/skeleton.tsx.
//
// Este e o do admin são os únicos do app, de propósito. O boundary de um
// loading.tsx nasce no `{children}` do layout acima dele, e só existem dois
// layouts: este e o admin/(panel). Sem layout intermediário em grupos/,
// futs/, grupo/[slug]/, fut/[id]/ ou avaliar/, um loading.tsx lá dentro cai
// no mesmo ponto do DOM que este e desenha o mesmo skeleton — arquivo a mais
// sem nada em troca. Criar layout por segmento é o que passa a justificar um.
export default function Loading() {
  return <PageSkeleton />;
}
