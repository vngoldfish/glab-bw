import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { NAV_ROUTES } from "../routes";

const SECTIONS = [
  { id: "handles", title: "Tổng quan chấm (handle)" },
  { id: "node-prompt", title: "Node Prompt" },
  { id: "node-reference", title: "Node Ảnh có sẵn" },
  { id: "node-generate", title: "Node Tạo ảnh" },
  { id: "node-video", title: "Node Tạo video" },
  { id: "node-frame", title: "Node Tách frame" },
  { id: "image-video", title: "Pipeline: Ảnh → Video" },
  { id: "video-chain", title: "Pipeline: Nối video (frame cuối)" },
  { id: "assets-ai", title: "Ảnh có sẵn & AI prompt" },
  { id: "run", title: "Chạy, tiếp tục & phím tắt" },
  { id: "media", title: "Media project" },
  { id: "api-guide", title: "Tích hợp API & Demo chạy thử (Mới)" },
  { id: "grok-flow-mechanisms", title: "Cơ chế Grok, Flow & Meta AI" },
] as const;

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="docs-chip-handle">
      <span className="wf-dot" style={{ background: color }} />
      <code>{label}</code>
    </span>
  );
}

function HandleTable({
  rows,
}: {
  rows: Array<{
    side: "Trái · IN" | "Phải · OUT";
    id: string;
    color: string;
    meaning: string;
    connect: string;
  }>;
}) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>
            <th>Vị trí</th>
            <th>ID chấm</th>
            <th>Ý nghĩa</th>
            <th>Nối với</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.side}-${r.id}`}>
              <td>
                <span className={`docs-side-badge${r.side.startsWith("Trái") ? " in" : " out"}`}>
                  {r.side}
                </span>
              </td>
              <td>
                <Dot color={r.color} label={r.id} />
              </td>
              <td>{r.meaning}</td>
              <td className="muted">{r.connect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  const navigate = useNavigate();
  const [apiTab, setApiTab] = useState<"curl" | "python">("curl");

  const handleTriggerDemo = async (demoType: "modernyou" | "char", action: "create" | "run") => {
    const isModern = demoType === "modernyou";
    const projectName = isModern ? `Demo Báo Thức API (${action === "create" ? "Thô" : "Chạy"})` : `Demo Võ Thuật API (${action === "create" ? "Thô" : "Chạy"})`;
    
    const payload = {
      project_name: projectName,
      aspect_ratio: "16:9",
      model_image: "nano_banana_2_lite",
      model_video: "veo_31_fast",
      boxes: isModern ? [
        {
          type: "generate",
          prompts: "001. Hand-drawn 2D doodle cartoon, clock blaring on nightstand, cobalt blue background.\n002. Hand-drawn 2D doodle cartoon, @MODERNYOU waking up in bed frown, cobalt blue background.\n003. Hand-drawn 2D doodle cartoon, @MODERNYOU tense mouth with storm cloud above head, cobalt blue background.\n004. Hand-drawn 2D doodle cartoon, @MODERNYOU flat on back with grey block on chest, cobalt blue background."
        },
        {
          type: "video_generate",
          prompts: "001. Hand-drawn 2D doodle cartoon animation, clock blaring rattle, cobalt blue background.\n002. Hand-drawn 2D doodle cartoon animation, @MODERNYOU gropes hand toward alarm, cobalt blue background.\n003. Hand-drawn 2D doodle cartoon animation, storm cloud puffs above head, cobalt blue background.\n004. Hand-drawn 2D doodle cartoon animation, heavy grey block drops on chest, cobalt blue background."
        },
        {
          type: "video_generate",
          prompts: "001. Hand-drawn 2D doodle cartoon animation, alarm clock flies off nightstand and smashes on floor.\n003. Hand-drawn 2D doodle cartoon animation, grey storm cloud grows larger and lightning flashes."
        }
      ] : [
        {
          type: "video_generate",
          prompts: "001 cô gái @char đang đứng thủ thế võ thuật"
        },
        {
          type: "video_generate",
          prompts: "001 cô gái @char thực hiện động tác đấm thẳng"
        },
        {
          type: "video_generate",
          prompts: "001 cô gái @char đá xoay vòng đẹp mắt"
        }
      ],
      references: [
        {
          name: isModern ? "MODERNYOU" : "char",
          image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXUpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAnUlEQVR42u3TQQ0AIBDAsIG/tL+0i4spQA6Sg7xWp/2qPwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcDkAWN0Abe1D1JcAAAAAElFTkSuQmCC"
        }
      ]
    };

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
        navigate(`${NAV_ROUTES.workflow}/${encodeURIComponent(pid)}`);
      } else {
        alert("Không nhận được Project ID từ API");
      }
    } catch (err) {
      alert(`Lỗi khi gọi API: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="docs-page">
      <header className="docs-hero">
        <div>
          <p className="docs-kicker">Tài liệu</p>
          <h1>Hướng dẫn Workflow</h1>
          <p className="muted docs-lead">
            Chi tiết chức năng từng chấm trên node, cách nối pipeline ảnh/video, và Media project.
            Mở{" "}
            <Link to={NAV_ROUTES.workflow} className="docs-inline-link">
              Workflow
            </Link>{" "}
            để thực hành trên canvas.
          </p>
        </div>
        <div className="docs-hero-actions">
          <Link to={NAV_ROUTES.workflow} className="btn btn-primary btn-sm">
            Mở Workflow
          </Link>
          <Link to={NAV_ROUTES.projects} className="btn btn-ghost btn-sm">
            Projects
          </Link>
        </div>
      </header>

      <div className="docs-layout">
        <nav className="docs-toc panel-card" aria-label="Mục lục">
          <strong>Mục lục</strong>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="docs-content">
          {/* —— Overview —— */}
          <section id="handles" className="panel-card docs-section">
            <h2>Tổng quan chấm (handle)</h2>
            <p className="muted">
              Chấm tròn trên cạnh node là <strong>cổng nối dữ liệu</strong>. Kéo dây từ chấm{" "}
              <strong>phải (OUT)</strong> sang chấm <strong>trái (IN)</strong> của node kế. Màu + ID
              chấm cho biết loại dữ liệu — nối đúng loại thì pipeline mới chạy đúng.
            </p>

            <h3>Bảng màu &amp; loại dữ liệu</h3>
            <ul className="docs-handle-list">
              <li>
                <span className="wf-dot" style={{ background: "#6366f1" }} />
                <div>
                  <strong>prompt</strong>{" "}
                  <span className="muted">— chuỗi text gợi ý gen (từ node Prompt)</span>
                </div>
              </li>
              <li>
                <span className="wf-dot" style={{ background: "#22c55e" }} />
                <div>
                  <strong>image / start_image (xanh lá)</strong>{" "}
                  <span className="muted">— ảnh/khung dùng làm đầu vào hình ảnh</span>
                </div>
              </li>
              <li>
                <span className="wf-dot" style={{ background: "#14b8a6" }} />
                <div>
                  <strong>image / end_image (teal)</strong>{" "}
                  <span className="muted">— ảnh tham chiếu hoặc khung cuối</span>
                </div>
              </li>
              <li>
                <span className="wf-dot" style={{ background: "#f59e0b" }} />
                <div>
                  <strong>video</strong>{" "}
                  <span className="muted">— file video sau khi gen</span>
                </div>
              </li>
              <li>
                <span className="wf-dot" style={{ background: "#ec4899" }} />
                <div>
                  <strong>end_image (hồng, trên Tách frame)</strong>{" "}
                  <span className="muted">— frame cuối clip, dùng nối video tiếp</span>
                </div>
              </li>
            </ul>

            <div className="docs-callout">
              <strong>Quy tắc vàng:</strong> chỉ nối cùng “loại” dữ liệu (prompt→prompt,
              image→start_image, video→video). Không nối prompt vào start_image.
            </div>

            <h3>Hướng kéo</h3>
            <pre className="docs-flow">{`[Node nguồn]  ●OUT  ──────▶  ●IN  [Node đích]
     (chấm phải)              (chấm trái)`}</pre>
          </section>

          {/* —— Prompt —— */}
          <section id="node-prompt" className="panel-card docs-section">
            <h2>
              Node <span className="docs-node-tag" style={{ background: "#6366f1" }}>Prompt</span>
            </h2>
            <p className="muted">
              Chứa text ý tưởng / prompt gen. Không nhận input; chỉ <strong>xuất</strong> text sang
              node gen. Dùng <strong>✦ AI</strong> để viết lại prompt (có đọc context pipeline).
            </p>
            <HandleTable
              rows={[
                {
                  side: "Phải · OUT",
                  id: "prompt",
                  color: "#6366f1",
                  meaning: "Gửi nội dung textarea sang node gen",
                  connect: "Tạo ảnh · prompt  hoặc  Tạo video · prompt",
                },
              ]}
            />
            <ul className="docs-bullets">
              <li>
                Một Prompt có thể nối tới <strong>một</strong> node gen (Ảnh hoặc Video).
              </li>
              <li>
                Prompt cho ảnh thường mô tả tĩnh (người, cảnh, ánh sáng); Prompt cho video nhấn
                chuyển động / camera.
              </li>
              <li>
                Không có chấm trái — không “nhận” prompt từ node khác.
              </li>
            </ul>
          </section>

          {/* —— Reference —— */}
          <section id="node-reference" className="panel-card docs-section">
            <h2>
              Node{" "}
              <span className="docs-node-tag" style={{ background: "#14b8a6" }}>Ảnh có sẵn</span>
            </h2>
            <p className="muted">
              Đưa ảnh đã có (Media project / thư viện / URL) vào graph, không gen mới. Chỉ{" "}
              <strong>xuất ảnh</strong> ra các node cần hình.
            </p>
            <HandleTable
              rows={[
                {
                  side: "Phải · OUT",
                  id: "image",
                  color: "#14b8a6",
                  meaning: "Ảnh đã gắn trên node",
                  connect:
                    "Tạo ảnh · image  ·  Tạo video · start_image  ·  (hiếm) end_image",
                },
              ]}
            />
            <ul className="docs-bullets">
              <li>Gắn file bằng nút chọn ảnh hoặc dán URL <code>/api/files/…</code>.</li>
              <li>
                Thường nối thẳng vào <strong>start_image</strong> của Video (bỏ qua bước gen ảnh).
              </li>
            </ul>
          </section>

          {/* —— Generate —— */}
          <section id="node-generate" className="panel-card docs-section">
            <h2>
              Node <span className="docs-node-tag" style={{ background: "#22c55e" }}>Tạo ảnh</span>
            </h2>
            <p className="muted">
              Gọi Flow gen ảnh. Nhận prompt (và tuỳ chọn ảnh tham chiếu), xuất ảnh kết quả sang
              Video hoặc nơi khác.
            </p>
            <HandleTable
              rows={[
                {
                  side: "Trái · IN",
                  id: "prompt",
                  color: "#6366f1",
                  meaning: "Text prompt dùng để gen ảnh",
                  connect: "Từ node Prompt · prompt (bắt buộc cho gen text→ảnh)",
                },
                {
                  side: "Trái · IN",
                  id: "image",
                  color: "#14b8a6",
                  meaning: "Ảnh tham chiếu / chỉnh sửa (tuỳ chọn)",
                  connect: "Từ Ảnh có sẵn · image hoặc node ảnh khác",
                },
                {
                  side: "Phải · OUT",
                  id: "image",
                  color: "#22c55e",
                  meaning: "Ảnh vừa gen (preview trên node)",
                  connect: "Tạo video · start_image (phổ biến nhất)",
                },
              ]}
            />
            <ul className="docs-bullets">
              <li>
                <strong>prompt (trên)</strong> — input chính; không nối prompt thì node thiếu text
                gen.
              </li>
              <li>
                <strong>image (giữa, IN)</strong> — ảnh base/ref khi model hỗ trợ; có thể bỏ trống.
              </li>
              <li>
                <strong>image (phải, OUT)</strong> — kết quả; kéo sang Video để image-to-video.
              </li>
            </ul>
            <pre className="docs-flow">{`[Prompt]──prompt──▶[Tạo ảnh]──image──▶[Tạo video · start_image]`}</pre>
          </section>

          {/* —— Video —— */}
          <section id="node-video" className="panel-card docs-section">
            <h2>
              Node <span className="docs-node-tag" style={{ background: "#f59e0b" }}>Tạo video</span>
            </h2>
            <p className="muted">
              Gen video (text-to-video hoặc image-to-video). Có <strong>3 chấm vào</strong> (trái)
              và <strong>1 chấm ra</strong> (phải). Mode tự đổi theo ảnh đầu/cuối đã nối hoặc gắn
              tay.
            </p>
            <HandleTable
              rows={[
                {
                  side: "Trái · IN",
                  id: "prompt",
                  color: "#6366f1",
                  meaning: "Mô tả chuyển động / cảnh video (trên ~22%)",
                  connect: "Node Prompt · prompt",
                },
                {
                  side: "Trái · IN",
                  id: "start_image",
                  color: "#22c55e",
                  meaning: "Khung/ảnh đầu clip — image-to-video (giữa ~50%)",
                  connect:
                    "Tạo ảnh · image  ·  Ảnh có sẵn · image  ·  Tách frame · end_image / start_image",
                },
                {
                  side: "Trái · IN",
                  id: "end_image",
                  color: "#14b8a6",
                  meaning: "Khung cuối (tuỳ chọn) — mode start+end (dưới ~75%)",
                  connect: "Tách frame · end_image (hoặc ảnh cố định)",
                },
                {
                  side: "Phải · OUT",
                  id: "video",
                  color: "#f59e0b",
                  meaning: "Video đã gen",
                  connect: "Tách frame · video (để nối clip tiếp)",
                },
              ]}
            />
            <h3>Chế độ theo chấm đã nối</h3>
            <ul className="docs-bullets">
              <li>
                <strong>Chỉ prompt</strong> (không start_image) → text-to-video.
              </li>
              <li>
                <strong>Có start_image</strong> (nối node ảnh hoặc gắn file) → image-to-video từ
                khung đầu.
              </li>
              <li>
                <strong>Có start + end_image</strong> → video interpolate / start–end (khi model hỗ
                trợ).
              </li>
              <li>
                Không bắt buộc cả 3 input: tối thiểu prompt <em>hoặc</em> start_image tùy use-case.
              </li>
            </ul>
            <div className="docs-callout">
              <strong>Hay nhầm:</strong> nối ảnh vào chấm <code>prompt</code> (tím) thay vì{" "}
              <code>start_image</code> (xanh lá giữa). Ảnh đầu phải vào chấm giữa.
            </div>
            <pre className="docs-flow">{`Trái node Tạo video (từ trên xuống):
  ● prompt        ← text chuyển động
  ● start_image   ← ảnh/khung đầu  ← nối ảnh vào ĐÂY
  ● end_image     ← khung cuối (tuỳ chọn)

Phải:
  ● video         → sang Tách frame`}</pre>
          </section>

          {/* —— Frame —— */}
          <section id="node-frame" className="panel-card docs-section">
            <h2>
              Node{" "}
              <span className="docs-node-tag" style={{ background: "#ec4899" }}>Tách frame</span>
            </h2>
            <p className="muted">
              Nhận video, trích khung (đầu / giữa / cuối). Có <strong>1 IN</strong> và{" "}
              <strong>3 OUT</strong> — dùng để nối clip 2 bằng frame cuối.
            </p>
            <HandleTable
              rows={[
                {
                  side: "Trái · IN",
                  id: "video",
                  color: "#f59e0b",
                  meaning: "Video nguồn cần tách frame",
                  connect: "Tạo video · video",
                },
                {
                  side: "Phải · OUT",
                  id: "image",
                  color: "#22c55e",
                  meaning: "Frame dạng ảnh chung (trên ~40%)",
                  connect: "Tạo ảnh · image / xem preview / lưu",
                },
                {
                  side: "Phải · OUT",
                  id: "start_image",
                  color: "#14b8a6",
                  meaning: "Khung đầu clip (giữa ~62%)",
                  connect: "Video kế · start_image (nếu muốn tiếp từ đầu)",
                },
                {
                  side: "Phải · OUT",
                  id: "end_image",
                  color: "#ec4899",
                  meaning: "Khung cuối clip (dưới ~82%) — quan trọng nhất khi nối video",
                  connect: "Video kế · start_image (nối cảnh mượt)",
                },
              ]}
            />
            <ul className="docs-bullets">
              <li>
                Dropdown <em>Lấy frame</em>: chọn <code>end</code> khi chỉ cần nối video tiếp.
              </li>
              <li>
                <strong>Nối tiếp chuẩn:</strong> Tách frame ·{" "}
                <Dot color="#ec4899" label="end_image" /> → Video2 ·{" "}
                <Dot color="#22c55e" label="start_image" />
              </li>
              <li>
                OUT <code>image</code> / <code>start_image</code> dùng khi cần frame khác (không bắt
                buộc cho continue).
              </li>
            </ul>
            <pre className="docs-flow">{`[Video1]──video──▶[Tách frame]──end_image──▶[Video2 · start_image]
                         │
                         └── (tuỳ chọn) image / start_image`}</pre>
          </section>

          {/* —— Pipelines —— */}
          <section id="image-video" className="panel-card docs-section">
            <h2>Pipeline: Ảnh → Video</h2>
            <p className="muted">Gen ảnh rồi biến thành video từ khung đầu.</p>
            <ol className="docs-steps">
              <li>
                <code>Prompt</code> · prompt → <code>Tạo ảnh</code> · prompt
              </li>
              <li>
                <code>Tạo ảnh</code> · image → <code>Tạo video</code> ·{" "}
                <strong>start_image</strong>
              </li>
              <li>
                (Tuỳ chọn) Prompt chuyển động → <code>Tạo video</code> · prompt
              </li>
              <li>
                Bấm <strong>Chạy</strong> — preview trên từng node
              </li>
            </ol>
            <pre className="docs-flow">{`[Prompt]──prompt──▶[Tạo ảnh]──image──▶[Tạo video]
                                          start_image
[Prompt video]────────prompt────────────▶[Tạo video]`}</pre>
            <p className="muted docs-tip">
              Cột trái Workflow: <em>Mẫu: Ảnh→Video</em>.
            </p>
          </section>

          <section id="video-chain" className="panel-card docs-section">
            <h2>Pipeline: Nối video (frame cuối)</h2>
            <p className="muted">
              Frame cuối clip 1 làm start clip 2 — liên tục cảnh (continue).
            </p>
            <ol className="docs-steps">
              <li>
                <code>Video1</code> · video → <code>Tách frame</code> · video
              </li>
              <li>
                <code>Tách frame</code> · <strong>end_image</strong> (chấm hồng dưới) →{" "}
                <code>Video2</code> · <strong>start_image</strong>
              </li>
              <li>
                <code>Prompt2</code> · prompt → <code>Video2</code> · prompt
              </li>
              <li>
                <strong>Tiếp tục</strong> / <strong>Tạo lại</strong> khi cần
              </li>
            </ol>
            <pre className="docs-flow">{`[Ảnh]→[Video1]→[Tách frame]──end_image──▶[Video2]◀──prompt──[Prompt2]
                              (frame cuối)    start_image`}</pre>
            <p className="muted docs-tip">
              Cột trái: <em>Mẫu: Nối video (frame cuối)</em>.
            </p>
          </section>

          <section id="assets-ai" className="panel-card docs-section">
            <h2>Ảnh có sẵn &amp; AI prompt</h2>
            <ul className="docs-steps docs-steps-ul">
              <li>
                Node <code>Ảnh có sẵn</code> hoặc nút gắn ảnh trên Ảnh/Video — lấy Media project /
                thư viện <code>@ref</code>
              </li>
              <li>
                <code>Prompt</code> + <strong>✦ AI</strong>: đọc prompt hiện tại + node trước/sau
                trên graph để viết lại
              </li>
              <li>
                Bật API AI trong <Link to={NAV_ROUTES.settings}>Cài đặt</Link>
              </li>
            </ul>
          </section>

          <section id="run" className="panel-card docs-section">
            <h2>Chạy, tiếp tục &amp; phím tắt</h2>
            <div className="docs-grid-2">
              <div>
                <h3>Nút chạy</h3>
                <ul>
                  <li>
                    <strong>Chạy</strong> — cả graph
                  </li>
                  <li>
                    <strong>Tiếp tục</strong> — bỏ node đã OK
                  </li>
                  <li>
                    <strong>Tạo lại</strong> — gen lại một node
                  </li>
                </ul>
              </div>
              <div>
                <h3>Phím tắt</h3>
                <ul>
                  <li>
                    <kbd>Backspace</kbd> / <kbd>Delete</kbd> — xóa node
                  </li>
                  <li>Kéo nền — pan · scroll — zoom</li>
                  <li>Lưu project (cột trái)</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="media" className="panel-card docs-section">
            <h2>Media project</h2>
            <p className="muted">
              Cột phải Workflow chỉ hiện <strong>Media project</strong> (output project đang mở).
            </p>
            <ul>
              <li>
                Tab <strong>Ảnh</strong> | <strong>Video</strong>
              </li>
              <li>
                Sắp xếp <strong>mới trên · cũ dưới</strong>
              </li>
              <li>Click thumbnail phóng to · Folder trên disk</li>
              <li>
                Quản lý đầy đủ hơn tại <Link to={NAV_ROUTES.projects}>Projects</Link>
              </li>
            </ul>
          </section>

          {/* —— API Integration & Demo Run (MỚI) —— */}
          <section id="api-guide" className="panel-card docs-section" style={{ borderLeft: "4px solid var(--primary, #6366f1)" }}>
            <h2>Tích hợp API &amp; Demo chạy thử</h2>
            <p className="muted">
              Hệ thống cung cấp API từ xa giúp bạn tạo dự án và workflow tự động từ bất kỳ công cụ ngoài nào (Python, Node.js, cURL...).
            </p>

            <h3>Các Endpoint chính</h3>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Phương thức</th>
                    <th>Endpoint</th>
                    <th>Ý nghĩa</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="docs-side-badge out" style={{ background: "var(--success, #10b981)", color: "white" }}>POST</span></td>
                    <td><code>/api/workflows/create-bulk</code></td>
                    <td>Tạo dự án + vẽ workflow thô trên UI (Chờ chạy, không tự động chạy)</td>
                  </tr>
                  <tr>
                    <td><span className="docs-side-badge out" style={{ background: "var(--warning, #f59e0b)", color: "white" }}>POST</span></td>
                    <td><code>/api/workflows/run-bulk</code></td>
                    <td>Tạo dự án + Khởi chạy workflow song song lập tức trong background</td>
                  </tr>
                  <tr>
                    <td><span className="docs-side-badge in">GET</span></td>
                    <td><code>/api/workflows/runs/{"{run_id}"}</code></td>
                    <td>Theo dõi tiến độ chạy &amp; lấy danh sách file ảnh/video kết quả</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="docs-callout" style={{ marginTop: 16 }}>
              <strong>Mẹo nạp ảnh tham chiếu (@tên):</strong> Bạn chỉ cần gửi <code>name: "char"</code> (không phân biệt hoa thường). 
              Nếu nhân vật đã có trong thư viện cục bộ của máy, backend tự động lấy ảnh gốc chất lượng cao, không bao giờ ghi đè làm hỏng ảnh của bạn!
            </div>

            <h3>Chạy thử các kịch bản demo mẫu</h3>
            <p className="muted" style={{ fontSize: "13px" }}>
              Bấm trực tiếp vào các nút dưới đây để test API ngay trên giao diện web. Hệ thống sẽ tự động gọi API tương ứng và đưa bạn sang trang Canvas dự án mới tạo!
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
              {/* Demo 1 */}
              <div className="docs-demo-card panel-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 8 }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#fdba74" }}>📋 Demo 1: Kịch bản Báo thức @MODERNYOU (4 cảnh nối tiếp)</h4>
                <p className="muted" style={{ fontSize: "12px", margin: "0 0 12px 0", lineHeight: "1.5" }}>
                  Tạo chuỗi hoạt cảnh doodle 2D về chiếc chuông báo thức sáng thứ Hai. Gồm 4 node tạo ảnh, 4 node tạo video và 2 node cắt frame cuối nối tiếp cảnh. Sử dụng nhân vật tham chiếu `@MODERNYOU`.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button 
                    onClick={() => handleTriggerDemo("modernyou", "create")}
                    className="btn btn-primary btn-sm"
                  >
                    🎨 Dựng dự án thô (create-bulk)
                  </button>
                  <button 
                    onClick={() => handleTriggerDemo("modernyou", "run")}
                    className="btn btn-ghost btn-sm"
                  >
                    🚀 Chạy tự động (run-bulk)
                  </button>
                </div>
              </div>

              {/* Demo 2 */}
              <div className="docs-demo-card panel-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 8 }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#93c5fd" }}>📋 Demo 2: Hoạt cảnh Võ thuật @char (3 cảnh nối tiếp)</h4>
                <p className="muted" style={{ fontSize: "12px", margin: "0 0 12px 0", lineHeight: "1.5" }}>
                  Dựng chuỗi video hành động võ thuật của cô gái `@char`. Tự động cắt khung hình cuối của video trước làm ảnh bắt đầu cho video sau để tạo sự tiếp diễn mượt mà.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button 
                    onClick={() => handleTriggerDemo("char", "create")}
                    className="btn btn-primary btn-sm"
                  >
                    🎨 Dựng dự án thô (create-bulk)
                  </button>
                  <button 
                    onClick={() => handleTriggerDemo("char", "run")}
                    className="btn btn-ghost btn-sm"
                  >
                    🚀 Chạy tự động (run-bulk)
                  </button>
                </div>
              </div>

              {/* Mới: Hộp code mẫu tích hợp API */}
              <div style={{ marginTop: 24, borderTop: "1px dashed var(--border)", paddingTop: 16 }}>
                <h4 style={{ margin: "0 0 12px 0", color: "var(--primary, #6366f1)" }}>💻 Mẫu Code Tích Hợp API Từ Xa</h4>
                <p className="muted" style={{ fontSize: "13px", margin: "0 0 12px 0" }}>
                  Sử dụng các mẫu code dưới đây để gọi API từ bất kỳ ứng dụng hoặc script bên ngoài nào:
                </p>

                {/* Tab buttons */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button 
                    onClick={() => setApiTab("curl")} 
                    className={`btn btn-sm ${apiTab === "curl" ? "btn-primary" : "btn-ghost"}`}
                    style={{ padding: "4px 12px", fontSize: "12px" }}
                  >
                    cURL (Bash)
                  </button>
                  <button 
                    onClick={() => setApiTab("python")} 
                    className={`btn btn-sm ${apiTab === "python" ? "btn-primary" : "btn-ghost"}`}
                    style={{ padding: "4px 12px", fontSize: "12px" }}
                  >
                    Python
                  </button>
                </div>

                {/* Tab content */}
                {apiTab === "curl" ? (
                  <pre style={{ 
                    background: "rgba(0,0,0,0.4)", 
                    padding: 14, 
                    borderRadius: 6, 
                    overflowX: "auto", 
                    border: "1px solid var(--border)", 
                    color: "#a7f3d0", 
                    fontSize: "12px", 
                    fontFamily: "monospace", 
                    lineHeight: "1.5" 
                  }}>
{`# 🎨 Kịch bản 1: Tạo dự án thô (Chờ chạy - Dùng create-bulk)
curl -X POST http://localhost:8765/api/workflows/create-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "Chuỗi Võ Thuật 007",
    "aspect_ratio": "16:9",
    "boxes": [
      {
        "type": "video_generate",
        "prompts": "001 cô gái @char đang đứng thủ thế võ thuật\\n001 cô gái @char thực hiện động tác đấm thẳng"
      }
    ],
    "references": [
      {
        "name": "char",
        "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ..."
      }
    ]
  }'

# 🚀 Kịch bản 2: Tạo dự án & Khởi chạy lập tức (Dùng run-bulk)
curl -X POST http://localhost:8765/api/workflows/run-bulk \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_name": "Modern You Alarm Clock",
    "aspect_ratio": "16:9",
    "boxes": [
      {
        "type": "generate",
        "prompts": "001. Red alarm clock...\\n002. @MODERNYOU waking up..."
      }
    ]
  }'`}
                  </pre>
                ) : (
                  <pre style={{ 
                    background: "rgba(0,0,0,0.4)", 
                    padding: 14, 
                    borderRadius: 6, 
                    overflowX: "auto", 
                    border: "1px solid var(--border)", 
                    color: "#93c5fd", 
                    fontSize: "12px", 
                    fontFamily: "monospace", 
                    lineHeight: "1.5" 
                  }}>
{`import json
import urllib.request

BASE_URL = "http://localhost:8765/api"

payload = {
    "project_name": "Modern You Alarm Clock",
    "aspect_ratio": "16:9",
    "boxes": [
        {
            "type": "generate",
            "prompts": "001. Red alarm clock...\\n002. @MODERNYOU waking up..."
        }
    ],
    "references": [
        {
            "name": "MODERNYOU",
            "image": "data:image/png;base64,iVBORw0KGgoAAA..."
        }
    ]
}

# Gửi request lên endpoint /create-bulk để chỉ tạo dự án thô
req = urllib.request.Request(
    f"{BASE_URL}/workflows/create-bulk",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode("utf-8"))
        print(f"Project Created! ID: {data['project_id']}")
        print(f"Open URL: http://127.0.0.1:5173/workflow/{data['project_id']}")
except Exception as e:
    print("Error:", e)`}
                  </pre>
                )}
              </div>
            </div>
          </section>

          {/* —— Grok & Google Flow Mechanisms —— */}
          <section id="grok-flow-mechanisms" className="panel-card docs-section" style={{ borderLeft: "4px solid var(--purple-bright)" }}>
            <h2>Cơ chế hoạt động: Grok, Flow &amp; Meta AI</h2>
            <p className="muted">
              Ứng dụng G-Labs BW hoạt động dựa trên sự kết hợp giữa Backend dịch vụ Python và các Chrome Extension để thực hiện các tác vụ tạo tài nguyên tự động vượt rào chống bot.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
              <div>
                <h3 style={{ color: "var(--purple-bright)", margin: "0 0 8px 0" }}>1. Cơ chế tự động hóa Google Flow (Veo)</h3>
                <p className="muted" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                  Google Flow sử dụng một hệ thống xác thực chặt chẽ dựa trên tài khoản Google và các cơ chế chống bot bằng reCAPTCHA Enterprise:
                </p>
                <ul className="docs-bullets" style={{ fontSize: "13px" }}>
                  <li>
                    <strong>Quản lý Cookie &amp; Session:</strong> Khi người dùng mở trình duyệt đăng nhập Google Flow, ứng dụng G-Labs sẽ trích xuất token session an toàn và lưu vào tệp <code>accounts.json</code> để backend sử dụng.
                  </li>
                  <li>
                    <strong>Vượt rào reCAPTCHA Enterprise:</strong> Mỗi khi backend gửi lệnh gen, Google yêu cầu giải mã reCAPTCHA. Ứng dụng sẽ ủy thác tác vụ giải mã này cho Chrome extension <strong>G-Labs Automation - Auth Helper</strong>. Extension này tự động tiêm tập lệnh giải mã và gọi thư viện <code>grecaptcha.enterprise</code> của Google trong ngữ cảnh tab thật để lấy Token giải mã hợp lệ gửi về cho backend.
                  </li>
                  <li>
                    <strong>Xoay vòng tài khoản (Rotating Queue):</strong> Nếu một tài khoản bị lỗi (quá hạn ngạch gen, phản hồi lỗi 503), backend sẽ tự động tạm dừng tài khoản đó trong thời gian chờ (cooldown) và xoay vòng sang tài khoản Google tiếp theo trong hàng đợi, đảm bảo gen liên tục không bị gián đoạn.
                  </li>
                </ul>
              </div>

              <hr style={{ border: "0", borderTop: "1px dashed var(--border)", margin: "10px 0" }} />

              <div>
                <h3 style={{ color: "#fdba74", margin: "0 0 8px 0" }}>2. Cơ chế vượt rào chống bot Grok (grok.com)</h3>
                <p className="muted" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                  Grok.com chặn bot bằng Cloudflare và cơ chế mã token động <code>x-statsig-id</code> sinh ra từ dấu vân tay thiết bị (DOM-fingerprint) của trình duyệt. Ứng dụng sử dụng cơ chế vượt rào song song:
                </p>
                <ul className="docs-bullets" style={{ fontSize: "13px" }}>
                  <li>
                    <strong>Đăng nhập kép (Dual Auth):</strong> Hỗ trợ sử dụng xAI API chính thức (cần API Key trả phí) hoặc sử dụng Session Web miễn phí trực tiếp từ tab Grok của bạn (qua cookies sso/sso-rw).
                  </li>
                  <li>
                    <strong>Tự động tạo mã chống bot (Statsig Minting Bypass):</strong> Ứng dụng tích hợp bộ <em>Statsig Mint Recipe</em>. Khi chạy tác vụ gen, backend gửi công thức cấu hình Turbopack (module ID 13530089) xuống cho Extension. Extension sẽ truy cập trực tiếp vào nhân quản lý module Turbopack của tab <code>grok.com/imagine</code> đang chạy, kích hoạt hàm middleware của Grok để tự sinh ra mã <code>x-statsig-id</code> mới và stamp thẳng vào request. Bạn không cần phải click gen ảnh bằng tay trên web để "đánh hơi" mã nữa.
                  </li>
                  <li>
                    <strong>WebSocket inside MAIN world:</strong> Đối với tạo ảnh, Extension mở một kết nối WebSocket trực tiếp đến <code>wss://grok.com/ws/imagine/listen</code> ngay bên trong trang Grok của bạn. Bằng cách này, request thừa hưởng toàn bộ thông số cookie, User-Agent và IP của trình duyệt thực tế, bypass 100% Cloudflare và tải ảnh chất lượng gốc về máy.
                  </li>
                </ul>
              </div>

              <hr style={{ border: "0", borderTop: "1px dashed var(--border)", margin: "10px 0" }} />

              <div>
                <h3 style={{ color: "#3498db", margin: "0 0 8px 0" }}>3. Cơ chế hoạt động của Meta AI (Vibes AI)</h3>
                <p className="muted" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                  Meta AI (hoạt động thông qua cổng Vibes.ai) sử dụng session xác thực từ Cookie để thực hiện các yêu cầu sinh ảnh và video miễn phí bằng các mô hình của Meta:
                </p>
                <ul className="docs-bullets" style={{ fontSize: "13px" }}>
                  <li>
                    <strong>Đăng nhập thông qua Cookie meta_session:</strong> Tương tự như cơ chế của Flow, Vibes AI xác thực người dùng bằng cookie <code>meta_session</code>. Cookie này có thể được xuất dễ dàng từ trình duyệt Chrome khi bạn truy cập và đăng nhập vào trang <code>vibes.ai</code> bằng tài khoản của mình.
                  </li>
                  <li>
                    <strong>Tương tác qua REST API trực tiếp:</strong> Sau khi cấu hình cookie trong phần Cài đặt, Backend sẽ thực hiện gửi các yêu cầu HTTP POST/GET trực tiếp đến API của Vibes AI (<code>/api/v1/meta/generate</code> hoặc <code>/api/v1/meta/video/generate</code>) kèm theo cookie xác thực để tạo nội dung một cách tự động, không cần tương tác thủ công trên giao diện web.
                  </li>
                  <li>
                    <strong>Hỗ trợ đa dạng tỷ lệ và Mô hình:</strong> Hỗ trợ các tỷ lệ màn hình 1:1, 9:16, 16:9 cho ảnh và video với các mô hình <code>midjen-base</code> và <code>midjen-short</code> của Meta, cũng như tải kết xuất video 480p chất lượng cao trực tiếp về máy.
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
