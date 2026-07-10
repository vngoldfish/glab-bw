import { Link } from "react-router-dom";
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
        </div>
      </div>
    </div>
  );
}
