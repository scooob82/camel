<?php
declare(strict_types=1);

namespace Cas;

use Cas\Http\HttpError;

/** Resolves the signed-in user for the current request. */
final class Auth
{
    private ?array $user = null;
    private bool $resolved = false;

    public function __construct(private Db $db, private Session $session)
    {
    }

    public function user(): ?array
    {
        if ($this->resolved) {
            return $this->user;
        }
        $this->resolved = true;
        $uid = $this->session->get('uid');
        if (!is_string($uid)) {
            return null;
        }
        $user = $this->db->one('SELECT * FROM users WHERE id = ?', [$uid]);
        // session_version changes on password reset → logs out other sessions
        if (!$user || (int) $user['session_version'] !== (int) $this->session->get('sv')) {
            $this->session->logout();
            return null;
        }
        return $this->user = $user;
    }

    public function require(): array
    {
        return $this->user() ?? throw HttpError::unauthorized();
    }

    public function refresh(): void
    {
        $this->resolved = false;
        $this->user = null;
    }

    public static function publicUser(array $u): array
    {
        return [
            'id' => $u['id'],
            'email' => $u['email'],
            'name' => $u['name'],
            'plan' => $u['plan'],
            'role' => $u['role'],
            'emailVerified' => $u['email_verified_at'] !== null,
            'createdAt' => (int) $u['created_at'],
        ];
    }
}
