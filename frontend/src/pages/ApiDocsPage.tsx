import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { NAV_ROUTES } from "../routes";

export default function ApiDocsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"endpoints" | "demos" | "n8n-postman" | "public-api">("endpoints");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const apiOrigin = typeof window !== "undefined"
    ? (window.location.port === "5173" ? `${window.location.protocol}//${window.location.hostname}:8765` : window.location.origin)
    : "http://localhost:8765";

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleTriggerDemo = async (demoType: "complex" | "continuous" | "images" | "life", action: "create" | "run") => {
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
    } else if (demoType === "images") {
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
    } else {
      projectName = `Cuộc Đời Tôi - Phim 1 Phút (${action === "create" ? "Thô" : "Chạy"})`;
      payload = {
        project_name: projectName,
        aspect_ratio: "16:9",
        model_image: "nano_banana_2_lite",
        model_video: "veo_31_fast",
        boxes: [
          {
            type: "generate",
            prompts: (
              "001. A boy looking out of a window at the rain, dreaming of technology, hand-drawn 2D doodle cartoon.\n" +
              "002. A young man sitting alone in a dark room, glowing laptop screen reflecting on his face, hand-drawn 2D doodle cartoon.\n" +
              "003. @MODERNYOU facing a failed project on screen, head in hands, feeling depressed, hand-drawn 2D doodle cartoon.\n" +
              "004. @MODERNYOU walking alone in the heavy rain on a crowded city street, dark blue tone, hand-drawn 2D doodle cartoon.\n" +
              "005. @MODERNYOU looking up at the starry night sky through an attic window, eyes wide with hope, hand-drawn 2D doodle cartoon.\n" +
              "006. @MODERNYOU typing furiously on a glowing keyboard, coding lines morphing into magical energy, hand-drawn 2D doodle cartoon.\n" +
              "007. A vibrant workflow diagram shining bright in a dark room, connecting ideas together, hand-drawn 2D doodle cartoon.\n" +
              "008. Colorful cartoon characters flying out from the screen, lighting up the dark room, hand-drawn 2D doodle cartoon.\n" +
              "009. @MODERNYOU standing on a windy hill at sunrise, smiling at the horizon, bright future ahead, hand-drawn 2D doodle cartoon."
            )
          },
          {
            type: "video_generate",
            prompts: (
              "001. Raindrops falling on the window glass, boy's reflection blinking, hand-drawn 2D doodle cartoon animation.\n" +
              "002. Shadows moving in the room, screen light flickering on his face, hand-drawn 2D doodle cartoon animation.\n" +
              "003. @MODERNYOU taking a deep breath and looking up with a look of determination, hand-drawn 2D doodle cartoon animation.\n" +
              "004. Neon lights reflecting in puddles as @MODERNYOU walks under rain, people passing by, hand-drawn 2D doodle cartoon animation.\n" +
              "005. A shooting star crossing the sky, eyes of @MODERNYOU tracking it with a smile, hand-drawn 2D doodle cartoon animation.\n" +
              "006. Keyboard keys glowing as coding lines float upwards like sparks, hand-drawn 2D doodle cartoon animation.\n" +
              "007. Energy flows connecting the nodes on the diagram, pulsing bright lights, hand-drawn 2D doodle cartoon animation.\n" +
              "008. Cartoon shapes swirl and dance around the desk, creating a warm glow, hand-drawn 2D doodle cartoon animation.\n" +
              "009. Wind blowing through his hair, sun rising slowly behind the hills, camera pan, hand-drawn 2D doodle cartoon animation."
            )
          },
          {
            type: "video_generate",
            prompts: (
              "001. Rain stops and sunlight breaks through the dark clouds, hand-drawn 2D doodle cartoon animation.\n" +
              "003. Screen error turns into a green success checkmark, illuminating the workspace, hand-drawn 2D doodle cartoon animation.\n" +
              "006. Coding particles combine to form a glowing sphere of light, hand-drawn 2D doodle cartoon animation."
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
      const res = await fetch(apiOrigin + endpoint, {
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
        navigate(`${NAV_ROUTES.workflow}/${encodeURIComponent(pid)}`);
      } else {
        alert("Không nhận được Project ID từ API");
      }
    } catch (err) {
      alert(`Lỗi khi gọi API: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const codeComplexCurl = `# Dựng dự án thô (Không tự động chạy)
curl -X POST ${apiOrigin}/api/workflows/create-bulk \\
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
curl -X POST ${apiOrigin}/api/workflows/create-bulk \\
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
curl -X POST ${apiOrigin}/api/workflows/run-bulk \\
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

  const codeLifeCurl = `# 🎬 Gọi API tạo dự án "Cuộc Đời Tôi" 1 phút (9 cảnh hoạt hình đầy tâm trạng)
curl -X POST ${apiOrigin}/api/workflows/create-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "Cuoc Doi Toi - Phim 1 Phut",
    "aspect_ratio": "16:9",
    "boxes": [
      {
        "type": "generate",
        "prompts": "001. A boy looking out of a window at the rain...\\n002. A young man sitting in a dark room...\\n003. @MODERNYOU facing a failed project...\\n004. @MODERNYOU walking alone in heavy rain...\\n005. @MODERNYOU looking at starry sky...\\n006. @MODERNYOU typing on keyboard coding...\\n007. A vibrant workflow diagram shining...\\n008. Colorful cartoon characters flying...\\n009. @MODERNYOU standing on a hill at sunrise..."
      },
      {
        "type": "video_generate",
        "prompts": "001. Raindrops falling on window...\\n002. Shadows moving in room...\\n003. @MODERNYOU taking a deep breath...\\n004. Neon lights reflecting in puddles...\\n005. A shooting star crossing sky...\\n006. Keyboard keys glowing...\\n007. Energy flows connecting nodes...\\n008. Cartoon shapes swirl and dance...\\n009. Wind blowing through hair..."
      },
      {
        "type": "video_generate",
        "prompts": "001. Rain stops and sunlight breaks through...\\n003. Screen error turns into green checkmark...\\n006. Coding particles form glowing sphere..."
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
        "url": "${apiOrigin}/api/workflows/create-bulk",
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
        <button 
          onClick={() => setActiveTab("public-api")} 
          className={`docs-tab-btn ${activeTab === "public-api" ? "active" : ""}`}
          style={{ 
            background: "none", 
            border: "none", 
            color: activeTab === "public-api" ? "var(--primary, #6366f1)" : "var(--text-muted, #94a3b8)", 
            padding: "8px 16px", 
            cursor: "pointer", 
            fontWeight: "bold",
            borderBottom: activeTab === "public-api" ? "2px solid var(--primary, #6366f1)" : "none"
          }}
        >
          🔑 4. Public API v1
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

            {/* Demo 4: Cuộc đời tôi hoạt hình đầy tâm trạng (1 phút) */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #c084fc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2>4. Cuộc Đời Tôi (Phim hoạt hình 1 phút đầy tâm trạng - 9 Cảnh nối tiếp)</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleTriggerDemo("life", "create")} className="btn btn-primary btn-sm">🎨 Dựng dự án thô</button>
                  <button onClick={() => handleTriggerDemo("life", "run")} className="btn btn-ghost btn-sm">🚀 Chạy tự động</button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "13px", marginTop: 8 }}>
                *Đặc điểm*: Kịch bản điện ảnh ý nghĩa dài 1 phút kể về hành trình vượt khó của lập trình viên/editor sáng tạo nhân vật `@MODERNYOU`. Gồm **9 cảnh** được dàn dựng kết hợp giữa Tạo ảnh, Tạo video, và Tách frame cuối nối tiếp xuyên suốt 3 Box video liền mạch.
              </p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Mẫu code gửi request:</strong>
                <button onClick={() => handleCopy(codeLifeCurl, "demo4")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "demo4" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.4)", padding: 14, borderRadius: 6, overflowX: "auto", border: "1px solid var(--border)", color: "#e2e8f0", fontSize: "12px", fontFamily: "monospace", marginTop: 8 }}>
                {codeLifeCurl}
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
                <li>Chọn phương thức **`POST`** và nhập URL: <code>{apiOrigin}/api/workflows/create-bulk</code></li>
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
                <li><strong>URL</strong>: nhập <code>{apiOrigin}/api/workflows/create-bulk</code> (hoặc địa chỉ IP server của bạn)</li>
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

        {/* TAB 4: PUBLIC API V1 */}
        {activeTab === "public-api" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Section A: Authentication */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #10b981" }}>
              <h2>🔐 Xác thực (Authentication)</h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                API Key là bắt buộc cho tất cả các endpoint <code>/v1/*</code>. Bạn có thể sử dụng một trong hai phương thức xác thực sau:
              </p>
              <ul className="docs-bullets" style={{ fontSize: "14px", marginBottom: 16 }}>
                <li><code>Authorization: Bearer glbw_sk_xxx</code></li>
                <li><code>X-API-Key: glbw_sk_xxx</code></li>
              </ul>
              <p className="muted" style={{ fontSize: "14px", marginBottom: 16 }}>
                Để lấy API Key, vui lòng truy cập <strong>Settings → API Keys → Create</strong>.
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>Ví dụ Header:</strong>
                <button onClick={() => handleCopy('Authorization: Bearer YOUR_API_KEY', "auth_header")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "auth_header" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`Authorization: Bearer YOUR_API_KEY`}
              </pre>
            </section>

            {/* Section B: Image Generation Endpoints */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #6366f1" }}>
              <h2>🖼️ Tạo Ảnh (Image Generation)</h2>
              
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Phương thức</th>
                      <th>Đường dẫn API</th>
                      <th>Chức năng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--success, #10b981)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/images/generate</code></td>
                      <td>Tạo ảnh từ văn bản (Text → Image)</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--success, #10b981)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/images/with-references</code></td>
                      <td>Tạo ảnh với ảnh tham chiếu (Reference → Image)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>1. Text to Image</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả ảnh cần tạo</td></tr>
                    <tr><td>provider</td><td>string</td><td>Không</td><td>auto, v.v.</td></tr>
                    <tr><td>num_images</td><td>integer</td><td>Không</td><td>Số lượng ảnh</td></tr>
                    <tr><td>aspect_ratio</td><td>string</td><td>Không</td><td>Tỉ lệ khung hình (16:9, 1:1, v.v.)</td></tr>
                    <tr><td>model</td><td>string</td><td>Không</td><td>Model cần sử dụng</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/images/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A cyberpunk city at sunset, neon lights reflecting on wet streets",
  "provider": "auto",
  "num_images": 1,
  "aspect_ratio": "16:9",
  "model": "imagen_3"
}'`, "curl_image_gen")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_image_gen" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/images/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A cyberpunk city at sunset, neon lights reflecting on wet streets",
  "provider": "auto",
  "num_images": 1,
  "aspect_ratio": "16:9",
  "model": "imagen_3"
}'`}
              </pre>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>2. Image with References</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả ảnh cần tạo</td></tr>
                    <tr><td>reference_images</td><td>array of strings</td><td>Có</td><td>Danh sách đường dẫn hoặc URL ảnh tham chiếu</td></tr>
                    <tr><td>provider</td><td>string</td><td>Không</td><td>auto, v.v.</td></tr>
                    <tr><td>num_images</td><td>integer</td><td>Không</td><td>Số lượng ảnh</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/images/with-references \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A warrior standing in rain",
  "reference_images": ["/api/files/output/character.png", "/api/files/output/style.png"],
  "provider": "auto",
  "num_images": 2
}'`, "curl_image_ref")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_image_ref" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/images/with-references \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A warrior standing in rain",
  "reference_images": ["/api/files/output/character.png", "/api/files/output/style.png"],
  "provider": "auto",
  "num_images": 2
}'`}
              </pre>
            </section>

            {/* Section C: Video Generation Endpoints */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #f59e0b" }}>
              <h2>🎬 Tạo Video (Video Generation)</h2>
              
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Phương thức</th>
                      <th>Đường dẫn API</th>
                      <th>Chức năng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/videos/generate</code></td>
                      <td>Tạo video từ văn bản (Text → Video)</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/videos/from-image</code></td>
                      <td>Tạo video từ ảnh (Image → Video)</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/videos/start-end</code></td>
                      <td>Tạo video từ ảnh đầu &amp; cuối (Start+End → Video)</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/videos/with-references</code></td>
                      <td>Tạo video với ảnh tham chiếu (Reference → Video)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>1. Text to Video</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả nội dung video</td></tr>
                    <tr><td>provider</td><td>string</td><td>Không</td><td>auto, flow, v.v.</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/videos/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A cat walking through a magical forest with fireflies",
  "provider": "auto"
}'`, "curl_vid_gen")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_vid_gen" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/videos/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "A cat walking through a magical forest with fireflies",
  "provider": "auto"
}'`}
              </pre>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>2. Image to Video (I2V)</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả hành động của video</td></tr>
                    <tr><td>image</td><td>string</td><td>Có</td><td>Đường dẫn hoặc URL ảnh</td></tr>
                    <tr><td>provider</td><td>string</td><td>Không</td><td>flow, v.v.</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/videos/from-image \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "The character slowly turns their head and smiles",
  "image": "/api/files/output/portrait.png",
  "provider": "flow"
}'`, "curl_vid_i2v")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_vid_i2v" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/videos/from-image \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "The character slowly turns their head and smiles",
  "image": "/api/files/output/portrait.png",
  "provider": "flow"
}'`}
              </pre>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>3. Start + End to Video</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả hành động của video</td></tr>
                    <tr><td>start_image</td><td>string</td><td>Có</td><td>Đường dẫn hoặc URL ảnh đầu</td></tr>
                    <tr><td>end_image</td><td>string</td><td>Có</td><td>Đường dẫn hoặc URL ảnh cuối</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/videos/start-end \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "Smooth zoom out with dramatic lighting change",
  "start_image": "/api/files/output/frame_start.png",
  "end_image": "/api/files/output/frame_end.png"
}'`, "curl_vid_se")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_vid_se" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/videos/start-end \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "Smooth zoom out with dramatic lighting change",
  "start_image": "/api/files/output/frame_start.png",
  "end_image": "/api/files/output/frame_end.png"
}'`}
              </pre>

              <h3 style={{ marginTop: 24, fontSize: "16px" }}>4. Video with References</h3>
              <div className="docs-table-wrap" style={{ marginTop: 12 }}>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Bắt buộc</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>prompt</td><td>string</td><td>Có</td><td>Mô tả hành động của video</td></tr>
                    <tr><td>reference_images</td><td>array of strings</td><td>Có</td><td>Danh sách đường dẫn hoặc URL ảnh tham chiếu</td></tr>
                    <tr><td>provider</td><td>string</td><td>Không</td><td>flow, v.v.</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/videos/with-references \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "The character dances in the rain",
  "reference_images": ["/api/files/output/character_ref.png"],
  "provider": "flow"
}'`, "curl_vid_ref")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_vid_ref" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/videos/with-references \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "prompt": "The character dances in the rain",
  "reference_images": ["/api/files/output/character_ref.png"],
  "provider": "flow"
}'`}
              </pre>
            </section>

            {/* Section D: Unified Endpoint */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #ec4899" }}>
              <h2>🔄 Unified Endpoint (Tất cả trong 1 API)</h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                Một endpoint duy nhất để thực hiện mọi tác vụ dựa trên tham số <code>mode</code>.
              </p>
              
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Chế độ (mode)</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td><code>text_to_image</code></td><td>Tạo ảnh từ văn bản</td></tr>
                    <tr><td><code>text_to_video</code></td><td>Tạo video từ văn bản</td></tr>
                    <tr><td><code>image_to_video</code></td><td>Tạo video từ ảnh (yêu cầu trường <code>image</code>)</td></tr>
                    <tr><td><code>start_end_video</code></td><td>Tạo video từ 2 ảnh (yêu cầu <code>start_image</code>, <code>end_image</code>)</td></tr>
                    <tr><td><code>reference_image</code></td><td>Tạo ảnh có tham chiếu (yêu cầu <code>reference_images</code>)</td></tr>
                    <tr><td><code>reference_video</code></td><td>Tạo video có tham chiếu (yêu cầu <code>reference_images</code>)</td></tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL:</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "mode": "text_to_image",
  "prompt": "A futuristic city",
  "provider": "auto"
}'`, "curl_unified")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_unified" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "mode": "text_to_image",
  "prompt": "A futuristic city",
  "provider": "auto"
}'`}
              </pre>
            </section>

            {/* Section E: Polling & Results */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #06b6d4" }}>
              <h2>📋 Kiểm tra Kết quả (Polling)</h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                Sau khi gửi yêu cầu tạo (ảnh/video), bạn sẽ nhận được một <code>task_id</code>. Hãy dùng task_id này để kiểm tra trạng thái và lấy kết quả.
              </p>
              
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Phương thức</th>
                      <th>Đường dẫn API</th>
                      <th>Chức năng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/tasks/{"{task_id}"}</code></td>
                      <td>Kiểm tra trạng thái của task (pending, processing, completed, failed)</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/tasks/{"{task_id}"}/result</code></td>
                      <td>Lấy kết quả cuối cùng (URL ảnh/video) khi task ở trạng thái completed</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/tasks</code></td>
                      <td>Danh sách tất cả các task của API key hiện tại</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL (Polling status):</strong>
                <button onClick={() => handleCopy(`curl -X GET ${apiOrigin}/v1/tasks/TASK_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`, "curl_poll")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_poll" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X GET ${apiOrigin}/v1/tasks/TASK_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
              </pre>
            </section>

            {/* Section F: Rate Limiting & Usage */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #8b5cf6" }}>
              <h2>⚡ Rate Limiting & Thống kê</h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                Mặc định, mỗi API Key có giới hạn <strong>30 request/phút</strong> và <strong>500 request/ngày</strong>. Bạn sẽ nhận được HTTP 429 nếu vượt quá giới hạn.
              </p>
              
              <ul className="docs-bullets" style={{ fontSize: "14px", marginBottom: 16 }}>
                <li><code>X-RateLimit-Limit</code>: Giới hạn request</li>
                <li><code>X-RateLimit-Remaining</code>: Số request còn lại</li>
                <li><code>X-RateLimit-Reset</code>: Thời gian reset giới hạn</li>
                <li><code>Retry-After</code>: (Khi bị 429) Thời gian cần chờ trước khi thử lại</li>
              </ul>

              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Phương thức</th>
                      <th>Đường dẫn API</th>
                      <th>Chức năng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/usage</code></td>
                      <td>Kiểm tra hạn mức sử dụng của key</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/models</code></td>
                      <td>Danh sách các model khả dụng</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section G: Admin Key Management */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #64748b" }}>
              <h2>🔑 Quản lý API Keys</h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                (Cần có quyền Admin) Quản lý, tạo và giám sát các API Key.
              </p>
              
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Phương thức</th>
                      <th>Đường dẫn API</th>
                      <th>Chức năng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--success, #10b981)", color: "white", padding: "2px 8px", borderRadius: 4 }}>POST</span></td>
                      <td><code>/v1/admin/keys</code></td>
                      <td>Tạo API Key mới</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/admin/keys</code></td>
                      <td>Danh sách các API Key</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white", padding: "2px 8px", borderRadius: 4 }}>PUT</span></td>
                      <td><code>/v1/admin/keys/{"{id}"}</code></td>
                      <td>Cập nhật giới hạn hoặc trạng thái của key</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge out" style={{ background: "var(--danger, #ef4444)", color: "white", padding: "2px 8px", borderRadius: 4 }}>DELETE</span></td>
                      <td><code>/v1/admin/keys/{"{id}"}</code></td>
                      <td>Xóa API Key</td>
                    </tr>
                    <tr>
                      <td><span className="docs-side-badge in" style={{ padding: "2px 8px", borderRadius: 4 }}>GET</span></td>
                      <td><code>/v1/admin/keys/{"{id}"}/usage</code></td>
                      <td>Xem thống kê sử dụng chi tiết của một key</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ cURL (Tạo key):</strong>
                <button onClick={() => handleCopy(`curl -X POST ${apiOrigin}/v1/admin/keys \\
  -H "Authorization: Bearer ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "name": "User 1 Key",
  "rpm_limit": 30,
  "rpd_limit": 500
}'`, "curl_create_key")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "curl_create_key" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`curl -X POST ${apiOrigin}/v1/admin/keys \\
  -H "Authorization: Bearer ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "name": "User 1 Key",
  "rpm_limit": 30,
  "rpd_limit": 500
}'`}
              </pre>
            </section>

            {/* Section H: Python SDK Example */}
            <section className="panel-card docs-section" style={{ borderLeft: "4px solid #22c55e" }}>
              <h2>🐍 Python SDK Mẫu</h2>
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <strong>Ví dụ Code Python:</strong>
                <button onClick={() => handleCopy(`import requests
import time
  
API_BASE = "http://localhost:8765"
API_KEY = "glbw_sk_YOUR_KEY_HERE"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
  
# 1. Tạo ảnh
r = requests.post(f"{API_BASE}/v1/images/generate", 
    json={"prompt": "A beautiful sunset", "provider": "auto"},
    headers=HEADERS)
task_id = r.json()["task_id"]
print(f"Task created: {task_id}")
  
# 2. Poll kết quả
while True:
    r = requests.get(f"{API_BASE}/v1/tasks/{task_id}", headers=HEADERS)
    status = r.json()["status"]
    print(f"Status: {status}")
    if status in ("completed", "failed"):
        break
    time.sleep(5)
  
# 3. Lấy kết quả
r = requests.get(f"{API_BASE}/v1/tasks/{task_id}/result", headers=HEADERS)
print(r.json())`, "python_sdk")} className="btn btn-ghost btn-sm" style={{ color: "var(--success, #4ade80)" }}>
                  {copiedText === "python_sdk" ? "✓ Đã copy!" : "📋 Copy Code"}
                </button>
              </div>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 8, overflowX: "auto", border: "1px solid var(--border)", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6", marginTop: 8 }}>
{`import requests
import time
  
API_BASE = "http://localhost:8765"
API_KEY = "glbw_sk_YOUR_KEY_HERE"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
  
# 1. Tạo ảnh
r = requests.post(f"{API_BASE}/v1/images/generate", 
    json={"prompt": "A beautiful sunset", "provider": "auto"},
    headers=HEADERS)
task_id = r.json()["task_id"]
print(f"Task created: {task_id}")
  
# 2. Poll kết quả
while True:
    r = requests.get(f"{API_BASE}/v1/tasks/{task_id}", headers=HEADERS)
    status = r.json()["status"]
    print(f"Status: {status}")
    if status in ("completed", "failed"):
        break
    time.sleep(5)
  
# 3. Lấy kết quả
r = requests.get(f"{API_BASE}/v1/tasks/{task_id}/result", headers=HEADERS)
print(r.json())`}
              </pre>
            </section>

          </div>
        )}

      </div>
    </div>
  );
}
