import { GeneratedPalace } from "@/components/agent/GeneratedPalace";
import "./generated.css";

export default async function GeneratedPalacePage({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  const params = await searchParams;
  const projectId = Array.isArray(params.project) ? params.project[0] : params.project;
  return <GeneratedPalace projectId={projectId ?? null}/>;
}
