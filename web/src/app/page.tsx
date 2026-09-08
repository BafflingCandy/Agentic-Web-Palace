import { WebPalaceBrain } from "@/components/WebPalaceBrain";

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ skipIntro?: string | string[] }>;
}) {
  const params = await searchParams;
  const skipIntro = Array.isArray(params.skipIntro)
    ? params.skipIntro.includes("1")
    : params.skipIntro === "1";

  return (
    <WebPalaceBrain
      canAddNodes={process.env.NODE_ENV === "development"}
      skipIntro={skipIntro}
    />
  );
}
