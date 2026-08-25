import { PageSkeleton } from "@/components/ui/skeleton";

// O fallback instantâneo da navegação — ver o porquê em ui/skeleton.tsx.
//
// Este e o do admin são os únicos do app, de propósito. O boundary de um
// loading.tsx nasce no `{children}` do layout acima dele, e só existem dois
// layouts: o raiz e o admin/(panel). Sem layout intermediário em grupos/,
// futs/, grupo/[slug]/, fut/[id]/ ou avaliar/, um loading.tsx lá dentro cai
// no mesmo ponto do DOM que este e desenha o mesmo skeleton — arquivo a mais
// sem nada em troca. Criar layout por segmento é o que passa a justificar um.
//
// ELE MORA NUM ROUTE GROUP, e não na raiz de app/, por uma razão só: deixar
// /guia de fora. O grupo não muda uma URL sequer — serve exclusivamente para
// desenhar até onde este boundary alcança.
//
// O motivo é que um loading.tsx não é "um skeleton se demorar": ele faz o Next
// despachar o fallback SEMPRE e mandar a página de verdade num <div hidden>,
// revelado por um $RC() lá adiante no stream. Provado com uma rota de teste sem
// um único await — ela também viajava escondida. Para quase todo lugar isso é o
// que se quer, e é o que este arquivo existe para dar.
//
// Para /guia, não: quem abre /guia#a-nota de um link mandado no grupo depende
// do salto de âncora do Chromium, e o Chromium desiste do fragmento no fim do
// carregamento. Com o conteúdo entrando por script no meio do stream, o salto
// vira corrida — que ele perdeu três vezes no CI em três dias de agosto de 2026,
// e perde de verdade com o servidor frio. Fora do boundary, o guia é a própria
// shell: o #a-nota tem caixa de layout no parse, e o salto passa a ser
// determinístico (medido: 15/15 com a CPU 6x mais lenta, 12/12 com 20x — contra
// 13/15 a 6x quando ele ainda estava aqui dentro).
//
// O guia só pode ficar de fora porque nada nele bloqueia o render: a única
// leitura de banco da página está atrás do <Suspense> de guia/valores-da-zenha
// .tsx. Página nova que precise esperar dado ANTES de desenhar qualquer coisa
// entra no grupo — senão o usuário fica olhando para uma tela em branco em vez
// deste skeleton.
export default function Loading() {
  return <PageSkeleton />;
}
