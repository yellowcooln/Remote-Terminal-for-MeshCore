from fastapi import APIRouter

from app.models import StatisticsResponse
from app.repository import StatisticsRepository

router = APIRouter(prefix="/statistics", tags=["statistics"])


@router.get("", response_model=StatisticsResponse)
async def get_statistics() -> StatisticsResponse:
    data = await StatisticsRepository.get_all()
    return StatisticsResponse(**data)
