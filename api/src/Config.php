<?php
declare(strict_types=1);

namespace Cas;

/**
 * Configuration lookup order:
 *   1. file in the CAS_CONFIG environment variable
 *   2. ../../cas-config.php (one level above the web root — recommended)
 *   3. api/config.php
 */
final class Config
{
    private const DEFAULTS = [
        'app_url' => 'http://localhost:8080',
        'app_name' => 'Camel Studio',
        'debug' => false,
        'db' => ['dsn' => 'sqlite:' . __DIR__ . '/../storage/dev.sqlite', 'user' => null, 'password' => null],
        'mail' => [
            'driver' => 'log',
            'from' => 'no-reply@example.com',
            'from_name' => 'Camel Studio',
            'smtp' => ['host' => '', 'port' => 587, 'user' => '', 'password' => '', 'secure' => 'tls', 'timeout' => 15],
        ],
        'session' => ['name' => 'cas_session', 'lifetime' => 2592000, 'secure' => null],
        'limits' => [
            'free' => ['projects' => 50, 'versions' => 30, 'project_bytes' => 2000000],
            'pro' => ['projects' => 500, 'versions' => 100, 'project_bytes' => 5000000],
            'team' => ['projects' => 2000, 'versions' => 200, 'project_bytes' => 5000000],
        ],
        'require_verified_email' => false,
        'setup_token' => '',
        'storage' => __DIR__ . '/../storage',
    ];

    private function __construct(private array $values)
    {
    }

    public static function load(?string $file = null): self
    {
        $candidates = array_filter([
            $file,
            getenv('CAS_CONFIG') ?: null,
            dirname(__DIR__, 3) . '/cas-config.php',
            dirname(__DIR__) . '/config.php',
        ]);
        $values = [];
        foreach ($candidates as $c) {
            if (is_file($c)) {
                $loaded = require $c;
                if (is_array($loaded)) {
                    $values = $loaded;
                }
                break;
            }
        }
        return new self(self::merge(self::DEFAULTS, $values));
    }

    public static function fromArray(array $values): self
    {
        return new self(self::merge(self::DEFAULTS, $values));
    }

    private static function merge(array $base, array $over): array
    {
        foreach ($over as $k => $v) {
            $base[$k] = is_array($v) && isset($base[$k]) && is_array($base[$k]) && !array_is_list($v) ? self::merge($base[$k], $v) : $v;
        }
        return $base;
    }

    /** Dot-notation access, e.g. get('mail.smtp.host'). */
    public function get(string $key, mixed $default = null): mixed
    {
        $v = $this->values;
        foreach (explode('.', $key) as $part) {
            if (!is_array($v) || !array_key_exists($part, $v)) {
                return $default;
            }
            $v = $v[$part];
        }
        return $v;
    }

    public function storage(string $sub = ''): string
    {
        $dir = rtrim((string) $this->get('storage'), '/') . ($sub !== '' ? '/' . $sub : '');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }
}
