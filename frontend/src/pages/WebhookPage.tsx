interface WebhookPageProps {
  apiKey: string;
  health: Record<string, unknown> | null;
}

export default function WebhookPage({ apiKey, health }: WebhookPageProps) {
  const ready = Boolean(health?.ready_to_generate);
  const reasons = Array.isArray(health?.readiness_reasons)
    ? (health?.readiness_reasons as string[]).join(" · ")
    : "";  const apiOrigin = typeof window !== "undefined"
    ? (window.location.port === "5173" ? `${window.location.protocol}//${window.location.hostname}:8765` : window.location.origin)
    : "http://127.0.0.1:8765";

  return (
    <div className="webhook-page" style={{ paddingBottom: 60 }}>
      <header className="page-header">
        <div className="page-title-group">
          <h1>Tài liệu Webhook & API từ xa</h1>
          <span className="pill pill-purple">REST API v0.2</span>
        </div>
      </header>
 
      <div className="info-grid" style={{ marginBottom: 24 }}>
        <div className="info-card">
          <span>Base URL</span>
          <code>{apiOrigin}/api</code>
        </div>
        <div className="info-card">
          <span>API Key của bạn</span>
          <code>{apiKey || "..."}</code>
        </div>
        <div className="info-card">
          <span>Trạng thái Gen</span>
          <code>{health ? (ready ? "Sẵn sàng gen" : "Online / Chưa sẵn sàng") : "Offline"}</code>
        </div>
      </div>
      {reasons ? (
        <p className="muted" style={{ marginBottom: 24, padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 6, color: "#fca5a5" }}>
          Lưu ý hệ thống chưa sẵn sàng: {reasons}
        </p>
      ) : null}
 
      <div className="settings-tabs" style={{ marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        <div className="settings-tab active">Danh sách chi tiết API & Hướng dẫn sử dụng</div>
      </div>
 
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
 
        {/* 1. API Image Generate */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge post">POST</span>
            <span className="api-path">/api/image/generate</span>
          </div>
          <p className="api-desc">
            API tạo ảnh đơn lẻ (Tạo nhanh). Hệ thống sẽ tự động chọn một tài khoản còn lượt chạy phù hợp với model yêu cầu để thực thi và tải kết quả về máy chủ.
          </p>
          <div className="api-params-title">Tham số đầu vào (JSON Body)</div>
          <table className="api-params-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Trường</th>
                <th style={{ width: "20%" }}>Kiểu dữ liệu</th>
                <th>Mô tả</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>prompt</code> <span className="api-param-req">Bắt buộc</span></td>
                <td>String</td>
                <td>Câu mô tả hình ảnh bằng tiếng Anh hoặc tiếng Việt (tự động dịch/AI tối ưu tùy cài đặt).</td>
              </tr>
              <tr>
                <td><code>model</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>String</td>
                <td>Model sử dụng. Ví dụ: <code>nano_banana_2_lite</code>, <code>nano_banana_2_pro</code>.</td>
              </tr>
              <tr>
                <td><code>aspect_ratio</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>String</td>
                <td>Tỉ lệ khung hình. Các tỉ lệ hỗ trợ: <code>1:1</code>, <code>16:9</code>, <code>4:3</code>, <code>9:16</code>, <code>3:4</code>.</td>
              </tr>
            </tbody>
          </table>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -X POST ${apiOrigin}/api/image/generate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"prompt":"A magical wizard cat, detailed digital art","model":"nano_banana_2_lite","aspect_ratio":"16:9"}'`}</pre>
        </div>
 
        {/* 2. List Workflows */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge get">GET</span>
            <span className="api-path">/api/webhook/workflows</span>
          </div>
          <p className="api-desc">
            Lấy toàn bộ danh sách các Workflow mẫu và Workflow cá nhân bạn đã thiết kế trong trình chỉnh sửa Graph UI. Kết quả trả về chứa ID của workflow dùng để kích hoạt chạy từ xa.
          </p>
          <div className="api-params-title">Kết quả phản hồi (JSON Response)</div>
          <pre className="code-block">{`{
  "workflows": [
    {
      "id": "sample_workflow_id",
      "name": "Mẫu: Prompt → Ảnh → Video",
      "node_count": 3,
      "updated_at": 1783694802.0
    }
  ]
}`}</pre>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -H "X-API-Key: ${apiKey}" \\
  ${apiOrigin}/api/webhook/workflows`}</pre>
        </div>
 
        {/* 3. Run Workflow */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge post">POST</span>
            <span className="api-path">/api/webhook/workflows/{"{workflow_id}"}/run</span>
          </div>
          <p className="api-desc">
            Kích hoạt chạy một sơ đồ Workflow tự động hóa bằng ID. Thích hợp để tích hợp với webhook từ n8n/Make.com khi muốn chạy một quy trình gen hàng loạt.
          </p>
          <div className="api-params-title">Tham số đầu vào (JSON Body)</div>
          <table className="api-params-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Trường</th>
                <th style={{ width: "20%" }}>Kiểu dữ liệu</th>
                <th>Mô tả</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>async_mode</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>Boolean</td>
                <td>Mặc định <code>true</code> (trả về <code>run_id</code> ngay). Đặt <code>false</code> nếu muốn API giữ kết nối (blocking) chờ gen xong mới trả kết quả.</td>
              </tr>
              <tr>
                <td><code>project_id</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>String</td>
                <td>Chỉ định ID của project để lưu tệp tin gọn gàng vào thư mục riêng của project đó.</td>
              </tr>
              <tr>
                <td><code>node_overrides</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>Object</td>
                <td>Ghi đè dữ liệu của từng Node trong graph. Cấu trúc: <code>{"{ \"[id_nút]\": { \"[trường]\": \"[giá_trị]\" } }"}</code>. Ví dụ ghi đè prompt nhập vào từ CRM bên ngoài.</td>
              </tr>
            </tbody>
          </table>
          <div className="api-params-title">Lệnh gọi mẫu (Chạy Async + Ghi đè prompt cho nút n_prompt)</div>
          <pre className="code-block">{`curl -X POST ${apiOrigin}/api/webhook/workflows/<workflow_id>/run \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{
    "async_mode": true,
    "node_overrides": {
      "n_prompt": {
        "prompt": "A cybernetic wolf glowing in dark synthwave forest"
      }
    }
  }'`}</pre>
        </div>
 
        {/* 4. Poll Workflow Run Status */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge get">GET</span>
            <span className="api-path">/api/webhook/workflows/runs/{"{run_id}"}</span>
          </div>
          <p className="api-desc">
            Kiểm tra trạng thái, log chi tiết từng bước, tiến độ phần trăm và link kết quả tải về của một lượt chạy sơ đồ Workflow (khi chạy ở chế độ <code>async_mode: true</code>).
          </p>
          <div className="api-params-title">Kết quả phản hồi (JSON Response)</div>
          <pre className="code-block">{`{
  "run_id": "c682beba38",
  "status": "completed", // running | completed | failed
  "progress": { "done": 3, "total": 3, "current": null },
  "node_results": {
    "n_gen": {
      "status": "completed",
      "results": ["/api/files/G-Labs BW/image_output/task_123/img.png"]
    }
  },
  "logs": [
    { "t": 1783694900, "msg": "Run n_gen type=generate" },
    { "t": 1783694920, "msg": "OK n_gen" }
  ]
}`}</pre>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -H "X-API-Key: ${apiKey}" \\
  ${apiOrigin}/api/webhook/workflows/runs/<run_id>`}</pre>
        </div>
 
        {/* 5. Upload File */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge post">POST</span>
            <span className="api-path">/api/webhook/upload</span>
          </div>
          <p className="api-desc">
            Tải lên tệp âm thanh (nhạc nền), ảnh tham chiếu (Image Reference) hoặc video thô từ xa. Tệp tin sẽ được lưu an toàn tại thư mục máy chủ và trả về URL để truyền tiếp vào API dựng ghép video.
          </p>
          <div className="api-params-title">Tham số đầu vào (Multipart Form)</div>
          <table className="api-params-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Trường</th>
                <th style={{ width: "20%" }}>Kiểu</th>
                <th>Mô tả</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>file</code> <span className="api-param-req">Bắt buộc</span></td>
                <td>File Binary</td>
                <td>Tệp nhạc mp3/wav, ảnh png/jpg, hoặc video mp4 cần upload lên server.</td>
              </tr>
            </tbody>
          </table>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -X POST ${apiOrigin}/api/webhook/upload \\
  -H "X-API-Key: ${apiKey}" \\
  -F "file=@/path/to/sound.mp3"`}</pre>
        </div>
 
        {/* 6. Assemble Video */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge post">POST</span>
            <span className="api-path">/api/webhook/video/assemble</span>
          </div>
          <p className="api-desc">
            Ghép nối các đoạn video ngắn thành một video dài hoàn chỉnh (Timeline). Hỗ trợ lồng nhạc nền (nhiều bản nhạc đặt ở các mốc thời gian khác nhau) và chèn chữ phụ đề (Subtitle) nhiều kiểu phong cách với định vị tọa độ.
          </p>
          <div className="api-params-title">Tham số đầu vào (JSON Body)</div>
          <table className="api-params-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Trường</th>
                <th style={{ width: "20%" }}>Kiểu dữ liệu</th>
                <th>Mô tả</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>clips</code> <span className="api-param-req">Bắt buộc</span></td>
                <td>Array [Object]</td>
                <td>Danh sách video nguồn ghép. Mỗi clip gồm: <code>url</code> (hoặc <code>path</code>), <code>trim_start</code> (cắt đầu), <code>trim_end</code> (cắt đuôi).</td>
              </tr>
              <tr>
                <td><code>audios</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>Array [Object]</td>
                <td>Nhạc nền chèn. Mỗi audio gồm: <code>url</code>, <code>start</code> (mốc bắt đầu trên timeline), <code>trim_start</code>, <code>trim_end</code>, <code>volume</code> (0.0 đến 2.0).</td>
              </tr>
              <tr>
                <td><code>texts</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>Array [Object]</td>
                <td>Chữ phụ đề chèn. Gồm: <code>text</code>, <code>start</code>, <code>end</code>, <code>style</code> (title, subtitle, top, center_box, v.v.), <code>color</code>, <code>font_size</code>.</td>
              </tr>
              <tr>
                <td><code>filename</code> <span className="api-param-opt">Tùy chọn</span></td>
                <td>String</td>
                <td>Tên file video đầu ra (mặc định tự tạo tên ngẫu nhiên kèm timestamp).</td>
              </tr>
            </tbody>
          </table>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -X POST ${apiOrigin}/api/webhook/video/assemble \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{
    "clips": [
      { "url": "/api/files/G-Labs BW/video_output/clip1.mp4" },
      { "url": "/api/files/G-Labs BW/video_output/clip2.mp4", "trim_start": 0.5, "trim_end": 7.0 }
    ],
    "audios": [
      { "url": "/api/files/G-Labs BW/webhook_uploads/bgm.mp3", "start": 0, "volume": 0.5 }
    ],
    "texts": [
      { "text": "Đoạn phim 1", "start": 0, "end": 2.5, "style": "title", "color": "yellow" },
      { "text": "Kết thúc phim", "start": 8.0, "end": 10.0, "style": "subtitle" }
    ]
  }'`}</pre>
        </div>
 
        {/* 7. List Accounts */}
        <div className="api-doc-card">
          <div className="api-header">
            <span className="api-badge get">GET</span>
            <span className="api-path">/api/webhook/accounts</span>
          </div>
          <p className="api-desc">
            Liệt kê danh sách các tài khoản đang chạy tự động trong hệ thống (Google Flow, Grok). Giúp hệ thống bên ngoài tự động giám sát xem có tài khoản nào bị lỗi, hết hạn cookie hoặc đang trong thời gian chờ (cooldown).
          </p>
          <div className="api-params-title">Kết quả phản hồi (JSON Response)</div>
          <pre className="code-block">{`{
  "accounts": [
    {
      "id": "account_unique_id",
      "provider": "flow",
      "label": "gmail_cua_ban@gmail.com",
      "enabled": true,
      "in_cooldown": false,
      "cooldown_left_sec": 0,
      "last_error": null
    }
  ]
}`}</pre>
          <div className="api-params-title">Lệnh gọi curl mẫu</div>
          <pre className="code-block">{`curl -H "X-API-Key: ${apiKey}" \\
  ${apiOrigin}/api/webhook/accounts`}</pre>
        </div>
      </div>
    </div>
  );
}
