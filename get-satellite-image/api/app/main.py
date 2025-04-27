import httpx
import os
import psycopg2
import psycopg2.pool
from fastapi import Depends, FastAPI, Response
from fastapi.responses import StreamingResponse
import io
from fastapi.middleware.cors import CORSMiddleware
from rio_tiler.io import Reader
from aws_lambda_powertools import Logger

from app.model import PointCreate

# ロガーの設定
logger = Logger(service="satellite-image-api")

app = FastAPI(
    title="衛星画像API",
    description="衛星画像を取得するためのAPI",
    version="1.0.0"
)

# CORS設定
cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Type"],
)

pool = None

async def init_pool_with_retry(dsn, max_retries=3, delay=3):
    last_err = None
    for i in range(max_retries):
        try:
            return await asyncpg.create_pool(dsn=dsn)
        except Exception as e:
            last_err = e
            if i < max_retries - 1:
                print(f"DBプール初期化リトライ {i+1}回目失敗。{delay}秒待つ…")
                await asyncio.sleep(delay)
    raise last_err

@app.on_event("startup")
def on_startup():
    global pool
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL環境変数が設定されていません。デフォルト値を使用します。")
        database_url = "postgresql://postgres:postgres@localhost:5432/satellite_image_db"
    try:
        pool = init_pool_with_retry(dsn=database_url)
        logger.info("データベース接続プールを初期化しました")
    except Exception as e:
        logger.error(f"データベース接続プールの初期化に失敗しました: {str(e)}")
        pool = None

# # データベース接続プールの初期化
# # 環境変数からデータベースURLを取得
# database_url = os.environ.get("DATABASE_URL")
# if not database_url:
#     logger.warning("DATABASE_URL環境変数が設定されていません。デフォルト値を使用します。")
#     database_url = "postgresql://postgres:postgres@localhost:5432/satellite_image_db"

# # 接続プールの作成
# try:
#     pool = psycopg2.pool.SimpleConnectionPool(
#         dsn=database_url, minconn=1, maxconn=10
#     )
#     logger.info("データベース接続プールを初期化しました")
# except Exception as e:
#     logger.error(f"データベース接続プールの初期化に失敗しました: {str(e)}")
#     # Lambda環境では起動時にエラーが発生してもサービスは継続する
#     # 実際のリクエスト時に再接続を試みる
#     pool = None

def get_connection():
    """データベース接続を取得する関数"""
    global pool
    
    # プールが存在しない場合は再初期化を試みる
    if pool is None:
        try:
            pool = psycopg2.pool.SimpleConnectionPool(
                dsn=database_url, minconn=1, maxconn=10
            )
            logger.info("データベース接続プールを再初期化しました")
        except Exception as e:
            logger.error(f"データベース接続プールの再初期化に失敗しました: {str(e)}")
            raise
    
    try:
        conn = pool.getconn()
        yield conn
    except Exception as e:
        logger.error(f"データベース接続の取得に失敗しました: {str(e)}")
        raise
    finally:
        try:
            if conn:
                pool.putconn(conn)
        except Exception as e:
            logger.error(f"データベース接続の返却に失敗しました: {str(e)}")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/points")
def get_points(conn=Depends(get_connection)):

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, ST_X(geom) as longitude, ST_Y(geom) as latitude FROM points"
        )
        res = cur.fetchall()

    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [longitude, latitude],
            },
            "properties": {
                "id": id,
            },
        }
        for id, longitude, latitude in res
    ]
    return {"type": "FeatureCollection", "features": features}

@app.post("/points")
def create_point(data: PointCreate, conn=Depends(get_connection)):
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO points (geom) VALUES (ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                (data.longitude, data.latitude),
            )
        conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT lastval()")
            res = cur.fetchone()
            _id = res[0]

            cur.execute(
                "SELECT id, ST_X(geom) as longitude, ST_Y(geom) as latitude FROM points WHERE id = %s",
                (_id,),
            )
            id, longitude, latitude = cur.fetchone()

        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [longitude, latitude],
            },
            "properties": {
                "id": id,
            },
        }
    except Exception as e:
        conn.rollback()
        return {"error": str(e)}

@app.delete("/points/{id}")
def delete_point(id: int, conn=Depends(get_connection)):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM points WHERE id = %s", (id,))
    conn.commit()
    return Response(status_code=204)

@app.get("/points/{point_id}/satellite.jpg")
async def satellite_preview (
    point_id: int,max_size: int = 256,
    conn=Depends(get_connection)
):
    if max_size > 1024:
        return Response(status_code=400)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT ST_X(geom) as longitude, ST_Y(geom) as latitude FROM points WHERE id = %s",
            (point_id,),
        )
        res = cur.fetchone()
    if not res:
        return Response(status_code=404)

    longitude, latitude = res

    buffer = 0.01
    minx = longitude - buffer
    maxx = longitude + buffer
    miny = latitude - buffer
    maxy = latitude + buffer

    result = await search_dataset(
        minx, miny, maxx, maxy, limit=1
    )
    if len(result["features"]) == 0:
        return Response(status_code=404)
    feature = result["features"][0]
    cog_url = feature["assets"]["visual"]["href"]

    with Reader(cog_url) as src:
        img = src.preview(max_size=max_size)
    jpg=img.render(img_format="JPEG")
    print(f"画像バイナリサイズ: {len(jpg)} bytes")
    return StreamingResponse(io.BytesIO(jpg), media_type="image/jpeg")


async def search_dataset(minx: float, miny: float, maxx: float, maxy: float, limit: int = 12):
    url = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items"
    params = {
        "limit": limit,
        "bbox": f"{minx},{miny},{maxx},{maxy}",
    }
    headers = {
        "Accept": "application/json",
    }
    async with httpx.AsyncClient() as client:
       res = await client.get(url, params=params, headers=headers)
       res.raise_for_status()
       dataset = res.json()

    return dataset