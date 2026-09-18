import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


class Settings:
    @property
    def cf_account_id(self) -> str | None:
        return os.environ.get("CF_ACCOUNT_ID")

    @property
    def cf_d1_database_id(self) -> str | None:
        return os.environ.get("CF_D1_DATABASE_ID")

    @property
    def cf_api_token(self) -> str | None:
        return os.environ.get("CF_API_TOKEN")

    @property
    def poyo_api_key(self) -> str | None:
        return os.environ.get("POYO_API_KEY")

    @property
    def poyo_base_url(self) -> str:
        return os.environ.get("POYO_BASE_URL", "https://api.poyo.ai")

    @property
    def pexels_api_key(self) -> str | None:
        return os.environ.get("PEXELS_API_KEY")

    @property
    def blob_read_write_token(self) -> str | None:
        return os.environ.get("BLOB_READ_WRITE_TOKEN")

    @property
    def app_access_token(self) -> str | None:
        return os.environ.get("APP_ACCESS_TOKEN")


settings = Settings()
