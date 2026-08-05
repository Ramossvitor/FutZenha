// Nomes de time são cores de colete; mapeia para estilos do chip.
const colorMap: Record<string, string> = {
  preto: "bg-neutral-900 text-white",
  branco: "bg-white text-neutral-900 border border-neutral-300",
  verde: "bg-emerald-600 text-white",
  azul: "bg-blue-600 text-white",
  vermelho: "bg-red-600 text-white",
  laranja: "bg-orange-500 text-white",
  amarelo: "bg-yellow-400 text-neutral-900",
};

export function vestClass(teamName: string): string {
  return colorMap[teamName.trim().toLowerCase()] ?? "bg-neutral-500 text-white";
}

export const defaultTeamNames = ["Preto", "Branco", "Verde", "Laranja", "Azul", "Vermelho"];
