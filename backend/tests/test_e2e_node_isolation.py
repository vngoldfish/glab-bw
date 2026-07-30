import asyncio
import json
from app.services.workflow_runner import run_workflow
from app.services import project_store

async def test_e2e_isolation():
    pid = "test_e2e_isolation_proj"
    proj = {
        "id": pid,
        "name": "E2E Isolation Project",
        "description": "Verification test for node isolation",
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

    print("1. Running Node 1...")
    run1 = await run_workflow(proj, prior_results={}, skip_completed=True, only_node_ids=["node_v1"], project_id=pid)
    n1_res = run1["node_results"]["node_v1"]["results"]
    print("   Node 1 generated:", n1_res)

    p1 = project_store.get_project(pid)
    p1_n1_urls = [n for n in p1["nodes"] if n["id"] == "node_v1"][0]["data"].get("resultUrls")
    print("   DB Node 1 resultUrls:", p1_n1_urls)

    prior2 = {
        "node_v1": {
            "status": "completed",
            "type": "video_generate_plus",
            "results": p1_n1_urls
        }
    }

    print("\n2. Running Node 2...")
    run2 = await run_workflow(proj, prior_results=prior2, skip_completed=True, only_node_ids=["node_v2"], project_id=pid)
    n2_res = run2["node_results"]["node_v2"]["results"]
    print("   Node 2 generated:", n2_res)

    p2 = project_store.get_project(pid)
    p2_n1_urls = [n for n in p2["nodes"] if n["id"] == "node_v1"][0]["data"].get("resultUrls")
    p2_n2_urls = [n for n in p2["nodes"] if n["id"] == "node_v2"][0]["data"].get("resultUrls")
    print("\n3. DB Verification after Node 2 run:")
    print("   DB Node 1 resultUrls:", p2_n1_urls)
    print("   DB Node 2 resultUrls:", p2_n2_urls)

    assert p2_n1_urls == p1_n1_urls, f"FAIL! Node 1 resultUrls changed from {p1_n1_urls} to {p2_n1_urls}"
    assert p2_n1_urls != p2_n2_urls, f"FAIL! Node 1 and Node 2 share identical resultUrls: {p2_n1_urls}"
    print("\n🎉 100% E2E ISOLATION VERIFIED PERFECTLY!")

if __name__ == "__main__":
    asyncio.run(test_e2e_isolation())
