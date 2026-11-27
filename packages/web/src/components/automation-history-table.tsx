import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { EmptyCard } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RovingFocusGroup, RovingFocusItem } from "@/components/ui/roving-focus-group";
import {
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OUTLINE_FILL_HOVER,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";
import type { DesktopAutomationRun, DesktopAutomationRunStatus } from "@/types";

type AutomationHistoryTableProps = {
  runs: DesktopAutomationRun[];
  onOpenSession(sessionPath: string): void;
};

const columnHelper = createColumnHelper<DesktopAutomationRun>();

function runStatusLabelKey(status: DesktopAutomationRunStatus) {
  return `automations.runStatus.${status}` as const;
}

export function AutomationHistoryTable({ runs, onOpenSession }: AutomationHistoryTableProps) {
  const { t, i18n } = useTranslation();

  const sortedRuns = useMemo(
    () => [...runs].sort((left, right) => right.startedAtUnixMs - left.startedAtUnixMs),
    [runs],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("startedAtUnixMs", {
        id: "time",
        header: () => t("automations.historyColumnTime"),
        cell: ({ getValue }) =>
          formatRelativeTime(new Date(getValue()).toISOString(), i18n.language),
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: () => t("automations.historyColumnStatus"),
        cell: ({ getValue }) => t(runStatusLabelKey(getValue())),
      }),
    ],
    [i18n.language, t],
  );

  // oxlint-disable-next-line react/incompatible-library -- TanStack Table returns functions that React Compiler cannot safely memoize.
  const table = useReactTable({
    data: sortedRuns,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  if (sortedRuns.length === 0) {
    return (
      <EmptyCard
        className="absolute inset-0 flex flex-col items-center justify-center"
        icon={<History strokeWidth={1.75} />}
        title={t("automations.noRuns")}
        description={t("automations.noRunsDescription")}
      />
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg",
        DESKTOP_OUTLINE_BORDER,
        "[&_[data-slot=table-row]]:border-outline-border",
      )}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "text-foreground/80",
                    header.column.id === "status" && "text-right",
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <RovingFocusGroup asChild orientation="vertical">
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <RovingFocusItem asChild key={row.id} tabStopId={row.id}>
                <TableRow
                  className={cn(
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                    DESKTOP_OUTLINE_FILL_HOVER,
                    instantHoverMotionClass,
                  )}
                  onClick={() => onOpenSession(row.original.sessionPath)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenSession(row.original.sessionPath);
                    }
                  }}
                  title={t("automations.openThread")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "text-foreground/80",
                        cell.column.id === "status" && "text-right",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              </RovingFocusItem>
            ))}
          </TableBody>
        </RovingFocusGroup>
      </Table>
    </div>
  );
}
