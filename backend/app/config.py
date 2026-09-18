from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    cf_account_id: str | None = os.environ.get("CF_ACCOUNT_ID")
    cf_d1_database_id: str | None = os.environ.get("CF_D1_DATABASE_ID")
    cf_api_token: str | None = os.environ.get("CF_API_TOKEN")
    poyo_api_key: str | None = os.environ.get("POYO_API_KEY")
    poyo_base_url: str = os.environ.get("POYO_BASE_URL", "https://api.poyo.ai")
    pexels_api_key: str | None = os.environ.get("PEXELS_API_KEY")
    blob_read_write_token: str | None = os.environ.get("BLOB_READ_WRITE_TOKEN")
    app_access_token: str | None = os.environ.get("APP_ACCESS_TOKEN")


settings = Settings()
