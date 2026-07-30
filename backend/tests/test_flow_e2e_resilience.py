import asyncio
import logging
from app.services.account_store import account_store
from app.providers.flow_veo_provider import FlowVeoProvider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_resilience_test():
    accounts = account_store.list_accounts("flow")
    active_accounts = [a for a in accounts if getattr(a, "enabled", True)]
    assert len(active_accounts) > 0, "No active Flow accounts found in test DB"
    
    account = active_accounts[0]
    provider = FlowVeoProvider(account)
    
    logger.info("=========================================")
    logger.info("1. Testing Flow Image Generation...")
    images = await provider.generate_image(
        prompt="a cute small white kitten on green grass",
        params={"model": "nano_banana_2_lite", "aspect_ratio": "16:9", "count": 1}
    )
    assert len(images) > 0, "Image generation returned empty output"
    assert len(images[0]) > 100, "Image output bytes too small"
    logger.info("✅ Image generation PASSED (%d bytes)", len(images[0]))

    logger.info("=========================================")
    logger.info("2. Injecting fake/stale project_id to force 404 auto-recovery...")
    creds = dict(account.credentials)
    creds["project_id"] = "fake_stale_project_999999"
    creds["image_project_id"] = "fake_stale_image_project_999999"
    account_store.update(account.id, credentials=creds)

    logger.info("=========================================")
    logger.info("3. Testing Image Auto-Recovery on 404...")
    recovered_images = await provider.generate_image(
        prompt="a red apple on table",
        params={"model": "nano_banana_2_lite", "aspect_ratio": "16:9", "count": 1}
    )
    assert len(recovered_images) > 0, "Recovered image generation failed"
    assert len(recovered_images[0]) > 100, "Recovered image bytes too small"
    logger.info("✅ 404 Auto-Recovery PASSED!")

    logger.info("=========================================")
    logger.info("4. Testing Flow Video Generation...")
    videos = await provider.generate_video(
        prompt="a flying golden butterfly in a garden",
        params={"model": "veo_31_lite_relaxed", "mode": "text_to_video", "duration": 5}
    )
    assert len(videos) > 0, "Video generation returned empty output"
    assert len(videos[0]) > 100, "Video output bytes too small"
    logger.info("✅ Video generation PASSED (%d bytes)", len(videos[0]))
    logger.info("=========================================")
    logger.info("ALL RESILIENCE TESTS PASSED SUCCESSFULLY!")
    logger.info("=========================================")

if __name__ == "__main__":
    asyncio.run(run_resilience_test())
