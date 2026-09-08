import { ProjectStudio } from "@/components/agent/ProjectStudio";
import "./studio.css";
import "./execution.css";

export const metadata = {
  title: "Create a Web Palace",
  description: "Create and review a new teaching website through the Web Palace agent workflow."
};

export default function CreatePalacePage() {
  return <ProjectStudio />;
}
