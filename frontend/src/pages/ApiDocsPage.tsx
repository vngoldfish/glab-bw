import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { NAV_ROUTES } from "../routes";

export default function ApiDocsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"endpoints" | "demos" | "n8n-postman">("endpoints");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleTriggerDemo = async (demoType: "complex" | "continuous" | "images", action: "create" | "run") => {
    let payload: any = {};
    let projectName = "";

    if (demoType === "complex") {
      projectName = `Demo Phức Tạp 001-009 (${action === "create" ? "Thô" : "Chạy"})`;
      payload = {
        project_name: projectName,
        aspect_ratio: "16:9",
        model_image: "nano_banana_2_lite",
        model_video: "veo_31_fast",
        boxes: [
          {
            type: "generate",
            prompts: (
              "001. Hand-drawn 2D doodle cartoon, a red alarm clock blaring on a nightstand, cobalt blue background.\n" +
              "002. Hand-drawn 2D doodle cartoon, @MODERNYOU waking up in bed with a dreading frown, cobalt blue background.\n" +
              "003. Hand-drawn 2D doodle cartoon, @MODERNYOU drinking a hot cup of coffee in the kitchen, cobalt blue background.\n" +
              "004. Hand-drawn 2D doodle cartoon, @MODERNYOU stepping out of the house into the rain, holding an umbrella, cobalt blue background.\n" +
              "005. Hand-drawn 2D doodle cartoon, @MODERNYOU waiting at the bus stop, rumpled clothes, cobalt blue background.\n" +
              "006. Hand-drawn 2D doodle cartoon, @MODERNYOU sitting inside a crowded bus looking out of the wet window, cobalt blue background.\n" +
              "007. Hand-drawn 2D doodle cartoon, @MODERNYOU walking into a large office building with a heavy sigh, cobalt blue background.\n" +
              "008. Hand-drawn 2D doodle cartoon, @MODERNYOU sitting at his office desk stacked high with documents, cobalt blue background.\n" +
              "009. Hand-drawn 2D doodle cartoon, @MODERNYOU looking up at the office wall clock showing 5 PM with a huge smile, cobalt blue background."
            )
          },
          {
            type: "video_generate",
            prompts: (
              "001. Hand-drawn 2D doodle cartoon animation, alarm clock vibrating violently, cobalt blue background.\n" +
              "002. Hand-drawn 2D doodle cartoon animation, @MODERNYOU reaches out to smash the alarm button, cobalt blue background.\n" +
              "003. Hand-drawn 2D doodle cartoon animation, steam rising from the coffee cup as @MODERNYOU takes a sip, cobalt blue background."
            )
          },
          {
            type: "video_generate",
            prompts: (
              "001. Hand-drawn 2D doodle cartoon animation, clock suddenly flies off the table, cobalt blue background.\n" +
              "003. Hand-drawn 2D doodle cartoon animation, @MODERNYOU smiles and drops a sugar cube into the cup, cobalt blue background."
            )
          },
          {
            type: "video_generate",
            prompts: (
              "001. Hand-drawn 2D doodle cartoon animation, alarm clock smashes on the floor into pieces, cobalt blue background.\n" +
              "003. Hand-drawn 2D doodle cartoon animation, coffee splashes slightly as sugar dissolves, cobalt blue background."
            )
          }
        ],
        references: [
          {
            name: "MODERNYOU",
            image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXUpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAnUlEQVR42u3TQQ0AIBDAsIG/tL+0i4spQA6Sg7xWp/2qPwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcDkAWN0Abe1D1JcAAAAAElFTkSuQmCC"
          }
        ]
      };
    } else if (demoType === "continuous") {
      projectName = `Demo Xuyên Suốt Chỉ 001 (${action === "create" ? "Thô" : "Chạy"})`;
      payload = {
        project_name: projectName,
        aspect_ratio: "16:9",
        model_video: "veo_31_fast",
        boxes: [
          {
            type: "video_generate",
            prompts: "001 cô gái @char đang đứng thủ thế võ thuật dưới mưa"
          },
          {
            type: "video_generate",
            prompts: "001 cô gái @char nhảy lên thực hiện cú đá xoáy vòng"
          },
          {
            type: "video_generate",
            prompts: "001 cô gái @char tiếp đất bằng một tay, nước bắn tung tóe"
          }
        ],
        references: [
          {
            name: "char",
            image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXUpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAnUlEQVR42u3TQQ0AIBDAsIG/tL+0i4spQA6Sg7xWp/2qPwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcDkAWN0Abe1D1JcAAAAAElFTkSuQmCC"
          }
        ]
      };
    } else {
      projectName = `Demo 10 Prompt Ảnh Tham Chiếu (${action === "create" ? "Thô" : "Chạy"})`;
      payload = {
        project_name: projectName,
        aspect_ratio: "1:1",
        model_image: "nano_banana_2_lite",
        boxes: [
          {
            type: "generate",
            prompts: (
              "001. Portrait of @MODERNYOU with a happy smiling face, flat colors, doodle style.\n" +
              "002. Portrait of @MODERNYOU showing an angry face, lightning behind, doodle style.\n" +
              "003. Portrait of @MODERNYOU crying, rain drops falling, doodle style.\n" +
              "004. Portrait of @MODERNYOU thinking deeply, lightbulb glowing next to head, doodle style.\n" +
              "005. Portrait of @MODERNYOU looking shocked, wide open mouth, doodle style.\n" +
              "006. Portrait of @MODERNYOU sleeping peacefully on a fluffy cloud, doodle style.\n" +
              "007. Portrait of @MODERNYOU winking playfully, holding a peace sign, doodle style.\n" +
              "008. Portrait of @MODERNYOU wearing a wizard hat, holding a magic wand, doodle style.\n" +
              "009. Portrait of @MODERNYOU looking exhausted, tongue hanging out, doodle style.\n" +
              "010. Portrait of @MODERNYOU wearing cool sunglasses, thumbs up, doodle style."
            )
          }
        ],
        references: [
          {
            name: "MODERNYOU",
            image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXUpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAnUlEQVR42u3TQQ0AIBDAsIG/tL+0i4spQA6Sg7xWp/2qPwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcDkAWN0Abe1D1JcAAAAAElFTkSuQmCC"
          }
        ]
      };
    }

    try {
      const endpoint = action === "create" ? "/api/workflows/create-bulk" : "/api/workflows/run-bulk";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await res.text() || "Lỗi server");
      }
      const data = await res.json();
      const pid = data.project_id;
      if (pid) {
        navigate(`/workflow/${pid}`);
      } else {
        alert("Không nhận được Project ID từ API");
      }
    } catch (err) {
      alert(`Lỗi khi gọi API: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const codeComplexCurl = `# Dựng dự án thô (Không tự động chạy)
curl -X POST http://localhost:8765/api/workflows/create-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "Demo Phức Tạp 001-009",
    "aspect_ratio": "16:9",
    "boxes": [
      {
        "type": "generate",
        "prompts": "001. Cảnh 1 vẽ đồng hồ báo thức...\\n002. Cảnh 2 @MODERNYOU tỉnh dậy...\\n003. Cảnh 3 @MODERNYOU uống cafe...\\n[Prompts tiếp tục từ 004 đến 009]"
      },
      {
        "type": "video_generate",
        "prompts": "001. Hoạt họa đồng hồ rung chuông...\\n002. @MODERNYOU đập nút tắt báo thức...\\n003. Khói bốc lên từ cốc cafe..."
      },
      {
        "type": "video_generate",
        "prompts": "001. Đồng hồ bay khỏi bàn và rơi vỡ...\\n003. @MODERNYOU cười thả đường..."
      },
      {
        "type": "video_generate",
        "prompts": "001. Các mảnh vỡ tung tóe...\\n003. Cafe sủi bọt đường tan..."
      }
    ],
    "references": [
      {
        "name": "MODERNYOU",
        "image": "data:image/png;base64,iVBORw0KGgoAAA..."
      }
    ]
  }'`;

  const codeContinuousCurl = `# Gọi API tạo dự án nối tiếp xuyên suốt chỉ từ 001
curl -X POST http://localhost:8765/api/workflows/create-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "Demo Xuyên Suốt 001",
    "aspect_ratio": "16:9",
    "boxes": [
      {
        "type": "video_generate",
        "prompts": "001 cô gái @char đang đứng thủ thế võ thuật"
      },
      {
        "type": "video_generate",
        "prompts": "001 cô gái @char nhảy lên thực hiện cú đá xoáy"
      },
      {
        "type": "video_generate",
        "prompts": "001 cô gái @char tiếp đất bằng một tay"
      }
    ],
    "references": [
      {
        "name": "char",
        "image": "data:image/png;base64,iVBORw0KGgoAAA..."
      }
    ]
  }'`;

  const codeImagesCurl = `# Gọi API sinh 10 ảnh chân dung nhân vật tham chiếu
curl -X POST http://localhost:8765/api/workflows/run-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "10 Chân Dung Chuyên Nghiệp",
    "aspect_ratio": "1:1",
    "boxes": [
      {
        "type": "generate",
        "prompts": "001. Chân dung @MODERNYOU cười vui vẻ...\\n002. Chân dung @MODERNYOU tức giận...\\n[Gõ tiếp đến 010]"
      }
    ],
    "references": [
      {
        "name": "MODERNYOU",
        "image": "data:image/png;base64,iVBORw0KGgoAAA..."
      }
    ]
  }'`;

  const codeN8n = `{
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:8765/api/workflows/create-bulk",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Content-Type", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\\n  \\"project_name\\": \\"Dự án n8n Automate\\",\\n  \\"aspect_ratio\\": \\"16:9\\",\\n  \\"boxes\\": [\\n    { \\"type\\": \\"video_generate\\", \\"prompts\\": \\"001 cô gái @char múa võ dưới mưa\\" }\\n  ],\\n  \\"references\\": [\\n    { \\"name\\": \\"char\\", \\"image\\": \\"data:image/png;base64,iVBORw0KGgoAAA...\\" }\\n  ]\\n}"
      },
      "id": "2bc983c2-4fe4-4a4b-972d-1144ac9c8942",
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.1
    }
  ]
}`;

  return (
    <div className="docs-page">
      <header className="docs-hero">
        <div>
          <p className="docs-kicker">Tài liệu API từ xa</p>
          <h1>Tài Liệu Tích Hợp API</h1>
          <p className="muted docs-lead">
            Cách điều khiển G-Labs BW từ ứng dụng ngoài qua HTTP REST API. Hướng dẫn thiết lập n8n, Postman và chạy thử các kịch bản demo mẫu.
          </p>
        </div>
        <div className="docs-hero-actions">
          <Link to={NAV_ROUTES.workflow} className="btn btn-primary btn-sm">
            Mở Workflow Editor
          </Link>
          <Link to={NAV_ROUTES.docs} className="btn btn-ghost btn-sm">
            Docs Workflow UI
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <div className="docs-tabs" style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--border)", marginBottom: 20, paddingBottom: 4 }}>
        <button 
          onClick={() => setActiveTab("endpoints")} 
          className={`docs-tab-btn ${activeTab === "endpoints" ? "active" : ""}`}
          style={{ 
            background: "none", 
            border: "none", 
            color: activeTab === "endpoints" ? "var(--primary, #6366f1)" : "var(--text-muted, #94a3b8)", 
            padding: "8px 16px", 
            cursor: "pointer", 
            fontWeight: "bold",
            borderBottom: activeTab === "endpoints" ? "2px solid var(--primary, #6366f1)" : "none"
          }}
        >
          ⚙️ 1. Danh sách Endpoint
        </button>
        <button 
          onClick={() => setActiveTab("demos")} 
          className={`docs-tab-btn ${activeTab === "demos" ? "active" : ""}`}
          style={{ 
            background: "none", 
            border: "none", 
            color: activeTab === "demos" ? "var(--primary, #6366f1)" : "var(--text-muted, #94a3b8)", 
            padding: "8px 16px", 
            cursor: "pointer", 
            fontWeight: "bold",
            borderBottom: activeTab === "demos" ? "2px solid var(--primary, #6366f1)" : "none"
          }}
        >
          📋 2. Kịch bản & Code Mẫu
        </button>
        <button 
          onClick={() => setActiveTab("n8n-postman")} 
          className={`docs-tab-btn ${activeTab === "n8n-postman" ? "active" : ""}`}
          style={{ 
            background: "none", 
            border: "none", 
            color: activeTab === "n8n-postman" ? "var(--primary, #6366f1)" : "var(--text-muted, #94a3b8)", 
            padding: "8px 16px", 
            cursor: "pointer", 
            fontWeight: "bold",
            borderBottom: activeTab === "n8n-postman" ? "2px solid var(--primary, #6366f1)" : "none"
          }}
        >
          🔗 3. Tích hợp n8n / Postman
        </button>
      </div>

      <div className="docs-content" style={{ maxWidth: "100%", width: "100%" }}>
        
        {/* TAB 1: ENDPOINTS */}
        {activeTab === "endpoints" && (
          <section className="panel-card docs-section" style={{ borderLeft: "4px solid var(--primary, #6366f1)" }}>
            <h2>Danh sách Endpoint HTTP REST API</h2>
            <p className="muted" style={{ marginBottom: 20 }}>
              Gọi các API này từ script hoặc backend của bạn. Cổng mặc định của backend là <code>8765</code>.
            </p>

            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Phương thức</th>
                    <th>Đường dẫn API</th>
                    <th>Chức năng</th>
                    <th>Dữ liệu nhận (Payload)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="docs-side-badge out" style={{ background: "var(--success, #10b981)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                    <td><code>/api/workflows/create-bulk</code></td>
                    <td>Dựng trước đồ thị thô, lưu Project trên UI nhưng <strong>chờ chạy (idle)</strong>.</td>
                    <td><code>BulkRunRequest</code> (JSON)</td>
                  </tr>
                  <tr>
                    <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                    <td><code>/api/workflows/run-bulk</code></td>
                    <td>Dựng đồ thị và <strong>khởi chạy song song ngay lập tức</strong> trong nền.</td>
                    <td><code>BulkRunRequest</code> (JSON)</td>
                  </tr>
                  <tr>
                    <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                    <td><code>/api/workflows/runs/{"{run_id}"}</code></td>
                    <td>Lấy tiến trình chạy (ví dụ 10/23 node) và URLs kết quả ảnh/video.</td>
                    <td>Không có body</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ marginTop: 24 }}>Cấu trúc dữ liệu JSON gửi lên (BulkRunRequest)</h3>
            <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6" }}>
{`{
  "project_name": "Tên dự án hiển thị trên UI", // Tùy chọn
  "project_id": "id_cu_de_ghi_de",             // Tùy chọn (để update project cũ)
  "model_image": "nano_banana_2_lite",         // Tùy chọn
  "model_video": "veo_31_fast",                 // Tùy chọn
  "aspect_ratio": "16:9",                      // Tùy chọn ("16:9" | "9:16" | "1:1")
  "boxes": [                                   // Bắt buộc (mảng các cột chứa prompt)
    {
      "type": "generate",                      // "generate" (Ảnh) hoặc "video_generate" (Video)
      "prompts": "001. Prompt 1\\n002. Prompt 2" // Các prompt, cách nhau bằng dấu xuống dòng \\n
    }
  ],
  "references": [                              // Tùy chọn (danh sách nhân vật tham chiếu)
    {
      "name": "char",                          // Khớp với @char trong prompt (không phân biệt hoa/thường)
      "image": "data:image/png;base64,..."     // Chuỗi ảnh base64 hoặc URL ảnh tĩnh
    }
  ]
}`}
            </pre>
          </section>
        )}

        {/* TAB 2: DEMOS & CODE SAMPLES */}
        {activeTab === "demos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Demo 1: Phức tạp nối tiếp */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #fdba74" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2>1. Kịch Bản Phức Tạp 001 - 009 (Nhiều hàng Box Ảnh &amp; Video nối tiếp)</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleTriggerDemo("complex", "create")} className="btn btn-primary btn-sm">🎨 Dựng dự án thô</button>
                  <button onClick={() => handleTriggerDemo("complex", "run")} className="btn btn-ghost btn-sm">🚀 Chạy tự động</button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "13px", marginTop: 8 }}>
                *Đặc điểm*: Dựng chuỗi kịch bản đầy đủ gồm **1 hàng Tạo ảnh** (vẽ 9 prompt ảnh từ 001 đến 009) và **3 hàng Tạo video** (mỗi hàng video tự động trích xuất frame cuối của cảnh trước để làm ảnh bắt đầu cho video tiếp diễn hành động xuyên suốt).
              </p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Mẫu code gửi request:</strong>
                <button onClick={() => handleCopy(codeComplexCurl, "demo1")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "demo1" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.4)", padding: 14, borderRadius: 6, overflowX: "auto", border: "1px solid var(--border)", color: "#e2e8f0", fontSize: "12px", fontFamily: "monospace", marginTop: 8 }}>
                {codeComplexCurl}
              </pre>
            </section>

            {/* Demo 2: Video nối tiếp liên tục chỉ 001 */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #93c5fd" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2>2. Video Nối Tiếp Liên Tục (Chỉ 001 xuyên suốt nhiều Box Video)</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleTriggerDemo("continuous", "create")} className="btn btn-primary btn-sm">🎨 Dựng dự án thô</button>
                  <button onClick={() => handleTriggerDemo("continuous", "run")} className="btn btn-ghost btn-sm">🚀 Chạy tự động</button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "13px", marginTop: 8 }}>
                *Đặc điểm*: Thích hợp để tạo ra một đoạn clip dài liên tục chỉ từ 1 khung hình ban đầu. Gồm 3 box video kế tiếp nhau (Video 1 ➔ Video 2 ➔ Video 3). Hệ thống tự sinh các node Tách Frame trung gian để nối liền hành động của `@char`.
              </p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Mẫu code gửi request:</strong>
                <button onClick={() => handleCopy(codeContinuousCurl, "demo2")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "demo2" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.4)", padding: 14, borderRadius: 6, overflowX: "auto", border: "1px solid var(--border)", color: "#e2e8f0", fontSize: "12px", fontFamily: "monospace", marginTop: 8 }}>
                {codeContinuousCurl}
              </pre>
            </section>

            {/* Demo 3: Tạo 10 ảnh tham chiếu */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #a7f3d0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2>3. Tạo Hàng Loạt 10 Chân Dung (Chỉ ảnh tham chiếu &amp; 10 prompt ảnh)</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleTriggerDemo("images", "create")} className="btn btn-primary btn-sm">🎨 Dựng dự án thô</button>
                  <button onClick={() => handleTriggerDemo("images", "run")} className="btn btn-ghost btn-sm">🚀 Chạy tự động</button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "13px", marginTop: 8 }}>
                *Đặc điểm*: Dành cho quy trình tạo bộ sticker, biểu cảm nhân vật. Gồm 1 node Ảnh tham chiếu `@MODERNYOU` và 10 node Tạo ảnh chạy song song với 10 biểu cảm, góc máy khác nhau.
              </p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Mẫu code gửi request:</strong>
                <button onClick={() => handleCopy(codeImagesCurl, "demo3")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "demo3" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.4)", padding: 14, borderRadius: 6, overflowX: "auto", border: "1px solid var(--border)", color: "#e2e8f0", fontSize: "12px", fontFamily: "monospace", marginTop: 8 }}>
                {codeImagesCurl}
              </pre>
            </section>
          </div>
        )}

        {/* TAB 3: n8n & POSTMAN INTEGRATION */}
        {activeTab === "n8n-postman" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Postman */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #f472b6" }}>
              <h2>Hướng dẫn chạy trên Postman</h2>
              <p className="muted" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                Để test API nhanh trên Postman, bạn làm theo các bước sau:
              </p>
              <ol className="docs-steps" style={{ fontSize: "13px" }}>
                <li>Mở Postman, bấm vào nút **New ➔ HTTP Request**.</li>
                <li>Chọn phương thức **`POST`** và nhập URL: <code>http://127.0.0.1:8765/api/workflows/create-bulk</code></li>
                <li>Chuyển sang tab **Headers**, thêm header:
                  * Key: <code>Content-Type</code> · Value: <code>application/json</code>
                </li>
                <li>Chuyển sang tab **Body**, chọn kiểu dữ liệu **`raw`** và chọn định dạng **`JSON`** ở dropdown bên phải.</li>
                <li>Copy toàn bộ nội dung JSON code mẫu ở Tab 2 dán vào phần Body của Postman.</li>
                <li>Bấm **Send**. Phản hồi trả về mã 201 kèm <code>project_id</code> của dự án mới.</li>
              </ol>
            </section>

            {/* n8n */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #fb7185" }}>
              <h2>Hướng dẫn tích hợp vào n8n</h2>
              <p className="muted" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                n8n là công cụ tự động hóa quy trình rất mạnh mẽ. Bạn có thể gọi API của G-Labs BW bằng cách sử dụng node **HTTP Request** của n8n:
              </p>
              
              <h3 style={{ marginTop: 12 }}>Cách cấu hình node HTTP Request trong n8n:</h3>
              <ul className="docs-bullets" style={{ fontSize: "13px" }}>
                <li><strong>Method</strong>: chọn <code>POST</code></li>
                <li><strong>URL</strong>: nhập <code>http://localhost:8765/api/workflows/create-bulk</code> (hoặc địa chỉ IP server của bạn)</li>
                <li><strong>Send Headers</strong>: Bật lên (True)
                  * Add Parameter: Name=<code>Content-Type</code>, Value=<code>application/json</code>
                </li>
                <li><strong>Send Body</strong>: Bật lên (True)
                  * Body Content Type: chọn <code>JSON</code>
                  * Specify Body: chọn <code>Using JSON below</code>
                  * Json/Body Value: Nhập cấu hình payload của dự án (xem code JSON mẫu bên dưới)
                </li>
                <li><strong>Response Format</strong>: chọn <code>JSON</code></li>
              </ul>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Mẫu Node n8n (Bạn có thể copy đoạn JSON dưới đây rồi Paste trực tiếp vào n8n Canvas):</strong>
                <button onClick={() => handleCopy(codeN8n, "n8n")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "n8n" ? "✓ Đã copy!" : "📋 Copy Node JSON"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.4)", padding: 14, borderRadius: 6, overflowX: "auto", border: "1px solid var(--border)", color: "#fca5a5", fontSize: "12px", fontFamily: "monospace", marginTop: 8 }}>
                {codeN8n}
              </pre>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}
