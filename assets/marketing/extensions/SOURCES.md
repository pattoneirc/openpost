# Extension screenshots

`youtube-localizer-745a10444f66.webp` is a cropped screenshot of YouTube Studio in Brave, showing YouTube Localizer’s injected Generate button beside the thumbnail of the public video [Programação Web, em ~4 horas](https://www.youtube.com/watch?v=blA8L2Fzq9E). Captured on 2026-10-08.

The screenshot shows the real video and Studio interface. No account avatar, API keys or private videos are visible. No generation or Studio changes were made for this capture. The crop was encoded as WebP without changing its contents.

`x-timeline-blocker-08db3f799836.webp` shows the packaged X Timeline Blocker 0.1.1 running over OpenPost’s maintained `SocialPreviewPage` X preview, captured on 2026-10-08 in an isolated Chromium profile.

The extension’s unmodified content script hides the preview feed and inserts its real gate UI. The composer, navigation and sidebars remain visible. The capture harness supplies X’s timeline DOM identifiers so the extension can discover the preview feed. The timer and Browse timeline button are rendered by the extension.

This is OpenPost’s X preview with sample posts, not a live X account. No real profile, account data, API keys or paid requests were used. The screenshot was encoded as WebP without changing its contents.

Image filenames include a content hash because deployed assets use immutable caching. Keep the catalogue and asset manifest in sync when replacing a screenshot.

The added settings gallery was captured from the packaged extensions in isolated Chromium profiles. The existing lead screenshots above remain unchanged.

- `feed-limiter-885e055990fe.png` and `feed-limiter-shared-limits-4caa485f92d5.png`: Feed Limiter 0.2.0 settings, captured 11 October 2026. They show example YouTube controls and a saved shared allowance with a weekday browsing window.
- `youtube-localizer-settings-light-4375ddc0c5ef.png` and `youtube-localizer-settings-advanced-6fac8c6ee1ff.png`: YouTube Localizer 0.7.3 settings, captured 12 October 2026 with provider controls and advanced options. Provider fields are empty. All HTTP(S) requests were blocked during capture.

These are unedited screenshots of the packaged extension UI. No account data, private content, API keys or paid provider requests were used.
