"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  thumbLabels?: [string, string?];
};

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, thumbLabels, ...props }, ref) => {
  // Determine if this is a range slider based on the value prop
  const isRange = Array.isArray(props.value) && props.value.length > 1;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
      data-oid="s0hq84y"
    >
      <SliderPrimitive.Track
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
        data-oid="nl7rxjn"
      >
        <SliderPrimitive.Range
          className="absolute h-full bg-primary"
          data-oid="obe1..."
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={thumbLabels?.[0]}
        className="block h-4 w-4 rounded-full border border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        data-oid="v.25.-a"
      />
      {isRange && (
        <SliderPrimitive.Thumb
          aria-label={thumbLabels?.[1]}
          className="block h-4 w-4 rounded-full border border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          data-oid="mcbhxf0"
        />
      )}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
