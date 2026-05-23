import { useEffect, useRef, useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";

// const API_BASE = "http://141.148.79.21:3000";
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:3000";

const LANGUAGES: Record<number, { label: string; monaco: string; default: string }> = {
 71: {
    label: "Python",
    monaco: "python",
    default: `import time
import math

JOBS = 15
SLEEP = 10

print(f"Submitting {JOBS} jobs to stress test the cluster...")
print(f"Each job will sleep {SLEEP}s — watch Workers scale up →")
print()

# Simulate CPU work while waiting
start = time.time()
for i in range(8):
    # Heavy computation
    result = sum(math.sqrt(j) for j in range(100000))
    elapsed = (time.time() - start) * 1000
    print(f"  Task {i+1}/8 | sqrt_sum={result:.0f} | elapsed={elapsed:.0f}ms")

print()
print(f"Total time: {(time.time()-start)*1000:.0f}ms")
print("Watch Workers card → should have scaled up during execution")
`,
  },
  63: {
    label: "JavaScript",
    monaco: "javascript",
    default: `// Sorting + stats demo
const n = 10000;
const arr = Array.from({length: n}, (_, i) => Math.sin(i * 1.1) * 1000 | 0);

console.log("Array size:", n);
console.log("First 5:", arr.slice(0, 5).join(", "));

const start = Date.now();
arr.sort((a, b) => a - b);
const ms = Date.now() - start;

console.log("\\nAfter sort:");
console.log("Min:", arr[0]);
console.log("Max:", arr[n - 1]);
console.log("Median:", arr[Math.floor(n / 2)]);

const sum = arr.reduce((a, b) => a + b, 0);
console.log("Sum:", sum);
console.log("Avg:", (sum / n).toFixed(2));
console.log("\\nSorted in:", ms + "ms");
`,
  },
  50: {
    label: "C",
    monaco: "c",
    default: `#include <stdio.h>
#include <time.h>

#define N 300

int A[N][N], B[N][N], C[N][N];

int main() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            A[i][j] = (i * 3 + j) % 100;
            B[i][j] = (i - j * 2) % 100;
        }

    clock_t start = clock();
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            C[i][j] = 0;
            for (int k = 0; k < N; k++)
                C[i][j] += A[i][k] * B[k][j];
        }
    double ms = (double)(clock() - start) / CLOCKS_PER_SEC * 1000;

    printf("Matrix multiply %dx%d\\n", N, N);
    printf("C[0][0]     = %d\\n", C[0][0]);
    printf("C[150][150] = %d\\n", C[150][150]);
    printf("C[299][299] = %d\\n", C[299][299]);
    printf("\\nComputed in %.2fms\\n", ms);
    printf("Operations: %d million\\n", (N*N*N)/1000000);
    return 0;
}
`,
  },
};

type JobStatus = "idle" | "pending" | "completed" | "runtime_error" | "timeout" | "compilation_error" | "memory_limit_exceeded";

interface JobResult {
  token: string;
  status: JobStatus;
  stdout?: string;
  stderr?: string;
  execution_time?: number;
  exit_code?: number;
}

interface Metrics {
  queued: number;
  workerCount: number;
}

interface MetricHistory {
  time: string;
  queued: number;
  workers: number;
}

const statusColor: Record<string, string> = {
  completed: "#22c55e",
  runtime_error: "#ef4444",
  timeout: "#f59e0b",
  compilation_error: "#f97316",
  memory_limit_exceeded: "#a855f7",
  pending: "#3b82f6",
  idle: "#6b7280",
};

const statusLabel: Record<string, string> = {
  completed: "✓ Accepted",
  runtime_error: "✗ Runtime Error",
  timeout: "⏱ Time Limit",
  compilation_error: "✗ Compile Error",
  memory_limit_exceeded: "✗ Memory Limit",
  pending: "⟳ Running...",
  idle: "Ready",
};

export default function App() {
  const [langId, setLangId] = useState<number>(71);
  const [code, setCode] = useState<string>(LANGUAGES[71].default);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [result, setResult] = useState<JobResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({ queued: 0, workerCount: 0 });
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [completedJobs, setCompletedJobs] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/metrics`);
      const m: Metrics = res.data;
      setMetrics(m);
      setHistory((prev) => {
        const now = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const next = [...prev.slice(-29), { time: now, queued: m.queued, workers: m.workerCount }];
        return next;
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

   useEffect(() => {
    drawChart();
  }, [history]);

  function drawChart() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (history.length < 2) {
      ctx.fillStyle = "#374151";
      ctx.font = "12px monospace";
      ctx.fillText("Waiting for data...", W / 2 - 55, H / 2);
      return;
    }

    const maxQ = Math.max(...history.map((h) => h.queued), 1);
    const maxW = Math.max(...history.map((h) => h.workers), 1);
    const pad = { top: 12, right: 16, bottom: 24, left: 32 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
    }

    const drawLine = (data: number[], max: number, color: string) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      data.forEach((val, i) => {
        const x = pad.left + (i / (data.length - 1)) * chartW;
        const y = pad.top + chartH - (val / max) * chartH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = color + "20";
      data.forEach((val, i) => {
        const x = pad.left + (i / (data.length - 1)) * chartW;
        const y = pad.top + chartH - (val / max) * chartH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(pad.left + chartW, pad.top + chartH);
      ctx.lineTo(pad.left, pad.top + chartH);
      ctx.closePath();
      ctx.fill();
    };

    drawLine(history.map((h) => h.queued), maxQ, "#3b82f6");
    drawLine(history.map((h) => h.workers), maxW, "#22c55e");

    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    const last = history[history.length - 1];
    const first = history[0];
    ctx.fillText(first.time, pad.left, H - 4);
    ctx.fillText(last.time, W - pad.right - 40, H - 4);
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setJobStatus("pending");
    setResult(null);
    setTotalJobs((t) => t + 1);

    try {
      const res = await axios.post(`${API_BASE}/submit/batch`, {
        submissions: [
          {
            source_code: code,
            language_id: langId,
            problem_id: `demo-${Date.now()}`,
            callback_url: "http://localhost:3002/callback",
            timeout: 10000,
            memory_limit: 256,
          },
        ],
      });

      const token: string = res.data.tokens[0];
      pollForResult(token);
    } catch (e) {
      setJobStatus("runtime_error");
      setSubmitting(false);
    }
  }
async function handleStressTest() {
  const jobs = Array.from({ length: 15 }, (_, i) => ({
    source_code: `import time\ntime.sleep(10)\nprint("job ${i + 1} done")`,
    language_id: 71,
    problem_id: `stress-${Date.now()}-${i}`,
    timeout: 15000,
    memory_limit: 256,
  }));

  try {
    await axios.post(`${API_BASE}/submit/batch`, { submissions: jobs });
    setTotalJobs(t => t + 15);
  } catch (e) {
    console.error(e);
  }
}
  function pollForResult(token: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await axios.get(`${API_BASE}/status/${token}`);
        const data: JobResult = res.data;
        if (data.status !== "pending") {
          clearInterval(pollRef.current!);
          setResult(data);
          setJobStatus(data.status as JobStatus);
          setSubmitting(false);
          if (data.status === "completed") setCompletedJobs((c) => c + 1);
        }
      } catch {}
      if (attempts > 40) {
        clearInterval(pollRef.current!);
        setJobStatus("timeout");
        setSubmitting(false);
      }
    }, 500);
  }

  function handleLangChange(id: number) {
    setLangId(id);
    setCode(LANGUAGES[id].default);
    setJobStatus("idle");
    setResult(null);
  }

  const statusCol = statusColor[jobStatus] ?? "#6b7280";

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", overflow: "hidden" }}>

      {/* LEFT: Editor panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #21262d", minWidth: 0 }}>

        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #21262d", background: "#161b22" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#58a6ff", letterSpacing: "0.05em" }}>CODERUN</span>
          <span style={{ fontSize: 11, color: "#6e7681", marginLeft: 4 }}>distributed execution engine</span>
          <div style={{ flex: 1 }} />
          {Object.entries(LANGUAGES).map(([id, lang]) => (
            <button
              key={id}
              onClick={() => handleLangChange(Number(id))}
              style={{
                padding: "4px 12px", fontSize: 12, borderRadius: 6, border: "1px solid",
                borderColor: langId === Number(id) ? "#58a6ff" : "#30363d",
                background: langId === Number(id) ? "#1f3a5f" : "transparent",
                color: langId === Number(id) ? "#58a6ff" : "#8b949e",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Monaco Editor */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            language={LANGUAGES[langId].monaco}
            value={code}
            onChange={(v) => setCode(v ?? "")}
            theme="vs-dark"
            options={{
              fontSize: 14, minimap: { enabled: false }, lineNumbers: "on",
              scrollBeyondLastLine: false, padding: { top: 16 },
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true, renderLineHighlight: "gutter",
            }}
          />
        </div>

        {/* Run bar */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid #21262d", background: "#161b22", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: "8px 24px", fontSize: 13, fontWeight: 600, borderRadius: 6,
              background: submitting ? "#1f3a5f" : "#238636", border: "1px solid",
              borderColor: submitting ? "#30363d" : "#2ea043",
              color: submitting ? "#8b949e" : "#ffffff",
              cursor: submitting ? "not-allowed" : "pointer", transition: "all 0.15s",
              fontFamily: "inherit",
            }}
          >
            {submitting ? "▶ Running..." : "▶ Run"}
          </button>
          <button
  onClick={handleStressTest}
  style={{
    padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6,
    background: "transparent", border: "1px solid #f59e0b",
    color: "#f59e0b", cursor: "pointer", fontFamily: "inherit",
    transition: "all 0.15s",
  }}
>
  ⚡ Stress Test
</button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusCol, boxShadow: submitting ? `0 0 8px ${statusCol}` : "none", transition: "all 0.3s" }} />
            <span style={{ fontSize: 12, color: statusCol, fontWeight: 500 }}>{statusLabel[jobStatus]}</span>
          </div>

          {result?.execution_time && (
            <span style={{ fontSize: 11, color: "#6e7681", marginLeft: "auto" }}>
              {result.execution_time}ms · exit {result.exit_code}
            </span>
          )}
        </div>

        {/* Output panel */}
        <div style={{ height: 180, borderTop: "1px solid #21262d", background: "#0d1117", overflow: "auto", padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "#6e7681", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Output</div>
          {result ? (
            <pre style={{ fontSize: 13, margin: 0, color: result.stdout ? "#e6edf3" : "#f85149", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {result.stdout || result.stderr || "No output"}
            </pre>
          ) : (
            <span style={{ fontSize: 13, color: "#6e7681" }}>
              {jobStatus === "pending" ? "Executing..." : "Run your code to see output"}
            </span>
          )}
        </div>
      </div>

      {/* RIGHT: Dashboard panel */}
      <div style={{ width: 320, display: "flex", flexDirection: "column", background: "#161b22", overflow: "auto" }}>

        {/* Dashboard header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d" }}>
          <div style={{ fontSize: 11, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em" }}>Cluster Dashboard</div>
        </div>

        {/* Metric cards */}
        <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "Workers", value: metrics.workerCount, color: "#22c55e" },
            { label: "Queued", value: metrics.queued, color: "#3b82f6" },
            { label: "Submitted", value: totalJobs, color: "#a78bfa" },
            { label: "Completed", value: completedJobs, color: "#34d399" },
          ].map((m) => (
            <div key={m.label} style={{ background: "#0d1117", borderRadius: 8, padding: "10px 12px", border: "1px solid #21262d" }}>
              <div style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: m.color, lineHeight: 1 }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Live metrics</div>
          <div style={{ background: "#0d1117", borderRadius: 8, border: "1px solid #21262d", padding: 8 }}>
            <canvas ref={canvasRef} width={270} height={100} style={{ display: "block" }} />
            <div style={{ display: "flex", gap: 16, marginTop: 6, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 16, height: 2, background: "#3b82f6", borderRadius: 1 }} />
                <span style={{ fontSize: 10, color: "#6e7681" }}>queued</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 16, height: 2, background: "#22c55e", borderRadius: 1 }} />
                <span style={{ fontSize: 10, color: "#6e7681" }}>workers</span>
              </div>
            </div>
          </div>
        </div>

        {/* Architecture diagram */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>System architecture</div>
          <div style={{ background: "#0d1117", borderRadius: 8, border: "1px solid #21262d", padding: 12, fontSize: 11, color: "#8b949e", lineHeight: 1.8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { icon: "🌐", label: "React Frontend", color: "#58a6ff" },
                { icon: "↓", label: "", color: "#30363d" },
                { icon: "⚡", label: "Fastify API  :3000", color: "#a78bfa" },
                { icon: "↓", label: "", color: "#30363d" },
                { icon: "📦", label: "Redis Queue", color: "#f59e0b" },
                { icon: "↓", label: "", color: "#30363d" },
                { icon: "⚙️", label: `Workers ×${metrics.workerCount}  (auto-scale)`, color: "#22c55e" },
                { icon: "↓", label: "", color: "#30363d" },
                { icon: "📡", label: "Webhook  :3001", color: "#3b82f6" },
              ].map((row, i) =>
                row.label ? (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 16, textAlign: "center" }}>{row.icon}</span>
                    <span style={{ color: row.color }}>{row.label}</span>
                  </div>
                ) : (
                  <div key={i} style={{ paddingLeft: 6, color: "#30363d" }}>│</div>
                )
              )}
            </div>
          </div>
        </div>

        {/* K8s info */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Kubernetes</div>
          <div style={{ background: "#0d1117", borderRadius: 8, border: "1px solid #21262d", padding: 12 }}>
            {[
              { label: "Cluster", value: "docker-desktop" },
              { label: "Namespace", value: "default" },
              { label: "Deployment", value: "code-worker-deployment" },
              { label: "Min pods", value: "1" },
              { label: "Max pods", value: "10" },
              { label: "Scale trigger", value: "5 jobs/pod" },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #21262d", fontSize: 11 }}>
                <span style={{ color: "#6e7681" }}>{row.label}</span>
                <span style={{ color: "#e6edf3", fontFamily: "monospace" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Refresh indicator */}
        <div style={{ padding: "8px 16px", marginTop: "auto", borderTop: "1px solid #21262d" }}>
          <span style={{ fontSize: 10, color: "#6e7681" }}>⟳ metrics refresh every 3s</span>
        </div>
      </div>
    </div>
  );
}