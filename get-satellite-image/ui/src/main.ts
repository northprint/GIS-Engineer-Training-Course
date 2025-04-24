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
    zoom: 12,
  },
});

// Marker関連の処理
const markers: Marker[] = [];
let isMarkerClicked = false;

const createPopupDom = async (id: string) => {
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

  // 画像を表示する要素
  const anchor = document.createElement("a");
  anchor.href = await satelliteImageUrl(id, 1024);
  anchor.style.display = "none"; // 最初は非表示

  // 画像要素
  const img = document.createElement("img");
  img.width = 256;
  img.height = 256;
  img.alt = "衛星画像";
  img.src = await satelliteImageUrl(id);

  // 画像の読み込みが完了したらローディング表示を非表示にして画像を表示
  img.onload = () => {
    loadingDiv.style.display = "none";
    anchor.style.display = "block";
  };

  // 画像の読み込みに失敗した場合
  img.onerror = () => {
    loadingDiv.textContent = "画像の読み込みに失敗しました";
    loadingDiv.style.backgroundColor = "#ffeeee";
  };

  anchor.appendChild(img);

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

  popupDom.appendChild(loadingDiv);
  popupDom.appendChild(anchor);
  popupDom.appendChild(buttonDom);
  return popupDom;
};

const loadMarkers = async () => {
  const points = await loadPoints();
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
};

const clearMarkers = () => {
  markers.forEach((marker) => marker.remove());
};

map.on("load", async () => {
  await loadMarkers();
});

map.on("click", async (e) => {
  if (isMarkerClicked) {
    isMarkerClicked = false;
    return;
  }

  if (!confirm("地点を作成しますか？")) return;

  const { lng, lat } = e.lngLat;
  await createPoint({ longitude: lng, latitude: lat });
  clearMarkers();
  await loadMarkers();
});
