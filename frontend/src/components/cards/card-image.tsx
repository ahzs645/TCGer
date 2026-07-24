"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

import { getCardBackImage } from "@/lib/utils";

interface CardImageProps extends Omit<ImageProps, "alt" | "onError" | "src"> {
  alt: string;
  fallbackSrc?: string | null;
  src?: string | null;
  tcg?: string;
}

export function CardImage({
  alt,
  fallbackSrc,
  src,
  style,
  tcg,
  ...props
}: CardImageProps) {
  const cardBack = getCardBackImage(tcg);
  const [currentSrc, setCurrentSrc] = useState(src || cardBack);

  useEffect(() => {
    setCurrentSrc(src || cardBack);
  }, [cardBack, src]);

  return (
    <Image
      {...props}
      alt={alt}
      src={currentSrc}
      style={{
        backgroundColor: "hsl(var(--muted))",
        backgroundImage: `url("${cardBack}")`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "contain",
        ...style,
      }}
      onError={() => {
        setCurrentSrc((value) => {
          if (fallbackSrc && value !== fallbackSrc && value !== cardBack) {
            return fallbackSrc;
          }
          return cardBack;
        });
      }}
    />
  );
}
