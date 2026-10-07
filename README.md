# FrameCut static release

2026-10-07 release: optional original timestamp overlay. Select the source label region once, then place its frame-aligned pixels at the top-left or top-right of the cropped export. Includes a small output preview. Oversized labels are reduced proportionally.

Stable latest entry: https://raw.githack.com/weigenwu/MOVIE/codex/static-site/index.html

Future updates use this same branch URL. According to https://raw.githack.com/ the branch endpoint refreshes within minutes after a push; high-traffic caching may extend to an hour. Reload an already open editor after the update. Existing commit-pinned `rawcdn.githack.com` links keep their original versions. This free third-party service has no guaranteed uptime or availability on every network.

Validated using this exact WASM engine as a compute library: six AVI/MP4 export cases cover both corners, scaling, nonzero trim starts, disabled overlay, and audio retention. Native FFmpeg independently decoded every output; FFV1 RGB frames matched the expected composite byte-for-byte. Browser UI verification was unavailable in this session.

A browser-local AVI/MP4 crop and trim editor. This branch contains only the prebuilt website and video processing engine. Video inputs and exported results stay on the visitor's device.

Source: https://github.com/weigenwu/MOVIE/tree/134d1f900077efae33e0a03b64989a79bfbb68a2

This branch has no GitHub Actions workflow. It can be served by any HTTPS static host. Publish by pushing this branch, then check the fixed entry and its resources; use commit-pinned CDN URLs only for archived releases.

Third-party components: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10 (GPL-2.0-or-later). Source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10 .

CDN adaptations: the two WebAssembly segments use `.wasm` names so raw.githack.com serves them directly. On the shared githack.com origin, directory handles are kept only in the current page and never persisted to IndexedDB; repeated exports in that page still use the chosen folder. A dedicated hosting origin retains the original persistent-folder behavior.

Run `node verify-release.mjs` to check release engine integrity and shared-origin directory handling.

2026-09-23: All four crop corners now have larger handles and zoom-independent hit targets, including the portion outside video edges. Hover shows the resize direction. Run `node test-crop-handles.mjs` for the edge/zoom regression check. Browser checks covered all four corners at 1x and 3x, 1:1 aspect lock, and MP4 export.

2026-10-05: Simplified labels and spacing, moved repeated instructions into Help, and retained actionable errors and folder-saving status. Browser validation covered a synthetic 320x320 AVI, zoom, crop/time settings, and a 240x240 one-second MP4 export. Existing crop-handle and release-integrity checks pass.

2026-10-06: Dragging the video now always starts a new selection by default, including inside an existing crop; no selection-mode button is required. Handles still resize the crop, and the optional Move selection button (移动选框) enables dragging the existing region without resizing. Escape returns to direct selection. Square crops expose a pixel side-length input; rectangles retain width/height fields. Browser checks covered consecutive forward/reverse selections with no toolbar clicks, click-without-drag, corner resizing, explicit movement, Escape, square side length, and a 160x160 MP4 export from a synthetic AVI. No source video or test output is included in this release.
