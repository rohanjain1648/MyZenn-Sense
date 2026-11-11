import { Video } from 'lucide-react';
import { updateSettings, useSettings } from '@/privacy/settings';
import { useCameras } from '@/sense/cameras';

/**
 * Choose which camera to measure with. Shown only when there is a real choice
 * (two or more cameras). Choosing does not turn the camera on.
 */
export function CameraPicker({ compact = false }: { compact?: boolean }) {
  const cameras = useCameras();
  const settings = useSettings();
  if (cameras.length < 2) return null;

  // A saved camera that is no longer plugged in falls back to the default.
  const selected = cameras.some((c) => c.id === settings.cameraId) ? (settings.cameraId as string) : '';

  return (
    <label className={compact ? 'mt-6 flex flex-wrap items-center gap-3 text-sm' : 'flex items-start justify-between gap-6 py-4'}>
      <span className={compact ? 'flex items-center gap-2 text-muted-foreground' : ''}>
        {compact ? (
          <>
            <Video className="h-4 w-4" aria-hidden />
            Camera
          </>
        ) : (
          <>
            <span className="block font-medium">Camera</span>
            <span className="mt-1 block text-sm text-muted-foreground">Which camera to measure with. Choosing one does not turn it on.</span>
          </>
        )}
      </span>
      <select
        className="max-w-[18rem] rounded-lg border border-white/10 bg-secondary px-3 py-2 text-sm"
        value={selected}
        onChange={(e) => {
          const camera = cameras.find((c) => c.id === e.target.value);
          updateSettings({ cameraId: camera?.id ?? null, cameraLabel: camera?.label ?? null });
        }}
      >
        <option value="">System default</option>
        {cameras.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
