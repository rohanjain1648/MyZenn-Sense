import { useEffect, useState } from 'react';

export interface CameraOption {
  id: string;
  label: string;
}

/**
 * Video inputs on this computer. Listing devices does not turn a camera on.
 * In the desktop app, main.cjs grants the 'media' permission check to the
 * app's own page so labels are available before the first session.
 */
export async function listCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput' && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function useCameras(): CameraOption[] {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      listCameras()
        .then((list) => alive && setCameras(list))
        .catch(() => alive && setCameras([]));
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, []);
  return cameras;
}
