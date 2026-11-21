<?php
declare(strict_types=1);

namespace Cas;

use Cas\Http\HttpError;

/** Fixed-window rate limiter stored in the database (works on shared hosting). */
final class RateLimiter
{
    public function __construct(private Db $db)
    {
    }

    /** Count a hit; throws 429 when the limit is exceeded. */
    public function hit(string $key, int $max, int $windowSeconds): void
    {
        $k = substr(hash('sha256', $key), 0, 64);
        $now = now();
        $windowMs = $windowSeconds * 1000;
        $row = $this->db->one('SELECT window_start, hits FROM rate_limits WHERE k = ?', [$k]);
        if (!$row || $now - (int) $row['window_start'] >= $windowMs) {
            $this->db->exec('DELETE FROM rate_limits WHERE k = ?', [$k]);
            $this->db->insert('rate_limits', ['k' => $k, 'window_start' => $now, 'hits' => 1]);
            return;
        }
        if ((int) $row['hits'] >= $max) {
            $retry = (int) ceil(($windowMs - ($now - (int) $row['window_start'])) / 1000);
            header('Retry-After: ' . max(1, $retry));
            throw new HttpError(429, 'too_many_requests', 'Too many attempts. Please try again in ' . max(1, (int) ceil($retry / 60)) . ' min.');
        }
        $this->db->exec('UPDATE rate_limits SET hits = hits + 1 WHERE k = ?', [$k]);
    }

    public function clear(string $key): void
    {
        $this->db->exec('DELETE FROM rate_limits WHERE k = ?', [substr(hash('sha256', $key), 0, 64)]);
    }

    public function prune(): int
    {
        return $this->db->exec('DELETE FROM rate_limits WHERE window_start < ?', [now() - 86400000]);
    }
}
