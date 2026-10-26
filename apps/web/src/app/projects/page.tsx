import type { Metadata } from "next";
import { ProjectList } from "@/components/projects/project-list";

export const metadata: Metadata = {
  title: "Projects · Akira",
};

export default function ProjectsPage() {
  return <ProjectList />;
}
