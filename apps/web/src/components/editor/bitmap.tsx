"use client";

import { useEffect, useRef } from "react";

/** Draws an ImageBitmap thumbnail, cropped to fill its box like `object-fit: cover`. */
export function Bitmap({ image, className }: { image: ImageBitmap; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    canvas.width = width;
    canvas.height = height;
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    canvas.getContext("2d")?.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }, [image]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
