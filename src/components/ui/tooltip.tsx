import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function AppTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={280} skipDelayDuration={120}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({
  label,
  children,
  side = "top",
}: {
  label?: string | null;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  if (!label) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="ui-tip" side={side} sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
