"use client";

import Image from "next/image";
import { useState } from "react";

type FunctionFaceProps = {
  image: { url: string; width: number; height: number } | null;
  name: string;
  className?: string;
};

export function FunctionFace({ image, name, className = "h-14 w-14" }: FunctionFaceProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  if (image && failedImageUrl !== image.url) {
    return <Image src={image.url} alt={`${name} agent face`} width={image.width} height={image.height} className={`${className} rounded-full object-cover`} onError={() => setFailedImageUrl(image.url)} />;
  }
  return <span aria-label={`${name} agent face unavailable`} className={`inline-grid ${className} place-items-center rounded-full bg-[var(--ink)] font-extrabold text-white`}>{name.trim().charAt(0).toUpperCase()}</span>;
}
