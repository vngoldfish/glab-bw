import asyncio
import os
import json
from app.services.workflow_runner import run_workflow
from app.services import project_store

async def test_workflow_node_isolation():
    pid = "test_isolation_proj"
    proj = {
        "id": pid,
        "name": "Test Isolation Project",
        "description": "Test node video isolation",
        "nodes": [
            {
                "id": "node_v1",
                "type": "video_generate_plus",
                "position": {"x": 100, "y": 100},
                "data": {"title": "Tạo video 1", "prompt": "a sleeping cat", "model": "veo_31_lite_relaxed"}
            },
            {
                "id": "node_v2",
                "type": "video_generate_plus",
                "position": {"x": 600, "y": 100},
                "data": {"title": "Tạo video 2", "prompt": "a running dog", "model": "veo_31_lite_relaxed"}
            }
        ],
        "edges": []
    }
    project_store.save_project(proj, pid)

    # 1. Run Node 1 only
    prior1 = {}
    print("--- Running Node 1 ONLY ---")
    run1 = await run_workflow(
        proj,
        prior_results=prior1,
        skip_completed=True,
        only_node_ids=["node_v1"],
        project_id=pid
    )
    print("Run 1 Node Results keys:", list(run1["node_results"].keys()))
    print("Run 1 Node 1 result:", run1["node_results"].get("node_v1"))
    print("Run 1 Node 2 result:", run1["node_results"].get("node_v2"))

    # Load saved project after Run 1
    p1 = project_store.get_project(pid)
    n1_data = [n for n in p1["nodes"] if n["id"] == "node_v1"][0]["data"]
    n2_data = [n for n in p1["nodes"] if n["id"] == "node_v2"][0]["data"]
    print("DB after Run 1 - Node 1 resultUrls:", n1_data.get("resultUrls"))
    print("DB after Run 1 - Node 2 resultUrls:", n2_data.get("resultUrls"))

    # 2. Run Node 2 only with prior_results from Node 1
    prior2 = {
        "node_v1": {
            "status": "completed",
            "type": "video_generate_plus",
            "results": n1_data.get("resultUrls", ["http://127.0.0.1:8765/api/files/test/v1.mp4"])
        }
    }
    print("\n--- Running Node 2 ONLY ---")
    run2 = await run_workflow(
        proj,
        prior_results=prior2,
        skip_completed=True,
        only_node_ids=["node_v2"],
        project_id=pid
    )
    print("Run 2 Node Results keys:", list(run2["node_results"].keys()))
    print("Run 2 Node 1 result in run:", run2["node_results"].get("node_v1"))
    print("Run 2 Node 2 result in run:", run2["node_results"].get("node_v2"))

    # Load saved project after Run 2
    p2 = project_store.get_project(pid)
    n1_data_after = [n for n in p2["nodes"] if n["id"] == "node_v1"][0]["data"]
    n2_data_after = [n for n in p2["nodes"] if n["id"] == "node_v2"][0]["data"]
    print("\nDB after Run 2 - Node 1 resultUrls:", n1_data_after.get("resultUrls"))
    print("DB after Run 2 - Node 2 resultUrls:", n2_data_after.get("resultUrls"))

    assert n1_data_after.get("resultUrls") != n2_data_after.get("resultUrls"), "BUG! Node 1 resultUrls matches Node 2 resultUrls!"
    print("\n✅ PYTHON TEST PASSED: Node 1 and Node 2 results are isolated!")

if __name__ == "__main__":
    asyncio.run(test_workflow_node_isolation())
