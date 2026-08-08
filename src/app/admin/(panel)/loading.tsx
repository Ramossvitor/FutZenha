import { PageSkeleton } from "@/components/ui/skeleton";

// O fallback instantâneo da navegação — ver o porquê em ui/skeleton.tsx.
export default function Loading() {
  return <PageSkeleton />;
}
