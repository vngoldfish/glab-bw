import asyncio
import os
import json
from app.services.workflow_runner import run_workflow
from app.services import project_store

async def test_chained_node_isolation():
    pid = "test_chained_proj"
    proj = {
        "id": pid,
        "name": "Chained Video Project",
        "description": "Test chained video nodes with default titles",
        "nodes": [
            {
                "id": "node_video_1",
                "type": "video_generate_plus",
                "position": {"x": 100, "y": 100},
                "data": {"id": "node_video_1", "title": "Tạo video", "prompt": "a blue ocean wave", "model": "veo_31_lite_relaxed"}
            },
            {
                "id": "node_frame_1",
                "type": "frame_extract",
                "position": {"x": 400, "y": 100},
                "data": {"id": "node_frame_1", "title": "Tách frame", "positions": "end"}
            },
            {
                "id": "node_video_2",
                "type": "video_generate_plus",
                "position": {"x": 700, "y": 100},
                "data": {"id": "node_video_2", "title": "Tạo video", "prompt": "a flying eagle", "model": "veo_31_lite_relaxed"}
            }
        ],
        "edges": [
            {
                "id": "e1",
                "source": "node_video_1",
                "sourceHandle": "video",
                "target": "node_frame_1",
                "targetHandle": "video"
            },
            {
                "id": "e2",
                "source": "node_frame_1",
                "sourceHandle": "end_image",
                "target": "node_video_2",
                "targetHandle": "start_image"
            }
        ]
    }
    project_store.save_project(proj, pid)

    # Step 1: Run Node 1 only
    print("1. Executing Node 1...")
    run1 = await run_workflow(proj, prior_results={}, skip_completed=True, only_node_ids=["node_video_1"], project_id=pid)
    n1_file = run1["node_results"]["node_video_1"]["results"][0]
    print("   Node 1 video file URL:", n1_file)

    p1 = project_store.get_project(pid)
    n1_url_p1 = [n for n in p1["nodes"] if n["id"] == "node_video_1"][0]["data"].get("resultUrls")[0]

    # Step 2: Run Frame Extract node
    print("\n2. Executing Frame Extract...")
    prior_fe = {
        "node_video_1": {
            "status": "completed",
            "type": "video_generate_plus",
            "results": [n1_url_p1]
        }
    }
    run_fe = await run_workflow(proj, prior_results=prior_fe, skip_completed=True, only_node_ids=["node_frame_1"], project_id=pid)
    frame_url = run_fe["node_results"]["node_frame_1"]["results"][0]
    print("   Extracted Frame URL:", frame_url)

    p_fe = project_store.get_project(pid)
    n1_url_fe = [n for n in p_fe["nodes"] if n["id"] == "node_video_1"][0]["data"].get("resultUrls")[0]
    print("   DB Node 1 resultUrls after Frame Extract:", n1_url_fe)

    # Step 3: Run Node 2 only
    print("\n3. Executing Node 2...")
    prior_v2 = {
        "node_video_1": {
            "status": "completed",
            "type": "video_generate_plus",
            "results": [n1_url_p1]
        },
        "node_frame_1": {
            "status": "completed",
            "type": "frame_extract",
            "results": [frame_url],
            "frames": [{"position": "end", "url": frame_url}]
        }
    }
    run2 = await run_workflow(proj, prior_results=prior_v2, skip_completed=True, only_node_ids=["node_video_2"], project_id=pid)
    n2_file = run2["node_results"]["node_video_2"]["results"][0]
    print("   Node 2 video file URL:", n2_file)

    p2 = project_store.get_project(pid)
    n1_url_p2 = [n for n in p2["nodes"] if n["id"] == "node_video_1"][0]["data"].get("resultUrls")[0]
    n2_url_p2 = [n for n in p2["nodes"] if n["id"] == "node_video_2"][0]["data"].get("resultUrls")[0]

    print("\n4. Final DB Check:")
    print("   Node 1 resultUrls:", n1_url_p2)
    print("   Node 2 resultUrls:", n2_url_p2)

    assert n1_url_p2 != n2_url_p2, f"FAIL! Node 1 and Node 2 have the SAME video URL: {n1_url_p2}"
    print("\n🎉 CHAINED TEST PASSED! Node 1 and Node 2 video URLs are completely separate!")

if __name__ == "__main__":
    asyncio.run(test_chained_node_isolation())
