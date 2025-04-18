import * as React from "react"
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// Stub CalendarProps to maintain API compatibility
export type CalendarProps = React.HTMLAttributes<HTMLDivElement> & {
  mode?: string
  selected?: Date | Date[] | { from: Date; to: Date }
  onSelect?: (date: Date | undefined) => void
  disabled?: { from: Date; to: Date } | Date[]
  [key: string]: any
}

function Calendar({
  className,
  ...props
}: CalendarProps) {
  return (
    <div className={cn("p-3", className)}>
      {/* This is a stub component that replaces the react-day-picker implementation */}
      {/* The actual calendar functionality is not used in the application */}
      <div className="flex justify-center items-center p-4 border rounded-md">
        <p className="text-muted-foreground">Calendar component (stub)</p>
      </div>
    </div>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
