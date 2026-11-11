// Smoke check used by `npm run smoke` (electron/main.cjs, MYZENN_SMOKE=1).
// Verifies the packaged page can reach both preload bridges and load the
// SmartSpectra renderer module. It never constructs or starts the SDK, so it
// never opens the camera and never spends Presage credits.
if (window.myzennSense) {
  (window as unknown as { __senseSmoke: () => Promise<unknown> }).__senseSmoke = async () => {
    const config = await window.myzennSense!.getConfig();
    const sdk = (await import('@smartspectra/node-sdk/renderer')) as Record<string, unknown>;
    const messages = (await import('@smartspectra/node-sdk/messages')) as Record<string, unknown>;
    // Listing devices never turns a camera on.
    const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    const cams = devices.filter((d) => d.kind === 'videoinput');
    return {
      cameras: cams.length,
      cameraNamesVisible: cams.some((d) => !!d.label),
      requestInsight: typeof (sdk.SmartSpectraSDK as { prototype?: { requestInsight?: unknown } })?.prototype?.requestInsight,
      appBridge: true,
      presageBridge: !!window.__smartspectraBridge,
      rendered: (document.getElementById('root')?.childElementCount ?? 0) > 0,
      sdkClass: typeof sdk.SmartSpectraSDK,
      decodeMetrics: typeof messages.decodeMetrics,
      hasPresageKey: config.hasPresageKey,
      aiProviders: config.aiProviders,
      sdkVersion: config.sdkVersion,
      platform: config.platform,
    };
  };
}

export {};
