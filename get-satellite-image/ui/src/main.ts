import "maplibre-gl/dist/maplibre-gl.css";
import { Map, Marker, Popup } from "maplibre-gl";

import {
  createPoint,
  loadPoints,
  deletePoint,
  satelliteImageUrl,
} from "./api.ts";

const map = new Map({
  container: "app",
  maxZoom: 18,
  center: [139.767125, 35.681236],
  zoom: 10,
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          "© OpenStreetMap contributors | Copernicus Sentinel data 2024' for Sentinel data",
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
      },
    ],
  },
});

// Marker関連の処理
const markers: Marker[] = [];
let isMarkerClicked = false;

const createPopupDom = (id: string) => {
  const popupDom = document.createElement("div");
  popupDom.style.display = "flex";
  popupDom.style.flexDirection = "column";
  popupDom.style.alignItems = "center";

  // ローディング表示用の要素
  const loadingDiv = document.createElement("div");
  loadingDiv.style.display = "flex";
  loadingDiv.style.justifyContent = "center";
  loadingDiv.style.alignItems = "center";
  loadingDiv.style.width = "256px";
  loadingDiv.style.height = "256px";
  loadingDiv.style.backgroundColor = "#f0f0f0";
  loadingDiv.style.color = "#666";
  loadingDiv.style.fontWeight = "bold";
  loadingDiv.textContent = "衛星画像を読み込み中...";

  popupDom.appendChild(loadingDiv);

  // 削除ボタン
  const buttonDom = document.createElement("button");
  buttonDom.textContent = "削除";
  buttonDom.style.marginTop = "8px";
  buttonDom.style.padding = "4px 12px";
  buttonDom.onclick = async () => {
    if (!confirm("地点を削除しますか？")) return;
    await deletePoint(id);
    clearMarkers();
    await loadMarkers();
  };
  popupDom.appendChild(buttonDom);

  // 画像取得は非同期で実行
  satelliteImageUrl(id, 256)
    .then((blobUrl) => {
      // 画像を表示する要素
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.style.display = "block";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";

      // 画像要素
      const img = document.createElement("img");
      img.width = 256;
      img.height = 256;
      img.alt = "衛星画像";
      img.src = blobUrl;

      img.onload = () => {
        loadingDiv.style.display = "none";
        anchor.style.display = "block";
      };
      img.onerror = () => {
        loadingDiv.textContent = "画像の読み込みに失敗しました";
        loadingDiv.style.backgroundColor = "#ffeeee";
        anchor.style.display = "none";
      };

      anchor.appendChild(img);
      // 画像とダウンロードリンクを削除ボタンの前に挿入
      popupDom.insertBefore(anchor, buttonDom);
    })
    .catch(() => {
      loadingDiv.textContent = "画像の取得に失敗しました";
      loadingDiv.style.backgroundColor = "#ffeeee";
    });

  return popupDom;
};

// --- リトライ付きpoints取得 ---
async function loadPointsWithRetry(maxRetries = 3, delayMs = 1000) {
  let lastErr: unknown = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await loadPoints();
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

const loadMarkers = async () => {
  try {
    const points = await loadPointsWithRetry();
    points.features.forEach((feature) => {
      const popup = new Popup().setMaxWidth("500px");
      const marker = new Marker()
        .setLngLat(feature.geometry.coordinates)
        .addTo(map)
        .setPopup(popup);
      marker.getElement().addEventListener("click", () => {
        isMarkerClicked = true;
        (async () => {
          popup.setDOMContent(await createPopupDom(feature.properties.id));
        })();
      });
      markers.push(marker);
    });
  } catch (err) {
    hideLoadingOverlay();
    alert("ポイント情報の取得に失敗しました。時間をおいて再度お試しください。\n" + (err instanceof Error ? err.message : ""));
  }
};

const clearMarkers = () => {
  markers.forEach((marker) => marker.remove());
};

// === ローディングオーバーレイ操作 ===
function showLoadingOverlay() {
  let overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(255,255,255,0.7)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="spinner"></div>
        <div style='font-size:0.7rem;color:#333;margin-top:16px;'>読み込み中...</div>
      </div>
      <style>
        .spinner {
          width: 48px;
          height: 48px;
          border: 6px solid #ccc;
          border-top: 6px solid #333;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = "flex";
  }
}
function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

map.on("load", async () => {
  showLoadingOverlay();
  await loadMarkers();
  hideLoadingOverlay();
});

map.on("click", async (e) => {
  if (isMarkerClicked) {
    isMarkerClicked = false;
    return;
  }

  if (!confirm("地点を作成しますか？")) return;

  const { lng, lat } = e.lngLat;
  showLoadingOverlay();
  await createPoint({ longitude: lng, latitude: lat });
  clearMarkers();
  await loadMarkers();
  hideLoadingOverlay();
});
