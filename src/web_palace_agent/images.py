from __future__ import annotations

import base64
from abc import ABC, abstractmethod

from .schemas import GeneratedAsset, ImageGenerationSettings, ImageRequest
from .workspace import Workspace


class ImageGenerator(ABC):
    @abstractmethod
    async def generate(
        self,
        requests: list[ImageRequest],
        settings: ImageGenerationSettings,
        workspace: Workspace,
    ) -> list[GeneratedAsset]: ...


class OpenAIImageGenerator(ImageGenerator):
    """Approved, bounded OpenAI image generation for PNG Web Palace assets."""

    async def generate(
        self,
        requests: list[ImageRequest],
        settings: ImageGenerationSettings,
        workspace: Workspace,
    ) -> list[GeneratedAsset]:
        if settings.provider != "openai" or not settings.model:
            raise ValueError("OpenAI image generation requires provider 'openai' and an image model")
        from openai import AsyncOpenAI

        client = AsyncOpenAI()
        generated: list[GeneratedAsset] = []
        for request in requests[: settings.maximum_images]:
            response = await client.images.generate(
                model=settings.model,
                prompt=request.prompt,
                size=request.size,
                n=1,
            )
            encoded = response.data[0].b64_json
            if not encoded:
                raise RuntimeError("Image provider did not return base64 image data")
            workspace.write_binary(request.relative_path, base64.b64decode(encoded))
            generated.append(
                GeneratedAsset(
                    relative_path=request.relative_path,
                    purpose=request.purpose,
                    provider=settings.provider,
                    model=settings.model,
                    estimated_cost_usd=settings.estimated_cost_per_image,
                )
            )
        return generated
