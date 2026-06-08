import { useCallback, useMemo } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  type Node, type Edge, type NodeProps, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, ListChecks, Plus, Trash2, Pause } from "lucide-react";
import type { Workspace } from "../lib/api";

// The canvas IS the editor: add nodes from the palette, click to select (syncs
// the inspector), drag to position (persisted in spec.layout), delete on hover.
// Run-aware highlighting (active node glow) arrives in Phase 2.

export type Sel = { kind: "agent" | "task"; idx: number } | null;

type AgentData = { label: string; selected: boolean; onSelect: () => void; onDelete: () => void };
type TaskData = AgentData & { hitl: boolean };

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  return (
    <div onClick={data.onSelect}
      className={`group relative w-[180px] cursor-pointer rounded-xl border bg-elevated2 px-3 py-2 text-xs transition ${data.selected ? "border-node-agent ring-2 ring-node-agent/40" : "border-border-strong hover:border-node-agent/60"}`}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-node-agent" />
      <div className="flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-node-agent)" }} />
        <span className="truncate font-medium text-ink">{data.label}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted">agent</div>
      <button onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
        className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-elevated p-1 text-muted hover:text-danger group-hover:block" aria-label="Delete agent">
        <Trash2 className="h-3 w-3" />
      </button>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-node-agent" />
    </div>
  );
}

function TaskNode({ data }: NodeProps<Node<TaskData>>) {
  return (
    <div onClick={data.onSelect}
      className={`group relative w-[180px] cursor-pointer rounded-xl border bg-elevated px-3 py-2 text-xs transition ${data.selected ? "border-node-task ring-2 ring-node-task/40" : "border-border-strong hover:border-node-task/60"}`}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-node-task" />
      <div className="flex items-center gap-1.5">
        <ListChecks className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-node-task)" }} />
        <span className="truncate font-medium text-ink">{data.label}</span>
        {data.hitl && <Pause className="h-3 w-3 shrink-0" style={{ color: "var(--color-warn)" }} />}
      </div>
      <div className="mt-0.5 text-[10px] text-muted">task</div>
      <button onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
        className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-elevated p-1 text-muted hover:text-danger group-hover:block" aria-label="Delete task">
        <Trash2 className="h-3 w-3" />
      </button>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-node-task" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode, task: TaskNode };

export function CrewCanvas({
  ws, sel, onSelect, onAddAgent, onAddTask, onDelete, onMove,
}: {
  ws: Workspace;
  sel: Sel;
  onSelect: (s: Sel) => void;
  onAddAgent: () => void;
  onAddTask: () => void;
  onDelete: (s: Sel) => void;
  onMove: (nodeId: string, x: number, y: number) => void;
}) {
  const layout = (ws.layout ?? {}) as Record<string, { x: number; y: number }>;

  const { nodes, edges } = useMemo(() => {
    const agentX: Record<string, number> = {};
    ws.tasks.forEach((t, i) => { if (!(t.agent in agentX)) agentX[t.agent] = i * 230; });

    const nodes: Node[] = [];
    ws.agents.forEach((a, i) => {
      const id = `agent:${a.id}`;
      nodes.push({
        id, type: "agent",
        position: layout[id] ?? { x: agentX[a.id] ?? i * 230, y: 0 },
        data: {
          label: a.role || "Untitled agent",
          selected: sel?.kind === "agent" && sel.idx === i,
          onSelect: () => onSelect({ kind: "agent", idx: i }),
          onDelete: () => onDelete({ kind: "agent", idx: i }),
        } satisfies AgentData,
      });
    });
    ws.tasks.forEach((t, i) => {
      const id = `task:${i}`;
      nodes.push({
        id, type: "task",
        position: layout[id] ?? { x: i * 230, y: 190 },
        data: {
          label: t.name || t.description?.slice(0, 24) || `task ${i + 1}`,
          hitl: !!t.human_input,
          selected: sel?.kind === "task" && sel.idx === i,
          onSelect: () => onSelect({ kind: "task", idx: i }),
          onDelete: () => onDelete({ kind: "task", idx: i }),
        } satisfies TaskData,
      });
    });

    const edges: Edge[] = [];
    ws.tasks.forEach((t, i) => {
      if (ws.agents.some((a) => a.id === t.agent))
        edges.push({ id: `own-${i}`, source: `agent:${t.agent}`, target: `task:${i}`,
          style: { stroke: "var(--color-node-agent)", strokeOpacity: 0.5 } });
      if (i > 0)
        edges.push({ id: `seq-${i}`, source: `task:${i - 1}`, target: `task:${i}`,
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-node-task)" },
          style: { stroke: "var(--color-node-task)" } });
    });
    return { nodes, edges };
  }, [ws, sel, onSelect, onDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.dragging === false && c.position) {
        onMove(c.id, c.position.x, c.position.y);
      }
    }
  }, [onMove]);

  const empty = ws.agents.length === 0 && ws.tasks.length === 0;

  return (
    <div className="relative h-[360px] w-full">
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <button onClick={onAddAgent}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-ink shadow hover:bg-elevated2">
          <Plus className="h-3 w-3" /><Bot className="h-3 w-3" style={{ color: "var(--color-node-agent)" }} /> Agent
        </button>
        <button onClick={onAddTask}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-ink shadow hover:bg-elevated2">
          <Plus className="h-3 w-3" /><ListChecks className="h-3 w-3" style={{ color: "var(--color-node-task)" }} /> Task
        </button>
      </div>
      {empty && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-sm text-muted">
          Add an agent and a task to start building.
        </div>
      )}
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView proOptions={{ hideAttribution: true }}
        nodesConnectable={false} colorMode="dark"
        onPaneClick={() => onSelect(null)}
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
