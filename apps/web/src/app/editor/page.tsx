import type { Metadata } from "next";
import { Suspense } from "react";
import { Editor } from "@/components/editor/editor";

export const metadata: Metadata = {
  title: "Editor · Akira",
};

export default function EditorPage() {
  // The editor reads ?project= from the address, which only exists in the browser.
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
