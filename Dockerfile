FROM python:3.12-slim

WORKDIR /app

# System deps for reportlab + pdfminer
RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6-dev libjpeg-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy built frontend into /app/static  (built by CI before docker build)
COPY frontend/dist/ ./static/

# Serve static files from FastAPI
RUN pip install --no-cache-dir aiofiles

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
