# G-Labs BW — Grok Statsig companion

Chạy **cùng** extension gốc **G-Labs Automation - Auth Helper**.

## Việc của extension này

- Lấy `x-statsig-id` (anti-bot code 7) từ tab `grok.com`
- Đẩy lên bridge `http://127.0.0.1:18923/sync/statsig`
- Backend gắn header vào `gfetch` của Auth Helper
- **Không reload / không nhảy URL** tab Grok

## Cài

1. Chrome → `chrome://extensions` → Developer mode
2. **Load unpacked** → chọn thư mục `extension-grok/`
3. Reload extension sau mỗi lần update code

## Quy trình gen (không F5)

1. Mở đúng `https://grok.com/imagine` (login SuperGrok)
2. Gen **1 ảnh thủ công** trên web — **giữ tab, không đóng**
3. Badge extension → **OK** (đã có statsig)
4. Trong app: Flow Image → Engine **Grok** → gen ngay

## Badge

| Badge | Ý nghĩa |
|-------|---------|
| OK (xanh) | Đã có x-statsig-id |
| … (vàng) | Tab mở nhưng chưa token — gen 1 ảnh trên web |
| TAB | Chưa mở grok.com/imagine |
| OFF | Bridge :18923 tắt / thiếu route statsig |
