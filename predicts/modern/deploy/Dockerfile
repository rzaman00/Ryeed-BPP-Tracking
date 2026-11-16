# Build from predicts/modern:  docker build -f deploy/Dockerfile -t bpp-predicts .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BPP_PREDICTS_HOST=0.0.0.0
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
COPY static ./static
COPY data ./data
EXPOSE 8000
CMD ["python", "app.py"]
