import type { Metadata } from "next";
import { SpikeEditor } from "@/components/features/spike-editor";

export const metadata: Metadata = {
  title: "Editor · Akira",
};

export default function EditorPage() {
  return <SpikeEditor />;
}
