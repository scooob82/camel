<?php
declare(strict_types=1);

namespace Cas;

use Cas\Http\HttpError;

final class Support
{
    public static function id(string $prefix = ''): string
    {
        return $prefix . rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
    }

    public static function token(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function validId(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[A-Za-z0-9_-]{4,64}$/', $id) === 1;
    }

    public static function email(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    /** Validate a user password and collect errors into $errors. */
    public static function checkPassword(string $password, string $field, array &$errors): void
    {
        if (mb_strlen($password) < 10) {
            $errors[$field] = 'Use at least 10 characters.';
        } elseif (mb_strlen($password) > 200) {
            $errors[$field] = 'Password is too long.';
        }
    }

    /**
     * Validate a project file (CamelFile JSON) and return it re-encoded.
     * Only the shape is checked; the content is owned by the client.
     */
    public static function projectData(mixed $file, int $maxBytes): string
    {
        if (!is_array($file) || array_is_list($file) && $file !== [] || !isset($file['routes'], $file['onExceptions']) || !is_array($file['routes']) || !is_array($file['onExceptions'])) {
            throw HttpError::validation(['file' => 'Invalid project file.']);
        }
        $json = json_encode($file, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen($json) > $maxBytes) {
            throw new HttpError(413, 'too_large', sprintf('Project is larger than %d kB.', intdiv($maxBytes, 1000)));
        }
        return $json;
    }

    public static function decode(string $json): mixed
    {
        return json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    }
}
