"use client";

import * as React from "react";
import { DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md",
      className,
    )}
    {...props}
    data-oid="1qc_3ac"
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandDialog = ({ children, ...props }: DialogProps) => {
  return (
    <Dialog {...props} data-oid="_1tev:o">
      <DialogContent
        className="overflow-hidden p-0 shadow-lg"
        data-oid="wa.4za7"
      >
        <DialogHeader className="sr-only" data-oid="_lbihme">
          <DialogTitle data-oid="i-2g3m2">Command palette</DialogTitle>
          <DialogDescription data-oid="3o.cafn">
            Access quick navigation and actions.
          </DialogDescription>
        </DialogHeader>
        <Command className="bg-background" data-oid="0iano-n">
          <div className="relative border-b" data-oid="u3iy89z">
            <CommandInput
              placeholder="Search for pages, actions, or games..."
              className="pl-10"
              data-oid="2wvmc0j"
            />
            <CommandSearchIcon data-oid="tg8a75m" />
          </div>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};
CommandDialog.displayName = "CommandDialog";

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Input
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-md bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    data-oid="b2n_oy5"
  />
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[400px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
    data-oid="ew.e:la"
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn("py-6 text-center text-sm", className)}
    {...props}
    data-oid="59t-.6_"
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-2 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
    data-oid="sh8dz6t"
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
    data-oid="svjt3.n"
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground",
      className,
    )}
    {...props}
    data-oid="0dlslch"
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
      data-oid="qy0dayj"
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

const CommandIcon = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex h-8 w-8 items-center justify-center rounded-md bg-muted",
      className,
    )}
    {...props}
    data-oid="_ae:1o_"
  />
);

const CommandSearchIcon = () => (
  <div
    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
    data-oid="y-6218f"
  >
    <Search className="h-4 w-4" data-oid="g-cgefr" />
  </div>
);

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandIcon,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSearchIcon,
  CommandSeparator,
  CommandShortcut,
};
