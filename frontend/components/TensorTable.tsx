"use client";

import { useMemo, useState } from "react";

import { formatCount } from "@/lib/format";
import type { TensorItem } from "@/lib/types";
import { IconSearch } from "./ui";

const PAGE_SIZE = 200;

export function TensorTable({ tensors }: { tensors: TensorItem[] }) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tensors;
    return tensors.filter(
      (tensor) =>
        tensor.name.toLowerCase().includes(needle) ||
        tensor.dtype.toLowerCase().includes(needle),
    );
  }, [tensors, filter]);

  const shown = matches.slice(0, limit);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="relative max-w-xs flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <input
            className="input pl-8"
            placeholder="Filter tensors…"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
        </div>
        <span className="text-xs text-muted">
          {matches.length.toLocaleString()} of {tensors.length.toLocaleString()} tensors
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[38rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="w-40 px-2 py-2 font-medium">Shape</th>
              <th className="w-28 px-2 py-2 font-medium">Type</th>
              <th className="w-28 px-4 py-2 text-right font-medium">Elements</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((tensor) => (
              <tr key={tensor.name} className="border-b border-line/60 hover:bg-raised/60">
                <td className="px-4 py-1.5 font-mono text-xs break-all">{tensor.name}</td>
                <td className="px-2 py-1.5 font-mono text-xs text-muted">
                  [{tensor.shape.join(", ")}]
                </td>
                <td className="px-2 py-1.5 font-mono text-xs text-muted">{tensor.dtype}</td>
                <td className="px-4 py-1.5 text-right font-mono text-xs text-muted">
                  {formatCount(tensor.n_elements)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {matches.length > shown.length && (
          <div className="p-4 text-center">
            <button
              type="button"
              className="btn"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, matches.length - shown.length)} more
            </button>
          </div>
        )}

        {!matches.length && (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No tensor matches “{filter}”.
          </p>
        )}
      </div>
    </div>
  );
}
