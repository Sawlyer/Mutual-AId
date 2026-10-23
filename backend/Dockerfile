FROM ghcr.io/astral-sh/uv:0.11.23 AS uv
FROM python:3.12-slim-bookworm

COPY --from=uv /uv /uvx /bin/

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

COPY pyproject.toml uv.lock ./
COPY app ./app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]

CMD ["/opt/venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/backend/app"]
