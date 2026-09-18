from fastapi import Depends
from starlette.middleware.cors import CORSMiddleware


def register_routers(app, api_router, cron_router, require_app_token):
    app.include_router(api_router, dependencies=[Depends(require_app_token)])
    app.include_router(cron_router)


def configure_cors(app, cors_origins_csv: str):
    origins = [origin.strip() for origin in cors_origins_csv.split(",")]
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=False,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
