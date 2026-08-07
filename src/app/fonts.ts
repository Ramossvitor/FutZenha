import { Archivo, Instrument_Sans } from "next/font/google";

// Display e UI. O `axes: ["wdth"]` não é otimização, é requisito: sem ele o
// Google devolve o arquivo com `font-stretch: 100%` e os passos 87/112/125%
// do design viram no-op silencioso — nem `font-stretch` nem
// `font-variation-settings` funcionam, porque o eixo não está no .woff2.
//
// `weight` não pode vir junto de `axes` (o loader do next/font lança). Fonte
// variável já traz a faixa inteira, 100..900.
export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

// Corpo. Instrument Sans também tem eixo de largura (75..100), mas o design
// só usa 100% — pedir o eixo engordaria o arquivo sem nenhum uso.
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

// Só `latin`: a faixa U+0000–00FF cobre todo o pt-BR (á ã â à ç é ê í ó ô õ ú
// estão em U+00C0–00FF). `latin-ext` é Europa Oriental e só somaria um segundo
// .woff2 baixado à toa.
