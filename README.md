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
- Browser-mixed audio from all unmuted streams.
- iPad-friendly start screen for Safari audio permissions.
- Fullscreen PWA manifest served from the configured base path.
- Auto reconnect with backoff.
- Per-stream mute controls and optional audio meters.
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
| `FULLSCREEN_BUTTON` | `true` | Show fullscreen button where supported. |
| `AUDIO_METERS` | `true` | Show per-stream audio meters. |
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
- `.github/workflows/container.yaml` builds the Docker image on pull requests and publishes to GHCR on pushes to `main` or version tags.

Published image name:

```text
ghcr.io/<owner>/go2rtc-split
```
