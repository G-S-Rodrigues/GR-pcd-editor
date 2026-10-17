FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS python-deps
COPY --from=ghcr.io/astral-sh/uv:0.12.10 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/app/.venv UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim-bookworm AS app
RUN groupadd -g 10001 app \
    && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin app \
    && mkdir -p /data /work \
    && chown 10001:10001 /work \
    && chmod 1777 /work
COPY --from=python-deps /app/.venv /app/.venv
COPY backend/ /app/backend/
COPY --from=frontend-build /src/frontend/dist /app/static
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GR_PCD_DATA_ROOT=/data \
    GR_PCD_WORK_ROOT=/work \
    GR_PCD_STATIC_DIR=/app/static
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python","-c","import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]
CMD ["uvicorn","--app-dir","/app/backend","gr_pcd.app:app","--host","0.0.0.0","--port","8080"]

FROM app AS checks
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends shellcheck libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend-build /src/frontend /app/frontend
COPY --from=python-deps /usr/local/bin/uv /usr/local/bin/uv
COPY pyproject.toml uv.lock /app/
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/app/.venv UV_COMPILE_BYTECODE=0
RUN uv sync --frozen --no-install-project
COPY tests/ /app/tests/
COPY scripts/ /app/scripts/
COPY gr-pcd-visualizer.sh /app/
RUN chown 10001:10001 /app && chown -R 10001:10001 /app/frontend
USER 10001:10001
