"""
Test script: Verify SSE progress tracking end-to-end.
1. Connect to SSE stream
2. Emit test events from backend
3. Verify events arrive at client
"""
import asyncio
import sys
import json
import time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from app.core.progress import (
    progress_bus, emit_task_status, emit_task_progress,
    emit_workflow_log, ProgressEvent, EventType
)

async def test_progress_system():
    print("=" * 50)
    print("  SSE Progress Tracker — Integration Test")
    print("=" * 50)
    
    # Test 1: Subscribe a client
    print("\n[Test 1] Subscribe client...")
    queue = progress_bus.subscribe("test-client-001")
    assert progress_bus.client_count == 1
    print(f"  ✅ Client subscribed (count: {progress_bus.client_count})")
    
    # Test 2: Emit task status
    print("\n[Test 2] Emit task status events...")
    emit_task_status("task-abc123", "image", "running", message="Bắt đầu: beautiful landscape")
    event = await asyncio.wait_for(queue.get(), timeout=2)
    assert event.type == EventType.TASK_STATUS
    assert event.status == "running"
    assert event.task_id == "task-abc123"
    print(f"  ✅ Received: type={event.type.value}, status={event.status}, msg={event.message}")
    
    # Test 3: Emit task progress
    print("\n[Test 3] Emit task progress events...")
    emit_task_progress("task-abc123", "Đang gửi prompt tạo ảnh...", percent=30, task_type="image")
    event = await asyncio.wait_for(queue.get(), timeout=2)
    assert event.type == EventType.TASK_PROGRESS
    assert event.percent == 30
    print(f"  ✅ Received: step={event.step}, percent={event.percent}%")
    
    # Test 4: Rate limiting (progress within 300ms should be dropped)
    print("\n[Test 4] Rate limiting test...")
    await asyncio.sleep(0.35)  # Wait for rate limit window to reset
    emit_task_progress("task-abc123", "Step A", percent=40, task_type="image")
    emit_task_progress("task-abc123", "Step B", percent=50, task_type="image")  # should be dropped
    emit_task_progress("task-abc123", "Step C", percent=60, task_type="image")  # should be dropped
    
    event = await asyncio.wait_for(queue.get(), timeout=2)
    assert event.step == "Step A"  # Only first should arrive
    
    # Queue should be empty (rate limited)
    assert queue.empty(), "Rate limiting didn't work — extra events leaked through"
    print(f"  ✅ Rate limited: only 'Step A' arrived, 'Step B'+'Step C' dropped")
    
    # Test 5: percent=100 always goes through (even within rate limit)
    print("\n[Test 5] Complete event bypasses rate limit...")
    emit_task_progress("task-abc123", "Hoàn thành!", percent=100, task_type="image")
    event = await asyncio.wait_for(queue.get(), timeout=2)
    assert event.percent == 100
    print(f"  ✅ 100% event delivered: step={event.step}")
    
    # Test 6: Workflow log
    print("\n[Test 6] Workflow log events...")
    emit_workflow_log("run-xyz789", "Node prompt_1 hoàn thành", data={"done": 2, "total": 5})
    event = await asyncio.wait_for(queue.get(), timeout=2)
    assert event.type == EventType.WORKFLOW_LOG
    assert event.message == "Node prompt_1 hoàn thành"
    print(f"  ✅ Received: msg={event.message}, data={event.data}")
    
    # Test 7: Log buffering
    print("\n[Test 7] Log buffering (500ms batch)...")
    from app.core.progress import SSELogHandler
    import logging
    handler = SSELogHandler(min_level=logging.INFO)
    handler.setFormatter(logging.Formatter("%(message)s"))
    
    test_logger = logging.getLogger("test.buffer")
    test_logger.addHandler(handler)
    test_logger.setLevel(logging.INFO)
    
    test_logger.info("Buffered log line 1")
    test_logger.info("Buffered log line 2")
    test_logger.info("Buffered log line 3")
    
    # Should NOT arrive yet (buffered 500ms)
    assert queue.empty(), "Log buffer leaked immediately"
    print("  ⏳ Logs buffered, waiting 600ms for flush...")
    
    await asyncio.sleep(0.6)
    
    count = 0
    while not queue.empty():
        ev = queue.get_nowait()
        count += 1
    assert count == 3, f"Expected 3 buffered logs, got {count}"
    print(f"  ✅ {count} buffered log events flushed after 500ms")
    
    # Test 8: Task completion flow
    print("\n[Test 8] Full task lifecycle...")
    emit_task_status("task-full-001", "video", "running", message="Bắt đầu tạo video")
    await asyncio.wait_for(queue.get(), timeout=2)
    
    # Wait for rate limit to expire
    await asyncio.sleep(0.35)
    emit_task_progress("task-full-001", "Đang chọn tài khoản...", percent=5, task_type="video")
    await asyncio.wait_for(queue.get(), timeout=2)
    
    await asyncio.sleep(0.35)
    emit_task_progress("task-full-001", "Đang gửi prompt...", percent=15, task_type="video")
    await asyncio.wait_for(queue.get(), timeout=2)
    
    emit_task_status("task-full-001", "video", "completed", message="Hoàn thành (1 kết quả)")
    await asyncio.wait_for(queue.get(), timeout=2)
    print("  ✅ Full lifecycle: running → 5% → 15% → completed")
    
    # Cleanup
    progress_bus.unsubscribe("test-client-001")
    assert progress_bus.client_count == 0
    print(f"\n  ✅ Cleanup done (clients: {progress_bus.client_count})")
    
    print("\n" + "=" * 50)
    print("  ALL 8 TESTS PASSED ✅")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(test_progress_system())
