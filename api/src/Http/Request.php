<?php
declare(strict_types=1);

namespace Cas\Http;

final class Request
{
    /** @var array<string,string> */
    public array $params = [];
    private ?array $json = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $headers,
        public readonly string $body,
        public readonly string $ip,
    ) {
    }

    public static function fromGlobals(): self
    {
        $uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $script = $_SERVER['SCRIPT_NAME'] ?? '';
        $base = rtrim(str_replace('\\', '/', dirname($script)), '/');
        // Support both /api/v1/... (rewrite) and /api/index.php/v1/... (no rewrite)
        if ($script !== '' && str_starts_with($uri, $script)) {
            $path = substr($uri, strlen($script));
        } elseif ($base !== '' && str_starts_with($uri, $base . '/')) {
            $path = substr($uri, strlen($base));
        } else {
            $path = $uri;
        }
        // When served under /api by the dev router
        if (str_starts_with($path, '/api/')) {
            $path = substr($path, 4);
        }
        $headers = [];
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        return new self(
            strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            '/' . trim($path ?: '/', '/'),
            $_GET,
            $headers,
            (string) file_get_contents('php://input'),
            (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /** Parsed JSON body (object). */
    public function json(): array
    {
        if ($this->json !== null) {
            return $this->json;
        }
        if ($this->body === '') {
            return $this->json = [];
        }
        $data = json_decode($this->body, true, 64);
        if (!is_array($data) || array_is_list($data) && $data !== []) {
            throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.');
        }
        return $this->json = $data;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->json()[$key] ?? $default;
    }

    public function string(string $key): string
    {
        $v = $this->json()[$key] ?? '';
        return is_scalar($v) ? trim((string) $v) : '';
    }

    public function isMutating(): bool
    {
        return !in_array($this->method, ['GET', 'HEAD', 'OPTIONS'], true);
    }
}
