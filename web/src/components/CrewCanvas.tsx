import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Workspace } from "../lib/api";

// Visualizes a crew as a graph: agents feed the tasks they own; tasks run in
// process order (sequential edges). Foundation for the full visual flow builder.

const nodeBase = {
  color: "var(--color-ink)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  fontSize: 12,
  width: 190,
  padding: 10,
};

export function CrewCanvas({ ws, activeAgent }: { ws: Workspace; activeAgent?: string | null }) {
  const { nodes, edges } = useMemo(() => {
    const agentX: Record<string, number> = {};
    ws.tasks.forEach((t, i) => { if (!(t.agent in agentX)) agentX[t.agent] = i * 240; });

    const agentNodes: Node[] = ws.agents.map((a, i) => ({
      id: `agent:${a.id}`,
      position: { x: agentX[a.id] ?? i * 240, y: 0 },
      data: { label: `🧑 ${a.role}` },
      style: {
        ...nodeBase,
        background: a.role === activeAgent ? "var(--color-brand-soft)" : "var(--color-elevated2)",
        borderColor: a.role === activeAgent ? "var(--color-node-agent)" : "var(--color-border-strong)",
      },
    }));

    const taskNodes: Node[] = ws.tasks.map((t, i) => ({
      id: `task:${i}`,
      position: { x: i * 240, y: 170 },
      data: { label: `▸ ${t.name ?? `task ${i + 1}`}${t.human_input ? "  ⏸ HITL" : ""}\n${t.description.slice(0, 60)}` },
      style: { ...nodeBase, background: "var(--color-elevated)", borderColor: "var(--color-node-task)", whiteSpace: "pre-wrap" },
    }));

    const edges: Edge[] = [];
    ws.tasks.forEach((t, i) => {
      edges.push({ id: `own-${i}`, source: `agent:${t.agent}`, target: `task:${i}`,
        style: { stroke: "var(--color-node-agent)" }, animated: t.agent === activeAgent });
      if (i > 0) edges.push({ id: `seq-${i}`, source: `task:${i - 1}`, target: `task:${i}`,
        style: { stroke: "var(--color-node-task)" } });
    });

    return { nodes: [...agentNodes, ...taskNodes], edges };
  }, [ws, activeAgent]);

  if (ws.agents.length === 0 && ws.tasks.length === 0) {
    return <div className="grid h-[320px] place-items-center text-sm text-muted">Add agents and tasks to see the graph.</div>;
  }
  return (
    <div className="h-[340px] w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}
        nodesDraggable nodesConnectable={false} colorMode="dark">
        <Background color="var(--color-border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
