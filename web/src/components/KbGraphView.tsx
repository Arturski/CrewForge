import { useMemo } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { KbGraph } from "../lib/api";

// Read-only preview of a knowledge base's entity graph. Entities are laid out
// on concentric rings, highest-degree (most connected) first, so hubs sit in
// the middle without needing a force simulation.

type EntityData = { label: string; type: string; hub: boolean };

function EntityNode({ data }: NodeProps<Node<EntityData>>) {
  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs transition ${
      data.hub ? "border-brand bg-brand-soft font-medium text-ink" : "border-border-strong bg-elevated2 text-ink"}`}>
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
      {data.label}
      {data.type && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted">{data.type}</span>}
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
    </div>
  );
}

const NODE_TYPES = { entity: EntityNode };

function ringPosition(i: number): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  let start = 1, ring = 1;
  while (i >= start + ring * 8) { start += ring * 8; ring += 1; }
  const slot = i - start, count = ring * 8;
  const angle = (2 * Math.PI * slot) / count + (ring % 2 ? 0 : Math.PI / count);
  const radius = ring * 170;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function KbGraphView({ graph }: { graph: KbGraph }) {
  const { nodes, edges } = useMemo(() => {
    const sorted = [...graph.entities].sort((a, b) => b.degree - a.degree);
    const hubCut = sorted.length ? Math.max(2, sorted[0].degree) : 0;
    const nodes: Node<EntityData>[] = sorted.map((e, i) => ({
      id: e.name, type: "entity", position: ringPosition(i), draggable: true,
      data: { label: e.label, type: e.type, hub: e.degree >= hubCut },
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = graph.relations
      .filter((r) => ids.has(r.source) && ids.has(r.target))
      .map((r, i) => ({
        id: `f${i}`, source: r.source, target: r.target, label: r.label,
        labelStyle: { fontSize: 9, fill: "var(--color-muted)" },
        labelBgStyle: { fill: "var(--color-canvas)", fillOpacity: 0.85 },
        style: { stroke: "var(--color-border-strong)" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-border-strong)" },
      }));
    return { nodes, edges };
  }, [graph]);

  return (
    <div className="h-[420px] overflow-hidden rounded-lg border border-border bg-canvas">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView
        nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }}
        minZoom={0.15}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
