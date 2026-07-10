interface WebhookPageProps {
  apiKey: string;
  health: Record<string, unknown> | null;
}

export default function WebhookPage({ apiKey, health }: WebhookPageProps) {
  const ready = Boolean(health?.ready_to_generate);
  const reasons = Array.isArray(health?.readiness_reasons)
    ? (health?.readiness_reasons as string[]).join(" · ")
    : "";

  return (
    <div className="webhook-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Webhook API</h1>
          <span className="pill pill-purple">REST</span>
        </div>
      </header>

      <div className="info-grid">
        <div className="info-card">
          <span>Base URL</span>
          <code>http://127.0.0.1:8765/api</code>
        </div>
        <div className="info-card">
          <span>API Key</span>
          <code>{apiKey || "..."}</code>
        </div>
        <div className="info-card">
          <span>Health</span>
          <code>{health ? (ready ? "Ready" : "Online / not ready") : "Offline"}</code>
        </div>
      </div>
      {reasons ? <p className="muted">Readiness: {reasons}</p> : null}

      <pre className="code-block">{`curl -X POST http://127.0.0.1:8765/api/image/generate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"prompt":"a cat wearing sunglasses","model":"nano_banana_2","aspect_ratio":"16:9"}'`}</pre>

      <h2 style={{ marginTop: 24, fontSize: 16 }}>Batch async (n8n / job lớn)</h2>
      <pre className="code-block">{`# 1) Submit
curl -X POST http://127.0.0.1:8765/api/batch/submit-async \\
  -H "Content-Type: application/json" \\
  -d '{"concurrency":3,"items":[{"prompt":"cat","provider":"image","params":{}}]}'

# 2) Poll
curl http://127.0.0.1:8765/api/batch/<batch_id>`}</pre>

      <p className="muted">
        API: /api/image/generate, /api/video/generate, /api/grok/generate, /api/status/:id,
        /api/batch/submit, /api/batch/submit-async, /api/batch/:id, /api/maintenance/disk,
        /api/files/:path
      </p>
    </div>
  );
}
