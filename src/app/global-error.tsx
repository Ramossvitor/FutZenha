"use client";

/**
 * Último recurso: só aparece se o PRÓPRIO layout raiz quebrar. Substitui o
 * <html> inteiro, então nada do design system está garantido aqui — nem o CSS
 * global —, e por isso o estilo é inline e sem fonte customizada.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // retry() refaz o fetch do servidor; reset() sozinho re-renderizaria o mesmo
  // payload com erro e o botão nunca recuperaria — ver src/app/error.tsx.
  retry: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0E0D",
          color: "#EDF2EF",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
            O FutZenha tropeçou feio agora
          </p>
          <p style={{ fontSize: 14, color: "#9AA7A1", margin: "0 0 16px" }}>
            Tenta de novo — se seguir falhando, avisa o admin.
            {error.digest ? ` (código ${error.digest})` : ""}
          </p>
          <button
            onClick={retry}
            style={{
              background: "#CDFF3A",
              color: "#070908",
              border: 0,
              borderRadius: 6,
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
