// config.jsonからAPIエンドポイントを取得
let cachedApiHost: string | null = null;

async function getApiHost(): Promise<string> {
  if (cachedApiHost !== null) return cachedApiHost as string;
  try {
    const res = await fetch("/config.json");
    if (!res.ok) throw new Error("config.json fetch failed");
    const config = await res.json();
    if (!config.apiEndpoint)
      throw new Error("apiEndpoint not found in config.json");
    cachedApiHost = (config.apiEndpoint ?? "http://localhost:3000").replace(
      /\/$/,
      ""
    ); // 末尾スラッシュ除去
    if (cachedApiHost !== null) {
      return cachedApiHost;
    } else {
      throw new Error("cachedApiHost is null");
    }
  } catch (e) {
    // 開発時はローカルAPI fallback
    console.error("config.jsonの取得に失敗しました: ", e);
    return "http://localhost:3000";
  }
}

const createPoint = async (data: { longitude: number; latitude: number }) => {
  const apiHost = await getApiHost();
  const response = await fetch(`${apiHost}/points`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return await response.json();
};

const deletePoint = async (id: string) => {
  const apiHost = await getApiHost();
  const response = await fetch(`${apiHost}/points/${id}`, {
    method: "DELETE",
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response;
};

type PointsResponse = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      id: string;
    };
  }[];
};

const loadPoints = async (): Promise<PointsResponse> => {
  const apiHost = await getApiHost();
  const response = await fetch(`${apiHost}/points`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  const data = await response.json();
  return data;
};

const satelliteImageUrl = async (
  id: string,
  maxSize: number = 256
): Promise<string> => {
  const apiHost = await getApiHost();
  return `${apiHost}/points/${id}/satellite.jpg?max_size=${maxSize}`;
};

export { createPoint, deletePoint, loadPoints, satelliteImageUrl };
