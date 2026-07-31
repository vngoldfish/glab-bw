"""Test: kiểm tra browser pool chỉ mở đúng 1 tab Flow."""
import asyncio
import sys
sys.path.insert(0, ".")

async def main():
    from app.services.browser_pool import browser_pool_manager

    print("=" * 60)
    print("TEST: Kiểm tra số tab đang mở trong Browser Pool")
    print("=" * 60)

    for aid, inst in browser_pool_manager._instances.items():
        print(f"\n📋 Account: {inst.account_label} ({aid})")
        print(f"   Status: {inst.status}")
        print(f"   Started: {inst.started_at}")

        if inst._context:
            pages = inst._context.pages
            print(f"   Tổng pages: {len(pages)}")
            for i, p in enumerate(pages):
                try:
                    url = p.url or "(blank)"
                except:
                    url = "(error reading url)"
                print(f"   Page {i}: {url}")

            # Đếm tab Flow
            flow_tabs = [p for p in pages if "labs.google" in (p.url or "")]
            ext_tabs = [p for p in pages if "chrome-extension://" in (p.url or "")]
            other_tabs = [p for p in pages if "labs.google" not in (p.url or "") and "chrome-extension://" not in (p.url or "")]

            print(f"\n   🟢 Flow tabs: {len(flow_tabs)}")
            print(f"   🔵 Extension tabs: {len(ext_tabs)}")
            print(f"   ⚪ Other tabs: {len(other_tabs)}")

            if len(flow_tabs) > 1:
                print(f"\n   ❌ LỖI: Có {len(flow_tabs)} tab Flow! Chỉ nên có 1.")
                print(f"   → Đóng {len(flow_tabs) - 1} tab thừa...")
                for p in flow_tabs[1:]:
                    try:
                        await p.close()
                        print(f"     Đã đóng: {p.url}")
                    except Exception as e:
                        print(f"     Lỗi đóng: {e}")
            elif len(flow_tabs) == 1:
                print(f"\n   ✅ OK: Đúng 1 tab Flow")
            else:
                print(f"\n   ⚠️ Không có tab Flow nào!")

            if other_tabs:
                print(f"\n   ⚠️ Có {len(other_tabs)} tab thừa (không phải Flow/Extension):")
                for p in other_tabs:
                    print(f"     - {p.url}")
        else:
            print("   ⚠️ Không có context (browser chưa chạy)")

    print("\n" + "=" * 60)

    # Test 2: Stop rồi launch lại, kiểm tra
    print("\nTEST 2: Stop → Launch lại → Kiểm tra tab")
    for aid, inst in list(browser_pool_manager._instances.items()):
        print(f"\n🔄 Stopping {inst.account_label}...")
        await browser_pool_manager.stop(aid)
        print(f"   Stopped ✅")

        print(f"🔄 Launching lại...")
        new_inst = await browser_pool_manager.launch(aid, headless=True)

        # Đợi browser khởi động xong
        for _ in range(10):
            await asyncio.sleep(2)
            if new_inst.status == "running":
                break

        print(f"   Status: {new_inst.status}")

        if new_inst._context:
            pages = new_inst._context.pages
            print(f"   Tổng pages sau restart: {len(pages)}")
            flow_count = 0
            for i, p in enumerate(pages):
                url = p.url or "(blank)"
                is_flow = "labs.google" in url
                is_ext = "chrome-extension://" in url
                tag = "🟢 Flow" if is_flow else ("🔵 Ext" if is_ext else "⚪ Other")
                print(f"   Page {i}: [{tag}] {url}")
                if is_flow:
                    flow_count += 1

            if flow_count == 1:
                print(f"\n   ✅ PASS: Đúng 1 tab Flow sau restart!")
            elif flow_count > 1:
                print(f"\n   ❌ FAIL: Vẫn {flow_count} tab Flow sau restart!")
            else:
                print(f"\n   ⚠️ WARN: Không có tab Flow sau restart")

    print("\n" + "=" * 60)
    print("TEST XONG")

asyncio.run(main())
