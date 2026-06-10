import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type KnowledgeBase, type SearchHit } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, Modal, Tabs, TabsList, TabsTrigger, TabsContent, Textarea } from "../components/ui";
import { useToast } from "../lib/toast";
import { Database, GitBranch, Globe, Plus, Trash2, Upload } from "lucide-react";

const SRC_TONE = { ready: "ok", processing: "running", error: "danger" } as const;

export function Knowledge() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selId = params.get("kb");
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const loadList = useCallback(() => api.knowledgeBases().then((d) => setKbs(d.knowledge_bases)).catch(() => {}), []);
  useEffect(() => { loadList(); }, [loadList]);

  const loadKb = useCallback(() => {
    if (selId) api.knowledgeBase(selId).then(setKb).catch(() => setKb(null));
    else setKb(null);
  }, [selId]);
  useEffect(() => { loadKb(); }, [loadKb]);

  // Poll while any source is still processing.
  useEffect(() => {
    if (!kb?.sources?.some((s) => s.status === "processing")) return;
    const id = window.setInterval(() => { loadKb(); loadList(); }, 1500);
    return () => window.clearInterval(id);
  }, [kb, loadKb, loadList]);

  async function create() {
    try { const k = await api.createKnowledge(name || "Knowledge base"); setCreating(false); setName(""); await loadList(); setParams({ kb: k.id }); }
    catch (e) { toast(String(e), "error"); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this knowledge base?")) return;
    await api.deleteKnowledge(id); toast("Deleted", "ok"); setParams({}); loadList();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Knowledge</h1>
          <p className="max-w-2xl text-sm text-muted">Ingest files, text, web pages, docs sites and GitHub repos. Agents search them at run time. Embeddings run locally — no API key needed.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New knowledge base</Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader title="Knowledge bases" />
          <div className="divide-y divide-border">
            {kbs.map((k) => (
              <div key={k.id} className={`group flex items-center gap-2 px-4 py-2.5 text-sm transition ${k.id === selId ? "bg-brand-soft" : "hover:bg-elevated2"}`}>
                <button onClick={() => setParams({ kb: k.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Database className="h-4 w-4 shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{k.name}</span>
                    <span className="text-[10px] text-muted">{k.stats.sources} sources · {k.stats.chunks} chunks</span>
                  </span>
                </button>
                <button onClick={() => remove(k.id)} className="opacity-0 transition group-hover:opacity-100 text-muted hover:text-danger" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {!kbs.length && <div className="px-4 py-6 text-sm text-muted">No knowledge bases yet.</div>}
          </div>
        </Card>

        {kb ? <KbDetail kb={kb} onChanged={() => { loadKb(); loadList(); }} /> : (
          <Card><div className="grid h-[300px] place-items-center text-sm text-muted">Select or create a knowledge base.</div></Card>
        )}
      </div>

      {creating && (
        <Modal title="New knowledge base" onClose={() => setCreating(false)}>
          <div className="space-y-4">
            <Input autoFocus placeholder="e.g. Company Docs" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create}>Create</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function KbDetail({ kb, onChanged }: { kb: KnowledgeBase; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [crawl, setCrawl] = useState(false);
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addText() {
    if (!text.trim()) return;
    setBusy(true);
    try { await api.addKbSource(kb.id, { kind: "text", text }); setText(""); onChanged(); toast("Ingesting…", "ok"); }
    catch (e) { toast(String(e), "error"); } finally { setBusy(false); }
  }
  async function addUrl() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await api.addKbSource(kb.id, { kind: "url", url: url.trim(), crawl });
      setUrl(""); onChanged(); toast(crawl ? "Crawling site…" : "Fetching page…", "ok");
    } catch (e) { toast(String(e), "error"); } finally { setBusy(false); }
  }
  async function addRepo() {
    if (!repo.trim()) return;
    setBusy(true);
    try {
      await api.addKbSource(kb.id, { kind: "github", url: repo.trim() });
      setRepo(""); onChanged(); toast("Ingesting repo…", "ok");
    } catch (e) { toast(String(e), "error"); } finally { setBusy(false); }
  }
  async function addFile(file: File) {
    setBusy(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
      });
      await api.addKbSource(kb.id, { kind: "file", filename: file.name, content_b64: b64 });
      onChanged(); toast(`Ingesting ${file.name}…`, "ok");
    } catch (e) { toast(String(e), "error"); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function search() {
    try { const d = await api.searchKb(kb.id, q); setHits(d.results); } catch (e) { toast(String(e), "error"); }
  }

  return (
    <Card>
      <CardHeader title={kb.name} sub={`${kb.stats.sources} sources · ${kb.stats.chunks} chunks · local embeddings`} />
      <div className="space-y-5 p-5">
        <Tabs defaultValue="add">
          <TabsList>
            <TabsTrigger value="add">Text & files</TabsTrigger>
            <TabsTrigger value="web">Web page</TabsTrigger>
            <TabsTrigger value="github">GitHub repo</TabsTrigger>
          </TabsList>
          <TabsContent value="add">
            <div className="space-y-3">
              <Textarea placeholder="Paste text/notes to ingest…" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex items-center gap-2">
                <Button onClick={addText} disabled={busy || !text.trim()}>Add text</Button>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && addFile(e.target.files[0])} />
                <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="h-4 w-4" /> Upload file</Button>
                <span className="text-xs text-muted">pdf · docx · md · txt · csv</span>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="web">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="https://docs.example.com/intro" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUrl()} />
                <Button onClick={addUrl} disabled={busy || !url.trim()}><Globe className="h-4 w-4" /> Ingest</Button>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} className="accent-[var(--brand)]" />
                Crawl the whole site (follows same-site links, up to 30 pages)
              </label>
            </div>
          </TabsContent>
          <TabsContent value="github">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="https://github.com/owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRepo()} />
                <Button onClick={addRepo} disabled={busy || !repo.trim()}><GitBranch className="h-4 w-4" /> Ingest</Button>
              </div>
              <p className="text-xs text-muted">Public repos only. Docs and source files are indexed (readme, md, code); lockfiles and binaries are skipped.</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* sources */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Sources</div>
          <div className="space-y-1">
            {(kb.sources ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md border border-border bg-canvas px-3 py-1.5 text-xs">
                <span className="truncate text-ink">{s.ref}</span>
                <Badge tone={SRC_TONE[s.status]}>{s.status === "ready" ? `${s.chunks} chunks` : s.status === "processing" ? (s.progress || "processing") : s.status}</Badge>
                {s.error && <span className="truncate text-danger">{s.error}</span>}
              </div>
            ))}
            {!kb.sources?.length && <div className="text-xs text-muted">No sources yet — add text or a file above.</div>}
          </div>
        </div>

        {/* test search */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Test search</div>
          <div className="flex gap-2">
            <Input placeholder="Ask a question your agents might ask…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
            <Button onClick={search} disabled={!q.trim()}>Search</Button>
          </div>
          {hits && (
            <div className="mt-3 space-y-2">
              {hits.map((h, i) => (
                <div key={i} className="rounded-lg border border-border bg-canvas p-3 text-xs">
                  <div className="mb-1 flex items-center gap-2 text-muted"><Badge tone="brand">{h.score.toFixed(2)}</Badge><span className="truncate">{h.source}</span></div>
                  <div className="line-clamp-3 text-ink">{h.text}</div>
                </div>
              ))}
              {!hits.length && <div className="text-xs text-muted">No results.</div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
