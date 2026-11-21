# Studio runner

Sandbox service behind **Run & Debug** and the Saxon engine of the **Transformation Lab**.
The PHP API calls it with a shared token; browsers never talk to it directly.

| Endpoint | Purpose |
|---|---|
| `GET /health` | versions, liveness |
| `POST /run` | load Camel YAML routes into a fresh CamelContext, send the input to `direct:cas-start`, return the trace (one event per processor, keyed by the builder's node ids), mock results, logs, output |
| `POST /transform` | XSLT 3.0 or XQuery 3.1 with Saxon-HE, optional instruction trace with line numbers and timings |

## Security model

1. The frontend replaces external endpoints with `mock:` endpoints before sending a run.
2. `Sandbox.java` rejects routes that use components or languages that could touch the host
   (`exec`, `file`, `sql`, `http`, scripting languages, bean creation …).
3. The container runs read-only, as a non-root user, with CPU, memory and PID limits
   (`docker-compose.yml`). **Block outgoing network traffic on the host firewall.**
4. Every run has a timeout (max 15 s) and size limits; at most 4 runs execute concurrently.

## Run

```bash
cd runner
mvn test                      # unit tests (needs Maven Central access)
RUNNER_TOKEN=$(openssl rand -hex 24) docker compose up -d --build
curl localhost:8090/health
```

Then in `cas-config.php`:

```php
'runner' => ['url' => 'http://<vps>:8090', 'token' => '<same token>'],
```

> Written against Camel 4.10 and Saxon-HE 12 APIs. The code was not compiled in the environment
> it was written in — run `mvn test` first and fix any API drift (most likely spots:
> `CollectingTraceListener` for the Saxon version in use, `PluginHelper.getRoutesLoader`).
