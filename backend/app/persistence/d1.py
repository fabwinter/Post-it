import asyncio
from typing import Optional

import requests
from fastapi import HTTPException


def d1_query_sync(sql: str, params: Optional[list], cf_account_id: str, cf_d1_database_id: str, cf_api_token: str):
    if not (cf_account_id and cf_d1_database_id and cf_api_token):
        raise HTTPException(
            status_code=500,
            detail="Cloudflare D1 is not configured (need CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN)",
        )
    url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account_id}/d1/database/{cf_d1_database_id}/query"
    resp = requests.post(
        url,
        headers={"Authorization": f"******", "Content-Type": "application/json"},
        json={"sql": sql, "params": params or []},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"D1 error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    if not body.get("success"):
        raise HTTPException(status_code=502, detail=f"D1 query failed: {str(body.get('errors'))[:400]}")
    result = (body.get("result") or [{}])[0]
    return result.get("results", []), result.get("meta", {})


async def d1_query(sql: str, params: Optional[list], cf_account_id: str, cf_d1_database_id: str, cf_api_token: str):
    return await asyncio.to_thread(d1_query_sync, sql, params, cf_account_id, cf_d1_database_id, cf_api_token)
