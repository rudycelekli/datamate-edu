"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

const FIPS_TO_NAME: Record<string, string> = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California",
  "08": "Colorado", "09": "Connecticut", "10": "Delaware", "11": "District of Columbia", "12": "Florida",
  "13": "Georgia", "15": "Hawaii", "16": "Idaho", "17": "Illinois", "18": "Indiana",
  "19": "Iowa", "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine",
  "24": "Maryland", "25": "Massachusetts", "26": "Michigan", "27": "Minnesota", "28": "Mississippi",
  "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada", "33": "New Hampshire",
  "34": "New Jersey", "35": "New Mexico", "36": "New York", "37": "North Carolina", "38": "North Dakota",
  "39": "Ohio", "40": "Oklahoma", "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island",
  "45": "South Carolina", "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah",
  "50": "Vermont", "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin",
  "56": "Wyoming",
};

interface USMapProps {
  data: Record<string, { units: number; volume: number }>;
  onStateClick?: (state: string) => void;
  selectedState?: string;
  formatCurrency: (n: number) => string;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  abbr: string;
  name: string;
  units: number;
  volume: number;
}

interface GeoFeature {
  type: string;
  id: string;
  properties: Record<string, string>;
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

// Simple GeoJSON path generator using Albers USA projection
function albersUsaProject(lon: number, lat: number): [number, number] | null {
  // Main continental US - simplified Albers equal-area conic
  const toRad = Math.PI / 180;
  const phi1 = 29.5 * toRad;
  const phi2 = 45.5 * toRad;
  const phi0 = 38 * toRad;
  const lam0 = -96 * toRad;

  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const C = Math.cos(phi1) * Math.cos(phi1) + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;

  const lam = lon * toRad;
  const phi = lat * toRad;
  const theta = n * (lam - lam0);
  const rho = Math.sqrt(C - 2 * n * Math.sin(phi)) / n;

  let x = rho * Math.sin(theta);
  let y = rho0 - rho * Math.cos(theta);

  // Scale to SVG space
  x = 480 + x * 1050;
  y = 300 - y * 1050;

  // Alaska (shift and scale)
  if (lon < -130 && lat > 50) {
    const ax = 170 + (lon + 180) * 0.4;
    const ay = 510 - (lat - 50) * 6;
    return [ax, ay];
  }

  // Hawaii
  if (lon < -150 && lat < 25) {
    const hx = 250 + (lon + 160) * 5;
    const hy = 510 + (lat - 20) * 5;
    return [hx, hy];
  }

  return [x, y];
}

function topoToGeo(topo: { type: string; objects: Record<string, { type: string; geometries: Array<{ type: string; id: string; properties: Record<string, string>; arcs: number[][] | number[][][] }> }>; arcs: number[][][] ; transform?: { scale: [number, number]; translate: [number, number] } }): GeoFeature[] {
  const obj = topo.objects.states;
  if (!obj) return [];

  const scale = topo.transform?.scale || [1, 1];
  const translate = topo.transform?.translate || [0, 0];

  // Decode arcs
  const decodedArcs: number[][][] = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  function decodeArc(idx: number): number[][] {
    if (idx >= 0) return decodedArcs[idx];
    return [...decodedArcs[~idx]].reverse();
  }

  function decodeRing(indices: number[]): number[][] {
    const coords: number[][] = [];
    indices.forEach((idx) => {
      const arc = decodeArc(idx);
      arc.forEach((pt, i) => {
        if (i > 0 || coords.length === 0) coords.push(pt);
      });
    });
    return coords;
  }

  return obj.geometries.map((geom) => {
    let coordinates: number[][][] | number[][][][] = [];
    if (geom.type === "Polygon") {
      coordinates = (geom.arcs as number[][]).map((ring) => decodeRing(ring));
    } else if (geom.type === "MultiPolygon") {
      coordinates = (geom.arcs as number[][][]).map((polygon) =>
        polygon.map((ring) => decodeRing(ring))
      );
    }
    return {
      type: "Feature",
      id: geom.id,
      properties: geom.properties || {},
      geometry: { type: geom.type, coordinates },
    };
  });
}

function geoToPath(feature: GeoFeature): string {
  const { type, coordinates } = feature.geometry;

  function ringToPath(ring: number[][]): string {
    const pts = ring
      .map((c) => albersUsaProject(c[0], c[1]))
      .filter((p): p is [number, number] => p !== null);
    if (pts.length < 3) return "";
    return "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") + "Z";
  }

  let d = "";
  if (type === "Polygon") {
    (coordinates as number[][][]).forEach((ring) => {
      d += ringToPath(ring);
    });
  } else if (type === "MultiPolygon") {
    (coordinates as number[][][][]).forEach((polygon) => {
      polygon.forEach((ring) => {
        d += ringToPath(ring);
      });
    });
  }
  return d;
}

const USMap: React.FC<USMapProps> = ({
  data,
  onStateClick,
  selectedState,
  formatCurrency,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [features, setFeatures] = useState<GeoFeature[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, abbr: "", name: "", units: 0, volume: 0,
  });

  useEffect(() => {
    fetch(GEO_URL)
      .then((r) => r.json())
      .then((topo) => {
        const geo = topoToGeo(topo);
        setFeatures(geo);
      })
      .catch(() => {});
  }, []);

  const volumes = Object.values(data).map((d) => d.volume);
  const maxVolume = volumes.length > 0 ? Math.max(...volumes) : 1;

  const getColor = useCallback((vol: number) => {
    const t = Math.max(0.1, vol / maxVolume);
    return `rgba(234, 88, 12, ${0.1 + t * 0.9})`;
  }, [maxVolume]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, abbr: string, name: string) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const stateData = data[abbr];
      let x = e.clientX - rect.left + 12;
      let y = e.clientY - rect.top - 10;
      if (x + 200 > rect.width) x = e.clientX - rect.left - 212;
      if (y < 0) y = 4;
      setTooltip({
        visible: true, x, y, abbr, name,
        units: stateData?.units ?? 0,
        volume: stateData?.volume ?? 0,
      });
    },
    [data]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left + 12;
    const y = e.clientY - rect.top - 10;
    if (x + 200 > rect.width) x = e.clientX - rect.left - 212;
    setTooltip((prev) => ({ ...prev, x, y: y < 0 ? 4 : y }));
  }, []);

  if (features.length === 0) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading map...</div>;
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <svg viewBox="0 0 960 600" className="w-full h-auto">
        {features.map((feature) => {
          const fips = feature.id;
          const abbr = FIPS_TO_ABBR[fips] || "";
          const name = FIPS_TO_NAME[fips] || feature.properties?.name || "";
          const stateData = data[abbr];
          const hasData = !!stateData;
          const isSelected = selectedState === abbr;
          const d = geoToPath(feature);
          if (!d) return null;

          return (
            <path
              key={fips}
              d={d}
              fill={hasData ? getColor(stateData.volume) : "#e5e7eb"}
              stroke={isSelected ? "#ea580c" : "#ffffff"}
              strokeWidth={isSelected ? 2 : 0.75}
              className="cursor-pointer transition-colors duration-150"
              onMouseEnter={(e) => handleMouseEnter(e, abbr, name)}
              onMouseMove={(e) => handleMouseMove(e)}
              onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
              onClick={() => onStateClick?.(abbr)}
            />
          );
        })}
      </svg>

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y, minWidth: 180 }}
        >
          <div className="font-semibold">{tooltip.name} ({tooltip.abbr})</div>
          <div className="mt-1 flex justify-between gap-4 text-gray-300">
            <span>Units:</span>
            <span className="font-medium text-white">{tooltip.units.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4 text-gray-300">
            <span>Volume:</span>
            <span className="font-medium text-white">{formatCurrency(tooltip.volume)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default USMap;
