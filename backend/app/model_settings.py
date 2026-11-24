from agents import ModelSettings
from openai.types.shared import Reasoning

from app.config import Settings


def model_settings_for(settings: Settings) -> ModelSettings:
    """Build shared model settings from validated backend configuration."""
    return ModelSettings(reasoning=Reasoning(effort=settings.openai_reasoning_effort))
