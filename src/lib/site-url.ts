// URL base do site, usada no metadataBase (preview do WhatsApp) e nos links de
// convite que o admin manda no grupo. Sem `server-only`: o seed roda fora do Next.
//
// Na Vercel o domínio só é conhecido depois do primeiro deploy, então a cadeia
// deriva dele automaticamente — NEXT_PUBLIC_SITE_URL só é necessária para
// forçar um domínio próprio. Atenção: as vars VERCEL_* existem apenas no
// servidor; se um dia precisar do valor num Client Component, use a pública.
export function siteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    // Domínio estável de produção do projeto (vira o custom domain se houver).
    (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    // URL única deste deploy — rede de segurança, muda a cada publicação.
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    "http://localhost:3000";

  return url.replace(/\/+$/, "");
}
