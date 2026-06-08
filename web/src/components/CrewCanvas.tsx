import { useCallback, useMemo } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  type Node, type Edge, type NodeProps, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, ListChecks, Plus, Trash2, Pause } from "lucide-react";
import type { Workspace } from "../lib/api";

// The canvas IS the editor (add/select/drag/delete) and the live run view
// (nodes glow by run status). Pass readOnly to use it purely for observation.

export type Sel = { kind: "agent" | "task"; idx: number } | null;
export type NodeStatus = "running" | "done" | "error";

type BaseData = {
  label: string; selected: boolean; status?: NodeStatus; readOnly?: boolean;
  onSelect: () => void; onDelete: () => void;
};
type TaskData = BaseData & { hitl: boolean };

// Literal class strings (Tailwind JIT can't see dynamically-built names).
const STATUS_RING: Record<NodeStatus, string> = {
  running: "border-running ring-2 ring-running/50 animate-pulse",
  done: "border-ok ring-2 ring-ok/40",
  error: "border-danger ring-2 ring-danger/50",
};
const AGENT_SKIN = {
  bg: "bg-elevated2", handle: "!h-1.5 !w-1.5 !border-0 !bg-node-agent",
  sel: "border-node-agent ring-2 ring-node-agent/40", base: "border-border-strong hover:border-node-agent/60",
};
const TASK_SKIN = {
  bg: "bg-elevated", handle: "!h-1.5 !w-1.5 !border-0 !bg-node-task",
  sel: "border-node-task ring-2 ring-node-task/40", base: "border-border-strong hover:border-node-task/60",
};

function NodeShell({ data, skin, kind, children }: {
  data: BaseData; skin: typeof AGENT_SKIN; kind: string; children?: React.ReactNode;
}) {
  const edge = data.status ? STATUS_RING[data.status] : data.selected ? skin.sel : skin.base;
  return (
    <div onClick={data.onSelect}
      className={`group relative w-[180px] cursor-pointer rounded-xl border px-3 py-2 text-xs transition ${skin.bg} ${edge}`}>
      <Handle type="target" position={Position.Top} className={skin.handle} />
      {children}
      {!data.readOnly && (
        <button onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
          className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-elevated p-1 text-muted hover:text-danger group-hover:block" aria-label={`Delete ${kind}`}>
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className={skin.handle} />
    </div>
  );
}

function AgentNode({ data }: NodeProps<Node<BaseData>>) {
  return (
    <NodeShell data={data} skin={AGENT_SKIN} kind="agent">
      <div className="flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-node-agent)" }} />
        <span className="truncate font-medium text-ink">{data.label}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted">agent</div>
    </NodeShell>
  );
}

function TaskNode({ data }: NodeProps<Node<TaskData>>) {
  return (
    <NodeShell data={data} skin={TASK_SKIN} kind="task">
      <div className="flex items-center gap-1.5">
        <ListChecks className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-node-task)" }} />
        <span className="truncate font-medium text-ink">{data.label}</span>
        {data.hitl && <Pause className="h-3 w-3 shrink-0" style={{ color: "var(--color-warn)" }} />}
      </div>
      <div className="mt-0.5 text-[10px] text-muted">task</div>
    </NodeShell>
  );
}

const nodeTypes = { agent: AgentNode, task: TaskNode };
const noop = () => {};

export function CrewCanvas({
  ws, sel = null, onSelect = noop, onAddAgent = noop, onAddTask = noop, onDelete = noop, onMove = noop,
  readOnly = false, status = {},
}: {
  ws: Workspace;
  sel?: Sel;
  onSelect?: (s: Sel) => void;
  onAddAgent?: () => void;
  onAddTask?: () => void;
  onDelete?: (s: Sel) => void;
  onMove?: (nodeId: string, x: number, y: number) => void;
  readOnly?: boolean;
  status?: Record<string, NodeStatus>;
}) {
  const layout = (ws.layout ?? {}) as Record<string, { x: number; y: number }>;

  const { nodes, edges } = useMemo(() => {
    const agentX: Record<string, number> = {};
    ws.tasks.forEach((t, i) => { if (!(t.agent in agentX)) agentX[t.agent] = i * 230; });

    const nodes: Node[] = [];
    ws.agents.forEach((a, i) => {
      const id = `agent:${a.id}`;
      nodes.push({
        id, type: "agent", draggable: !readOnly,
        position: layout[id] ?? { x: agentX[a.id] ?? i * 230, y: 0 },
        data: {
          label: a.role || "Untitled agent", status: status[id], readOnly,
          selected: sel?.kind === "agent" && sel.idx === i,
          onSelect: () => onSelect({ kind: "agent", idx: i }),
          onDelete: () => onDelete({ kind: "agent", idx: i }),
        } satisfies BaseData,
      });
    });
    ws.tasks.forEach((t, i) => {
      const id = `task:${i}`;
      nodes.push({
        id, type: "task", draggable: !readOnly,
        position: layout[id] ?? { x: i * 230, y: 190 },
        data: {
          label: t.name || t.description?.slice(0, 24) || `task ${i + 1}`,
          hitl: !!t.human_input, status: status[id], readOnly,
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
  }, [ws, sel, status, readOnly, onSelect, onDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (readOnly) return;
    for (const c of changes) {
      if (c.type === "position" && c.dragging === false && c.position) {
        onMove(c.id, c.position.x, c.position.y);
      }
    }
  }, [onMove, readOnly]);

  const empty = ws.agents.length === 0 && ws.tasks.length === 0;

  return (
    <div className="relative h-[360px] w-full">
      {!readOnly && (
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
      )}
      {empty && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-sm text-muted">
          {readOnly ? "This workflow has no nodes." : "Add an agent and a task to start building."}
        </div>
      )}
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView proOptions={{ hideAttribution: true }}
        nodesConnectable={false} colorMode="dark"
        onPaneClick={() => !readOnly && onSelect(null)}
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
