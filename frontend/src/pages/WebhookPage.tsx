interface WebhookPageProps {
  apiKey: string;
  health: Record<string, unknown> | null;
}

export default function WebhookPage({ apiKey, health }: WebhookPageProps) {
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
          <code>{health ? "Online" : "Offline"}</code>
        </div>
      </div>

      <pre className="code-block">{`curl -X POST http://127.0.0.1:8765/api/image/generate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"prompt":"a cat wearing sunglasses","model":"nano_banana_2","aspect_ratio":"16:9"}'`}</pre>

      <p className="muted">
        API tương thích G-Labs: /api/image/generate, /api/video/generate, /api/grok/generate,
        /api/meta/generate, /api/status/:id, /api/files/:name
      </p>
    </div>
  );
}