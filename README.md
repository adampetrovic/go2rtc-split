# go2rtc Split

A small fullscreen PWA for watching multiple [go2rtc](https://github.com/AlexxIT/go2rtc) streams at once. It is designed to be mounted under an existing go2rtc hostname, for example:

```text
https://go2rtc.example.test/split/
```

The app connects back to the same origin by default:

```text
wss://go2rtc.example.test/api/ws?src=<stream>
```

That means an Envoy/Gateway route can send `/split/*` to this container while leaving `/api/ws`, `/video-rtc.js`, `/stream.html`, and the rest of go2rtc on the existing go2rtc backend.

## Features

- Multiple go2rtc streams in a split view.
- Browser-mixed audio from all unmuted streams, with per-stream focus audio.
- iPad-friendly start screen for Safari audio permissions.
- Fullscreen PWA manifest served from the configured base path.
- PWA-safe per-stream focus mode that does not require the browser Fullscreen API.
- Pinch or pointer zoom and pan per stream for framing.
- Auto reconnect with backoff.
- Optional mute controls, browser fullscreen controls, stream focus controls, and audio meters.
- Runtime configuration via environment variables.
- Docker image build and GHCR publish workflow.

## Local development

```bash
npm install
npm run dev
```

For the full production server locally:

```bash
npm run build
PORT=8080 BASE_PATH=/split npm run preview
```

Then open:

```text
http://localhost:8080/split/
```

## Docker

```bash
docker build -t go2rtc-split .
docker run --rm -p 8080:8080 \
  -e BASE_PATH=/split \
  -e GO2RTC_STREAMS='stream_a:Stream A,stream_b:Stream B' \
  go2rtc-split
```

## UX model

- Split view shows every configured stream.
- Per-stream **Full screen** buttons enter focus mode. In installed PWA mode this is an in-app fullscreen fallback; in browsers that support native fullscreen the stream can also enter browser fullscreen.
- In focus mode, the active stream fills the app and its button changes to **Split view**.
- Pinch a stream to zoom it, drag while zoomed to reframe it, and double-tap to reset the crop.
- If `DOCUMENT_FULLSCREEN_BUTTON=true`, non-PWA browsers also get a global browser-fullscreen button.

## Configuration

All configuration is read at container start and exposed to the browser through `<BASE_PATH>/config.json`.

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `8080` | HTTP listen port. |
| `HOST` | `0.0.0.0` | HTTP listen address. |
| `BASE_PATH` | `/split` | Path where the app is mounted. |
| `APP_NAME` | `go2rtc Split` | Name shown on the start screen and manifest. |
| `PAGE_TITLE` | `go2rtc Split` | Browser page title. |
| `GO2RTC_STREAMS` / `STREAMS` | unset | Streams to show. Supports comma format or JSON array. |
| `GO2RTC_WS_PATH` | `/api/ws` | Same-origin go2rtc WebSocket path. |
| `GO2RTC_WS_URL` | unset | Absolute WebSocket URL. Supports `{src}` placeholder. Overrides `GO2RTC_WS_PATH`. |
| `GO2RTC_STREAM_PARAM` | `src` | Query parameter name for the stream source. |
| `GO2RTC_QUERY` | unset | Extra query string added to WebSocket URLs, for example `media=video+audio`. |
| `LAYOUT` | `auto` | `auto`, `stack`, or `grid`. |
| `OBJECT_FIT` | `contain` | CSS video fit: `contain`, `cover`, or `fill`. |
| `AUDIO_MODE` | `mixed` | `mixed` or `muted`. Browser output mixing is used. |
| `START_MUTED` | `false` | Start every stream muted. |
| `DEFAULT_VOLUME` | `1` | Initial per-video volume from `0` to `1`. |
| `SHOW_CONTROLS` | `true` | Show global and per-stream controls. |
| `SHOW_STATUS` | `true` | Reserved for status display. |
| `NATIVE_VIDEO_CONTROLS` | `false` | Enable native browser video controls. |
| `WAKE_LOCK` | `true` | Request screen wake lock where supported. |
| `FULLSCREEN_BUTTON` | `true` | Master switch for fullscreen/focus controls. |
| `DOCUMENT_FULLSCREEN_BUTTON` | `true` | Show the global browser fullscreen button when supported. |
| `STREAM_FULLSCREEN_BUTTON` | `true` | Show per-stream focus/fullscreen buttons, including PWA fallback focus mode. |
| `AUDIO_METERS` | `true` | Show per-stream audio meters. |
| `AUDIO_UNLOCK_PROMPT` | `true` | Show a tap-to-enable-audio prompt if browser autoplay policy blocks playback. |
| `SLEEP_RECOVERY` | `true` | On return from lock/background, resume audio contexts, retry playback, and optionally restart streams. |
| `SLEEP_RECOVERY_RECONNECT_MS` | `30000` | Restart all WebRTC streams after the app has been hidden for at least this long. Set `0` to reconnect on every resume. |
| `RECONNECT_MIN_MS` | `1000` | Minimum reconnect backoff. |
| `RECONNECT_MAX_MS` | `15000` | Maximum reconnect backoff. |
| `ICE_SERVERS` | Cloudflare and Google STUN | Comma-separated ICE server URLs, or a JSON `RTCIceServer[]`. |

### Stream format

Comma format:

```text
GO2RTC_STREAMS=stream_a:Stream A,stream_b:Stream B
```

JSON format:

```json
[
  { "id": "stream-a", "src": "stream_a", "label": "Stream A" },
  { "id": "stream-b", "src": "stream_b", "label": "Stream B", "muted": false }
]
```

## Gateway routing shape

The intended deployment is a path-specific route on the existing go2rtc hostname:

```yaml
route:
  split:
    hostnames:
      - "go2rtc.${SECRET_DOMAIN}"
    parentRefs:
      - name: envoy-internal
        namespace: network
    rules:
      - matches:
          - path:
              type: PathPrefix
              value: /split
        backendRefs:
          - identifier: app
            port: http
```

The existing go2rtc route should remain as the catch-all for the same hostname.

## CI and publishing

- `.github/workflows/ci.yaml` runs type checks, tests, and a production build.
- `.github/workflows/container.yaml` builds the Docker image on pull requests and publishes to GHCR on pushes to `main` or SemVer tags.

Published image name:

```text
ghcr.io/<owner>/go2rtc-split
```

Versioned releases use SemVer tags in the form `vMAJOR.MINOR.PATCH`, for example `v0.1.0`. Pushing a SemVer tag publishes matching container tags:

```text
ghcr.io/<owner>/go2rtc-split:v0.1.0
ghcr.io/<owner>/go2rtc-split:0.1.0
ghcr.io/<owner>/go2rtc-split:0.1
```

The `latest` tag is only published from the default branch.
