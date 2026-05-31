import os
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RQ_QUEUE = os.getenv("RQ_QUEUE", "meetings")
DATA_DIR = os.getenv("DATA_DIR", "/tmp/auto-write-data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
DB_PATH = os.getenv("DB_PATH", os.path.join(DATA_DIR, "app.db"))
WEB_DIR = os.getenv(
    "WEB_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "web")),
)

# Cloudflare R2
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "auto-write-uploads")
